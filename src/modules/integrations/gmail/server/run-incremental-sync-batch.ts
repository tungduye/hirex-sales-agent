import "server-only";

import { randomUUID } from "node:crypto";
import { getFullMessage, GmailApiError, listHistoryPage } from "@/modules/integrations/gmail/server/gmail-api";
import { parseGmailMessage } from "@/modules/integrations/gmail/server/gmail-message-parser";
import { deleteMailboxMessage, recomputeThreadAggregates, upsertMailboxMessage } from "@/modules/integrations/gmail/server/mailbox-persistence";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import { loadSyncCredentials, markReauthenticationRequired, ReauthenticationRequiredError, TransientCredentialError } from "@/modules/integrations/gmail/server/sync-credentials";
import type { GmailHistoryPage, GmailHistoryRecord, IncrementalSyncSafeErrorCode, IncrementalSyncStatus } from "@/modules/integrations/gmail/types/incremental-sync";

const HISTORY_PAGE_SIZE = 100;
const MESSAGE_CONCURRENCY = 5;
const STALE_LOCK_MS = 10 * 60 * 1000;

interface Scope { workspaceId: string; emailAccountId: string }
interface AccountRow { id: string; status: string; provider_history_id: string | null }
interface StateRow {
  id: string;
  status: IncrementalSyncStatus;
  start_history_id: string;
  next_page_token: string | null;
  target_history_id: string | null;
  processed_history_records: number;
  affected_message_count: number;
  synced_message_count: number;
  deleted_message_count: number;
  failed_message_count: number;
  safe_error_code: string | null;
  batch_lock_id: string | null;
  batch_lock_at: string | null;
}
type BatchResult = { success: boolean; completed: boolean; message: string };
type ClaimResult =
  | { kind: "CLAIMED"; state: StateRow }
  | { kind: "BUSY" }
  | { kind: "EXPIRED" }
  | { kind: "CURSOR_CHANGED" };
type PageWork = { kind: "REFETCH" | "DELETE"; messageId: string; threadId: string | null };
type WorkResult = { kind: "SYNCED" | "DELETED"; threadId: string | null } | { kind: "FAILED"; code: IncrementalSyncSafeErrorCode };

export async function runIncrementalSyncBatch(scope: Scope): Promise<BatchResult> {
  try {
    return await executeIncrementalSyncBatch(scope);
  } catch {
    return failure("This incremental sync could not be completed. Please try again.");
  }
}

