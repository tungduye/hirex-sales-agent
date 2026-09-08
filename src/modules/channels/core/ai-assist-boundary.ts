import type { ChannelType } from "./channel-contracts.ts";

export interface AiDraftProposal {
  kind: "DRAFT_MESSAGE";
  workspaceId: string;
  conversationId: string;
  channelType: ChannelType;
  text: string;
  modelReference: string;
  promptVersion: string;
  evidenceMessageIds: string[];
}

export interface ReviewedDraftAction {
  proposal: AiDraftProposal;
  policyDecisionId: string;
  approvedBy: string;
  approvedAt: string;
}

export function canQueueReviewedDraft(value: ReviewedDraftAction): boolean {
  return (
    value.proposal.kind === "DRAFT_MESSAGE" &&
    value.proposal.text.trim().length > 0 &&
    value.proposal.text.length <= 100_000 &&
    !value.proposal.text.includes("\u0000") &&
    value.policyDecisionId.length > 0 &&
    value.approvedBy.length > 0 &&
    Number.isFinite(Date.parse(value.approvedAt))
  );
}
