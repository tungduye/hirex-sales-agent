import type { ChannelAccountStatus, ChannelType } from "@/modules/channels/core/channel-contracts";
import type { ConversationStatus, TakeoverMode } from "@/modules/channels/core/conversation-policy";

export interface OmnichannelInboxAccount {
  id: string;
  channelType: ChannelType;
  displayName: string;
  status: ChannelAccountStatus;
}

export interface OmnichannelInboxConversation {
  id: string;
  channelAccountId: string;
  channelType: ChannelType;
  subject: string | null;
  status: ConversationStatus;
  takeoverMode: TakeoverMode;
  assignedTo: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  latestText: string | null;
  latestDirection: "INBOUND" | "OUTBOUND" | null;
  senderExternalId: string | null;
  tagIds: string[];
  proposedActions: Array<{ id: string; text: string | null; proposedBy: string }>;
}

export interface OmnichannelInboxProfile { id: string; fullName: string }
export interface OmnichannelInboxTag { id: string; name: string; color: string | null }

export interface OmnichannelInboxData {
  accounts: OmnichannelInboxAccount[];
  conversations: OmnichannelInboxConversation[];
  selectedChannelType: ChannelType | null;
  selectedAccountId: string | null;
  profiles: OmnichannelInboxProfile[];
  tags: OmnichannelInboxTag[];
  error: string | null;
}