async function executeIncrementalSyncBatch(scope: Scope): Promise<BatchResult> {
  const supabase = createPrivilegedSupabaseClient();
  const accountResult = await supabase.from("email_accounts")
    .select("id, status, provider_history_id")
    .eq("id", scope.emailAccountId).eq("workspace_id", scope.workspaceId).eq("provider", "GMAIL").maybeSingle();
  const account = accountResult.data as AccountRow | null;
  if (accountResult.error || !account) return failure("This email account could not be synced.");
  if (account.status !== "CONNECTED") return failure("Gmail access expired. Reconnect the account and try again.");
  if (!account.provider_history_id) return failure("Complete the initial mailbox sync before syncing changes.");

  const lockId = randomUUID();
  const claim = await claimState(scope, account.provider_history_id, lockId);
  if (claim.kind === "BUSY") return failure("Another Gmail sync action is already running.");
  if (claim.kind === "EXPIRED") return failure("Gmail history expired. A full mailbox resync is required.");
  if (claim.kind === "CURSOR_CHANGED") return failure("The mailbox checkpoint changed. Refresh and try again.");
  const state = claim.state;

  try {
    const credentials = await loadSyncCredentials(scope.emailAccountId, scope.workspaceId);
    let page: GmailHistoryPage;
    try {
      page = await listHistoryPage(credentials.accessToken, {
        startHistoryId: state.start_history_id,
        pageToken: state.next_page_token,
        maxResults: HISTORY_PAGE_SIZE,
      });
    } catch (error) {
      if (error instanceof GmailApiError && error.status === 404) {
        await failState(scope, state.id, lockId, "HISTORY_ID_EXPIRED");
        return failure("Gmail history expired. A full mailbox resync is required.");
      }
      throw error;
    }

    const targetHistoryId = cleanOpaqueId(page.historyId);
    if (!targetHistoryId) {
      await failState(scope, state.id, lockId, "GMAIL_TEMPORARY_ERROR");
      return failure("Gmail could not be reached. Please try again.");
    }

    const extracted = extractPageWork(page.history ?? []);
    const results = await mapWithConcurrency(extracted.work, MESSAGE_CONCURRENCY, (item) => processWork(scope, credentials.accessToken, credentials.emailAddress, item));
    const failed = results.filter((item): item is Extract<WorkResult, { kind: "FAILED" }> => item.kind === "FAILED");
    const touchedThreads = new Set(results.flatMap((item) => item.kind !== "FAILED" && item.threadId ? [item.threadId] : []));

    if (failed.length === 0) {
      try {
        await recomputeThreadAggregates(scope, touchedThreads);
      } catch {
        failed.push({ kind: "FAILED", code: "MAILBOX_PERSISTENCE_ERROR" });
      }
    }

    if (failed.length > 0) {
      const code = mostImportantError(failed.map((item) => item.code));
      if (code === "REAUTH_REQUIRED") await markReauthenticationRequired(scope.emailAccountId, scope.workspaceId);
      await failState(scope, state.id, lockId, code);
      return failure(messageForCode(code));
    }

    const pageCounters = {
      processed: (page.history ?? []).length,
      affected: extracted.affectedCount,
      synced: results.filter((item) => item.kind === "SYNCED").length,
      deleted: results.filter((item) => item.kind === "DELETED").length,
    };
    if (page.nextPageToken) {
      const checkpoint = await supabase.from("email_incremental_sync_states").update({
        status: "RUNNING",
        next_page_token: page.nextPageToken,
        target_history_id: targetHistoryId,
        processed_history_records: state.processed_history_records + pageCounters.processed,
        affected_message_count: state.affected_message_count + pageCounters.affected,
        synced_message_count: state.synced_message_count + pageCounters.synced,
        deleted_message_count: state.deleted_message_count + pageCounters.deleted,
        last_batch_at: new Date().toISOString(),
        safe_error_code: null,
        batch_lock_id: null,
        batch_lock_at: null,
      }).eq("id", state.id).eq("workspace_id", scope.workspaceId).eq("email_account_id", scope.emailAccountId)
        .eq("status", "RUNNING").eq("batch_lock_id", lockId).select("id").maybeSingle();
      if (checkpoint.error || !checkpoint.data) {
        await releaseLock(scope, state.id, lockId);
        return failure("Sync progress could not be saved. Retrying this page is safe.");
      }
      return success(false, pageCounters, "One history page was synced. More changes remain.");
    }

    const staged = await supabase.from("email_incremental_sync_states").update({ target_history_id: targetHistoryId })
      .eq("id", state.id).eq("workspace_id", scope.workspaceId).eq("email_account_id", scope.emailAccountId)
      .eq("status", "RUNNING").eq("batch_lock_id", lockId).select("id").maybeSingle();
    if (staged.error || !staged.data) {
      await releaseLock(scope, state.id, lockId);
      return failure("Sync completion could not be saved. Retrying this page is safe.");
    }

    const finalized = await supabase.rpc("finalize_incremental_email_sync", {
      p_state_id: state.id,
      p_workspace_id: scope.workspaceId,
      p_email_account_id: scope.emailAccountId,
      p_batch_lock_id: lockId,
      p_processed_history_records: pageCounters.processed,
      p_affected_message_count: pageCounters.affected,
      p_synced_message_count: pageCounters.synced,
      p_deleted_message_count: pageCounters.deleted,
      p_failed_message_count: 0,
    });
    if (finalized.error || finalized.data !== true) {
      const cursorChanged = await hasAccountCursorChanged(scope, state.start_history_id);
      await failState(scope, state.id, lockId, cursorChanged ? "CURSOR_CHANGED" : "MAILBOX_PERSISTENCE_ERROR");
      return failure(cursorChanged ? "The mailbox checkpoint changed. Refresh and try again." : "Sync completion could not be saved. Retrying this page is safe.");
    }
    return success(true, pageCounters, "Gmail changes are up to date.");
  } catch (error) {
    const code = classifyError(error);
    if (code === "REAUTH_REQUIRED") await markReauthenticationRequired(scope.emailAccountId, scope.workspaceId);
    await failState(scope, state.id, lockId, code);
    return failure(messageForCode(code));
  }
}

