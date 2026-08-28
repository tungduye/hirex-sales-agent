export interface SendReconciliationCandidateDiscoveryInput {
  workspaceId: string;
  emailAccountId?: string;
  limit?: number;
}

export interface SendReconciliationCandidate {
  sendRequestId: string;
  workspaceId: string;
  emailAccountId: string;
  sendLockAt: string;
  attemptCount: number;
}

export interface SendReconciliationCandidateDiscoveryResult {
  status: "READY" | "INVALID_INPUT" | "UNAVAILABLE";
  candidates: SendReconciliationCandidate[];
}
