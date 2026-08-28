import "server-only";

import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

const COLUMNS = "id, workspace_id, email_account_id, send_type, status, attempt_count, last_attempt_at, safe_error_code, send_lock_id, send_lock_at, reply_to_email_message_id, to_addresses, cc_addresses, bcc_addresses, subject, body_text, body_html, send_after, idempotency_key, provider_message_id, provider_thread_id, rfc_message_id, sent_at";

export async function inspectReplySendRequest(input: {
  sendRequestId: string;
  workspaceId: string;
  emailAccountId: string;
}): Promise<unknown> {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.from("email_send_requests")
    .select(COLUMNS)
    .eq("id", input.sendRequestId)
    .eq("workspace_id", input.workspaceId)
    .eq("email_account_id", input.emailAccountId)
    .maybeSingle();
  return error || !data ? null : data;
}
