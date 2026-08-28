import type {
  SendReconciliationReason,
  SendReconciliationResult,
} from "@/modules/integrations/gmail/types/send-reconciliation";
import type { SendReconciliationOrchestrationResult } from "@/modules/integrations/gmail/types/send-reconciliation-orchestration";

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

export interface ReconcileAmbiguousSendInput {
  sendRequestId: string;
  workspaceId: string;
  emailAccountId: string;
}

interface ReconciliationOrchestrationDependencies {
  evaluate: (
    input: ReconcileAmbiguousSendInput,
  ) => Promise<SendReconciliationResult>;
  finalize: (input: ReconcileAmbiguousSendInput & {
    emailMessageId: string;
  }) => Promise<boolean>;
}

/**
 * Pure control-flow boundary for deterministic tests. SAFE_MATCH remains
 * advisory: only the transactional finalizer may authorize the state change.
 */
export async function orchestrateAmbiguousSendReconciliation(
  input: ReconcileAmbiguousSendInput,
  dependencies: ReconciliationOrchestrationDependencies,
): Promise<SendReconciliationOrchestrationResult> {
  if (!isUuid(input?.sendRequestId)
    || !isUuid(input?.workspaceId)
    || !isUuid(input?.emailAccountId)) {
    return result("INVALID_INPUT", null, null, "INVALID_INPUT");
  }

  let evaluation: SendReconciliationResult;
  try {
    evaluation = await dependencies.evaluate(input);
  } catch {
    return result(
      "UNAVAILABLE",
      input.sendRequestId,
      null,
      "ORCHESTRATION_UNAVAILABLE",
    );
  }

  if (!isEvaluationShapeValid(evaluation, input.sendRequestId)) {
    return result(
      "UNAVAILABLE",
      input.sendRequestId,
      null,
      "ORCHESTRATION_UNAVAILABLE",
    );
  }

  if (evaluation.classification === "SAFE_MATCH"
    && evaluation.reason !== "SAFE_EXACT_CANONICAL_MATCH") {
    return result(
      "UNAVAILABLE",
      input.sendRequestId,
      null,
      "ORCHESTRATION_UNAVAILABLE",
    );
  }

  if (evaluation.classification === "NO_MATCH"
    || evaluation.classification === "AMBIGUOUS") {
    return result(
      evaluation.classification,
      input.sendRequestId,
      isUuid(evaluation.matchedEmailMessageId)
        ? evaluation.matchedEmailMessageId
        : null,
      evaluation.reason,
    );
  }

  if (!isUuid(evaluation.matchedEmailMessageId)) {
    return result(
      "UNAVAILABLE",
      input.sendRequestId,
      null,
      "MATCHED_MESSAGE_INVALID",
    );
  }

  try {
    const finalized = await dependencies.finalize({
      ...input,
      emailMessageId: evaluation.matchedEmailMessageId,
    });
    if (typeof finalized !== "boolean") {
      return result(
        "UNAVAILABLE",
        input.sendRequestId,
        evaluation.matchedEmailMessageId,
        "ORCHESTRATION_UNAVAILABLE",
      );
    }
    return finalized
      ? result(
          "FINALIZED",
          input.sendRequestId,
          evaluation.matchedEmailMessageId,
          "FINALIZED",
        )
      : result(
          "EVIDENCE_CHANGED",
          input.sendRequestId,
          evaluation.matchedEmailMessageId,
          "EVIDENCE_CHANGED",
        );
  } catch {
    return result(
      "UNAVAILABLE",
      input.sendRequestId,
      evaluation.matchedEmailMessageId,
      "ORCHESTRATION_UNAVAILABLE",
    );
  }
}

function isEvaluationShapeValid(
  evaluation: SendReconciliationResult,
  sendRequestId: string,
) {
  const baseShapeIsValid = Boolean(evaluation)
    && evaluation.sendRequestId === sendRequestId
    && (
      evaluation.classification === "SAFE_MATCH"
      || evaluation.classification === "NO_MATCH"
      || evaluation.classification === "AMBIGUOUS"
    )
    && isSendReconciliationReason(evaluation.reason)
    && (
      evaluation.matchedEmailMessageId === null
      || typeof evaluation.matchedEmailMessageId === "string"
    );
  return baseShapeIsValid;
}

function isSendReconciliationReason(
  value: unknown,
): value is SendReconciliationReason {
  return typeof value === "string"
    && SEND_RECONCILIATION_REASONS.has(value as SendReconciliationReason);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function result(
  status: SendReconciliationOrchestrationResult["status"],
  sendRequestId: string | null,
  matchedEmailMessageId: string | null,
  reason: SendReconciliationOrchestrationResult["reason"],
): SendReconciliationOrchestrationResult {
  return { status, sendRequestId, matchedEmailMessageId, reason };
}
