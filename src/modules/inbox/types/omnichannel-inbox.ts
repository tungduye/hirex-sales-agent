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
  isPinned: boolean;
  isMuted: boolean;
  folder: "PRIMARY" | "OTHER";
  latestText: string | null;
  latestDirection: "INBOUND" | "OUTBOUND" | null;
  senderExternalId: string | null;
  contactName: string | null;
  participantName: string | null;
  avatarUrl: string | null;
  accountDisplayName: string;
  lastInboundAt: string | null;
  tagIds: string[];
  proposedActions: Array<{ id: string; text: string | null; proposedBy: string }>;
  /** Group chat (several people write in it); shown under the "Nhóm" tab only. */
  isGroup: boolean;
  /** E-mail from a robot sender (no-reply, notifications…). */
  automated: boolean;
  providerConversationId: string | null;
  /** Zalo group listed once for all of our nicks in it ("ZALO:<group name>"); null for other rows. */
  groupKey: string | null;
  /** Every listed copy behind this row, the one it opens first (one id for ordinary rows). */
  copyIds: string[];
  /** The nick (channel account) of each copy, same order as copyIds. */
  copyAccountIds: string[];
}

export interface OmnichannelInboxProfile {
  id: string;
  fullName: string;
  allChannelAccounts: boolean;
  channelAccountIds: string[];
}
export interface OmnichannelInboxTag { id: string; name: string; color: string | null }

export interface OmnichannelInboxData {
  workspaceId: string | null;
  /** Signed-in member, for the "Của tôi" tab. */
  currentUserId: string | null;
  accounts: OmnichannelInboxAccount[];
  conversations: OmnichannelInboxConversation[];
  selectedChannelType: ChannelType | null;
  /** Every channel picked in the chips (several allowed); empty = all channels. */
  selectedChannelTypes: ChannelType[];
  /** The same list as it travels in the URL: "ZALO,EMAIL". */
  channelParam: string | null;
  selectedAccountId: string | null;
  selectedOwnerIds: string[];
  selectedTagIds: string[];
  tagMatchMode: "all" | "any";
  firstMessageFrom: string | null;
  firstMessageTo: string | null;
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
  attachments: Array<{
    id: string | null;
    filename: string | null;
    contentType: string | null;
    sizeBytes: number | null;
    downloadUrl: string | null;
  }>;
  deliveryStatus: "RECEIVED" | "PENDING" | "SENDING" | "SENT" | "DELIVERY_UNKNOWN" | "FAILED" | "BLOCKED";
  actionId?: string;
  reconciliationStatus?: "NONE" | "NEEDS_REVIEW" | "ACKNOWLEDGED_NO_RETRY";
}

export interface OmnichannelConversationDetail {
  id: string;
  channelAccountId: string;
  channelType: ChannelType;
  accountDisplayName: string;
  accountHealthLabel: string;
  contactName: string | null;
  participantName: string | null;
  avatarUrl: string | null;
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
  pendingActions: Array<{ id: string; text: string | null }>;
  legacyEmailAccountId: string | null;
  legacyEmailThreadId: string | null;
  /** Zalo group with several of our nicks in it: the copies this member may send from ("Gửi bằng"). */
  sendAs: Array<{ conversationId: string; accountDisplayName: string }>;
}

export type OmnichannelConversationDetailResult =
  | { status: "ready"; conversation: OmnichannelConversationDetail }
  | { status: "not_found"; conversation: null }
  | { status: "error"; conversation: null };
