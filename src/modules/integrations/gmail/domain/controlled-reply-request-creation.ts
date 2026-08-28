const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_TEXT_LENGTH = 100_000;

export interface ControlledReplyRequestCreationInput {
  workspaceId: string;
  emailAccountId: string;
  emailMessageId: string;
  bodyText: string;
  idempotencyKey: string;
}

export interface ControlledReplyRequestCreationDependencies {
  create(input: {
    workspaceId: string;
    emailAccountId: string;
    replyToEmailMessageId: string;
    bodyText: string;
    idempotencyKey: string;
  }): Promise<unknown>;
}

export interface ControlledReplyRequestCreationResult {
  status: "CREATED" | "EXISTING" | "NOT_REPLYABLE" | "IDEMPOTENCY_CONFLICT"
    | "INVALID_INPUT" | "UNAVAILABLE" | "REFUSED";
  reason: string;
  sendRequestId: string | null;
  workspaceId: string | null;
  emailAccountId: string | null;
  emailMessageId: string | null;
  requestStatus: "PENDING" | null;
  sendType: "REPLY" | null;
}

export async function runControlledReplyRequestCreationCli(
  argv: string[],
  environment: Record<string, string | undefined>,
  dependencies: ControlledReplyRequestCreationDependencies,
): Promise<ControlledReplyRequestCreationResult> {
  if (environment.HIREX_ENABLE_CONTROLLED_REPLY_REQUEST_CREATE !== "1") {
    return empty("REFUSED", "CONTROLLED_REPLY_REQUEST_CREATE_DISABLED");
  }
  const input = parseArguments(argv);
  if (!input) return empty("INVALID_INPUT", "INVALID_ARGUMENTS");

  let creation: unknown;
  try {
    creation = await dependencies.create({
      workspaceId: input.workspaceId,
      emailAccountId: input.emailAccountId,
      replyToEmailMessageId: input.emailMessageId,
      bodyText: input.bodyText,
      idempotencyKey: input.idempotencyKey,
    });
  } catch {
    return scoped(input, "UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE", null);
  }
  return mapCreationResult(input, creation);
}

export function mapCreationResult(
  input: ControlledReplyRequestCreationInput,
  value: unknown,
): ControlledReplyRequestCreationResult {
  if (!isRecord(value) || !exactKeys(value, ["status", "sendRequestId", "replyToEmailMessageId", "reason"])
    || value.replyToEmailMessageId !== input.emailMessageId) {
    return scoped(input, "UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE", null);
  }
  if (value.status === "CREATED" && value.reason === "REPLY_REQUEST_CREATED" && isUuid(value.sendRequestId)) {
    return success(input, "CREATED", value.reason, value.sendRequestId);
  }
  if (value.status === "EXISTING" && value.reason === "EXISTING_IDEMPOTENT_REPLY_REQUEST" && isUuid(value.sendRequestId)) {
    return success(input, "EXISTING", value.reason, value.sendRequestId);
  }
  if (value.status === "IDEMPOTENCY_CONFLICT" && value.reason === "IDEMPOTENCY_KEY_REUSED"
    && isUuid(value.sendRequestId)) {
    return scoped(input, "IDEMPOTENCY_CONFLICT", value.reason, value.sendRequestId);
  }
  if (value.status === "NOT_REPLYABLE" && value.reason === "REPLY_TARGET_NOT_SAFE" && value.sendRequestId === null) {
    return scoped(input, "NOT_REPLYABLE", value.reason, null);
  }
  if (value.status === "INVALID_INPUT" && value.reason === "INVALID_REPLY_REQUEST_INPUT" && value.sendRequestId === null) {
    return scoped(input, "INVALID_INPUT", value.reason, null);
  }
  if (value.status === "UNAVAILABLE" && value.reason === "REPLY_REQUEST_UNAVAILABLE" && value.sendRequestId === null) {
    return scoped(input, "UNAVAILABLE", value.reason, null);
  }
  return scoped(input, "UNAVAILABLE", "REPLY_REQUEST_UNAVAILABLE", null);
}

function parseArguments(argv: unknown): ControlledReplyRequestCreationInput | null {
  if (!Array.isArray(argv) || argv.length !== 10 || !argv.every((item) => typeof item === "string")) return null;
  const allowed = ["--workspace-id", "--email-account-id", "--email-message-id", "--body-text", "--idempotency-key"];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.includes(flag) || value.startsWith("--") || flags.has(flag)) return null;
    flags.set(flag, value);
  }
  const workspaceId = flags.get("--workspace-id");
  const emailAccountId = flags.get("--email-account-id");
  const emailMessageId = flags.get("--email-message-id");
  const bodyText = flags.get("--body-text");
  const idempotencyKey = flags.get("--idempotency-key");
  return isUuid(workspaceId) && isUuid(emailAccountId) && isUuid(emailMessageId)
    && isUuid(idempotencyKey) && typeof bodyText === "string" && bodyText.trim().length > 0
    && bodyText.length <= MAX_BODY_TEXT_LENGTH && !bodyText.includes("\u0000")
    ? { workspaceId, emailAccountId, emailMessageId, bodyText, idempotencyKey } : null;
}

function empty(status: "REFUSED" | "INVALID_INPUT", reason: string): ControlledReplyRequestCreationResult {
  return {
    status, reason, sendRequestId: null, workspaceId: null, emailAccountId: null,
    emailMessageId: null, requestStatus: null, sendType: null,
  };
}
function scoped(input: ControlledReplyRequestCreationInput,
  status: Exclude<ControlledReplyRequestCreationResult["status"], "CREATED" | "EXISTING" | "REFUSED">,
  reason: string, sendRequestId: string | null): ControlledReplyRequestCreationResult {
  return {
    status, reason, sendRequestId, workspaceId: input.workspaceId,
    emailAccountId: input.emailAccountId, emailMessageId: input.emailMessageId,
    requestStatus: null, sendType: null,
  };
}
function success(input: ControlledReplyRequestCreationInput, status: "CREATED" | "EXISTING",
  reason: string, sendRequestId: string): ControlledReplyRequestCreationResult {
  return {
    status, reason, sendRequestId, workspaceId: input.workspaceId,
    emailAccountId: input.emailAccountId, emailMessageId: input.emailMessageId,
    requestStatus: "PENDING", sendType: "REPLY",
  };
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function isUuid(value: unknown): value is string { return typeof value === "string" && UUID_PATTERN.test(value); }
