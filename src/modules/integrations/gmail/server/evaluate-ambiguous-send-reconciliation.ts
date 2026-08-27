import "server-only";

import {
  classifyAmbiguousSendEvidence,
  type AmbiguousSendRequestEvidence,
  type CanonicalMessageEvidence,
  type CanonicalThreadEvidence,
} from "@/modules/integrations/gmail/domain/classify-ambiguous-send";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import type { SendReconciliationResult } from "@/modules/integrations/gmail/types/send-reconciliation";

interface SendRequestRow {
  id: string;
  workspace_id: string;
  email_account_id: string;
  send_type: string;
  status: string;
  to_addresses: string[];
  cc_addresses: string[];
  bcc_addresses: string[];
  subject: string;
  body_text: string | null;
  body_html: string | null;
  send_after: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
}

interface EmailAccountRow { email_address: string; status: string }

interface MessageRow {
  id: string;
  workspace_id: string;
  email_account_id: string;
  email_thread_id: string;
  provider_message_id: string;
  hirex_send_request_id: string | null;
  labels: string[];
  direction: string;
  from_email: string | null;
  to_emails: string[];
  subject: string | null;
  body_text: string | null;
}

interface ThreadRow {
  id: string;
  workspace_id: string;
  email_account_id: string;
  provider_thread_id: string;
}

export async function evaluateAmbiguousSendReconciliation(input: {
  sendRequestId: string;
  workspaceId: string;
  emailAccountId: string;
}): Promise<SendReconciliationResult> {
  const supabase = createPrivilegedSupabaseClient();
  const { data: requestData, error: requestError } = await supabase
    .from("email_send_requests")
    .select("id, workspace_id, email_account_id, send_type, status, to_addresses, cc_addresses, bcc_addresses, subject, body_text, body_html, send_after, provider_message_id, provider_thread_id")
    .eq("id", input.sendRequestId)
    .eq("workspace_id", input.workspaceId)
    .eq("email_account_id", input.emailAccountId)
    .maybeSingle();
  if (requestError) return unavailable(input.sendRequestId);
  const requestRow = requestData as SendRequestRow | null;
  if (!requestRow || requestRow.send_type !== "NEW" || requestRow.status !== "SENDING") {
    return classify(input, requestRow, null, [], null);
  }

  const { data: accountData, error: accountError } = await supabase
    .from("email_accounts")
    .select("email_address, status")
    .eq("id", input.emailAccountId)
    .eq("workspace_id", input.workspaceId)
    .eq("provider", "GMAIL")
    .eq("status", "CONNECTED")
    .maybeSingle();
  if (accountError) return unavailable(input.sendRequestId);
  const account = accountData as EmailAccountRow | null;
  if (!account) return classify(input, requestRow, null, [], null);

  const { data: messageData, error: messageError } = await supabase
    .from("email_messages")
    .select("id, workspace_id, email_account_id, email_thread_id, provider_message_id, hirex_send_request_id, labels, direction, from_email, to_emails, subject, body_text")
    .eq("workspace_id", input.workspaceId)
    .eq("email_account_id", input.emailAccountId)
    .eq("provider", "GMAIL")
    .eq("hirex_send_request_id", input.sendRequestId)
    .limit(2);
  if (messageError) return unavailable(input.sendRequestId);
  const messageRows = (messageData ?? []) as MessageRow[];
  if (messageRows.length !== 1) {
    return classify(input, requestRow, account.email_address, messageRows, null);
  }
  const candidate = messageRows[0] as unknown;
  if (!candidate || typeof candidate !== "object"
    || typeof (candidate as Record<string, unknown>).email_thread_id !== "string") {
    return unavailable(input.sendRequestId);
  }

  const { data: threadData, error: threadError } = await supabase
    .from("email_threads")
    .select("id, workspace_id, email_account_id, provider_thread_id")
    .eq("id", messageRows[0].email_thread_id)
    .eq("workspace_id", input.workspaceId)
    .eq("email_account_id", input.emailAccountId)
    .eq("provider", "GMAIL")
    .maybeSingle();
  if (threadError) return unavailable(input.sendRequestId);

  return classify(
    input,
    requestRow,
    account.email_address,
    messageRows,
    threadData as ThreadRow | null,
  );
}

function classify(
  input: { sendRequestId: string; workspaceId: string; emailAccountId: string },
  request: SendRequestRow | null,
  connectedEmail: string | null,
  messages: MessageRow[],
  thread: ThreadRow | null,
) {
  return classifyAmbiguousSendEvidence({
    request: request ? mapRequest(request) : null,
    connectedEmail,
    candidates: messages.map(mapMessage),
    thread: thread ? mapThread(thread) : null,
    expectedWorkspaceId: input.workspaceId,
    expectedEmailAccountId: input.emailAccountId,
    sendRequestId: input.sendRequestId,
  });
}

function mapRequest(row: SendRequestRow): AmbiguousSendRequestEvidence {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    emailAccountId: row.email_account_id,
    sendType: row.send_type,
    status: row.status,
    toAddresses: row.to_addresses,
    ccAddresses: row.cc_addresses,
    bccAddresses: row.bcc_addresses,
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    sendAfter: row.send_after,
    providerMessageId: row.provider_message_id,
    providerThreadId: row.provider_thread_id,
  };
}

function mapMessage(row: MessageRow): CanonicalMessageEvidence {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    emailAccountId: row.email_account_id,
    emailThreadId: row.email_thread_id,
    providerMessageId: row.provider_message_id,
    hirexSendRequestId: row.hirex_send_request_id,
    labels: row.labels,
    direction: row.direction,
    fromEmail: row.from_email,
    toEmails: row.to_emails,
    subject: row.subject,
    bodyText: row.body_text,
  };
}

function mapThread(row: ThreadRow): CanonicalThreadEvidence {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    emailAccountId: row.email_account_id,
    providerThreadId: row.provider_thread_id,
  };
}

function unavailable(sendRequestId: string): SendReconciliationResult {
  return {
    classification: "AMBIGUOUS",
    reason: "EVALUATION_UNAVAILABLE",
    sendRequestId,
    matchedEmailMessageId: null,
  };
}