async function claimState(scope: Scope, accountCursor: string, lockId: string): Promise<ClaimResult> {
  const supabase = createPrivilegedSupabaseClient();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const loaded = await supabase.from("email_incremental_sync_states").select(STATE_COLUMNS)
      .eq("workspace_id", scope.workspaceId).eq("email_account_id", scope.emailAccountId).maybeSingle();
    if (loaded.error) throw new Error("INCREMENTAL_STATE_READ_FAILED");
    const current = loaded.data as StateRow | null;
    if (!current) {
      const now = new Date().toISOString();
      const created = await supabase.from("email_incremental_sync_states").insert({
        workspace_id: scope.workspaceId, email_account_id: scope.emailAccountId,
        status: "RUNNING", start_history_id: accountCursor, next_page_token: null, target_history_id: null,
        started_at: now, completed_at: null, last_batch_at: null, safe_error_code: null,
        batch_lock_id: lockId, batch_lock_at: now,
      }).select(STATE_COLUMNS).maybeSingle();
      if (!created.error && created.data) return { kind: "CLAIMED", state: created.data as StateRow };
      if (created.error?.code === "23505") continue;
      throw new Error("INCREMENTAL_STATE_CREATE_FAILED");
    }

    if (current.batch_lock_id && !isStale(current.batch_lock_at)) return { kind: "BUSY" };
    if (current.batch_lock_id) {
      const stale = await supabase.from("email_incremental_sync_states").update({ batch_lock_id: null, batch_lock_at: null })
        .eq("id", current.id).eq("workspace_id", scope.workspaceId).eq("batch_lock_id", current.batch_lock_id)
        .lt("batch_lock_at", new Date(Date.now() - STALE_LOCK_MS).toISOString());
      if (stale.error) throw new Error("INCREMENTAL_STALE_LOCK_FAILED");
    }

    if (current.status === "FAILED" && current.safe_error_code === "HISTORY_ID_EXPIRED") return { kind: "EXPIRED" };
    if (current.status !== "COMPLETED" && current.start_history_id !== accountCursor) {
      await markCursorChanged(scope, current.id);
      return { kind: "CURSOR_CHANGED" };
    }

    const now = new Date().toISOString();
    const update = current.status === "COMPLETED"
      ? {
          status: "RUNNING", start_history_id: accountCursor, next_page_token: null, target_history_id: null,
          processed_history_records: 0, affected_message_count: 0, synced_message_count: 0,
          deleted_message_count: 0, failed_message_count: 0, started_at: now, completed_at: null,
          last_batch_at: null, safe_error_code: null, batch_lock_id: lockId, batch_lock_at: now,
        }
      : { status: "RUNNING", safe_error_code: null, batch_lock_id: lockId, batch_lock_at: now };
    let query = supabase.from("email_incremental_sync_states").update(update)
      .eq("id", current.id).eq("workspace_id", scope.workspaceId).is("batch_lock_id", null);
    if (current.status === "COMPLETED") query = query.eq("status", "COMPLETED");
    else query = query.eq("start_history_id", accountCursor).in("status", ["RUNNING", "FAILED"]);
    const claimed = await query.select(STATE_COLUMNS).maybeSingle();
    if (claimed.error) throw new Error("INCREMENTAL_STATE_CLAIM_FAILED");
    if (claimed.data) return { kind: "CLAIMED", state: claimed.data as StateRow };
    return { kind: "BUSY" };
  }
  return { kind: "BUSY" };
}

function extractPageWork(records: GmailHistoryRecord[]) {
  const refetch = new Map<string, string | null>();
  const deleted = new Map<string, string | null>();
  for (const record of records) {
    for (const event of [...(record.messagesAdded ?? []), ...(record.labelsAdded ?? []), ...(record.labelsRemoved ?? [])]) {
      const id = cleanOpaqueId(event.message?.id);
      if (id && !refetch.has(id)) refetch.set(id, cleanOpaqueId(event.message?.threadId));
    }
    for (const event of record.messagesDeleted ?? []) {
      const id = cleanOpaqueId(event.message?.id);
      if (id) deleted.set(id, cleanOpaqueId(event.message?.threadId));
    }
  }
  for (const id of deleted.keys()) refetch.delete(id);
  const work: PageWork[] = [
    ...[...refetch].map(([messageId, threadId]) => ({ kind: "REFETCH" as const, messageId, threadId })),
    ...[...deleted].map(([messageId, threadId]) => ({ kind: "DELETE" as const, messageId, threadId })),
  ];
  return { work, affectedCount: new Set([...refetch.keys(), ...deleted.keys()]).size };
}

async function processWork(scope: Scope, accessToken: string, emailAddress: string, work: PageWork): Promise<WorkResult> {
  try {
    if (work.kind === "DELETE") {
      return { kind: "DELETED", threadId: await deleteMailboxMessage(scope, work.messageId, work.threadId) };
    }
    try {
      const resource = await getFullMessage(accessToken, work.messageId);
      const parsed = parseGmailMessage(resource, emailAddress);
      if (!parsed) return { kind: "FAILED", code: "MAILBOX_PERSISTENCE_ERROR" };
      if (parsed.labels.includes("SPAM") || parsed.labels.includes("TRASH")) {
        return {
          kind: "DELETED",
          threadId: await deleteMailboxMessage(
            scope,
            work.messageId,
            parsed.providerThreadId || work.threadId,
          ),
        };
      }
      return { kind: "SYNCED", threadId: await upsertMailboxMessage(scope, parsed) };
    } catch (error) {
      if (error instanceof GmailApiError && error.status === 404) {
        return { kind: "DELETED", threadId: await deleteMailboxMessage(scope, work.messageId, work.threadId) };
      }
      throw error;
    }
  } catch (error) {
    return { kind: "FAILED", code: classifyError(error) };
  }
}

