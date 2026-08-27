import "server-only";

import { randomUUID } from "node:crypto";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import type { SendNewMessageInput } from "@/modules/integrations/gmail/schemas/send-new-message";

export interface SendAccount {
  id: string;
  emailAddress: string;
  scopes: string[];
}

export interface EmailSendRequestRow {
  id: string;
  email_account_id: string;
  send_type: "NEW";
  status: "PENDING" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";
  to_addresses: string[];
  subject: string;
  body_text: string | null;
  idempotency_key: string;
  safe_error_code: string | null;
  rfc_message_id: string | null;
}

export async function loadSendAccount(emailAccountId: string, workspaceId: string) {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase
    .from("email_accounts")
    .select("id, email_address, scopes")
    .eq("id", emailAccountId)
    .eq("workspace_id", workspaceId)
    .eq("provider", "GMAIL")
    .eq("status", "CONNECTED")
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id as string,
    emailAddress: data.email_address as string,
    scopes: data.scopes as string[],
  } satisfies SendAccount;
}

export async function createOrLoadSendRequest(
  input: SendNewMessageInput,
  workspaceId: string,
  senderDomain: string,
) {
  const supabase = createPrivilegedSupabaseClient();
  const requestId = randomUUID();
  const rfcMessageId = `<hirex.${requestId}@${senderDomain}>`;
  const { data, error } = await supabase.from("email_send_requests").insert({
    id: requestId,
    workspace_id: workspaceId,
    email_account_id: input.emailAccountId,
    send_type: "NEW",
    status: "PENDING",
    reply_to_email_message_id: null,
    to_addresses: [input.to],
    cc_addresses: [],
    bcc_addresses: [],
    subject: input.subject,
    body_text: input.bodyText,
    body_html: null,
    send_after: null,
    idempotency_key: input.idempotencyKey,
    rfc_message_id: rfcMessageId,
  }).select(sendRequestColumns).maybeSingle();

  if (!error && data) return { row: data as EmailSendRequestRow, created: true };
  if (error?.code !== "23505") return null;

  const existing = await loadSendRequestByIdempotency(
    workspaceId,
    input.emailAccountId,
    input.idempotencyKey,
  );
  return existing ? { row: existing, created: false } : null;
}

export async function loadSendRequestByIdempotency(
  workspaceId: string,
  emailAccountId: string,
  idempotencyKey: string,
) {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.from("email_send_requests")
    .select(sendRequestColumns)
    .eq("workspace_id", workspaceId)
    .eq("email_account_id", emailAccountId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  return error || !data ? null : data as EmailSendRequestRow;
}

export async function loadSendRequestById(
  requestId: string,
  workspaceId: string,
  emailAccountId: string,
) {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.from("email_send_requests")
    .select(sendRequestColumns)
    .eq("id", requestId)
    .eq("workspace_id", workspaceId)
    .eq("email_account_id", emailAccountId)
    .maybeSingle();
  return error || !data ? null : data as EmailSendRequestRow;
}

export async function claimSendRequest(
  requestId: string,
  workspaceId: string,
  emailAccountId: string,
  lockId: string,
) {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.rpc("claim_email_send_request", {
    p_request_id: requestId,
    p_workspace_id: workspaceId,
    p_email_account_id: emailAccountId,
    p_send_lock_id: lockId,
  });
  return !error && data === true;
}

export async function finalizeSendRequestSent(input: {
  requestId: string;
  workspaceId: string;
  emailAccountId: string;
  lockId: string;
  providerMessageId: string;
  providerThreadId: string;
}) {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.rpc("finalize_email_send_request_sent", {
    p_request_id: input.requestId,
    p_workspace_id: input.workspaceId,
    p_email_account_id: input.emailAccountId,
    p_send_lock_id: input.lockId,
    p_provider_message_id: input.providerMessageId,
    p_provider_thread_id: input.providerThreadId,
  });
  return !error && data === true;
}

export async function finalizeSendRequestFailed(input: {
  requestId: string;
  workspaceId: string;
  emailAccountId: string;
  lockId: string;
  safeErrorCode: string;
}) {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.rpc("finalize_email_send_request_failed", {
    p_request_id: input.requestId,
    p_workspace_id: input.workspaceId,
    p_email_account_id: input.emailAccountId,
    p_send_lock_id: input.lockId,
    p_safe_error_code: input.safeErrorCode,
  });
  return !error && data === true;
}

export function payloadMatches(row: EmailSendRequestRow, input: SendNewMessageInput) {
  return row.send_type === "NEW"
    && row.email_account_id === input.emailAccountId
    && row.to_addresses.length === 1
    && row.to_addresses[0] === input.to
    && row.subject === input.subject
    && row.body_text === input.bodyText;
}

const sendRequestColumns = "id, email_account_id, send_type, status, to_addresses, subject, body_text, idempotency_key, safe_error_code, rfc_message_id";
