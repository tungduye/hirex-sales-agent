import "server-only";

import { randomUUID } from "node:crypto";
import { getFullMessage, GmailApiError, listMessagePage } from "@/modules/integrations/gmail/server/gmail-api";
import { parseGmailMessage } from "@/modules/integrations/gmail/server/gmail-message-parser";
import { recomputeThreadAggregates, upsertMailboxMessage } from "@/modules/integrations/gmail/server/mailbox-persistence";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import { loadSyncCredentials, markReauthenticationRequired, ReauthenticationRequiredError, TransientCredentialError } from "@/modules/integrations/gmail/server/sync-credentials";
import type { GmailMessageResource } from "@/modules/integrations/gmail/types/gmail-message";
import type { InitialSyncStatus } from "@/modules/integrations/gmail/types/initial-sync";

const CONCURRENCY = 5;
const STALE_LOCK_MS = 10 * 60 * 1000;

interface SyncStateRow {
  id: string; status: InitialSyncStatus; next_page_token: string | null; initial_history_id: string | null;
  processed_messages: number; synced_messages: number; skipped_messages: number; failed_messages: number;
}
interface Scope { workspaceId: string; emailAccountId: string }
type BatchResult = { success: boolean; completed: boolean; message: string };
type MessageResult =
  | { kind: "synced"; threadId: string; resource: GmailMessageResource }
  | { kind: "skipped"; resource: GmailMessageResource | null }
  | { kind: "failed"; authentication: boolean; resource: GmailMessageResource | null };

export async function runInitialSyncBatch(scope: Scope): Promise<BatchResult> {
  try {
    return await executeInitialSyncBatch(scope);
  } catch {
    return { success: false, completed: false, message: "This sync batch could not be completed. Please try again." };
  }
}

