import type { ChannelType } from "./channel-contracts.ts";
import { selectCampaignChannel, type CampaignChannelCandidate, type CampaignMessageRequirement } from "./campaign-channel-policy.ts";

export const MULTICHANNEL_RECIPIENT_STATUSES = ["ACTIVE", "REPLIED", "SUPPRESSED", "COMPLETED", "FAILED", "DELIVERY_UNKNOWN"] as const;
export type MultichannelRecipientStatus = (typeof MULTICHANNEL_RECIPIENT_STATUSES)[number];

export interface MultichannelCampaignStep {
  id: string;
  position: number;
  delayMinutes: number;
  textTemplate: string | null;
  attachmentIds: string[];
  allowedChannels: ChannelType[];
  requiresTemplate: boolean;
}

export interface MultichannelRecipientState {
  id: string;
  workspaceId: string;
  campaignId: string;
  contactId: string;
  status: MultichannelRecipientStatus;
  currentStepPosition: number;
  nextStepAt: string | null;
}

export type CampaignStepPlan =
  | {
      status: "READY";
      recipientId: string;
      stepId: string;
      channelAccountId: string;
      channelType: ChannelType;
      recipientExternalId: string;
    }
  | { status: "STOPPED"; reason: "RECIPIENT_TERMINAL" | "NOT_DUE" | "NO_ELIGIBLE_CHANNEL" | "STEP_CHANNEL_UNAVAILABLE" };

export function planMultichannelCampaignStep(input: {
  recipient: MultichannelRecipientState;
  step: MultichannelCampaignStep;
  candidates: readonly CampaignChannelCandidate[];
  now: string;
}): CampaignStepPlan {
  if (input.recipient.status !== "ACTIVE") return { status: "STOPPED", reason: "RECIPIENT_TERMINAL" };
  if (!input.recipient.nextStepAt || !Number.isFinite(Date.parse(input.recipient.nextStepAt)) || Date.parse(input.recipient.nextStepAt) > Date.parse(input.now)) return { status: "STOPPED", reason: "NOT_DUE" };
  const allowed = input.candidates.filter((candidate) => input.step.allowedChannels.includes(candidate.channelType));
  if (allowed.length === 0) return { status: "STOPPED", reason: "STEP_CHANNEL_UNAVAILABLE" };
  const requirements: CampaignMessageRequirement = {
    needsText: input.step.textTemplate !== null,
    needsFiles: input.step.attachmentIds.length > 0,
    needsTemplates: input.step.requiresTemplate,
  };
  const selected = selectCampaignChannel(allowed, requirements);
  if (!selected) return { status: "STOPPED", reason: "NO_ELIGIBLE_CHANNEL" };
  return {
    status: "READY",
    recipientId: input.recipient.id,
    stepId: input.step.id,
    channelAccountId: selected.channelAccountId,
    channelType: selected.channelType,
    recipientExternalId: selected.recipientExternalId,
  };
}
