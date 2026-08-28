const MAX_BODY_TEXT_LENGTH = 100_000;

export interface CreateReplySendRequestInput {
  workspaceId: string;
  emailAccountId: string;
  replyToEmailMessageId: string;
  bodyText: string;
  idempotencyKey: string;
}

export type CreateReplySendRequestStatus =
  | "CREATED"
  | "EXISTING"
  | "NOT_REPLYABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_INPUT"
  | "UNAVAILABLE";

export type CreateReplySendRequestReason =
  | "REPLY_REQUEST_CREATED"
  | "EXISTING_IDEMPOTENT_REPLY_REQUEST"
  | "REPLY_TARGET_NOT_SAFE"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_REPLY_REQUEST_INPUT"
  | "REPLY_REQUEST_UNAVAILABLE";

export interface CreateReplySendRequestResult {
  status: CreateReplySendRequestStatus;
  sendRequestId: string | null;
  replyToEmailMessageId: string;
  reason: CreateReplySendRequestReason;
}

export interface ReplySendRequestInsertPayload {
  workspace_id: string;
  email_account_id: string;
  send_type: "REPLY";
  status: "PENDING";
  reply_to_email_message_id: string;
  to_addresses: [string];
  cc_addresses: [];
  bcc_addresses: [];
  subject: string;
  body_text: string;
  body_html: null;
  send_after: null;
  idempotency_key: string;
  attempt_count: 0;
}

export interface ExistingReplySendRequestEvidence {
  id: unknown;
  workspace_id: unknown;
  email_account_id: unknown;
  send_type: unknown;
  status: unknown;
  attempt_count: unknown;
  send_after: unknown;
  reply_to_email_message_id: unknown;
  to_addresses: unknown;
  cc_addresses: unknown;
  bcc_addresses: unknown;
  subject: unknown;
  body_text: unknown;
  body_html: unknown;
  idempotency_key: unknown;
}

type InsertResult =
  | { kind: "CREATED"; sendRequestId: unknown }
  | { kind: "UNIQUE_CONFLICT" }
  | { kind: "ERROR" };

export interface CreateReplySendRequestDependencies {
  evaluateReplyTarget(input: { workspaceId: string; emailAccountId: string; emailMessageId: string }): Promise<unknown>;
  createRow(payload: ReplySendRequestInsertPayload): Promise<InsertResult>;
  loadByIdempotency(input: CreateReplySendRequestInput): Promise<unknown>;
}

export async function createReplySendRequestWithDependencies(
  input: CreateReplySendRequestInput,
  dependencies: CreateReplySendRequestDependencies,
): Promise<CreateReplySendRequestResult> {
  if (!isValidInput(input)) return result(input, "INVALID_INPUT", "INVALID_REPLY_REQUEST_INPUT");

  let evaluation: unknown;
  try {
    evaluation = await dependencies.evaluateReplyTarget({
      workspaceId: input.workspaceId,
      emailAccountId: input.emailAccountId,
      emailMessageId: input.replyToEmailMessageId,
    });
  } catch {
    return result(input, "UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE");
  }

  const prepared = prepareReplySendRequest(input, evaluation);
  if (!prepared.payload) return prepared.result;

  let inserted: InsertResult;
  try {
    inserted = await dependencies.createRow(prepared.payload);
  } catch {
    return result(input, "UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE");
  }
  if (inserted.kind === "CREATED") {
    return isUuid(inserted.sendRequestId)
      ? result(input, "CREATED", "REPLY_REQUEST_CREATED", inserted.sendRequestId)
      : result(input, "UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE");
  }
  if (inserted.kind === "ERROR") return result(input, "UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE");

  let existing: unknown;
  try {
    existing = await dependencies.loadByIdempotency(input);
  } catch {
    return result(input, "UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE");
  }
  return classifyExistingReplyRequest(input, prepared.payload, existing);
}

export function prepareReplySendRequest(
  input: CreateReplySendRequestInput,
  evaluation: unknown,
): { payload: ReplySendRequestInsertPayload | null; result: CreateReplySendRequestResult } {
  if (!isValidInput(input)) {
    return { payload: null, result: result(input, "INVALID_INPUT", "INVALID_REPLY_REQUEST_INPUT") };
  }
  if (!isRecord(evaluation)) {
    return { payload: null, result: result(input, "UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE") };
  }
  if (evaluation.classification !== "SAFE_REPLY_TARGET" || evaluation.reason !== "SAFE_CANONICAL_REPLY_TARGET") {
    const status = evaluation.classification === "NOT_REPLYABLE" ? "NOT_REPLYABLE" : "UNAVAILABLE";
    const reason = status === "NOT_REPLYABLE" ? "REPLY_TARGET_NOT_SAFE" : "REPLY_REQUEST_UNAVAILABLE";
    return { payload: null, result: result(input, status, reason) };
  }
  if (!isSafeReplyPlan(evaluation, input)) {
    return { payload: null, result: result(input, "UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE") };
  }

  const payload: ReplySendRequestInsertPayload = {
    workspace_id: input.workspaceId,
    email_account_id: input.emailAccountId,
    send_type: "REPLY",
    status: "PENDING",
    reply_to_email_message_id: input.replyToEmailMessageId,
    to_addresses: [evaluation.recipientEmail],
    cc_addresses: [],
    bcc_addresses: [],
    subject: evaluation.subject,
    body_text: input.bodyText,
    body_html: null,
    send_after: null,
    idempotency_key: input.idempotencyKey,
    attempt_count: 0,
  };
  return { payload, result: result(input, "CREATED", "REPLY_REQUEST_CREATED") };
}

