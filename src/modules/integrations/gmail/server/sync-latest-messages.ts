"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { getFullMessage, GmailApiError, listLatestMessageIds } from "@/modules/integrations/gmail/server/gmail-api";
import { parseGmailMessage } from "@/modules/integrations/gmail/server/gmail-message-parser";
import { recomputeThreadAggregates, upsertMailboxMessage } from "@/modules/integrations/gmail/server/mailbox-persistence";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import { loadSyncCredentials, markReauthenticationRequired, ReauthenticationRequiredError, TransientCredentialError } from "@/modules/integrations/gmail/server/sync-credentials";
import type { GmailSyncState } from "@/modules/integrations/gmail/types/sync-state";

const accountIdSchema = z.uuid();

export async function syncLatestGmailMessages(_state: GmailSyncState, formData: FormData): Promise<GmailSyncState> {
  const parsedId = accountIdSchema.safeParse(formData.get("emailAccountId"));
  if (!parsedId.success) return failure("This email account could not be synced.");
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return failure("Your account is not ready to sync Gmail.");
  const scope = { workspaceId: account.workspaceId, emailAccountId: parsedId.data };

  try {
    const credentials = await loadSyncCredentials(scope.emailAccountId, scope.workspaceId);
    let messageIds: string[];
    try {
      messageIds = await listLatestMessageIds(credentials.accessToken);
    } catch (error) {
      if (error instanceof GmailApiError && error.category === "AUTHENTICATION") {
        await markReauthenticationRequired(scope.emailAccountId, scope.workspaceId);
        return failure("Gmail access expired. Reconnect the account and try again.");
      }
      return failure("Gmail could not be reached. Please try again.");
    }

    let syncedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let authenticationFailed = false;
    const touchedThreads = new Set<string>();
    for (const messageId of messageIds) {
      try {
        const resource = await getFullMessage(credentials.accessToken, messageId);
        const message = parseGmailMessage(resource, credentials.emailAddress);
        if (!message) { skippedCount += 1; continue; }
        touchedThreads.add(await upsertMailboxMessage(scope, message));
        syncedCount += 1;
      } catch (error) {
        if (error instanceof GmailApiError && error.category === "AUTHENTICATION") {
          await markReauthenticationRequired(scope.emailAccountId, scope.workspaceId);
          authenticationFailed = true;
          break;
        }
        failedCount += 1;
      }
    }

    try { await recomputeThreadAggregates(scope, touchedThreads); }
    catch { return failure("Messages were stored, but thread summaries could not be refreshed.", syncedCount, skippedCount, failedCount); }

    if (authenticationFailed) {
      return failure("Gmail access expired. Reconnect the account and try again.", syncedCount, skippedCount, failedCount);
    }

    if (failedCount === 0) {
      const supabase = createPrivilegedSupabaseClient();
      await supabase.from("email_accounts").update({ last_sync_error: null })
        .eq("id", scope.emailAccountId).eq("workspace_id", scope.workspaceId).eq("provider", "GMAIL");
    }
    revalidatePath("/settings");
    const detail = [skippedCount && `${skippedCount} skipped`, failedCount && `${failedCount} failed`].filter(Boolean).join(", ");
    return { success: failedCount === 0, message: `${syncedCount} messages synced.${detail ? ` ${detail}.` : ""}`, syncedCount, skippedCount, failedCount };
  } catch (error) {
    if (error instanceof ReauthenticationRequiredError) return failure("Gmail access expired. Reconnect the account and try again.");
    if (error instanceof TransientCredentialError) return failure("Gmail could not be reached. Please try again.");
    return failure("This email account could not be synced.");
  }
}

function failure(message: string, syncedCount = 0, skippedCount = 0, failedCount = 0): GmailSyncState {
  return { success: false, message, syncedCount, skippedCount, failedCount };
}
