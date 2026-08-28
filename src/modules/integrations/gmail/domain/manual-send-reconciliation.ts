import type {
  ManualReconciliationOrchestratorResult,
  ManualSendReconciliationInput,
  ManualSendReconciliationResult,
} from "@/modules/integrations/gmail/types/manual-send-reconciliation";
import type { SendReconciliationReason } from "@/modules/integrations/gmail/types/send-reconciliation";
import type { SendReconciliationOrchestrationReason } from "@/modules/integrations/gmail/types/send-reconciliation-orchestration";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEND_RECONCILIATION_REASONS = new Set<SendReconciliationReason>([
  "SAFE_EXACT_CANONICAL_MATCH",
  "REQUEST_NOT_ELIGIBLE",
  "CORRELATION_NOT_FOUND",
  "MULTIPLE_CORRELATION_MATCHES",
  "SENT_LABEL_MISSING",
  "SPAM_OR_TRASH_MESSAGE",
  "SENDER_MISMATCH",
  "RECIPIENT_MISMATCH",
  "SUBJECT_MISMATCH",
  "BODY_MISMATCH",
  "BODY_COMPARISON_UNCERTAIN",
  "PROVIDER_MESSAGE_ID_CONFLICT",
  "PROVIDER_THREAD_ID_CONFLICT",
  "UNSUPPORTED_REQUEST_SHAPE",
  "CANONICAL_THREAD_UNAVAILABLE",
  "EVALUATION_UNAVAILABLE",
]);
const ORCHESTRATION_UNAVAILABLE_REASONS = new Set<
  SendReconciliationOrchestrationReason
>([
  "MATCHED_MESSAGE_INVALID",
  "ORCHESTRATION_UNAVAILABLE",
]);

interface ManualReconciliationDependencies {
  preflight: (input: ManualSendReconciliationInput) => Promise<unknown>;
  reconcile: (
    input: ManualSendReconciliationInput,
  ) => Promise<ManualReconciliationOrchestratorResult>;
}

/**
 * Exact preflight is a manual guard only. It never authorizes finalization;
 * the reviewed orchestrator and migration-009 transaction remain authoritative.
 */
export async function executeManualSendReconciliation(
  input: ManualSendReconciliationInput,
  dependencies: ManualReconciliationDependencies,
): Promise<ManualSendReconciliationResult> {
  if (!isUuid(input?.sendRequestId)
    || !isUuid(input?.workspaceId)
    || !isUuid(input?.emailAccountId)) {
    return result("INVALID_INPUT", null, null, "INVALID_INPUT");
  }
  const exactInput: ManualSendReconciliationInput = {
    sendRequestId: input.sendRequestId,
    workspaceId: input.workspaceId,
    emailAccountId: input.emailAccountId,
  };

  let preflight: unknown;
  try {
    preflight = await dependencies.preflight(exactInput);
  } catch {
    return unavailable(input.sendRequestId);
  }

  if (preflight === null) {
    return result(
      "NOT_ELIGIBLE",
      input.sendRequestId,
      null,
      "REQUEST_NOT_ELIGIBLE",
    );
  }
  if (!isEligiblePreflight(preflight, exactInput)) {
    return unavailable(input.sendRequestId);
  }

  try {
    const orchestration = await dependencies.reconcile(exactInput);
    if (!isSafeOrchestrationResult(orchestration, input.sendRequestId)) {
      return unavailable(input.sendRequestId);
    }
    return result(
      orchestration.status,
      input.sendRequestId,
      orchestration.matchedEmailMessageId,
      orchestration.reason,
    );
  } catch {
    return unavailable(input.sendRequestId);
  }
}

function isEligiblePreflight(
  value: unknown,
  input: ManualSendReconciliationInput,
) {
  if (!isRecord(value)
    || value.id !== input.sendRequestId
    || value.workspace_id !== input.workspaceId
    || value.email_account_id !== input.emailAccountId
    || typeof value.send_lock_at !== "string"
    || !Number.isFinite(Date.parse(value.send_lock_at))) {
    return false;
  }
  const account = Array.isArray(value.email_accounts)
    ? value.email_accounts.length === 1 ? value.email_accounts[0] : null
    : value.email_accounts;
  return isRecord(account)
    && account.id === input.emailAccountId
    && account.workspace_id === input.workspaceId
    && account.provider === "GMAIL"
    && account.status === "CONNECTED";
}

function isSafeOrchestrationResult(
  value: unknown,
  sendRequestId: string,
): value is ManualReconciliationOrchestratorResult {
  if (!isRecord(value)
    || value.sendRequestId !== sendRequestId
    || !(
      value.status === "FINALIZED"
      || value.status === "NO_MATCH"
      || value.status === "AMBIGUOUS"
      || value.status === "EVIDENCE_CHANGED"
      || value.status === "UNAVAILABLE"
    )
    || (
      value.matchedEmailMessageId !== null
      && !isUuid(value.matchedEmailMessageId)
    )) {
    return false;
  }
  if (value.status === "FINALIZED") {
    return value.reason === "FINALIZED"
      && isUuid(value.matchedEmailMessageId);
  }
  if (value.status === "EVIDENCE_CHANGED") {
    return value.reason === "EVIDENCE_CHANGED"
      && isUuid(value.matchedEmailMessageId);
  }
  if (value.status === "NO_MATCH" || value.status === "AMBIGUOUS") {
    return isSendReconciliationReason(value.reason);
  }
  return isOrchestrationUnavailableReason(value.reason);
}

function isSendReconciliationReason(
  value: unknown,
): value is SendReconciliationReason {
  return typeof value === "string"
    && SEND_RECONCILIATION_REASONS.has(value as SendReconciliationReason);
}

function isOrchestrationUnavailableReason(
  value: unknown,
): value is SendReconciliationOrchestrationReason {
  return typeof value === "string"
    && ORCHESTRATION_UNAVAILABLE_REASONS.has(
      value as SendReconciliationOrchestrationReason,
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function unavailable(sendRequestId: string): ManualSendReconciliationResult {
  return result(
    "UNAVAILABLE",
    sendRequestId,
    null,
    "ORCHESTRATION_UNAVAILABLE",
  );
}

function result(
  status: ManualSendReconciliationResult["status"],
  sendRequestId: string | null,
  matchedEmailMessageId: string | null,
  reason: ManualSendReconciliationResult["reason"],
): ManualSendReconciliationResult {
  return { status, sendRequestId, matchedEmailMessageId, reason };
}
