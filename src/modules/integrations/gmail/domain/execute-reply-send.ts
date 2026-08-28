export interface ExecuteReplySendInput {
  sendRequestId: string;
  workspaceId: string;
  emailAccountId: string;
}

export type ReplySendStatus =
  | "SENT"
  | "FAILED"
  | "NOT_ELIGIBLE"
  | "DELIVERY_STATUS_UNKNOWN"
  | "INVALID_INPUT"
  | "UNAVAILABLE";

export type ReplySendReason =
  | "SENT"
  | "REPLY_TARGET_CHANGED"
  | "REPLY_TARGET_NOT_REPLYABLE"
  | "MIME_BUILD_FAILED"
  | "REAUTH_REQUIRED"
  | "GMAIL_PERMISSION_DENIED"
  | "GMAIL_RATE_LIMITED"
  | "GMAIL_SEND_REJECTED"
  | "INVALID_EXECUTOR_INPUT"
  | "CREDENTIALS_UNAVAILABLE"
  | "LOCK_GENERATION_FAILED"
  | "REQUEST_NOT_ELIGIBLE"
  | "CLAIM_UNAVAILABLE"
  | "EXECUTION_UNAVAILABLE"
  | "GMAIL_DELIVERY_STATUS_UNKNOWN"
  | "PROVIDER_THREAD_MISMATCH"
  | "SENT_FINALIZATION_UNCERTAIN";

export interface ReplySendResult {
  status: ReplySendStatus;
  reason: ReplySendReason;
  sendRequestId: string | null;
  providerMessageId: string | null;
  providerThreadId: string | null;
}

export type ReplyDeterministicFailureCode =
  | "REPLY_TARGET_CHANGED"
  | "REPLY_TARGET_NOT_REPLYABLE"
  | "MIME_BUILD_FAILED"
  | "REAUTH_REQUIRED"
  | "GMAIL_PERMISSION_DENIED"
  | "GMAIL_RATE_LIMITED"
  | "GMAIL_SEND_REJECTED";

export class ReplyGmailDefinitiveError extends Error {
  readonly safeCode: Extract<ReplyDeterministicFailureCode,
    "REAUTH_REQUIRED" | "GMAIL_PERMISSION_DENIED" | "GMAIL_RATE_LIMITED" | "GMAIL_SEND_REJECTED">;

  constructor(safeCode: Extract<ReplyDeterministicFailureCode,
    "REAUTH_REQUIRED" | "GMAIL_PERMISSION_DENIED" | "GMAIL_RATE_LIMITED" | "GMAIL_SEND_REJECTED">) {
    super("Gmail definitively rejected the reply.");
    this.safeCode = safeCode;
  }
}

export class ReplyGmailAmbiguousError extends Error {
  constructor() { super("Gmail reply delivery status is unknown."); }
}

export interface ExecuteReplySendDependencies {
  loadCredentials(input: ExecuteReplySendInput): Promise<unknown>;
  generateLock(): unknown;
  claim(input: ExecuteReplySendInput & { sendLockId: string }): Promise<unknown>;
  prepare(input: ExecuteReplySendInput & { sendLockId: string }): Promise<unknown>;
  buildMime(input: { plan: unknown; senderEmail: string }): unknown;
  sendGmail(accessToken: string, raw: string, providerThreadId: string): Promise<unknown>;
  finalizeSent(input: ExecuteReplySendInput & {
    sendLockId: string;
    providerMessageId: string;
    providerThreadId: string;
  }): Promise<unknown>;
  finalizeFailed(input: ExecuteReplySendInput & {
    sendLockId: string;
    safeErrorCode: ReplyDeterministicFailureCode;
  }): Promise<unknown>;
}

