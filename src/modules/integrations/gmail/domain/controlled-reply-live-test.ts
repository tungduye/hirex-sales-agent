const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_BODY_TEXT_LENGTH = 100_000;

const FLAGS = [
  "--workspace-id", "--email-account-id", "--email-message-id", "--body-text", "--idempotency-key",
  "--expected-recipient", "--expected-subject", "--expected-provider-thread-id",
  "--expected-parent-rfc-message-id", "--confirm-send-one-reply",
] as const;

const DETERMINISTIC_FAILURES = new Set([
  "REPLY_TARGET_CHANGED", "REPLY_TARGET_NOT_REPLYABLE", "MIME_BUILD_FAILED", "REAUTH_REQUIRED",
  "GMAIL_PERMISSION_DENIED", "GMAIL_RATE_LIMITED", "GMAIL_SEND_REJECTED",
]);
const PREFLIGHT_NOT_REPLYABLE_REASONS = new Set([
  "MESSAGE_NOT_FOUND", "MESSAGE_NOT_INBOUND", "SPAM_OR_TRASH_MESSAGE", "SENDER_UNAVAILABLE",
  "SENDER_IS_CONNECTED_ACCOUNT", "RFC_MESSAGE_ID_UNAVAILABLE", "PROVIDER_MESSAGE_ID_UNAVAILABLE",
  "PROVIDER_THREAD_ID_UNAVAILABLE", "SUBJECT_UNAVAILABLE", "ACCOUNT_NOT_CONNECTED", "EVIDENCE_SCOPE_MISMATCH",
]);
const UNKNOWN_EXECUTION_REASONS = new Set([
  "GMAIL_DELIVERY_STATUS_UNKNOWN", "PROVIDER_THREAD_MISMATCH", "SENT_FINALIZATION_UNCERTAIN",
]);
const STOP_EXECUTION_REASONS = new Set([
  "REQUEST_NOT_ELIGIBLE", "INVALID_EXECUTOR_INPUT", "CREDENTIALS_UNAVAILABLE", "LOCK_GENERATION_FAILED",
  "CLAIM_UNAVAILABLE", "EXECUTION_UNAVAILABLE",
]);

export interface ControlledReplyLiveTestInput {
  workspaceId: string;
  emailAccountId: string;
  emailMessageId: string;
  bodyText: string;
  idempotencyKey: string;
  expectedRecipient: string;
  expectedSubject: string;
  expectedProviderThreadId: string;
  expectedParentRfcMessageId: string;
}

export interface ControlledReplyLiveTestDependencies {
  preflight(input: { workspaceId: string; emailAccountId: string; emailMessageId: string }): Promise<unknown>;
  createRequest(input: {
    workspaceId: string; emailAccountId: string; replyToEmailMessageId: string;
    bodyText: string; idempotencyKey: string;
  }): Promise<unknown>;
  inspectRequest(input: { sendRequestId: string; workspaceId: string; emailAccountId: string }): Promise<unknown>;
  executeRequest(input: { sendRequestId: string; workspaceId: string; emailAccountId: string }): Promise<unknown>;
}

export interface ControlledReplyLiveTestResult {
  status: "VERIFIED_SENT" | "VERIFIED_FAILED" | "DELIVERY_STATUS_UNKNOWN" | "REFUSED"
    | "INVALID_INPUT" | "NOT_REPLYABLE" | "IDEMPOTENCY_CONFLICT" | "UNAVAILABLE";
  reason: string;
  sendRequestId: string | null;
  workspaceId: string | null;
  emailAccountId: string | null;
  emailMessageId: string | null;
  requestCreationStatus: "CREATED" | "EXISTING" | null;
  executorStatus: "SENT" | "FAILED" | "DELIVERY_STATUS_UNKNOWN" | "NOT_ELIGIBLE"
    | "INVALID_INPUT" | "UNAVAILABLE" | null;
  finalRequestStatus: "PENDING" | "SENDING" | "SENT" | "FAILED" | "CANCELLED" | null;
  providerMessageId: string | null;
  providerThreadId: string | null;
}