async function executeInitialSyncBatch(scope: Scope): Promise<BatchResult> {
  const supabase = createPrivilegedSupabaseClient();
  const { data: account, error: accountLookupError } = await supabase.from("email_accounts")
    .select("id, status").eq("id", scope.emailAccountId).eq("workspace_id", scope.workspaceId)
    .eq("provider", "GMAIL").maybeSingle();
  if (accountLookupError || !account) return { success: false, completed: false, message: "This email account could not be synced." };
  if (account.status !== "CONNECTED") return { success: false, completed: false, message: "Gmail access expired. Reconnect the account and try again." };

  const lockId = randomUUID();
  const state = await claimState(scope, lockId);
  if (state === "COMPLETED") return { success: false, completed: true, message: "Initial mailbox sync is already complete." };
  if (!state) return { success: false, completed: false, message: "Another sync batch is already running." };

  try {
    const credentials = await loadSyncCredentials(scope.emailAccountId, scope.workspaceId);
    const page = await listMessagePage(credentials.accessToken, state.next_page_token);
    const prefetched = new Map<string, GmailMessageResource>();

    if (!state.initial_history_id && state.next_page_token === null) {
      const firstMessageId = page.messageIds[0];
      if (!firstMessageId) {
        await failState(scope, state.id, lockId, "HISTORY_ANCHOR_UNAVAILABLE");
        return { success: false, completed: false, message: "An empty mailbox cannot establish a safe History checkpoint yet." };
      }

      let firstMessage: GmailMessageResource;
      try {
        firstMessage = await getFullMessage(credentials.accessToken, firstMessageId);
      } catch (error) {
        if (error instanceof GmailApiError && error.category === "AUTHENTICATION") {
          await markReauthenticationRequired(scope.emailAccountId, scope.workspaceId);
          await failState(scope, state.id, lockId, "OAUTH_REAUTH_REQUIRED");
          return { success: false, completed: false, message: "Gmail access expired. Reconnect the account and try again." };
        }
        await failState(scope, state.id, lockId, error instanceof GmailApiError && error.status === 404 ? "HISTORY_ANCHOR_UNAVAILABLE" : "GMAIL_API_TEMPORARY");
        return { success: false, completed: false, message: "The mailbox checkpoint could not be established. Please retry this batch." };
      }

      const historyId = firstMessage.historyId?.trim();
      if (!historyId) {
        await failState(scope, state.id, lockId, "HISTORY_ANCHOR_UNAVAILABLE");
        return { success: false, completed: false, message: "The mailbox checkpoint could not be established. Please retry this batch." };
      }
      const { data: anchored, error: anchorError } = await supabase.from("email_sync_states")
        .update({ initial_history_id: historyId })
        .eq("id", state.id).eq("workspace_id", scope.workspaceId).eq("batch_lock_id", lockId)
        .is("initial_history_id", null).select("id").maybeSingle();
      if (anchorError || !anchored) {
        await failState(scope, state.id, lockId, "DATABASE_WRITE_FAILED");
        return { success: false, completed: false, message: "The mailbox checkpoint could not be saved. Please retry this batch." };
      }
      state.initial_history_id = historyId;
      prefetched.set(firstMessageId, firstMessage);
    }

    const results = await mapWithConcurrency(page.messageIds, CONCURRENCY, async (messageId): Promise<MessageResult> => {
      let resource: GmailMessageResource | null = null;
      try {
        resource = prefetched.get(messageId) ?? await getFullMessage(credentials.accessToken, messageId);
        const parsed = parseGmailMessage(resource, credentials.emailAddress);
        if (!parsed) return { kind: "skipped", resource };
        const threadId = await upsertMailboxMessage(scope, parsed);
        return { kind: "synced", threadId, resource };
      } catch (error) {
        if (error instanceof GmailApiError && error.status === 404) return { kind: "skipped", resource: null };
        return { kind: "failed", authentication: error instanceof GmailApiError && error.category === "AUTHENTICATION", resource };
      }
    });

    const touchedThreads = new Set(results.flatMap((result) => result.kind === "synced" ? [result.threadId] : []));
    try { await recomputeThreadAggregates(scope, touchedThreads); }
    catch {
      await failState(scope, state.id, lockId, "DATABASE_WRITE_FAILED");
      return { success: false, completed: false, message: "This batch could not be finalized. Please retry it." };
    }

    if (results.some((result) => result.kind === "failed" && result.authentication)) {
      await markReauthenticationRequired(scope.emailAccountId, scope.workspaceId);
      await failState(scope, state.id, lockId, "OAUTH_REAUTH_REQUIRED");
      return { success: false, completed: false, message: "Gmail access expired. Reconnect the account and try again." };
    }

    if (!state.initial_history_id) {
      await failState(scope, state.id, lockId, "HISTORY_ANCHOR_UNAVAILABLE");
      return { success: false, completed: false, message: "The mailbox checkpoint could not be established. Please retry this batch." };
    }

    const synced = results.filter((result) => result.kind === "synced").length;
    const skipped = results.filter((result) => result.kind === "skipped").length;
    const failed = results.filter((result) => result.kind === "failed").length;
    const now = new Date().toISOString();
    const completed = page.nextPageToken === null;

    if (failed > 0) {
      await failState(scope, state.id, lockId, "BATCH_PARTIAL_FAILURE");
      const summary = `${page.messageIds.length} attempted, ${synced} synced, ${skipped} skipped, ${failed} failed.`;
      return { success: false, completed: false, message: `Batch stopped without advancing its checkpoint. ${summary}` };
    }

    if (completed) {
      const { data: finalized, error: finalizeError } = await supabase.rpc("finalize_initial_email_sync", {
        p_state_id: state.id,
        p_workspace_id: scope.workspaceId,
        p_email_account_id: scope.emailAccountId,
        p_batch_lock_id: lockId,
        p_processed_messages: page.messageIds.length,
        p_synced_messages: synced,
        p_skipped_messages: skipped,
        p_failed_messages: failed,
      });
      if (finalizeError || finalized !== true) {
        await failState(scope, state.id, lockId, "DATABASE_WRITE_FAILED");
        return { success: false, completed: false, message: "Mailbox completion could not be saved. Please retry this batch." };
      }
      const summary = `${page.messageIds.length} processed, ${synced} synced, ${skipped} skipped, ${failed} failed.`;
      return { success: true, completed: true, message: `Initial mailbox sync completed. ${summary}` };
    }

    const { data: checkpointed, error: stateError } = await supabase.from("email_sync_states").update({
      status: "RUNNING",
      next_page_token: page.nextPageToken,
      processed_messages: state.processed_messages + page.messageIds.length,
      synced_messages: state.synced_messages + synced,
      skipped_messages: state.skipped_messages + skipped,
      failed_messages: state.failed_messages + failed,
      last_batch_at: now,
      completed_at: null,
      safe_error_code: null,
      batch_lock_id: null,
      batch_lock_at: null,
    }).eq("id", state.id).eq("workspace_id", scope.workspaceId).eq("batch_lock_id", lockId)
      .select("id").maybeSingle();
    if (stateError || !checkpointed) {
      await releaseLock(scope, state.id, lockId);
      return { success: false, completed: false, message: "Sync progress could not be saved. Retrying this page is safe." };
    }

    const summary = `${page.messageIds.length} processed, ${synced} synced, ${skipped} skipped, ${failed} failed.`;
    return { success: true, completed: false, message: `Batch complete. ${summary}` };
  } catch (error) {
    if (error instanceof GmailApiError && error.category === "AUTHENTICATION") {
      await markReauthenticationRequired(scope.emailAccountId, scope.workspaceId);
    }
    const code = error instanceof ReauthenticationRequiredError
      ? "OAUTH_REAUTH_REQUIRED"
      : error instanceof GmailApiError && error.category === "AUTHENTICATION"
        ? "OAUTH_REAUTH_REQUIRED"
      : error instanceof TransientCredentialError || error instanceof GmailApiError
        ? "GMAIL_API_TEMPORARY"
        : "DATABASE_WRITE_FAILED";
    await failState(scope, state.id, lockId, code);
    if (error instanceof ReauthenticationRequiredError || error instanceof GmailApiError && error.category === "AUTHENTICATION") return { success: false, completed: false, message: "Gmail access expired. Reconnect the account and try again." };
    if (error instanceof TransientCredentialError || error instanceof GmailApiError) return { success: false, completed: false, message: "Gmail could not be reached. Please try again." };
    return { success: false, completed: false, message: "This sync batch could not be completed. Please try again." };
  }
}