export async function executeReplySend(
  input: ExecuteReplySendInput,
  dependencies: ExecuteReplySendDependencies,
): Promise<ReplySendResult> {
  if (!isExactInput(input)) return result("INVALID_INPUT", "INVALID_EXECUTOR_INPUT", null);

  let credentials: unknown;
  try { credentials = await dependencies.loadCredentials(input); } catch {
    return result("UNAVAILABLE", "CREDENTIALS_UNAVAILABLE", input.sendRequestId);
  }
  if (!isCredentials(credentials, input)) {
    return result("UNAVAILABLE", "CREDENTIALS_UNAVAILABLE", input.sendRequestId);
  }

  let sendLockId: unknown;
  try { sendLockId = dependencies.generateLock(); } catch {
    return result("UNAVAILABLE", "LOCK_GENERATION_FAILED", input.sendRequestId);
  }
  if (!isUuid(sendLockId)) return result("UNAVAILABLE", "LOCK_GENERATION_FAILED", input.sendRequestId);
  const scoped = { ...input, sendLockId };

  let claim: unknown;
  try { claim = await dependencies.claim(scoped); } catch {
    return result("UNAVAILABLE", "CLAIM_UNAVAILABLE", input.sendRequestId);
  }
  const claimState = classifyClaim(claim, scoped);
  if (claimState === "EMPTY") return result("NOT_ELIGIBLE", "REQUEST_NOT_ELIGIBLE", input.sendRequestId);
  if (claimState !== "VALID") return result("UNAVAILABLE", "CLAIM_UNAVAILABLE", input.sendRequestId);

  let planResult: unknown;
  try { planResult = await dependencies.prepare(scoped); } catch {
    return result("UNAVAILABLE", "EXECUTION_UNAVAILABLE", input.sendRequestId);
  }
  const planner = classifyPlanner(planResult, scoped);
  if (planner.kind === "DETERMINISTIC_FAILURE") {
    return finalizeKnownFailure(input, sendLockId, planner.code, dependencies);
  }
  if (planner.kind === "NOT_ELIGIBLE") {
    return result("UNAVAILABLE", "EXECUTION_UNAVAILABLE", input.sendRequestId);
  }
  if (planner.kind !== "READY") {
    return result("UNAVAILABLE", "EXECUTION_UNAVAILABLE", input.sendRequestId);
  }

  let mimeResult: unknown;
  try { mimeResult = dependencies.buildMime({ plan: planner.plan, senderEmail: credentials.emailAddress }); } catch {
    return result("UNAVAILABLE", "EXECUTION_UNAVAILABLE", input.sendRequestId);
  }
  const mime = classifyMime(mimeResult, input.sendRequestId);
  if (mime.kind === "INVALID") {
    return finalizeKnownFailure(input, sendLockId, "MIME_BUILD_FAILED", dependencies);
  }
  if (mime.kind !== "READY") {
    return result("UNAVAILABLE", "EXECUTION_UNAVAILABLE", input.sendRequestId);
  }

  let providerResult: unknown;
  try {
    providerResult = await dependencies.sendGmail(
      credentials.accessToken,
      mime.raw,
      mime.providerThreadId,
    );
  } catch (error) {
    if (error instanceof ReplyGmailDefinitiveError) {
      if (!isProviderDefinitiveCode(error.safeCode)) {
        return result("DELIVERY_STATUS_UNKNOWN", "GMAIL_DELIVERY_STATUS_UNKNOWN", input.sendRequestId);
      }
      return finalizeKnownFailure(input, sendLockId, error.safeCode, dependencies);
    }
    return result("DELIVERY_STATUS_UNKNOWN", "GMAIL_DELIVERY_STATUS_UNKNOWN", input.sendRequestId);
  }

  if (!isProviderResult(providerResult)) {
    return result("DELIVERY_STATUS_UNKNOWN", "GMAIL_DELIVERY_STATUS_UNKNOWN", input.sendRequestId);
  }
  if (providerResult.providerThreadId !== mime.providerThreadId) {
    return result(
      "DELIVERY_STATUS_UNKNOWN",
      "PROVIDER_THREAD_MISMATCH",
      input.sendRequestId,
      providerResult.providerMessageId,
      providerResult.providerThreadId,
    );
  }

  let finalized: unknown;
  try {
    finalized = await dependencies.finalizeSent({
      ...input,
      sendLockId,
      providerMessageId: providerResult.providerMessageId,
      providerThreadId: providerResult.providerThreadId,
    });
  } catch {
    return result(
      "DELIVERY_STATUS_UNKNOWN",
      "SENT_FINALIZATION_UNCERTAIN",
      input.sendRequestId,
      providerResult.providerMessageId,
      providerResult.providerThreadId,
    );
  }
  return finalized === true
    ? result("SENT", "SENT", input.sendRequestId, providerResult.providerMessageId, providerResult.providerThreadId)
    : result("DELIVERY_STATUS_UNKNOWN", "SENT_FINALIZATION_UNCERTAIN", input.sendRequestId,
      providerResult.providerMessageId, providerResult.providerThreadId);
}

