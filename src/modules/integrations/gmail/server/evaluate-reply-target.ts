import "server-only";

import {
  evaluateReplyTargetEvidence,
  type ReplyTargetEvidence,
  type ReplyTargetInput,
  type ReplyTargetResult,
} from "@/modules/integrations/gmail/domain/classify-reply-target";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

export async function evaluateReplyTarget(input: ReplyTargetInput): Promise<ReplyTargetResult> {
  return evaluateReplyTargetEvidence(input, loadCanonicalEvidence);
}

async function loadCanonicalEvidence(input: ReplyTargetInput): Promise<ReplyTargetEvidence> {
  const supabase = createPrivilegedSupabaseClient();
  const [messageResult, accountResult] = await Promise.all([
    supabase.from("email_messages")
      .select("id, workspace_id, email_account_id, email_thread_id, provider, provider_message_id, rfc_message_id, direction, from_email, subject, labels")
      .eq("id", input.emailMessageId).eq("workspace_id", input.workspaceId).eq("email_account_id", input.emailAccountId).maybeSingle(),
    supabase.from("email_accounts")
      .select("id, workspace_id, provider, status, email_address")
      .eq("id", input.emailAccountId).eq("workspace_id", input.workspaceId).maybeSingle(),
  ]);
  if (messageResult.error || accountResult.error) throw new Error("Reply target evidence unavailable");

  const rawMessage = messageResult.data as Record<string, unknown> | null;
  let thread: unknown = null;
  if (rawMessage && typeof rawMessage.email_thread_id === "string") {
    const threadResult = await supabase.from("email_threads")
      .select("id, workspace_id, email_account_id, provider, provider_thread_id")
      .eq("id", rawMessage.email_thread_id).eq("workspace_id", input.workspaceId).eq("email_account_id", input.emailAccountId).maybeSingle();
    if (threadResult.error) throw new Error("Reply target evidence unavailable");
    thread = threadResult.data ? mapThread(threadResult.data as Record<string, unknown>) : null;
  }

  return {
    message: rawMessage ? mapMessage(rawMessage) : null,
    account: accountResult.data ? mapAccount(accountResult.data as Record<string, unknown>) : null,
    thread,
  };
}

function mapMessage(row: Record<string, unknown>) {
  return {
    id: row.id, workspaceId: row.workspace_id, emailAccountId: row.email_account_id,
    emailThreadId: row.email_thread_id, provider: row.provider, providerMessageId: row.provider_message_id,
    rfcMessageId: row.rfc_message_id, direction: row.direction, fromEmail: row.from_email,
    subject: row.subject, labels: row.labels,
  };
}

function mapAccount(row: Record<string, unknown>) {
  return { id: row.id, workspaceId: row.workspace_id, provider: row.provider, status: row.status, emailAddress: row.email_address };
}

function mapThread(row: Record<string, unknown>) {
  return { id: row.id, workspaceId: row.workspace_id, emailAccountId: row.email_account_id, provider: row.provider, providerThreadId: row.provider_thread_id };
}
