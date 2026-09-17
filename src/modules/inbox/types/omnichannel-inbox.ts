import type { ChannelAccountStatus, ChannelType } from "@/modules/channels/core/channel-contracts";
import type { ConversationStatus, TakeoverMode } from "@/modules/channels/core/conversation-policy";

export interface OmnichannelInboxAccount {
  id: string;
  channelType: ChannelType;
  displayName: string;
  status: ChannelAccountStatus;
  healthLabel: string;
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
  contactName: string | null;
  participantName: string | null;
  accountDisplayName: string;
  lastInboundAt: string | null;
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
  selectedPage: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  profiles: OmnichannelInboxProfile[];
  tags: OmnichannelInboxTag[];
  error: string | null;
}

export interface OmnichannelInboxMessage {
  id: string;
  conversationId: string;
  channelType: ChannelType;
  direction: "INBOUND" | "OUTBOUND";
  senderExternalId: string;
  text: string | null;
  timestamp: string;
  providerMessageId: string;
  attachmentCount: number;
}

export interface OmnichannelConversationDetail {
  id: string;
  channelAccountId: string;
  channelType: ChannelType;
  accountDisplayName: string;
  accountHealthLabel: string;
  contactName: string | null;
  participantName: string | null;
  senderExternalId: string | null;
  providerConversationId: string;
  subject: string | null;
  status: ConversationStatus;
  takeoverMode: TakeoverMode;
  assignedTo: string | null;
  lastInboundAt: string | null;
  messages: OmnichannelInboxMessage[];
  timelineTruncated: boolean;
  tagIds: string[];
  proposedActions: Array<{ id: string; text: string | null; proposedBy: string }>;
  legacyEmailAccountId: string | null;
}

export type OmnichannelConversationDetailResult =
  | { status: "ready"; conversation: OmnichannelConversationDetail }
  | { status: "not_found"; conversation: null }
  | { status: "error"; conversation: null };
