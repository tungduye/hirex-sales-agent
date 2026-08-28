export interface PrepareReplyExecutionInput {
  sendRequestId: string;
  workspaceId: string;
  emailAccountId: string;
  sendLockId: string;
}

export type ReplyExecutionStatus =
  | "READY"
  | "NOT_ELIGIBLE"
  | "EVIDENCE_CHANGED"
  | "NOT_REPLYABLE"
  | "INVALID_INPUT"
  | "UNAVAILABLE";

export type ReplyExecutionReason =
  | "READY_FOR_REPLY_MIME"
  | "REQUEST_NOT_CLAIMED"
  | "CLAIM_OWNERSHIP_MISMATCH"
  | "REQUEST_SHAPE_UNAVAILABLE"
  | "CANONICAL_REPLY_TARGET_CHANGED"
  | "REPLY_TARGET_NOT_SAFE"
  | "INVALID_REPLY_EXECUTION_INPUT"
  | "REPLY_EXECUTION_UNAVAILABLE";

export interface ReplyExecutionPlan {
  sendRequestId: string;
  workspaceId: string;
  emailAccountId: string;
  sendLockId: string;
  replyToEmailMessageId: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  providerThreadId: string;
  parentRfcMessageId: string;
}

export interface PrepareReplyExecutionResult {
  status: ReplyExecutionStatus;
  reason: ReplyExecutionReason;
  sendRequestId: string | null;
  plan: ReplyExecutionPlan | null;
}

export interface PrepareReplyExecutionDependencies {
  loadClaimedRequest(input: PrepareReplyExecutionInput): Promise<unknown>;
  evaluateCanonicalTarget(input: { workspaceId: string; emailAccountId: string; emailMessageId: string }): Promise<unknown>;
}

interface ValidClaimedRequest {
  id: string;
  workspaceId: string;
  emailAccountId: string;
  replyToEmailMessageId: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
}

export async function prepareReplyExecutionWithDependencies(
  input: PrepareReplyExecutionInput,
  dependencies: PrepareReplyExecutionDependencies,
): Promise<PrepareReplyExecutionResult> {
  if (!isExactInput(input)) return result("INVALID_INPUT", "INVALID_REPLY_EXECUTION_INPUT", null);

  let requestEvidence: unknown;
  try {
    requestEvidence = await dependencies.loadClaimedRequest(input);
  } catch {
    return result("UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE", input.sendRequestId);
  }

  const request = classifyClaimedRequest(input, requestEvidence);
  if (!("request" in request)) return request;

  let evaluation: unknown;
  try {
    evaluation = await dependencies.evaluateCanonicalTarget({
      workspaceId: input.workspaceId,
      emailAccountId: input.emailAccountId,
      emailMessageId: request.request.replyToEmailMessageId,
    });
  } catch {
    return result("UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE", input.sendRequestId);
  }
  return buildReplyExecutionPlan(input, request.request, evaluation);
}

export function classifyClaimedRequest(
  input: PrepareReplyExecutionInput,
  evidence: unknown,
): { request: ValidClaimedRequest } | PrepareReplyExecutionResult {
  if (evidence === null) return result("NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED", input.sendRequestId);
  if (!isClaimedRequestRow(evidence)) return result("UNAVAILABLE", "REQUEST_SHAPE_UNAVAILABLE", input.sendRequestId);

  if (evidence.id !== input.sendRequestId
    || evidence.workspace_id !== input.workspaceId
    || evidence.email_account_id !== input.emailAccountId
    || evidence.send_lock_id !== input.sendLockId) {
    return result("NOT_ELIGIBLE", "CLAIM_OWNERSHIP_MISMATCH", input.sendRequestId);
  }
  if (evidence.send_type !== "REPLY" || evidence.status !== "SENDING" || evidence.attempt_count !== 1
    || !isTimestamp(evidence.send_lock_at) || !isTimestamp(evidence.last_attempt_at)
    || evidence.send_lock_at !== evidence.last_attempt_at
    || evidence.safe_error_code !== null) {
    return result("NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED", input.sendRequestId);
  }
  if (!isUuid(evidence.reply_to_email_message_id)
    || evidence.to_addresses.length !== 1 || !isConservativeEmail(evidence.to_addresses[0])
    || evidence.cc_addresses.length !== 0 || evidence.bcc_addresses.length !== 0
    || !isSafeHeaderText(evidence.subject) || !isPlainTextBody(evidence.body_text)
    || evidence.body_html !== null || evidence.send_after !== null
    || evidence.provider_message_id !== null || evidence.provider_thread_id !== null
    || evidence.rfc_message_id !== null || evidence.sent_at !== null) {
    return result("NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE", input.sendRequestId);
  }

  return { request: {
    id: evidence.id,
    workspaceId: evidence.workspace_id,
    emailAccountId: evidence.email_account_id,
    replyToEmailMessageId: evidence.reply_to_email_message_id,
    recipientEmail: evidence.to_addresses[0],
    subject: evidence.subject,
    bodyText: evidence.body_text,
  } };
}

