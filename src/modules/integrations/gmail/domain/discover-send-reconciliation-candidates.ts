import type {
  SendReconciliationCandidate,
  SendReconciliationCandidateDiscoveryInput,
  SendReconciliationCandidateDiscoveryResult,
} from "@/modules/integrations/gmail/types/send-reconciliation-candidate";

export const DEFAULT_SEND_RECONCILIATION_CANDIDATE_LIMIT = 10;
export const MAX_SEND_RECONCILIATION_CANDIDATE_LIMIT = 25;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface NormalizedCandidateDiscoveryInput {
  workspaceId: string;
  emailAccountId: string | null;
  limit: number;
}

interface CandidateDiscoveryDependencies {
  read: (input: NormalizedCandidateDiscoveryInput) => Promise<unknown>;
}

/**
 * Candidate discovery is metadata-only. A returned row is not authorization
 * to finalize; the evaluator, SAFE_MATCH gate, and migration-009 RPC remain
 * mandatory before any later explicit mutation.
 */
export async function discoverSendReconciliationCandidates(
  input: SendReconciliationCandidateDiscoveryInput,
  dependencies: CandidateDiscoveryDependencies,
): Promise<SendReconciliationCandidateDiscoveryResult> {
  const normalized = normalizeInput(input);
  if (!normalized) return { status: "INVALID_INPUT", candidates: [] };

  try {
    const rows = await dependencies.read(normalized);
    const candidates = normalizeRows(rows, normalized);
    return candidates
      ? { status: "READY", candidates }
      : { status: "UNAVAILABLE", candidates: [] };
  } catch {
    return { status: "UNAVAILABLE", candidates: [] };
  }
}

function normalizeInput(
  input: SendReconciliationCandidateDiscoveryInput,
): NormalizedCandidateDiscoveryInput | null {
  if (!input || !isUuid(input.workspaceId)) return null;
  if (input.emailAccountId !== undefined && !isUuid(input.emailAccountId)) {
    return null;
  }
  if (input.limit !== undefined
    && (!Number.isInteger(input.limit) || input.limit <= 0)) {
    return null;
  }
  return {
    workspaceId: input.workspaceId,
    emailAccountId: input.emailAccountId ?? null,
    limit: Math.min(
      input.limit ?? DEFAULT_SEND_RECONCILIATION_CANDIDATE_LIMIT,
      MAX_SEND_RECONCILIATION_CANDIDATE_LIMIT,
    ),
  };
}

function normalizeRows(
  value: unknown,
  input: NormalizedCandidateDiscoveryInput,
): SendReconciliationCandidate[] | null {
  if (!Array.isArray(value) || value.length > input.limit) return null;
  const candidates: SendReconciliationCandidate[] = [];
  for (const row of value) {
    if (!isRecord(row)
      || !isUuid(row.id)
      || row.workspace_id !== input.workspaceId
      || !isUuid(row.email_account_id)
      || (input.emailAccountId !== null
        && row.email_account_id !== input.emailAccountId)
      || typeof row.send_lock_at !== "string"
      || !Number.isFinite(Date.parse(row.send_lock_at))
      || typeof row.attempt_count !== "number"
      || !Number.isInteger(row.attempt_count)
      || row.attempt_count < 0
      || !hasEligibleConnectedAccount(
        row.email_accounts,
        input.workspaceId,
        row.email_account_id,
      )) {
      return null;
    }
    candidates.push({
      sendRequestId: row.id,
      workspaceId: row.workspace_id,
      emailAccountId: row.email_account_id,
      sendLockAt: row.send_lock_at,
      attemptCount: row.attempt_count,
    });
  }
  return candidates.sort((left, right) => {
    const lockOrder = Date.parse(left.sendLockAt) - Date.parse(right.sendLockAt);
    return lockOrder || left.sendRequestId.localeCompare(right.sendRequestId);
  });
}

function hasEligibleConnectedAccount(
  value: unknown,
  workspaceId: string,
  emailAccountId: string,
) {
  const account = Array.isArray(value)
    ? value.length === 1 ? value[0] : null
    : value;
  return isRecord(account)
    && account.id === emailAccountId
    && account.workspace_id === workspaceId
    && account.provider === "GMAIL"
    && account.status === "CONNECTED";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
