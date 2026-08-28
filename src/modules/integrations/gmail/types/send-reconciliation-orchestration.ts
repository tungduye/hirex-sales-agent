import type { SendReconciliationReason } from "@/modules/integrations/gmail/types/send-reconciliation";

export type SendReconciliationOrchestrationStatus =
  | "FINALIZED"
  | "NO_MATCH"
  | "AMBIGUOUS"
  | "EVIDENCE_CHANGED"
  | "INVALID_INPUT"
  | "UNAVAILABLE";

export type SendReconciliationOrchestrationReason =
  | SendReconciliationReason
  | "FINALIZED"
  | "EVIDENCE_CHANGED"
  | "INVALID_INPUT"
  | "MATCHED_MESSAGE_INVALID"
  | "ORCHESTRATION_UNAVAILABLE";

export interface SendReconciliationOrchestrationResult {
  status: SendReconciliationOrchestrationStatus;
  sendRequestId: string | null;
  matchedEmailMessageId: string | null;
  reason: SendReconciliationOrchestrationReason;
}
