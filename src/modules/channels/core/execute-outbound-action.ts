import type { ChannelAdapterRegistry } from "./channel-adapter-registry.ts";
import { ChannelError } from "./channel-errors.ts";
import { isSendMessageCommand, type ChannelType, type SendAttachment, type SendMessageCommand } from "./channel-contracts.ts";

export interface OutboundActionRecord {
  id: string;
  workspaceId: string;
  conversationId: string | null;
  providerConversationId: string | null;
  channelAccountId: string;
  channelType: ChannelType;
  recipientExternalId: string;
  status: "APPROVED" | "QUEUED" | "EXECUTING";
  textContent: string | null;
  attachmentIds: string[];
  idempotencyKey: string;
  policyDecisionId: string;
  approvedBy: string;
  approvedAt: string;
}

export interface ClaimedOutboundAction extends OutboundActionRecord {
  status: "EXECUTING";
  executionLockId: string;
}

export interface CurrentPolicyEvidence {
  id: string;
  workspaceId: string;
  allowed: boolean;
  expiresAt: string;
}

export interface OutboundExecutionDependencies {
  loadAction(actionId: string): Promise<OutboundActionRecord | null>;
  loadPolicy(policyDecisionId: string): Promise<CurrentPolicyEvidence | null>;
  isSuppressed(input: { workspaceId: string; channelType: ChannelType; recipientExternalId: string }): Promise<boolean>;
  claim(input: { actionId: string; workspaceId: string; executionLockId: string }): Promise<ClaimedOutboundAction | null>;
  loadClaimedAttachments(input: { actionId: string; workspaceId: string; executionLockId: string; attachmentIds: string[] }): Promise<SendAttachment[]>;
  finalizeSent(input: { actionId: string; workspaceId: string; executionLockId: string; providerMessageId: string; providerConversationId: string; acceptedAt: string }): Promise<boolean>;
  finalizeFailed(input: { actionId: string; workspaceId: string; executionLockId: string; safeErrorCode: string }): Promise<boolean>;
  finalizeUnknown(input: { actionId: string; workspaceId: string; executionLockId: string; safeErrorCode: "DELIVERY_UNKNOWN" }): Promise<boolean>;
  adapters: ChannelAdapterRegistry;
  createLockId(): string;
  now(): string;
}

export type OutboundExecutionResult =
  | { status: "SENT"; actionId: string }
  | { status: "NOT_ELIGIBLE"; actionId: string }
  | { status: "FAILED"; actionId: string; safeErrorCode: string }
  | { status: "DELIVERY_UNKNOWN"; actionId: string }
  | { status: "UNAVAILABLE"; actionId: string };

function eligibleAction(value: OutboundActionRecord | null, actionId: string): value is OutboundActionRecord {
  return Boolean(
    value && value.id === actionId && (value.status === "APPROVED" || value.status === "QUEUED") &&
    value.approvedBy && Number.isFinite(Date.parse(value.approvedAt)),
  );
}

