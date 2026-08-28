import type {
  SendReconciliationOrchestrationReason,
  SendReconciliationOrchestrationResult,
  SendReconciliationOrchestrationStatus,
} from "@/modules/integrations/gmail/types/send-reconciliation-orchestration";

export interface ManualSendReconciliationInput {
  sendRequestId: string;
  workspaceId: string;
  emailAccountId: string;
}

export interface ManualSendReconciliationResult {
  status: SendReconciliationOrchestrationStatus | "NOT_ELIGIBLE";
  sendRequestId: string | null;
  matchedEmailMessageId: string | null;
  reason: SendReconciliationOrchestrationReason;
}

export type ManualReconciliationOrchestratorResult =
  SendReconciliationOrchestrationResult;
