import type { ChannelType } from "./channel-contracts.ts";

export type InboundSignal = "REPLY" | "UNSUBSCRIBE" | "HARD_BOUNCE" | "COMPLAINT";
export type CampaignStopReason = "REPLIED" | "UNSUBSCRIBED" | "HARD_BOUNCE" | "COMPLAINT";

export interface InboundSignalDecision {
  stopCampaigns: boolean;
  createChannelSuppression: boolean;
  suppressionReason: "UNSUBSCRIBED" | "HARD_BOUNCE" | "COMPLAINT" | null;
  stopReason: CampaignStopReason;
  channelType: ChannelType;
}

export function decideInboundSignal(channelType: ChannelType, signal: InboundSignal): InboundSignalDecision {
  switch (signal) {
    case "REPLY":
      return { stopCampaigns: true, createChannelSuppression: false, suppressionReason: null, stopReason: "REPLIED", channelType };
    case "UNSUBSCRIBE":
      return { stopCampaigns: true, createChannelSuppression: true, suppressionReason: "UNSUBSCRIBED", stopReason: "UNSUBSCRIBED", channelType };
    case "HARD_BOUNCE":
      return { stopCampaigns: true, createChannelSuppression: true, suppressionReason: "HARD_BOUNCE", stopReason: "HARD_BOUNCE", channelType };
    case "COMPLAINT":
      return { stopCampaigns: true, createChannelSuppression: true, suppressionReason: "COMPLAINT", stopReason: "COMPLAINT", channelType };
  }
}
