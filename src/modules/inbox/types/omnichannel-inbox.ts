import type { MessageReaction } from "@/modules/channels/core/zalo-reactions";
import type { ZaloSendLock } from "@/modules/channels/core/send-locks";
import type { ChannelAccountStatus, ChannelType } from "@/modules/channels/core/channel-contracts";
import type { ConversationStatus, TakeoverMode } from "@/modules/channels/core/conversation-policy";

export interface OmnichannelInboxAccount {
  id: string;
  channelType: ChannelType;
  displayName: string;
  status: ChannelAccountStatus;
  healthLabel: string;
  /** Người dùng chính (main user) of the account. */
  primaryProfileId?: string | null;
  /** Name of the main user, for grouping in the account picker. */
  primaryName?: string | null;
  /** Conversations with unread messages on this account (within the current scope). */
  unreadCount?: number;
  /** Unread e-mail from robots / the "Khác" folder, not counted in unreadCount. */
  unreadAutomated?: number;
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
  /** Zalo group identity shared by every nick's copy (see group-merge.ts); null when unknown. */
  zaloGroupKey?: string | null;
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
  /** Picked accounts as they travel in the URL: "id1,id2". */
  selectedAccountId: string | null;
  selectedAccountIds?: string[];
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
  /** Phạm vi in use and how many accounts each one covers (TEAM only when I manage someone). */
  scope?: "MINE" | "TEAM" | "ALL";
  scopeCounts?: { mine: number; team: number; all: number; hasTeam: boolean };
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
  /** Zalo reactions this nick sees on the message. */
  reactions?: MessageReaction[];
  /** Zalo reply: the earlier message it quoted. */
  quote?: { text: string; sender: string | null; messageId: string | null };
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
  /** Facebook Page: this chat in Meta Business Suite (no 24-hour limit there); null for other channels. */
  businessSuiteUrl: string | null;
  /** Set when this Zalo nick cannot send right now (an earlier send is still being settled). */
  sendLock: ZaloSendLock | null;
  /** The opened nick's own Zalo id (to recognise mentions of it). */
  accountExternalId: string | null;
  /** Main user of the opened nick, when it is someone else (composer warns "Đang trả lời bằng nick của …"). */
  accountOwnerName?: string | null;
  /** Zalo group: who is who (sender id -> name/avatar), our own nicks included; empty for other chats. */
  participants: Record<string, { name: string; avatarUrl: string | null; member?: boolean }>;
}

export type OmnichannelConversationDetailResult =
  | { status: "ready"; conversation: OmnichannelConversationDetail }
  | { status: "not_found"; conversation: null }
  | { status: "error"; conversation: null };