export async function executeOutboundAction(actionId: string, dependencies: OutboundExecutionDependencies): Promise<OutboundExecutionResult> {
  if (!actionId) return { status: "UNAVAILABLE", actionId };
  let action: OutboundActionRecord | null;
  try { action = await dependencies.loadAction(actionId); } catch { return { status: "UNAVAILABLE", actionId }; }
  if (!eligibleAction(action, actionId)) return { status: "NOT_ELIGIBLE", actionId };
  let policy: CurrentPolicyEvidence | null;
  try { policy = await dependencies.loadPolicy(action.policyDecisionId); } catch { return { status: "UNAVAILABLE", actionId }; }
  if (!policy || policy.id !== action.policyDecisionId || policy.workspaceId !== action.workspaceId || !policy.allowed || !Number.isFinite(Date.parse(policy.expiresAt)) || Date.parse(policy.expiresAt) <= Date.parse(dependencies.now())) return { status: "NOT_ELIGIBLE", actionId };
  try {
    if (await dependencies.isSuppressed({ workspaceId: action.workspaceId, channelType: action.channelType, recipientExternalId: action.recipientExternalId })) return { status: "NOT_ELIGIBLE", actionId };
  } catch { return { status: "UNAVAILABLE", actionId }; }
  const executionLockId = dependencies.createLockId();
  let claimed: ClaimedOutboundAction | null;
  try { claimed = await dependencies.claim({ actionId, workspaceId: action.workspaceId, executionLockId }); } catch { return { status: "UNAVAILABLE", actionId }; }
  if (!claimed || claimed.status !== "EXECUTING" || claimed.id !== action.id || claimed.workspaceId !== action.workspaceId || claimed.executionLockId !== executionLockId) return { status: "NOT_ELIGIBLE", actionId };
  let attachments: SendAttachment[];
  try { attachments = await dependencies.loadClaimedAttachments({ actionId, workspaceId: action.workspaceId, executionLockId, attachmentIds: claimed.attachmentIds }); }
  catch {
    try {
      const finalized = await dependencies.finalizeFailed({ actionId, workspaceId: action.workspaceId, executionLockId, safeErrorCode: "DELIVERY_REJECTED" });
      return finalized === true ? { status: "FAILED", actionId, safeErrorCode: "DELIVERY_REJECTED" } : { status: "UNAVAILABLE", actionId };
    } catch { return { status: "UNAVAILABLE", actionId }; }
  }
  const command: SendMessageCommand = { actionId: claimed.id, workspaceId: claimed.workspaceId, channelAccountId: claimed.channelAccountId, channelType: claimed.channelType, providerConversationId: claimed.providerConversationId, recipientExternalId: claimed.recipientExternalId, text: claimed.textContent, attachments, idempotencyKey: claimed.idempotencyKey, policyDecisionId: claimed.policyDecisionId };
  if (!isSendMessageCommand(command)) {
    try {
      const finalized = await dependencies.finalizeFailed({ actionId, workspaceId: action.workspaceId, executionLockId, safeErrorCode: "DELIVERY_REJECTED" });
      return finalized === true ? { status: "FAILED", actionId, safeErrorCode: "DELIVERY_REJECTED" } : { status: "UNAVAILABLE", actionId };
    } catch { return { status: "UNAVAILABLE", actionId }; }
  }
  let adapter;
  try { adapter = dependencies.adapters.get(command.channelType); }
  catch {
    try {
      const finalized = await dependencies.finalizeFailed({ actionId, workspaceId: action.workspaceId, executionLockId, safeErrorCode: "ACCOUNT_UNAVAILABLE" });
      return finalized === true ? { status: "FAILED", actionId, safeErrorCode: "ACCOUNT_UNAVAILABLE" } : { status: "UNAVAILABLE", actionId };
    } catch { return { status: "UNAVAILABLE", actionId }; }
  }
  try {
    const sent = await adapter.sendMessage(command);
    const finalized = await dependencies.finalizeSent({ actionId, workspaceId: action.workspaceId, executionLockId, ...sent });
    return finalized === true ? { status: "SENT", actionId } : { status: "DELIVERY_UNKNOWN", actionId };
  } catch (error) {
    if (error instanceof ChannelError && error.code !== "DELIVERY_UNKNOWN" && !error.retryable) {
      try {
        const finalized = await dependencies.finalizeFailed({ actionId, workspaceId: action.workspaceId, executionLockId, safeErrorCode: error.code });
        return finalized === true ? { status: "FAILED", actionId, safeErrorCode: error.code } : { status: "DELIVERY_UNKNOWN", actionId };
      } catch { return { status: "DELIVERY_UNKNOWN", actionId }; }
    }
    try { await dependencies.finalizeUnknown({ actionId, workspaceId: action.workspaceId, executionLockId, safeErrorCode: "DELIVERY_UNKNOWN" }); } catch { /* delivery remains unknown */ }
    return { status: "DELIVERY_UNKNOWN", actionId };
  }
}