export async function runControlledReplyLiveTestCli(
  argv: string[],
  environment: Record<string, string | undefined>,
  dependencies: ControlledReplyLiveTestDependencies,
): Promise<ControlledReplyLiveTestResult> {
  if (environment.HIREX_ENABLE_CONTROLLED_REPLY_LIVE_TEST !== "1") {
    return empty("REFUSED", "CONTROLLED_REPLY_LIVE_TEST_DISABLED");
  }
  const input = parseArguments(argv);
  if (!input) return empty("INVALID_INPUT", "INVALID_ARGUMENTS");
  const scope = scoped(input);

  let preflight: unknown;
  try { preflight = await dependencies.preflight(scope); } catch {
    return output(input, "UNAVAILABLE", "PREFLIGHT_UNAVAILABLE");
  }
  const canonical = classifyPreflight(preflight, input);
  if (canonical.kind === "NOT_REPLYABLE") return output(input, "NOT_REPLYABLE", canonical.reason);
  if (canonical.kind !== "READY") return output(input, "UNAVAILABLE", "PREFLIGHT_UNAVAILABLE");
  if (canonical.recipientEmail !== input.expectedRecipient || canonical.subject !== input.expectedSubject
    || canonical.providerThreadId !== input.expectedProviderThreadId
    || canonical.parentRfcMessageId !== input.expectedParentRfcMessageId) {
    return output(input, "REFUSED", "LIVE_TARGET_CONFIRMATION_MISMATCH");
  }

  let created: unknown;
  try {
    created = await dependencies.createRequest({
      workspaceId: input.workspaceId,
      emailAccountId: input.emailAccountId,
      replyToEmailMessageId: input.emailMessageId,
      bodyText: input.bodyText,
      idempotencyKey: input.idempotencyKey,
    });
  } catch { return output(input, "UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE"); }
  const creation = classifyCreation(created, input);
  if (creation.kind !== "READY") {
    return output(input, creation.status, creation.reason, creation.sendRequestId);
  }

  const inspectionInput = {
    sendRequestId: creation.sendRequestId,
    workspaceId: input.workspaceId,
    emailAccountId: input.emailAccountId,
  };
  let pendingRow: unknown;
  try { pendingRow = await dependencies.inspectRequest(inspectionInput); } catch {
    return output(input, "UNAVAILABLE", "PENDING_REQUEST_INSPECTION_FAILED", creation.sendRequestId, creation.status);
  }
  if (!isPendingRequest(pendingRow, input, canonical, creation.sendRequestId)) {
    return output(input, "UNAVAILABLE", "PENDING_REQUEST_INSPECTION_FAILED", creation.sendRequestId, creation.status);
  }

  let executor: unknown;
  try { executor = await dependencies.executeRequest(inspectionInput); } catch {
    executor = { status: "UNAVAILABLE", reason: "EXECUTION_UNAVAILABLE", sendRequestId: creation.sendRequestId,
      providerMessageId: null, providerThreadId: null };
  }
  const execution = classifyExecutor(executor, creation.sendRequestId);

  let finalRow: unknown;
  try { finalRow = await dependencies.inspectRequest(inspectionInput); } catch {
    if (execution.kind === "SENT" || execution.kind === "UNKNOWN") {
      return output(input, "DELIVERY_STATUS_UNKNOWN",
        execution.kind === "SENT" ? "FINAL_STATE_VERIFICATION_FAILED" : execution.reason,
        creation.sendRequestId, creation.status, execution.status, null,
        execution.providerMessageId, execution.providerThreadId);
    }
    return output(input, "UNAVAILABLE", "FINAL_STATE_VERIFICATION_FAILED", creation.sendRequestId,
      creation.status, execution.status);
  }
  const finalStatus = safeFinalStatus(finalRow);

  if (execution.kind === "SENT") {
    return isVerifiedSent(finalRow, input, canonical, creation.sendRequestId, execution)
      ? output(input, "VERIFIED_SENT", "VERIFIED_SENT", creation.sendRequestId, creation.status, "SENT", "SENT",
        execution.providerMessageId, execution.providerThreadId)
      : output(input, "DELIVERY_STATUS_UNKNOWN", "FINAL_STATE_VERIFICATION_FAILED", creation.sendRequestId,
        creation.status, "SENT", finalStatus, execution.providerMessageId, execution.providerThreadId);
  }
  if (execution.kind === "FAILED") {
    return isVerifiedFailed(finalRow, input, canonical, creation.sendRequestId, execution.reason)
      ? output(input, "VERIFIED_FAILED", execution.reason, creation.sendRequestId, creation.status, "FAILED", "FAILED")
      : output(input, "UNAVAILABLE", "FINAL_STATE_VERIFICATION_FAILED", creation.sendRequestId,
        creation.status, "FAILED", finalStatus);
  }
  if (execution.kind === "UNKNOWN") {
    return output(input, "DELIVERY_STATUS_UNKNOWN", execution.reason || "FINAL_STATE_UNRESOLVED",
      creation.sendRequestId, creation.status, execution.status, finalStatus,
      execution.providerMessageId, execution.providerThreadId);
  }
  return output(input, "UNAVAILABLE", execution.reason, creation.sendRequestId, creation.status,
    execution.status, finalStatus);
}