async function finalizeKnownFailure(
  input: ExecuteReplySendInput,
  sendLockId: string,
  safeErrorCode: ReplyDeterministicFailureCode,
  dependencies: ExecuteReplySendDependencies,
) {
  let finalized: unknown;
  try { finalized = await dependencies.finalizeFailed({ ...input, sendLockId, safeErrorCode }); } catch {
    return result("UNAVAILABLE", "EXECUTION_UNAVAILABLE", input.sendRequestId);
  }
  return finalized === true
    ? result("FAILED", safeErrorCode, input.sendRequestId)
    : result("UNAVAILABLE", "EXECUTION_UNAVAILABLE", input.sendRequestId);
}

function classifyClaim(value: unknown, input: ExecuteReplySendInput & { sendLockId: string }) {
  if (!Array.isArray(value)) return "MALFORMED" as const;
  if (value.length === 0) return "EMPTY" as const;
  if (value.length !== 1 || !isRecord(value[0]) || !exactKeys(value[0], [
    "request_id", "workspace_id", "email_account_id", "reply_to_email_message_id", "send_lock_id", "attempt_count",
  ])) return "MALFORMED" as const;
  const row = value[0];
  return row.request_id === input.sendRequestId && row.workspace_id === input.workspaceId
    && row.email_account_id === input.emailAccountId && row.send_lock_id === input.sendLockId
    && row.attempt_count === 1 && isUuid(row.reply_to_email_message_id)
    ? "VALID" as const : "MALFORMED" as const;
}

function classifyPlanner(value: unknown, input: ExecuteReplySendInput & { sendLockId: string }):
  | { kind: "READY"; plan: unknown }
  | { kind: "DETERMINISTIC_FAILURE"; code: "REPLY_TARGET_CHANGED" | "REPLY_TARGET_NOT_REPLYABLE" }
  | { kind: "NOT_ELIGIBLE" }
  | { kind: "UNAVAILABLE" } {
  if (!isRecord(value) || !exactKeys(value, ["status", "reason", "sendRequestId", "plan"])
    || value.sendRequestId !== input.sendRequestId) return { kind: "UNAVAILABLE" };
  if (value.status === "EVIDENCE_CHANGED" && value.reason === "CANONICAL_REPLY_TARGET_CHANGED" && value.plan === null) {
    return { kind: "DETERMINISTIC_FAILURE", code: "REPLY_TARGET_CHANGED" };
  }
  if (value.status === "NOT_REPLYABLE" && value.reason === "REPLY_TARGET_NOT_SAFE" && value.plan === null) {
    return { kind: "DETERMINISTIC_FAILURE", code: "REPLY_TARGET_NOT_REPLYABLE" };
  }
  if (value.status === "NOT_ELIGIBLE"
    && (value.reason === "REQUEST_NOT_CLAIMED" || value.reason === "CLAIM_OWNERSHIP_MISMATCH")
    && value.plan === null) return { kind: "NOT_ELIGIBLE" };
  if (value.status !== "READY" || value.reason !== "READY_FOR_REPLY_MIME" || !isPlan(value.plan, input)) {
    return { kind: "UNAVAILABLE" };
  }
  return { kind: "READY", plan: value.plan };
}