async function failState(scope: Scope, stateId: string, lockId: string, safeErrorCode: IncrementalSyncSafeErrorCode) {
  const supabase = createPrivilegedSupabaseClient();
  await supabase.from("email_incremental_sync_states").update({
    status: "FAILED", safe_error_code: safeErrorCode, batch_lock_id: null, batch_lock_at: null,
  }).eq("id", stateId).eq("workspace_id", scope.workspaceId).eq("email_account_id", scope.emailAccountId).eq("batch_lock_id", lockId);
}

async function releaseLock(scope: Scope, stateId: string, lockId: string) {
  const supabase = createPrivilegedSupabaseClient();
  await supabase.from("email_incremental_sync_states").update({ batch_lock_id: null, batch_lock_at: null })
    .eq("id", stateId).eq("workspace_id", scope.workspaceId).eq("email_account_id", scope.emailAccountId).eq("batch_lock_id", lockId);
}

async function markCursorChanged(scope: Scope, stateId: string) {
  const supabase = createPrivilegedSupabaseClient();
  await supabase.from("email_incremental_sync_states").update({ status: "FAILED", safe_error_code: "CURSOR_CHANGED" })
    .eq("id", stateId).eq("workspace_id", scope.workspaceId).eq("email_account_id", scope.emailAccountId).is("batch_lock_id", null);
}

async function hasAccountCursorChanged(scope: Scope, startHistoryId: string) {
  const supabase = createPrivilegedSupabaseClient();
  const { data } = await supabase.from("email_accounts").select("provider_history_id")
    .eq("id", scope.emailAccountId).eq("workspace_id", scope.workspaceId).eq("provider", "GMAIL").maybeSingle();
  return (data as { provider_history_id?: string } | null)?.provider_history_id !== startHistoryId;
}

function classifyError(error: unknown): IncrementalSyncSafeErrorCode {
  if (error instanceof ReauthenticationRequiredError) return "REAUTH_REQUIRED";
  if (error instanceof TransientCredentialError) return "GMAIL_TEMPORARY_ERROR";
  if (error instanceof GmailApiError) {
    if (error.category === "AUTHENTICATION") return "REAUTH_REQUIRED";
    if (error.status === 403) return "GMAIL_PERMISSION_DENIED";
    if (error.status === 429) return "GMAIL_RATE_LIMITED";
    return "GMAIL_TEMPORARY_ERROR";
  }
  return "MAILBOX_PERSISTENCE_ERROR";
}

function mostImportantError(codes: IncrementalSyncSafeErrorCode[]) {
  return codes.find((code) => code === "REAUTH_REQUIRED")
    ?? codes.find((code) => code === "GMAIL_PERMISSION_DENIED")
    ?? codes.find((code) => code === "GMAIL_RATE_LIMITED")
    ?? codes[0]
    ?? "MAILBOX_PERSISTENCE_ERROR";
}

function messageForCode(code: IncrementalSyncSafeErrorCode) {
  if (code === "REAUTH_REQUIRED") return "Gmail access expired. Reconnect the account and try again.";
  if (code === "GMAIL_PERMISSION_DENIED") return "Gmail access was denied. Check the account permissions and try again.";
  if (code === "GMAIL_RATE_LIMITED") return "Gmail is temporarily rate limited. Please try again later.";
  if (code === "HISTORY_ID_EXPIRED") return "Gmail history expired. A full mailbox resync is required.";
  return code === "MAILBOX_PERSISTENCE_ERROR"
    ? "Mailbox changes could not be saved. Retrying this page is safe."
    : "Gmail could not be reached. Please try again.";
}

function success(completed: boolean, counters: { processed: number; affected: number; synced: number; deleted: number }, message: string): BatchResult {
  return { success: true, completed, message: `${message} ${counters.processed} history records, ${counters.affected} affected, ${counters.synced} synced, ${counters.deleted} deleted.` };
}

function failure(message: string): BatchResult { return { success: false, completed: false, message }; }
function cleanOpaqueId(value?: string | null) { const cleaned = value?.trim(); return cleaned ? cleaned : null; }
function isStale(batchLockAt: string | null) { return !batchLockAt || new Date(batchLockAt).getTime() < Date.now() - STALE_LOCK_MS; }

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await work(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

const STATE_COLUMNS = "id, status, start_history_id, next_page_token, target_history_id, processed_history_records, affected_message_count, synced_message_count, deleted_message_count, failed_message_count, safe_error_code, batch_lock_id, batch_lock_at";