export function classifyExistingReplyRequest(
  input: CreateReplySendRequestInput,
  payload: ReplySendRequestInsertPayload,
  existing: unknown,
): CreateReplySendRequestResult {
  if (!isExistingRow(existing)) return result(input, "UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE");
  const equivalent = existing.workspace_id === payload.workspace_id
    && existing.email_account_id === payload.email_account_id
    && existing.idempotency_key === payload.idempotency_key
    && existing.send_type === "REPLY"
    && existing.status === "PENDING"
    && existing.attempt_count === 0
    && existing.send_after === null
    && existing.reply_to_email_message_id === payload.reply_to_email_message_id
    && existing.to_addresses.length === 1 && existing.to_addresses[0] === payload.to_addresses[0]
    && existing.cc_addresses.length === 0 && existing.bcc_addresses.length === 0
    && existing.subject === payload.subject && existing.body_text === payload.body_text
    && existing.body_html === null;
  return equivalent
    ? result(input, "EXISTING", "EXISTING_IDEMPOTENT_REPLY_REQUEST", existing.id)
    : result(input, "IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_KEY_REUSED", existing.id);
}

function isValidInput(input: unknown): input is CreateReplySendRequestInput {
  return isRecord(input)
    && isUuid(input.workspaceId) && isUuid(input.emailAccountId) && isUuid(input.replyToEmailMessageId)
    && isUuid(input.idempotencyKey)
    && typeof input.bodyText === "string" && input.bodyText.trim().length > 0
    && input.bodyText.length <= MAX_BODY_TEXT_LENGTH && !input.bodyText.includes("\u0000");
}

function isSafeReplyPlan(value: Record<string, unknown>, input: CreateReplySendRequestInput): value is Record<string, unknown> & {
  recipientEmail: string; subject: string; providerThreadId: string; parentRfcMessageId: string;
} {
  return value.workspaceId === input.workspaceId
    && value.emailAccountId === input.emailAccountId
    && value.replyToEmailMessageId === input.replyToEmailMessageId
    && isConservativeEmail(value.recipientEmail)
    && isSafeHeaderText(value.subject)
    && isSafeProviderThreadId(value.providerThreadId)
    && isCanonicalRfcMessageId(value.parentRfcMessageId);
}

function isExistingRow(value: unknown): value is {
  id: string; workspace_id: string; email_account_id: string; send_type: string; status: string;
  attempt_count: number; send_after: string | null;
  reply_to_email_message_id: string | null; to_addresses: string[]; cc_addresses: string[];
  bcc_addresses: string[]; subject: string; body_text: string | null; body_html: string | null;
  idempotency_key: string;
} {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.workspace_id)
    || !isUuid(value.email_account_id) || !isUuid(value.idempotency_key)) return false;
  return typeof value.send_type === "string" && typeof value.status === "string"
    && Number.isInteger(value.attempt_count) && (value.attempt_count as number) >= 0
    && nullableString(value.send_after) && nullableString(value.reply_to_email_message_id)
    && stringArray(value.to_addresses) && stringArray(value.cc_addresses) && stringArray(value.bcc_addresses)
    && typeof value.subject === "string" && nullableString(value.body_text) && nullableString(value.body_html);
}

function result(
  input: Pick<CreateReplySendRequestInput, "replyToEmailMessageId">,
  status: CreateReplySendRequestStatus,
  reason: CreateReplySendRequestReason,
  sendRequestId: string | null = null,
): CreateReplySendRequestResult {
  return { status, sendRequestId, replyToEmailMessageId: input.replyToEmailMessageId, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function hasControl(value: string) { return /[\u0000-\u001f\u007f-\u009f]/.test(value); }

function isSafeHeaderText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 998 && !hasControl(value);
}

function isSafeProviderThreadId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !hasControl(value);
}

function isCanonicalRfcMessageId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 998 && !hasControl(value)
    && /^<[^<>\s@]+@[^<>\s@]+>$/.test(value.trim());
}

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
