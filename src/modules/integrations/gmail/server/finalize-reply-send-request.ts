import "server-only";

import type {
  ExecuteReplySendInput,
  ReplyDeterministicFailureCode,
} from "@/modules/integrations/gmail/domain/execute-reply-send";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

export async function finalizeReplySendRequestSent(input: ExecuteReplySendInput & {
  sendLockId: string;
  providerMessageId: string;
  providerThreadId: string;
}) {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.rpc("finalize_reply_email_send_request_sent", {
    p_request_id: input.sendRequestId,
    p_workspace_id: input.workspaceId,
    p_email_account_id: input.emailAccountId,
    p_send_lock_id: input.sendLockId,
    p_provider_message_id: input.providerMessageId,
    p_provider_thread_id: input.providerThreadId,
  });
  if (error || typeof data !== "boolean") throw new Error("Reply SENT finalization unavailable");
  return data;
}

export async function finalizeReplySendRequestFailed(input: ExecuteReplySendInput & {
  sendLockId: string;
  safeErrorCode: ReplyDeterministicFailureCode;
}) {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.rpc("finalize_reply_email_send_request_failed", {
    p_request_id: input.sendRequestId,
    p_workspace_id: input.workspaceId,
    p_email_account_id: input.emailAccountId,
    p_send_lock_id: input.sendLockId,
    p_safe_error_code: input.safeErrorCode,
  });
  if (error || typeof data !== "boolean") throw new Error("Reply FAILED finalization unavailable");
  return data;
}