type Canonical = { kind: "READY"; recipientEmail: string; subject: string; providerThreadId: string; parentRfcMessageId: string }
  | { kind: "NOT_REPLYABLE"; reason: string } | { kind: "UNAVAILABLE" };
function classifyPreflight(value: unknown, input: ControlledReplyLiveTestInput): Canonical {
  if (!isRecord(value) || !exactKeys(value, ["status", "reason", "workspaceId", "emailAccountId", "emailMessageId",
    "recipientEmail", "subject", "providerThreadId", "parentRfcMessageId"])
    || value.workspaceId !== input.workspaceId || value.emailAccountId !== input.emailAccountId
    || value.emailMessageId !== input.emailMessageId) return { kind: "UNAVAILABLE" };
  if (value.status === "READY_FOR_CONTROLLED_REPLY_TEST" && value.reason === "SAFE_CANONICAL_REPLY_TARGET"
    && isEmail(value.recipientEmail) && isSafeSubject(value.subject) && isProviderId(value.providerThreadId)
    && isRfcMessageId(value.parentRfcMessageId)) {
    return { kind: "READY", recipientEmail: value.recipientEmail, subject: value.subject,
      providerThreadId: value.providerThreadId, parentRfcMessageId: value.parentRfcMessageId };
  }
  if (value.status === "NOT_REPLYABLE" && typeof value.reason === "string"
    && PREFLIGHT_NOT_REPLYABLE_REASONS.has(value.reason) && metadataNull(value)) {
    return { kind: "NOT_REPLYABLE", reason: value.reason };
  }
  return { kind: "UNAVAILABLE" };
}

type Creation = { kind: "READY"; status: "CREATED" | "EXISTING"; sendRequestId: string }
  | { kind: "STOP"; status: "NOT_REPLYABLE" | "IDEMPOTENCY_CONFLICT" | "INVALID_INPUT" | "UNAVAILABLE";
    reason: string; sendRequestId: string | null };
function classifyCreation(value: unknown, input: ControlledReplyLiveTestInput): Creation {
  if (!isRecord(value) || !exactKeys(value, ["status", "sendRequestId", "replyToEmailMessageId", "reason"])
    || value.replyToEmailMessageId !== input.emailMessageId) return stop("UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE");
  if ((value.status === "CREATED" && value.reason === "REPLY_REQUEST_CREATED"
      || value.status === "EXISTING" && value.reason === "EXISTING_IDEMPOTENT_REPLY_REQUEST")
    && isUuid(value.sendRequestId)) return { kind: "READY", status: value.status, sendRequestId: value.sendRequestId };
  if (value.status === "IDEMPOTENCY_CONFLICT" && value.reason === "IDEMPOTENCY_KEY_REUSED"
    && isUuid(value.sendRequestId)) return stop("IDEMPOTENCY_CONFLICT", value.reason, value.sendRequestId);
  if (value.status === "NOT_REPLYABLE" && value.reason === "REPLY_TARGET_NOT_SAFE" && value.sendRequestId === null) {
    return stop("NOT_REPLYABLE", value.reason);
  }
  if (value.status === "INVALID_INPUT" && value.reason === "INVALID_REPLY_REQUEST_INPUT" && value.sendRequestId === null) {
    return stop("INVALID_INPUT", value.reason);
  }
  if (value.status === "UNAVAILABLE" && value.reason === "REPLY_REQUEST_UNAVAILABLE" && value.sendRequestId === null) {
    return stop("UNAVAILABLE", value.reason);
  }
  return stop("UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE");
}
function stop(status: "NOT_REPLYABLE" | "IDEMPOTENCY_CONFLICT" | "INVALID_INPUT" | "UNAVAILABLE",
  reason: string, sendRequestId: string | null = null): Creation {
  return { kind: "STOP", status, reason, sendRequestId };
}

