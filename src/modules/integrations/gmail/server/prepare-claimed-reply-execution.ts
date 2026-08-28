import "server-only";

import {
  prepareReplyExecutionWithDependencies,
  type PrepareReplyExecutionInput,
} from "@/modules/integrations/gmail/domain/prepare-reply-execution-plan";
import { evaluateReplyTarget as loadCanonicalReplyTarget } from "@/modules/integrations/gmail/server/evaluate-reply-target";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

const claimedRequestColumns = "id, workspace_id, email_account_id, send_type, status, attempt_count, last_attempt_at, safe_error_code, send_lock_id, send_lock_at, reply_to_email_message_id, to_addresses, cc_addresses, bcc_addresses, subject, body_text, body_html, send_after, provider_message_id, provider_thread_id, rfc_message_id, sent_at";

export async function prepareClaimedReplyExecution(input: PrepareReplyExecutionInput) {
  return prepareReplyExecutionWithDependencies(input, {
    loadClaimedRequest,
    evaluateCanonicalTarget: loadCanonicalReplyTarget,
  });
}

async function loadClaimedRequest(input: PrepareReplyExecutionInput): Promise<unknown> {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.from("email_send_requests")
    .select(claimedRequestColumns)
    .eq("id", input.sendRequestId)
    .eq("workspace_id", input.workspaceId)
    .eq("email_account_id", input.emailAccountId)
    .maybeSingle();
  if (error) throw new Error("Reply execution evidence unavailable");
  return data;
}
