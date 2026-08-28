import "server-only";

import {
  createReplySendRequestWithDependencies,
  type CreateReplySendRequestInput,
  type ExistingReplySendRequestEvidence,
  type ReplySendRequestInsertPayload,
} from "@/modules/integrations/gmail/domain/prepare-reply-send-request";
import { evaluateReplyTarget } from "@/modules/integrations/gmail/server/evaluate-reply-target";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

const existingColumns = "id, workspace_id, email_account_id, send_type, status, attempt_count, send_after, reply_to_email_message_id, to_addresses, cc_addresses, bcc_addresses, subject, body_text, body_html, idempotency_key";

export async function createReplySendRequest(input: CreateReplySendRequestInput) {
  return createReplySendRequestWithDependencies(input, {
    evaluateReplyTarget,
    createRow: insertReplySendRequest,
    loadByIdempotency: loadReplySendRequestByIdempotency,
  });
}

async function insertReplySendRequest(payload: ReplySendRequestInsertPayload) {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.from("email_send_requests").insert(payload).select("id").maybeSingle();
  if (!error && data) return { kind: "CREATED" as const, sendRequestId: data.id as unknown };
  if (error?.code === "23505") return { kind: "UNIQUE_CONFLICT" as const };
  return { kind: "ERROR" as const };
}

async function loadReplySendRequestByIdempotency(input: CreateReplySendRequestInput): Promise<ExistingReplySendRequestEvidence | null> {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.from("email_send_requests")
    .select(existingColumns)
    .eq("workspace_id", input.workspaceId)
    .eq("email_account_id", input.emailAccountId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  return error || !data ? null : data as ExistingReplySendRequestEvidence;
}