type Execution = { kind: "SENT"; status: "SENT"; reason: "SENT"; providerMessageId: string; providerThreadId: string }
  | { kind: "FAILED"; status: "FAILED"; reason: string; providerMessageId: null; providerThreadId: null }
  | { kind: "UNKNOWN" | "STOP"; status: "DELIVERY_STATUS_UNKNOWN" | "NOT_ELIGIBLE" | "INVALID_INPUT" | "UNAVAILABLE";
    reason: string; providerMessageId: string | null; providerThreadId: string | null };
function classifyExecutor(value: unknown, sendRequestId: string): Execution {
  if (!isRecord(value) || !exactKeys(value, ["status", "reason", "sendRequestId", "providerMessageId", "providerThreadId"])
    || value.sendRequestId !== sendRequestId || typeof value.reason !== "string") {
    return { kind: "STOP", status: "UNAVAILABLE", reason: "EXECUTION_UNAVAILABLE",
      providerMessageId: null, providerThreadId: null };
  }
  if (value.status === "SENT" && value.reason === "SENT" && isProviderId(value.providerMessageId)
    && isProviderId(value.providerThreadId)) return { kind: "SENT", status: "SENT", reason: "SENT",
      providerMessageId: value.providerMessageId, providerThreadId: value.providerThreadId };
  if (value.status === "FAILED" && DETERMINISTIC_FAILURES.has(value.reason)
    && value.providerMessageId === null && value.providerThreadId === null) {
    return { kind: "FAILED", status: "FAILED", reason: value.reason,
      providerMessageId: null, providerThreadId: null };
  }
  if (value.status === "DELIVERY_STATUS_UNKNOWN" && UNKNOWN_EXECUTION_REASONS.has(value.reason)
    && nullableProviderId(value.providerMessageId) && nullableProviderId(value.providerThreadId)) {
    return { kind: "UNKNOWN", status: "DELIVERY_STATUS_UNKNOWN", reason: value.reason,
      providerMessageId: value.providerMessageId, providerThreadId: value.providerThreadId };
  }
  if (isConsistentStopExecution(value.status, value.reason)
    && value.providerMessageId === null && value.providerThreadId === null) {
    return { kind: "STOP", status: value.status, reason: value.reason, providerMessageId: null, providerThreadId: null };
  }
  return { kind: "STOP", status: "UNAVAILABLE", reason: "EXECUTION_UNAVAILABLE",
    providerMessageId: null, providerThreadId: null };
}

