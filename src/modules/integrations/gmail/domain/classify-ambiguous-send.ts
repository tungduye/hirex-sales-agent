import type {
  SendReconciliationReason,
  SendReconciliationResult,
} from "@/modules/integrations/gmail/types/send-reconciliation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AmbiguousSendRequestEvidence {
  id: string;
  workspaceId: string;
  emailAccountId: string;
  sendType: string;
  status: string;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  sendAfter: string | null;
  providerMessageId: string | null;
  providerThreadId: string | null;
}

export interface CanonicalMessageEvidence {
  id: string;
  workspaceId: string;
  emailAccountId: string;
  emailThreadId: string;
  providerMessageId: string;
  hirexSendRequestId: string | null;
  labels: string[];
  direction: string;
  fromEmail: string | null;
  toEmails: string[];
  subject: string | null;
  bodyText: string | null;
}

export interface CanonicalThreadEvidence {
  id: string;
  workspaceId: string;
  emailAccountId: string;
  providerThreadId: string;
}

export function classifyAmbiguousSendEvidence(input: {
  request: AmbiguousSendRequestEvidence | null;
  connectedEmail: string | null;
  candidates: CanonicalMessageEvidence[];
  thread: CanonicalThreadEvidence | null;
  expectedWorkspaceId: string;
  expectedEmailAccountId: string;
  sendRequestId: string;
}): SendReconciliationResult {
  const request = input.request;
  if (!isEligibleRequestIdentity(request)
    || request.id !== input.sendRequestId
    || request.workspaceId !== input.expectedWorkspaceId
    || request.emailAccountId !== input.expectedEmailAccountId
    || typeof input.connectedEmail !== "string"
    || input.connectedEmail.trim().length === 0) {
    return result("NO_MATCH", "REQUEST_NOT_ELIGIBLE", input.sendRequestId);
  }
  if (!isSupportedRequestShape(request)) {
    return result("NO_MATCH", "UNSUPPORTED_REQUEST_SHAPE", request.id);
  }
  if (!Array.isArray(input.candidates)) {
    return result("AMBIGUOUS", "EVALUATION_UNAVAILABLE", request.id);
  }
  if (input.candidates.length === 0) {
    return result("NO_MATCH", "CORRELATION_NOT_FOUND", request.id);
  }
  if (input.candidates.length !== 1) {
    return result("AMBIGUOUS", "MULTIPLE_CORRELATION_MATCHES", request.id);
  }

  const message = input.candidates[0];
  if (!isCanonicalMessageWellFormed(message)) {
    return result("AMBIGUOUS", "EVALUATION_UNAVAILABLE", request.id);
  }
  if (message.workspaceId !== request.workspaceId
    || message.emailAccountId !== request.emailAccountId
    || message.hirexSendRequestId !== request.id) {
    return result("NO_MATCH", "CORRELATION_NOT_FOUND", request.id);
  }
  if (!message.labels.includes("SENT")) {
    return result("NO_MATCH", "SENT_LABEL_MISSING", request.id, message.id);
  }
  if (message.labels.includes("SPAM") || message.labels.includes("TRASH")) {
    return result("NO_MATCH", "SPAM_OR_TRASH_MESSAGE", request.id, message.id);
  }
  if (normalizeEmail(message.fromEmail) !== normalizeEmail(input.connectedEmail)) {
    return result("NO_MATCH", "SENDER_MISMATCH", request.id, message.id);
  }
  if (message.toEmails.length !== 1
    || normalizeEmail(message.toEmails[0]) !== normalizeEmail(request.toAddresses[0])) {
    return result("NO_MATCH", "RECIPIENT_MISMATCH", request.id, message.id);
  }
  if (normalizeSubject(message.subject) !== normalizeSubject(request.subject)) {
    return result("NO_MATCH", "SUBJECT_MISMATCH", request.id, message.id);
  }
  if (message.bodyText === null || request.bodyText === null) {
    return result("AMBIGUOUS", "BODY_COMPARISON_UNCERTAIN", request.id, message.id);
  }
  if (!bodiesMatch(request.bodyText, message.bodyText)) {
    return result("NO_MATCH", "BODY_MISMATCH", request.id, message.id);
  }
  if (request.providerMessageId !== null
    && request.providerMessageId !== message.providerMessageId) {
    return result("NO_MATCH", "PROVIDER_MESSAGE_ID_CONFLICT", request.id, message.id);
  }
  if (!isCanonicalThreadWellFormed(input.thread)
    || input.thread.id !== message.emailThreadId
    || input.thread.workspaceId !== request.workspaceId
    || input.thread.emailAccountId !== request.emailAccountId) {
    return result("AMBIGUOUS", "CANONICAL_THREAD_UNAVAILABLE", request.id, message.id);
  }
  if (request.providerThreadId !== null
    && request.providerThreadId !== input.thread.providerThreadId) {
    return result("NO_MATCH", "PROVIDER_THREAD_ID_CONFLICT", request.id, message.id);
  }

  return result("SAFE_MATCH", "SAFE_EXACT_CANONICAL_MATCH", request.id, message.id);
}

