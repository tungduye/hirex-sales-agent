import "server-only";

import type { ExecuteReplySendInput } from "@/modules/integrations/gmail/domain/execute-reply-send";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

export async function claimReplySendRequest(input: ExecuteReplySendInput & { sendLockId: string }): Promise<unknown> {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.rpc("claim_reply_email_send_request", {
    p_request_id: input.sendRequestId,
    p_workspace_id: input.workspaceId,
    p_email_account_id: input.emailAccountId,
    p_send_lock_id: input.sendLockId,
  });
  if (error || !Array.isArray(data)) throw new Error("Reply claim unavailable");
  return data;
}
