import "server-only";

import type { ExecuteReplySendInput } from "@/modules/integrations/gmail/domain/execute-reply-send";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

export async function claimReplySendRequest(input: ExecuteReplySendInput & { sendLockId: string }): Promise<unknown> {
  const supabase = createPrivilegedSupabaseClient();
  return claimReplySendRequestWithRpc(input, (name, args) => supabase.rpc(name, args));
}

export async function claimReplySendRequestWithRpc(
  input: ExecuteReplySendInput & { sendLockId: string },
  rpc: (name: "claim_reply_email_send_request", args: {
    p_request_id: string;
    p_workspace_id: string;
    p_email_account_id: string;
    p_send_lock_id: string;
  }) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<unknown> {
  const { data, error } = await rpc("claim_reply_email_send_request", {
    p_request_id: input.sendRequestId,
    p_workspace_id: input.workspaceId,
    p_email_account_id: input.emailAccountId,
    p_send_lock_id: input.sendLockId,
  });
  if (error || !Array.isArray(data)) throw new Error("Reply claim unavailable");
  return data;
}