function isPendingRequest(value: unknown, input: ControlledReplyLiveTestInput, canonical: Extract<Canonical, { kind: "READY" }>, sendRequestId: string) {
  return hasImmutableShape(value, input, sendRequestId)
    && value.send_type === "REPLY" && value.status === "PENDING" && value.attempt_count === 0
    && value.last_attempt_at === null && value.safe_error_code === null
    && value.send_lock_id === null && value.send_lock_at === null
    && value.to_addresses.length === 1 && value.to_addresses[0] === canonical.recipientEmail
    && value.cc_addresses.length === 0 && value.bcc_addresses.length === 0
    && value.subject === canonical.subject && value.body_html === null && value.send_after === null
    && value.provider_message_id === null && value.provider_thread_id === null
    && value.rfc_message_id === null && value.sent_at === null;
}
function isVerifiedSent(value: unknown, input: ControlledReplyLiveTestInput,
  canonical: Extract<Canonical, { kind: "READY" }>, sendRequestId: string,
  execution: Extract<Execution, { kind: "SENT" }>) {
  return hasImmutableShape(value, input, sendRequestId) && value.send_type === "REPLY" && value.status === "SENT"
    && value.attempt_count === 1 && isTimestamp(value.last_attempt_at) && value.safe_error_code === null
    && value.send_lock_id === null && value.send_lock_at === null && value.to_addresses.length === 1
    && value.to_addresses[0] === canonical.recipientEmail && value.cc_addresses.length === 0
    && value.bcc_addresses.length === 0 && value.subject === canonical.subject && value.body_html === null
    && value.send_after === null && value.provider_message_id === execution.providerMessageId
    && value.provider_thread_id === execution.providerThreadId
    && value.provider_thread_id === canonical.providerThreadId && isTimestamp(value.sent_at)
    && value.rfc_message_id === null;
}
function isVerifiedFailed(value: unknown, input: ControlledReplyLiveTestInput,
  canonical: Extract<Canonical, { kind: "READY" }>, sendRequestId: string, reason: string) {
  return hasImmutableShape(value, input, sendRequestId) && value.send_type === "REPLY" && value.status === "FAILED"
    && value.attempt_count === 1 && isTimestamp(value.last_attempt_at) && value.safe_error_code === reason
    && value.send_lock_id === null && value.send_lock_at === null && value.to_addresses.length === 1
    && value.to_addresses[0] === canonical.recipientEmail && value.cc_addresses.length === 0
    && value.bcc_addresses.length === 0 && value.subject === canonical.subject
    && value.body_html === null && value.send_after === null
    && value.provider_message_id === null && value.provider_thread_id === null && value.rfc_message_id === null
    && value.sent_at === null;
}
function hasImmutableShape(value: unknown, input: ControlledReplyLiveTestInput, sendRequestId: string): value is Record<string, unknown> & {
  to_addresses: unknown[]; cc_addresses: unknown[]; bcc_addresses: unknown[];
} {
  return isRecord(value) && exactKeys(value, ["id", "workspace_id", "email_account_id", "send_type", "status",
    "attempt_count", "last_attempt_at", "safe_error_code", "send_lock_id", "send_lock_at",
    "reply_to_email_message_id", "to_addresses", "cc_addresses", "bcc_addresses", "subject", "body_text",
    "body_html", "send_after", "idempotency_key", "provider_message_id", "provider_thread_id", "rfc_message_id", "sent_at"])
    && value.id === sendRequestId && value.workspace_id === input.workspaceId
    && value.email_account_id === input.emailAccountId && value.reply_to_email_message_id === input.emailMessageId
    && value.idempotency_key === input.idempotencyKey && value.body_text === input.bodyText
    && Array.isArray(value.to_addresses) && Array.isArray(value.cc_addresses) && Array.isArray(value.bcc_addresses);
}

function parseArguments(argv: unknown): ControlledReplyLiveTestInput | null {
  if (!Array.isArray(argv) || argv.length !== FLAGS.length * 2 || !argv.every((item) => typeof item === "string")) return null;
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!FLAGS.includes(flag as typeof FLAGS[number]) || value.startsWith("--") || values.has(flag)) return null;
    values.set(flag, value);
  }
  if (values.get("--confirm-send-one-reply") !== "SEND_ONE_CONTROLLED_REPLY") return null;
  const input = {
    workspaceId: values.get("--workspace-id"), emailAccountId: values.get("--email-account-id"),
    emailMessageId: values.get("--email-message-id"), bodyText: values.get("--body-text"),
    idempotencyKey: values.get("--idempotency-key"), expectedRecipient: values.get("--expected-recipient"),
    expectedSubject: values.get("--expected-subject"),
    expectedProviderThreadId: values.get("--expected-provider-thread-id"),
    expectedParentRfcMessageId: values.get("--expected-parent-rfc-message-id"),
  };
  return isUuid(input.workspaceId) && isUuid(input.emailAccountId) && isUuid(input.emailMessageId)
    && isUuid(input.idempotencyKey) && isBody(input.bodyText) && isEmail(input.expectedRecipient)
    && isSafeSubject(input.expectedSubject) && isProviderId(input.expectedProviderThreadId)
    && isRfcMessageId(input.expectedParentRfcMessageId) ? input as ControlledReplyLiveTestInput : null;
}

