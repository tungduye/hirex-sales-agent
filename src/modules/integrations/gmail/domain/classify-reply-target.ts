export type ReplyTargetClassification =
  | "SAFE_REPLY_TARGET"
  | "NOT_REPLYABLE"
  | "AMBIGUOUS"
  | "UNAVAILABLE";

export type ReplyTargetReason =
  | "SAFE_CANONICAL_REPLY_TARGET"
  | "MESSAGE_NOT_FOUND"
  | "MESSAGE_NOT_INBOUND"
  | "SPAM_OR_TRASH_MESSAGE"
  | "SENDER_UNAVAILABLE"
  | "SENDER_IS_CONNECTED_ACCOUNT"
  | "RFC_MESSAGE_ID_UNAVAILABLE"
  | "PROVIDER_MESSAGE_ID_UNAVAILABLE"
  | "PROVIDER_THREAD_ID_UNAVAILABLE"
  | "SUBJECT_UNAVAILABLE"
  | "CANONICAL_THREAD_UNAVAILABLE"
  | "ACCOUNT_NOT_CONNECTED"
  | "EVIDENCE_SCOPE_MISMATCH"
  | "EVALUATION_UNAVAILABLE";

export interface ReplyTargetInput {
  workspaceId: string;
  emailAccountId: string;
  emailMessageId: string;
}

export interface ReplyTargetEvidence {
  message: unknown;
  account: unknown;
  thread: unknown;
}

export interface ReplyTargetResult {
  classification: ReplyTargetClassification;
  reason: ReplyTargetReason;
  workspaceId: string;
  emailAccountId: string;
  replyToEmailMessageId: string;
  recipientEmail: string | null;
  subject: string | null;
  providerThreadId: string | null;
  parentRfcMessageId: string | null;
}

export async function evaluateReplyTargetEvidence(
  input: ReplyTargetInput,
  load: (input: ReplyTargetInput) => Promise<ReplyTargetEvidence>,
): Promise<ReplyTargetResult> {
  if (!isUuid(input.workspaceId) || !isUuid(input.emailAccountId) || !isUuid(input.emailMessageId)) {
    return result(input, "UNAVAILABLE", "EVALUATION_UNAVAILABLE");
  }

  try {
    return classifyReplyTarget(input, await load(input));
  } catch {
    return result(input, "UNAVAILABLE", "EVALUATION_UNAVAILABLE");
  }
}

export function classifyReplyTarget(input: ReplyTargetInput, evidence: ReplyTargetEvidence): ReplyTargetResult {
  if (!isRecord(evidence)) return result(input, "AMBIGUOUS", "EVALUATION_UNAVAILABLE");
  if (evidence.message === null) return result(input, "NOT_REPLYABLE", "MESSAGE_NOT_FOUND");
  if (!isMessage(evidence.message)) return result(input, "AMBIGUOUS", "EVALUATION_UNAVAILABLE");
  const message = evidence.message;

  if (message.id !== input.emailMessageId
    || message.workspaceId !== input.workspaceId
    || message.emailAccountId !== input.emailAccountId
    || message.provider !== "GMAIL") {
    return result(input, "NOT_REPLYABLE", "EVIDENCE_SCOPE_MISMATCH");
  }

  if (evidence.account === null) return result(input, "NOT_REPLYABLE", "ACCOUNT_NOT_CONNECTED");
  if (!isAccount(evidence.account)) return result(input, "AMBIGUOUS", "EVALUATION_UNAVAILABLE");
  const account = evidence.account;
  if (account.id !== input.emailAccountId || account.workspaceId !== input.workspaceId) {
    return result(input, "NOT_REPLYABLE", "EVIDENCE_SCOPE_MISMATCH");
  }
  if (account.provider !== "GMAIL" || account.status !== "CONNECTED") {
    return result(input, "NOT_REPLYABLE", "ACCOUNT_NOT_CONNECTED");
  }

  if (message.direction !== "INBOUND") return result(input, "NOT_REPLYABLE", "MESSAGE_NOT_INBOUND");
  if (message.labels.includes("SPAM") || message.labels.includes("TRASH")) {
    return result(input, "NOT_REPLYABLE", "SPAM_OR_TRASH_MESSAGE");
  }

  const sender = normalizeEmail(message.fromEmail);
  const connectedEmail = normalizeEmail(account.emailAddress);
  if (!sender) return result(input, "NOT_REPLYABLE", "SENDER_UNAVAILABLE");
  if (!connectedEmail) return result(input, "AMBIGUOUS", "EVALUATION_UNAVAILABLE");
  if (sender === connectedEmail) return result(input, "NOT_REPLYABLE", "SENDER_IS_CONNECTED_ACCOUNT");
  if (!nonBlank(message.providerMessageId)) return result(input, "NOT_REPLYABLE", "PROVIDER_MESSAGE_ID_UNAVAILABLE");
  const parentRfcMessageId = message.rfcMessageId;
  if (!validRfcMessageId(parentRfcMessageId)) return result(input, "NOT_REPLYABLE", "RFC_MESSAGE_ID_UNAVAILABLE");

  const subject = replySubject(message.subject);
  if (!subject) return result(input, "NOT_REPLYABLE", "SUBJECT_UNAVAILABLE");

  if (evidence.thread === null) return result(input, "AMBIGUOUS", "CANONICAL_THREAD_UNAVAILABLE");
  if (!isThread(evidence.thread)) return result(input, "AMBIGUOUS", "CANONICAL_THREAD_UNAVAILABLE");
  const thread = evidence.thread;
  if (thread.id !== message.emailThreadId
    || thread.workspaceId !== input.workspaceId
    || thread.emailAccountId !== input.emailAccountId
    || thread.provider !== "GMAIL") {
    return result(input, "NOT_REPLYABLE", "EVIDENCE_SCOPE_MISMATCH");
  }
  const providerThreadId = thread.providerThreadId;
  if (!isProviderId(providerThreadId)) {
    return result(input, "NOT_REPLYABLE", "PROVIDER_THREAD_ID_UNAVAILABLE");
  }

  return {
    classification: "SAFE_REPLY_TARGET",
    reason: "SAFE_CANONICAL_REPLY_TARGET",
    workspaceId: input.workspaceId,
    emailAccountId: input.emailAccountId,
    replyToEmailMessageId: input.emailMessageId,
    recipientEmail: sender,
    subject,
    providerThreadId,
    parentRfcMessageId: parentRfcMessageId.trim(),
  };
}

