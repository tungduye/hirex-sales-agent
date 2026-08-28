import type {
  SendReconciliationReason,
  SendReconciliationResult,
} from "@/modules/integrations/gmail/types/send-reconciliation";
import type {
  SendReconciliationCandidateDiscoveryInput,
  SendReconciliationCandidateDiscoveryResult,
} from "@/modules/integrations/gmail/types/send-reconciliation-candidate";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const NO_MATCH_REASONS = new Set<SendReconciliationReason>([
  "REQUEST_NOT_ELIGIBLE",
  "CORRELATION_NOT_FOUND",
  "SENT_LABEL_MISSING",
  "SPAM_OR_TRASH_MESSAGE",
  "SENDER_MISMATCH",
  "RECIPIENT_MISMATCH",
  "SUBJECT_MISMATCH",
  "BODY_MISMATCH",
  "PROVIDER_MESSAGE_ID_CONFLICT",
  "PROVIDER_THREAD_ID_CONFLICT",
  "UNSUPPORTED_REQUEST_SHAPE",
]);
const AMBIGUOUS_REASONS = new Set<SendReconciliationReason>([
  "MULTIPLE_CORRELATION_MATCHES",
  "BODY_COMPARISON_UNCERTAIN",
  "CANONICAL_THREAD_UNAVAILABLE",
  "EVALUATION_UNAVAILABLE",
]);

type InspectorCommand =
  | { mode: "list"; workspaceId: string; emailAccountId?: string; limit: number }
  | { mode: "inspect"; workspaceId: string; emailAccountId: string; sendRequestId: string };

interface InspectorDependencies {
  list: (
    input: SendReconciliationCandidateDiscoveryInput,
  ) => Promise<SendReconciliationCandidateDiscoveryResult>;
  inspect: (input: {
    sendRequestId: string;
    workspaceId: string;
    emailAccountId: string;
  }) => Promise<SendReconciliationResult>;
}

export async function runReconciliationInspectorCli(
  argv: string[],
  dependencies: InspectorDependencies,
): Promise<Record<string, unknown>> {
  const command = parseArguments(argv);
  if (!command) return safeError("INVALID_INPUT", "INVALID_ARGUMENTS");

  try {
    if (command.mode === "list") {
      const discovery = await dependencies.list({
        workspaceId: command.workspaceId,
        emailAccountId: command.emailAccountId,
        limit: command.limit,
      });
      return mapDiscoveryOutput(discovery, command);
    }
    const inspection = await dependencies.inspect({
      sendRequestId: command.sendRequestId,
      workspaceId: command.workspaceId,
      emailAccountId: command.emailAccountId,
    });
    return mapInspectionOutput(inspection, command);
  } catch {
    return safeError("UNAVAILABLE", "INSPECTOR_UNAVAILABLE");
  }
}

function parseArguments(argv: string[]): InspectorCommand | null {
  if (!Array.isArray(argv) || (argv[0] !== "list" && argv[0] !== "inspect")) {
    return null;
  }
  const flags = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--")
      || typeof value !== "string"
      || value.startsWith("--")
      || flags.has(flag)
      || !["--workspace", "--account", "--request", "--limit"].includes(flag)) {
      return null;
    }
    flags.set(flag, value);
  }
  const workspaceId = flags.get("--workspace");
  if (!isUuid(workspaceId)) return null;

  if (argv[0] === "list") {
    if (flags.has("--request")) return null;
    const emailAccountId = flags.get("--account");
    if (emailAccountId !== undefined && !isUuid(emailAccountId)) return null;
    const limitValue = flags.get("--limit");
    const limit = limitValue === undefined ? DEFAULT_LIMIT : Number(limitValue);
    if (!Number.isInteger(limit) || limit <= 0) return null;
    return {
      mode: "list",
      workspaceId,
      ...(emailAccountId ? { emailAccountId } : {}),
      limit: Math.min(limit, MAX_LIMIT),
    };
  }

  if (flags.has("--limit")) return null;
  const emailAccountId = flags.get("--account");
  const sendRequestId = flags.get("--request");
  if (!isUuid(emailAccountId) || !isUuid(sendRequestId)) return null;
  return { mode: "inspect", workspaceId, emailAccountId, sendRequestId };
}

function mapDiscoveryOutput(
  value: SendReconciliationCandidateDiscoveryResult,
  command: Extract<InspectorCommand, { mode: "list" }>,
) {
  if (!value || !["READY", "INVALID_INPUT", "UNAVAILABLE"].includes(value.status)) {
    return safeError("UNAVAILABLE", "INSPECTOR_UNAVAILABLE");
  }
  if (value.status !== "READY") {
    return { status: value.status, candidates: [] };
  }
  if (!Array.isArray(value.candidates) || value.candidates.length > command.limit) {
    return safeError("UNAVAILABLE", "INSPECTOR_UNAVAILABLE");
  }
  const candidates = [];
  for (const candidate of value.candidates) {
    if (!candidate
      || !isUuid(candidate.sendRequestId)
      || candidate.workspaceId !== command.workspaceId
      || !isUuid(candidate.emailAccountId)
      || (command.emailAccountId !== undefined
        && candidate.emailAccountId !== command.emailAccountId)
      || typeof candidate.sendLockAt !== "string"
      || !Number.isFinite(Date.parse(candidate.sendLockAt))
      || typeof candidate.attemptCount !== "number"
      || !Number.isInteger(candidate.attemptCount)
      || candidate.attemptCount < 0) {
      return safeError("UNAVAILABLE", "INSPECTOR_UNAVAILABLE");
    }
    candidates.push({
      sendRequestId: candidate.sendRequestId,
      workspaceId: candidate.workspaceId,
      emailAccountId: candidate.emailAccountId,
      sendLockAt: candidate.sendLockAt,
      attemptCount: candidate.attemptCount,
    });
  }
  return { status: "READY", candidates };
}

function mapInspectionOutput(
  value: SendReconciliationResult,
  command: Extract<InspectorCommand, { mode: "inspect" }>,
) {
  if (!value
    || !["SAFE_MATCH", "NO_MATCH", "AMBIGUOUS"].includes(value.classification)
    || value.sendRequestId !== command.sendRequestId
    || (value.matchedEmailMessageId !== null
      && !isUuid(value.matchedEmailMessageId))) {
    return safeError("UNAVAILABLE", "INSPECTOR_UNAVAILABLE");
  }
  const classificationIsConsistent = (
    value.classification === "SAFE_MATCH"
    && value.reason === "SAFE_EXACT_CANONICAL_MATCH"
    && isUuid(value.matchedEmailMessageId)
  ) || (
    value.classification === "NO_MATCH"
    && isReasonIn(value.reason, NO_MATCH_REASONS)
  ) || (
    value.classification === "AMBIGUOUS"
    && isReasonIn(value.reason, AMBIGUOUS_REASONS)
  );
  if (!classificationIsConsistent) {
    return safeError("UNAVAILABLE", "INSPECTOR_UNAVAILABLE");
  }
  return {
    classification: value.classification,
    reason: value.reason,
    sendRequestId: value.sendRequestId,
    matchedEmailMessageId: value.matchedEmailMessageId,
  };
}

function safeError(status: "INVALID_INPUT" | "UNAVAILABLE", code: string) {
  return { status, code };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isReasonIn(
  value: unknown,
  reasons: ReadonlySet<SendReconciliationReason>,
): value is SendReconciliationReason {
  return typeof value === "string"
    && reasons.has(value as SendReconciliationReason);
}