function empty(status: "REFUSED" | "INVALID_INPUT", reason: string): ControlledReplyLiveTestResult {
  return { status, reason, sendRequestId: null, workspaceId: null, emailAccountId: null, emailMessageId: null,
    requestCreationStatus: null, executorStatus: null, finalRequestStatus: null,
    providerMessageId: null, providerThreadId: null };
}
function output(input: ControlledReplyLiveTestInput, status: ControlledReplyLiveTestResult["status"], reason: string,
  sendRequestId: string | null = null, requestCreationStatus: "CREATED" | "EXISTING" | null = null,
  executorStatus: ControlledReplyLiveTestResult["executorStatus"] = null,
  finalRequestStatus: ControlledReplyLiveTestResult["finalRequestStatus"] = null,
  providerMessageId: string | null = null, providerThreadId: string | null = null): ControlledReplyLiveTestResult {
  return { status, reason, sendRequestId, ...scoped(input), requestCreationStatus, executorStatus,
    finalRequestStatus, providerMessageId, providerThreadId };
}
function scoped(input: ControlledReplyLiveTestInput) {
  return { workspaceId: input.workspaceId, emailAccountId: input.emailAccountId, emailMessageId: input.emailMessageId };
}
function safeFinalStatus(value: unknown): ControlledReplyLiveTestResult["finalRequestStatus"] {
  if (!isRecord(value)) return null;
  return value.status === "PENDING" || value.status === "SENDING" || value.status === "SENT"
    || value.status === "FAILED" || value.status === "CANCELLED" ? value.status : null;
}
function metadataNull(value: Record<string, unknown>) { return value.recipientEmail === null && value.subject === null
  && value.providerThreadId === null && value.parentRfcMessageId === null; }
function nullableProviderId(value: unknown): value is string | null { return value === null || isProviderId(value); }
function isConsistentStopExecution(status: unknown, reason: unknown): status is "NOT_ELIGIBLE" | "INVALID_INPUT" | "UNAVAILABLE" {
  if (typeof reason !== "string" || !STOP_EXECUTION_REASONS.has(reason)) return false;
  if (status === "NOT_ELIGIBLE") return reason === "REQUEST_NOT_ELIGIBLE";
  if (status === "INVALID_INPUT") return reason === "INVALID_EXECUTOR_INPUT";
  return status === "UNAVAILABLE" && reason !== "REQUEST_NOT_ELIGIBLE" && reason !== "INVALID_EXECUTOR_INPUT";
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function isUuid(value: unknown): value is string { return typeof value === "string" && UUID_PATTERN.test(value); }
function hasControl(value: string) { return /[\u0000-\u001f\u007f-\u009f]/.test(value); }
function isBody(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0
  && value.length <= MAX_BODY_TEXT_LENGTH && !value.includes("\u0000"); }
function isSafeSubject(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0
  && value.length <= 998 && !hasControl(value); }
function isProviderId(value: unknown): value is string { return typeof value === "string" && value.length >= 1
  && value.length <= 512 && PROVIDER_ID_PATTERN.test(value); }
function isRfcMessageId(value: unknown): value is string { return typeof value === "string" && value.length <= 998
  && !hasControl(value) && /^<[^<>\s@]+@[^<>\s@]+>$/.test(value); }
function isTimestamp(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0
  && Number.isFinite(Date.parse(value)); }
function isEmail(value: unknown): value is string {
  if (typeof value !== "string" || value !== value.trim().toLowerCase() || value.length > 254 || hasControl(value)
    || /[\s<>()[\]\\,;:"]/.test(value)) return false;
  const parts = value.split("@"); if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain || local.length > 64 || domain.length > 253 || local.startsWith(".")
    || local.endsWith(".") || local.includes("..") || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => label.length > 0 && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}
