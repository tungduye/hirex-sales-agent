import type { ChannelType } from "../core/channel-contracts";

export interface ChannelSuppressionSummary { id: string; channelType: ChannelType; recipient: string; reason: string; source: string; createdAt: string }