function classifyMime(value: unknown, sendRequestId: string):
  | { kind: "READY"; raw: string; providerThreadId: string }
  | { kind: "INVALID" }
  | { kind: "UNAVAILABLE" } {
  if (!isRecord(value) || !exactKeys(value, ["status", "reason", "raw", "providerThreadId", "sendRequestId"])) {
    return { kind: "UNAVAILABLE" };
  }
  if (value.status === "INVALID_INPUT" && value.reason === "INVALID_REPLY_MIME_INPUT"
    && value.raw === null && value.providerThreadId === null && value.sendRequestId === null) return { kind: "INVALID" };
  if (value.status !== "READY" || value.reason !== "READY_FOR_GMAIL_REPLY_SEND"
    || value.sendRequestId !== sendRequestId || !isBase64Url(value.raw) || !isProviderId(value.providerThreadId)) {
    return { kind: "UNAVAILABLE" };
  }
  return { kind: "READY", raw: value.raw, providerThreadId: value.providerThreadId };
}

function isPlan(value: unknown, input: ExecuteReplySendInput & { sendLockId: string }) {
  if (!isRecord(value) || !exactKeys(value, [
    "sendRequestId", "workspaceId", "emailAccountId", "sendLockId", "replyToEmailMessageId",
    "recipientEmail", "subject", "bodyText", "providerThreadId", "parentRfcMessageId",
  ])) return false;
  return value.sendRequestId === input.sendRequestId && value.workspaceId === input.workspaceId
    && value.emailAccountId === input.emailAccountId && value.sendLockId === input.sendLockId
    && isUuid(value.replyToEmailMessageId) && isConservativeEmail(value.recipientEmail)
    && isSafeHeaderText(value.subject) && isPlainTextBody(value.bodyText)
    && isProviderId(value.providerThreadId) && isCanonicalRfcMessageId(value.parentRfcMessageId);
}

function isCredentials(value: unknown, input: ExecuteReplySendInput): value is {
  accessToken: string; emailAddress: string; emailAccountId: string; workspaceId: string;
} {
  return isRecord(value) && exactKeys(value, ["accessToken", "emailAddress", "emailAccountId", "workspaceId"])
    && isNonblank(value.accessToken) && isEmail(value.emailAddress)
    && value.emailAccountId === input.emailAccountId && value.workspaceId === input.workspaceId;
}
function isProviderResult(value: unknown): value is { providerMessageId: string; providerThreadId: string } {
  return isRecord(value) && exactKeys(value, ["providerMessageId", "providerThreadId"])
    && isProviderId(value.providerMessageId) && isProviderId(value.providerThreadId);
}
function result(status: ReplySendStatus, reason: ReplySendReason, sendRequestId: string | null,
  providerMessageId: string | null = null, providerThreadId: string | null = null): ReplySendResult {
  return { status, reason, sendRequestId, providerMessageId, providerThreadId };
}
function isExactInput(value: unknown): value is ExecuteReplySendInput {
  return isRecord(value) && exactKeys(value, ["sendRequestId", "workspaceId", "emailAccountId"])
    && isUuid(value.sendRequestId) && isUuid(value.workspaceId) && isUuid(value.emailAccountId);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function isNonblank(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function isProviderId(value: unknown): value is string { return typeof value === "string" && value.length >= 1 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value); }
function isBase64Url(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
    && value.length % 4 !== 1 && /^[A-Za-z0-9_-]+$/.test(value);
}
function isProviderDefinitiveCode(value: unknown): value is Extract<ReplyDeterministicFailureCode,
  "REAUTH_REQUIRED" | "GMAIL_PERMISSION_DENIED" | "GMAIL_RATE_LIMITED" | "GMAIL_SEND_REJECTED"> {
  return value === "REAUTH_REQUIRED" || value === "GMAIL_PERMISSION_DENIED"
    || value === "GMAIL_RATE_LIMITED" || value === "GMAIL_SEND_REJECTED";
}
function hasControl(value: string) { return /[\u0000-\u001f\u007f-\u009f]/.test(value); }
function isSafeHeaderText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 998 && !hasControl(value);
}
function isPlainTextBody(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100_000 && !value.includes("\u0000");
}
function isCanonicalRfcMessageId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 998 && !hasControl(value)
    && /^<[^<>\s@]+@[^<>\s@]+>$/.test(value);
}
function isEmail(value: unknown): value is string { return isConservativeEmail(value); }
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