function isSupportedRequestShape(request: AmbiguousSendRequestEvidence) {
  return Array.isArray(request.toAddresses)
    && request.toAddresses.length === 1
    && isNonEmptyString(request.toAddresses[0])
    && Array.isArray(request.ccAddresses)
    && request.ccAddresses.every((value) => typeof value === "string")
    && request.ccAddresses.length === 0
    && Array.isArray(request.bccAddresses)
    && request.bccAddresses.every((value) => typeof value === "string")
    && request.bccAddresses.length === 0
    && isNonEmptyString(request.subject)
    && isNonEmptyString(request.bodyText)
    && request.bodyHtml === null
    && request.sendAfter === null
    && (request.providerMessageId === null || isNonEmptyString(request.providerMessageId))
    && (request.providerThreadId === null || isNonEmptyString(request.providerThreadId));
}

function isEligibleRequestIdentity(
  request: AmbiguousSendRequestEvidence | null,
): request is AmbiguousSendRequestEvidence {
  return Boolean(request)
    && isNonEmptyString(request?.id)
    && isNonEmptyString(request.workspaceId)
    && isNonEmptyString(request.emailAccountId)
    && request.sendType === "NEW"
    && request.status === "SENDING";
}

function isCanonicalMessageWellFormed(
  message: CanonicalMessageEvidence | undefined,
): message is CanonicalMessageEvidence {
  return Boolean(message)
    && isNonEmptyString(message?.id)
    && isNonEmptyString(message.workspaceId)
    && isNonEmptyString(message.emailAccountId)
    && isNonEmptyString(message.emailThreadId)
    && isNonEmptyString(message.providerMessageId)
    && (message.hirexSendRequestId === null
      || (isNonEmptyString(message.hirexSendRequestId) && UUID_PATTERN.test(message.hirexSendRequestId)))
    && Array.isArray(message.labels)
    && message.labels.every((value) => typeof value === "string")
    && isNonEmptyString(message.direction)
    && (message.fromEmail === null || typeof message.fromEmail === "string")
    && Array.isArray(message.toEmails)
    && message.toEmails.every((value) => typeof value === "string")
    && (message.subject === null || typeof message.subject === "string")
    && (message.bodyText === null || typeof message.bodyText === "string");
}

function isCanonicalThreadWellFormed(
  thread: CanonicalThreadEvidence | null,
): thread is CanonicalThreadEvidence {
  return Boolean(thread)
    && isNonEmptyString(thread?.id)
    && isNonEmptyString(thread.workspaceId)
    && isNonEmptyString(thread.emailAccountId)
    && isNonEmptyString(thread.providerThreadId);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? null;
}

function normalizeSubject(value: string | null) {
  return value?.trim() ?? null;
}

export function bodiesMatch(expected: string, observed: string) {
  const left = normalizeLineEndings(expected);
  const right = normalizeLineEndings(observed);
  if (left === right) return true;
  return (left.endsWith("\n") && left.slice(0, -1) === right)
    || (right.endsWith("\n") && right.slice(0, -1) === left);
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function result(
  classification: SendReconciliationResult["classification"],
  reason: SendReconciliationReason,
  sendRequestId: string,
  matchedEmailMessageId: string | null = null,
): SendReconciliationResult {
  return { classification, reason, sendRequestId, matchedEmailMessageId };
}
