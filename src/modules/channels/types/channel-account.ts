import type { ChannelAccountStatus, ChannelCapability, ChannelType } from "../core/channel-contracts";

export interface ChannelAccountSummary {
  id: string;
  channelType: ChannelType;
  provider: string;
  externalAccountId: string;
  displayName: string | null;
  status: ChannelAccountStatus;
  capabilities: ChannelCapability[];
  lastHealthCheckAt: string | null;
  lastErrorCode: string | null;
}

export interface ChannelAccountsResult {
  accounts: ChannelAccountSummary[];
  error: string | null;
}