async function claimState(scope: Scope, lockId: string): Promise<SyncStateRow | "COMPLETED" | null> {
  const supabase = createPrivilegedSupabaseClient();
  const initial = await supabase.from("email_sync_states")
    .select("id, status, next_page_token, initial_history_id, processed_messages, synced_messages, skipped_messages, failed_messages")
    .eq("workspace_id", scope.workspaceId).eq("email_account_id", scope.emailAccountId).eq("sync_type", "INITIAL").maybeSingle();
  if (initial.error) throw new Error("SYNC_STATE_READ_FAILED");
  let data = initial.data;
  if (!data) {
    const created = await supabase.from("email_sync_states").insert({
      workspace_id: scope.workspaceId, email_account_id: scope.emailAccountId, sync_type: "INITIAL",
      status: "RUNNING", started_at: new Date().toISOString(),
    });
    if (created.error && created.error.code !== "23505") throw new Error("SYNC_STATE_CREATE_FAILED");
    const reloaded = await supabase.from("email_sync_states")
      .select("id, status, next_page_token, initial_history_id, processed_messages, synced_messages, skipped_messages, failed_messages")
      .eq("workspace_id", scope.workspaceId).eq("email_account_id", scope.emailAccountId).eq("sync_type", "INITIAL").maybeSingle();
    if (reloaded.error) throw new Error("SYNC_STATE_RELOAD_FAILED");
    data = reloaded.data;
  }
  const current = data as SyncStateRow | null;
  if (!current) throw new Error("SYNC_STATE_UNAVAILABLE");
  if (current.status === "COMPLETED") return "COMPLETED";

  const staleLock = await supabase.from("email_sync_states").update({ batch_lock_id: null, batch_lock_at: null })
    .eq("id", current.id).eq("workspace_id", scope.workspaceId)
    .lt("batch_lock_at", new Date(Date.now() - STALE_LOCK_MS).toISOString());
  if (staleLock.error) throw new Error("SYNC_STATE_STALE_LOCK_FAILED");
  const { data: claimed, error } = await supabase.from("email_sync_states").update({
    batch_lock_id: lockId, batch_lock_at: new Date().toISOString(), status: "RUNNING", safe_error_code: null,
  }).eq("id", current.id).eq("workspace_id", scope.workspaceId).is("batch_lock_id", null)
    .select("id, status, next_page_token, initial_history_id, processed_messages, synced_messages, skipped_messages, failed_messages").maybeSingle();
  if (error) throw new Error("SYNC_STATE_CLAIM_FAILED");
  return !claimed ? null : claimed as SyncStateRow;
}

async function failState(scope: Scope, stateId: string, lockId: string, safeErrorCode: string) {
  const supabase = createPrivilegedSupabaseClient();
  await supabase.from("email_sync_states").update({
    status: "FAILED", safe_error_code: safeErrorCode, batch_lock_id: null, batch_lock_at: null,
  }).eq("id", stateId).eq("workspace_id", scope.workspaceId).eq("batch_lock_id", lockId);
}

async function releaseLock(scope: Scope, stateId: string, lockId: string) {
  const supabase = createPrivilegedSupabaseClient();
  await supabase.from("email_sync_states").update({ batch_lock_id: null, batch_lock_at: null })
    .eq("id", stateId).eq("workspace_id", scope.workspaceId).eq("batch_lock_id", lockId);
}

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