function result(input: ReplyTargetInput, classification: ReplyTargetClassification, reason: ReplyTargetReason): ReplyTargetResult {
  return {
    classification,
    reason,
    workspaceId: input.workspaceId,
    emailAccountId: input.emailAccountId,
    replyToEmailMessageId: input.emailMessageId,
    recipientEmail: null,
    subject: null,
    providerThreadId: null,
    parentRfcMessageId: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function isMessage(value: unknown): value is {
  id: string; workspaceId: string; emailAccountId: string; emailThreadId: string; provider: string;
  providerMessageId: string | null; rfcMessageId: string | null;
  direction: string; fromEmail: string | null; subject: string | null; labels: string[];
} {
  if (!isRecord(value) || !exactKeys(value, ["id", "workspaceId", "emailAccountId", "emailThreadId", "provider", "providerMessageId", "rfcMessageId", "direction", "fromEmail", "subject", "labels"])) return false;
  return [value.id, value.workspaceId, value.emailAccountId, value.emailThreadId, value.provider, value.direction].every((item) => typeof item === "string")
    && nullableString(value.providerMessageId) && nullableString(value.rfcMessageId)
    && nullableString(value.fromEmail) && nullableString(value.subject)
    && Array.isArray(value.labels) && value.labels.every((label) => typeof label === "string");
}

function isAccount(value: unknown): value is { id: string; workspaceId: string; provider: string; status: string; emailAddress: string } {
  return isRecord(value) && exactKeys(value, ["id", "workspaceId", "provider", "status", "emailAddress"])
    && [value.id, value.workspaceId, value.provider, value.status, value.emailAddress].every((item) => typeof item === "string");
}

function isThread(value: unknown): value is { id: string; workspaceId: string; emailAccountId: string; provider: string; providerThreadId: unknown } {
  return isRecord(value) && exactKeys(value, ["id", "workspaceId", "emailAccountId", "provider", "providerThreadId"])
    && [value.id, value.workspaceId, value.emailAccountId, value.provider].every((item) => typeof item === "string");
}

function nullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function nonBlank(value: string | null): value is string { return typeof value === "string" && value.trim().length > 0 && !/[\r\n]/.test(value); }
function isProviderId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 512
    && /^[A-Za-z0-9_-]+$/.test(value);
}
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

function normalizeEmail(value: string | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 254 || hasControlCharacter(normalized)
    || /[\s<>()[\]\\,;:"]/.test(normalized)) return null;
  const parts = normalized.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || !domain || local.length > 64 || domain.length > 253
    || local.startsWith(".") || local.endsWith(".") || local.includes("..")
    || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => label.length === 0 || label.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return normalized;
}

function validRfcMessageId(value: string | null): value is string {
  if (typeof value !== "string" || value.length > 998 || hasControlCharacter(value)) return false;
  return /^<[^<>\s@]+@[^<>\s@]+>$/.test(value.trim());
}

function replySubject(value: string | null) {
  if (typeof value !== "string" || hasControlCharacter(value)) return null;
  const original = value.trim();
  if (!original) return null;
  const withoutPrefixes = original.replace(/^(?:re:\s*)+/i, "").trim();
  return withoutPrefixes ? `Re: ${withoutPrefixes}` : null;
}

function hasControlCharacter(value: string) {
  return /[\u0000-\u001f\u007f-\u009f]/.test(value);
}
