const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NOT_REPLYABLE_REASONS = new Set([
  "MESSAGE_NOT_FOUND",
  "MESSAGE_NOT_INBOUND",
  "SPAM_OR_TRASH_MESSAGE",
  "SENDER_UNAVAILABLE",
  "SENDER_IS_CONNECTED_ACCOUNT",
  "RFC_MESSAGE_ID_UNAVAILABLE",
  "PROVIDER_MESSAGE_ID_UNAVAILABLE",
  "PROVIDER_THREAD_ID_UNAVAILABLE",
  "SUBJECT_UNAVAILABLE",
  "ACCOUNT_NOT_CONNECTED",
  "EVIDENCE_SCOPE_MISMATCH",
]);
const AMBIGUOUS_REASONS = new Set([
  "CANONICAL_THREAD_UNAVAILABLE",
  "EVALUATION_UNAVAILABLE",
]);

export interface ControlledReplyPreflightInput {
  workspaceId: string;
  emailAccountId: string;
  emailMessageId: string;
}

export interface ControlledReplyPreflightDependencies {
  evaluate(input: ControlledReplyPreflightInput): Promise<unknown>;
}

export interface ControlledReplyPreflightResult {
  status: "READY_FOR_CONTROLLED_REPLY_TEST" | "NOT_REPLYABLE" | "AMBIGUOUS"
    | "UNAVAILABLE" | "INVALID_INPUT" | "REFUSED";
  reason: string;
  workspaceId: string | null;
  emailAccountId: string | null;
  emailMessageId: string | null;
  recipientEmail: string | null;
  subject: string | null;
  providerThreadId: string | null;
  parentRfcMessageId: string | null;
}

export async function runControlledReplyPreflightCli(
  argv: string[],
  environment: Record<string, string | undefined>,
  dependencies: ControlledReplyPreflightDependencies,
): Promise<ControlledReplyPreflightResult> {
  if (environment.HIREX_ENABLE_CONTROLLED_REPLY_PREFLIGHT !== "1") {
    return empty("REFUSED", "CONTROLLED_REPLY_PREFLIGHT_DISABLED");
  }
  const input = parseArguments(argv);
  if (!input) return empty("INVALID_INPUT", "INVALID_ARGUMENTS");

  let evaluation: unknown;
  try { evaluation = await dependencies.evaluate(input); } catch {
    return scoped(input, "UNAVAILABLE", "EVALUATION_UNAVAILABLE");
  }
  return mapEvaluation(input, evaluation);
}

export function mapEvaluation(
  input: ControlledReplyPreflightInput,
  value: unknown,
): ControlledReplyPreflightResult {
  if (!isRecord(value) || !exactKeys(value, [
    "classification", "reason", "workspaceId", "emailAccountId", "replyToEmailMessageId",
    "recipientEmail", "subject", "providerThreadId", "parentRfcMessageId",
  ]) || value.workspaceId !== input.workspaceId || value.emailAccountId !== input.emailAccountId
    || value.replyToEmailMessageId !== input.emailMessageId) {
    return scoped(input, "UNAVAILABLE", "EVALUATION_UNAVAILABLE");
  }

  if (value.classification === "SAFE_REPLY_TARGET" && value.reason === "SAFE_CANONICAL_REPLY_TARGET"
    && isConservativeEmail(value.recipientEmail) && isSafeSubject(value.subject)
    && isProviderId(value.providerThreadId) && isCanonicalRfcMessageId(value.parentRfcMessageId)) {
    return {
      status: "READY_FOR_CONTROLLED_REPLY_TEST",
      reason: "SAFE_CANONICAL_REPLY_TARGET",
      workspaceId: input.workspaceId,
      emailAccountId: input.emailAccountId,
      emailMessageId: input.emailMessageId,
      recipientEmail: value.recipientEmail,
      subject: value.subject,
      providerThreadId: value.providerThreadId,
      parentRfcMessageId: value.parentRfcMessageId,
    };
  }

  if (value.classification === "NOT_REPLYABLE" && isReason(value.reason, NOT_REPLYABLE_REASONS)
    && hasNullMetadata(value)) return scoped(input, "NOT_REPLYABLE", value.reason);
  if (value.classification === "AMBIGUOUS" && isReason(value.reason, AMBIGUOUS_REASONS)
    && hasNullMetadata(value)) return scoped(input, "AMBIGUOUS", value.reason);
  if (value.classification === "UNAVAILABLE" && value.reason === "EVALUATION_UNAVAILABLE"
    && hasNullMetadata(value)) return scoped(input, "UNAVAILABLE", value.reason);
  return scoped(input, "UNAVAILABLE", "EVALUATION_UNAVAILABLE");
}

function parseArguments(argv: unknown): ControlledReplyPreflightInput | null {
  if (!Array.isArray(argv) || argv.length !== 6 || !argv.every((item) => typeof item === "string")) return null;
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--workspace-id", "--email-account-id", "--email-message-id"].includes(flag)
      || value.startsWith("--") || flags.has(flag)) return null;
    flags.set(flag, value);
  }
  const workspaceId = flags.get("--workspace-id");
  const emailAccountId = flags.get("--email-account-id");
  const emailMessageId = flags.get("--email-message-id");
  return isUuid(workspaceId) && isUuid(emailAccountId) && isUuid(emailMessageId)
    ? { workspaceId, emailAccountId, emailMessageId } : null;
}

function empty(status: "INVALID_INPUT" | "REFUSED", reason: string): ControlledReplyPreflightResult {
  return {
    status, reason, workspaceId: null, emailAccountId: null, emailMessageId: null,
    recipientEmail: null, subject: null, providerThreadId: null, parentRfcMessageId: null,
  };
}
function scoped(input: ControlledReplyPreflightInput,
  status: "NOT_REPLYABLE" | "AMBIGUOUS" | "UNAVAILABLE", reason: string): ControlledReplyPreflightResult {
  return {
    status, reason, ...input,
    recipientEmail: null, subject: null, providerThreadId: null, parentRfcMessageId: null,
  };
}
function hasNullMetadata(value: Record<string, unknown>) {
  return value.recipientEmail === null && value.subject === null
    && value.providerThreadId === null && value.parentRfcMessageId === null;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function isUuid(value: unknown): value is string { return typeof value === "string" && UUID_PATTERN.test(value); }
function isReason(value: unknown, reasons: ReadonlySet<string>): value is string { return typeof value === "string" && reasons.has(value); }
function hasControl(value: string) { return /[\u0000-\u001f\u007f-\u009f]/.test(value); }
function isSafeSubject(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 998 && !hasControl(value); }
function isProviderId(value: unknown): value is string { return typeof value === "string" && value.length >= 1 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value); }
function isCanonicalRfcMessageId(value: unknown): value is string { return typeof value === "string" && value.length <= 998 && !hasControl(value) && /^<[^<>\s@]+@[^<>\s@]+>$/.test(value); }
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