export function buildReplyExecutionPlan(
  input: PrepareReplyExecutionInput,
  request: ValidClaimedRequest,
  evaluation: unknown,
): PrepareReplyExecutionResult {
  if (!isRecord(evaluation)) return result("UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE", input.sendRequestId);
  if (evaluation.classification !== "SAFE_REPLY_TARGET" || evaluation.reason !== "SAFE_CANONICAL_REPLY_TARGET") {
    return evaluation.classification === "NOT_REPLYABLE"
      ? result("NOT_REPLYABLE", "REPLY_TARGET_NOT_SAFE", input.sendRequestId)
      : result("UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE", input.sendRequestId);
  }
  if (!isSafeEvaluation(evaluation, input)) {
    return result("UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE", input.sendRequestId);
  }
  if (evaluation.replyToEmailMessageId !== request.replyToEmailMessageId
    || evaluation.recipientEmail !== request.recipientEmail
    || evaluation.subject !== request.subject) {
    return result("EVIDENCE_CHANGED", "CANONICAL_REPLY_TARGET_CHANGED", input.sendRequestId);
  }

  return {
    status: "READY",
    reason: "READY_FOR_REPLY_MIME",
    sendRequestId: input.sendRequestId,
    plan: {
      sendRequestId: input.sendRequestId,
      workspaceId: input.workspaceId,
      emailAccountId: input.emailAccountId,
      sendLockId: input.sendLockId,
      replyToEmailMessageId: request.replyToEmailMessageId,
      recipientEmail: evaluation.recipientEmail,
      subject: evaluation.subject,
      bodyText: request.bodyText,
      providerThreadId: evaluation.providerThreadId,
      parentRfcMessageId: evaluation.parentRfcMessageId,
    },
  };
}

function result(status: ReplyExecutionStatus, reason: ReplyExecutionReason, sendRequestId: string | null): PrepareReplyExecutionResult {
  return { status, reason, sendRequestId, plan: null };
}

function isExactInput(value: unknown): value is PrepareReplyExecutionInput {
  return isRecord(value)
    && exactKeys(value, ["sendRequestId", "workspaceId", "emailAccountId", "sendLockId"])
    && isUuid(value.sendRequestId) && isUuid(value.workspaceId)
    && isUuid(value.emailAccountId) && isUuid(value.sendLockId);
}

function isClaimedRequestRow(value: unknown): value is {
  id: string; workspace_id: string; email_account_id: string; send_type: string; status: string;
  attempt_count: number; last_attempt_at: string | null; safe_error_code: string | null;
  send_lock_id: string | null; send_lock_at: string | null; reply_to_email_message_id: string | null;
  to_addresses: string[]; cc_addresses: string[]; bcc_addresses: string[]; subject: string;
  body_text: string | null; body_html: string | null; send_after: string | null;
  provider_message_id: string | null; provider_thread_id: string | null; rfc_message_id: string | null; sent_at: string | null;
} {
  if (!isRecord(value) || !exactKeys(value, [
    "id", "workspace_id", "email_account_id", "send_type", "status", "attempt_count", "last_attempt_at",
    "safe_error_code", "send_lock_id", "send_lock_at", "reply_to_email_message_id", "to_addresses",
    "cc_addresses", "bcc_addresses", "subject", "body_text", "body_html", "send_after",
    "provider_message_id", "provider_thread_id", "rfc_message_id", "sent_at",
  ])) return false;
  return typeof value.id === "string" && typeof value.workspace_id === "string" && typeof value.email_account_id === "string"
    && typeof value.send_type === "string" && typeof value.status === "string" && Number.isInteger(value.attempt_count)
    && nullableString(value.last_attempt_at) && nullableString(value.safe_error_code)
    && nullableString(value.send_lock_id) && nullableString(value.send_lock_at) && nullableString(value.reply_to_email_message_id)
    && stringArray(value.to_addresses) && stringArray(value.cc_addresses) && stringArray(value.bcc_addresses)
    && typeof value.subject === "string" && nullableString(value.body_text) && nullableString(value.body_html)
    && nullableString(value.send_after) && nullableString(value.provider_message_id) && nullableString(value.provider_thread_id)
    && nullableString(value.rfc_message_id) && nullableString(value.sent_at);
}

function isSafeEvaluation(value: Record<string, unknown>, input: PrepareReplyExecutionInput): value is Record<string, unknown> & {
  replyToEmailMessageId: string; recipientEmail: string; subject: string; providerThreadId: string; parentRfcMessageId: string;
} {
  return value.workspaceId === input.workspaceId && value.emailAccountId === input.emailAccountId
    && isUuid(value.replyToEmailMessageId) && isConservativeEmail(value.recipientEmail)
    && isSafeHeaderText(value.subject) && isSafeProviderThreadId(value.providerThreadId)
    && isCanonicalRfcMessageId(value.parentRfcMessageId);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function hasControl(value: string) { return /[\u0000-\u001f\u007f-\u009f]/.test(value); }
function isTimestamp(value: string | null) { return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value)); }
function isPlainTextBody(value: string | null): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 100_000 && !value.includes("\u0000"); }
function isSafeHeaderText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 998 && !hasControl(value); }
function isSafeProviderThreadId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !hasControl(value); }
function isCanonicalRfcMessageId(value: unknown): value is string { return typeof value === "string" && value.length <= 998 && !hasControl(value) && /^<[^<>\s@]+@[^<>\s@]+>$/.test(value.trim()); }

function isConservativeEmail(value: unknown): value is string {
  if (typeof value !== "string" || value !== value.trim().toLowerCase() || value.length > 254 || hasControl(value)
    || /[\s<>()[\]\\,;:"]/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain || local.length > 64 || domain.length > 253 || local.startsWith(".")
    || local.endsWith(".") || local.includes("..") || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => label.length > 0 && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}
