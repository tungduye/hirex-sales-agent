import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { CHANNEL_ACCOUNT_STATUSES, CHANNEL_TYPES, type ChannelType } from "@/modules/channels/core/channel-contracts";
import { PROVIDER_HEALTH_STATUSES, type ProviderHealthStatus } from "@/modules/channels/core/provider-health";
import { CONVERSATION_STATUSES, TAKEOVER_MODES } from "@/modules/channels/core/conversation-policy";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { safeInboxPreview } from "../core/safe-preview";
import type { OmnichannelInboxAccount, OmnichannelInboxConversation, OmnichannelInboxData } from "../types/omnichannel-inbox";

const PAGE_SIZE = 50;
const MAX_PREVIEW_MESSAGES = 500;

interface AccountRow {
  id: unknown; channel_type: unknown; display_name: unknown; status: unknown;
  operator_enabled: unknown; provider_health_status: unknown; provider_health_checked_at: unknown;
}
interface ConversationRow {
  id: unknown; channel_account_id: unknown; channel_type: unknown; contact_id: unknown; subject: unknown;
  status: unknown; takeover_mode: unknown; assigned_to: unknown; last_message_at: unknown; unread_count: unknown; metadata: unknown;
}
interface MessageRow {
  conversation_id: unknown; direction: unknown; sender_external_id: unknown; text_content: unknown;
  received_at: unknown; sent_at: unknown; created_at: unknown;
}
interface ContactRow { id: unknown; full_name: unknown }
interface ProfileRow { id: unknown; full_name: unknown }
interface TagRow { id: unknown; name: unknown; color: unknown }
interface TagLinkRow { conversation_id: unknown; tag_id: unknown }
interface ActionRow { id: unknown; conversation_id: unknown; text_content: unknown; proposed_by: unknown }

function healthLabel(row: AccountRow, channelType: ChannelType): string {
  if (row.operator_enabled === false) return "Disabled";
  if (row.status !== "CONNECTED") return row.status === "REAUTH_REQUIRED" ? "Reconnect required" : row.status === "ERROR" ? "Error" : "Disconnected";
  if (channelType === "EMAIL") return "Connected";
  if (typeof row.provider_health_status !== "string" || !PROVIDER_HEALTH_STATUSES.includes(row.provider_health_status as ProviderHealthStatus)) return "Health unavailable";
  if (row.provider_health_status === "HEALTHY") return "Healthy";
  if (row.provider_health_status === "AUTH_REQUIRED") return "Reconnect required";
  if (row.provider_health_status === "UNKNOWN" && channelType === "FACEBOOK") return "Connected";
  return row.provider_health_status.charAt(0) + row.provider_health_status.slice(1).toLowerCase();
}

function mapAccount(row: AccountRow): OmnichannelInboxAccount | null {
  if (typeof row.id !== "string" || typeof row.channel_type !== "string" || !CHANNEL_TYPES.includes(row.channel_type as ChannelType) || typeof row.status !== "string" || !CHANNEL_ACCOUNT_STATUSES.includes(row.status as never)) return null;
  const channelType = row.channel_type as ChannelType;
  return { id: row.id, channelType, displayName: typeof row.display_name === "string" && row.display_name.trim() ? row.display_name : `${channelType} account`, status: row.status as OmnichannelInboxAccount["status"], healthLabel: healthLabel(row, channelType) };
}

function safePage(value: string | undefined): number {
  if (!value || !/^[1-9]\d{0,5}$/u.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}

function participantName(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).participantDisplayName;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function messageTime(row: MessageRow): string | null {
  for (const value of [row.received_at, row.sent_at, row.created_at]) if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  return null;
}

function emptyData(input: {
  accounts?: OmnichannelInboxAccount[]; selectedChannelType: ChannelType | null; selectedAccountId?: string | null;
  selectedPage: number; profiles?: OmnichannelInboxData["profiles"]; tags?: OmnichannelInboxData["tags"]; error: string;
}): OmnichannelInboxData {
  return { accounts: input.accounts ?? [], conversations: [], profiles: input.profiles ?? [], tags: input.tags ?? [], selectedChannelType: input.selectedChannelType, selectedAccountId: input.selectedAccountId ?? null, selectedPage: input.selectedPage, hasPreviousPage: input.selectedPage > 1, hasNextPage: false, error: input.error };
}

export async function getOmnichannelInboxData(filters: { channelType?: string; accountId?: string; page?: string }): Promise<OmnichannelInboxData> {
  const selectedChannelType = filters.channelType && CHANNEL_TYPES.includes(filters.channelType as ChannelType) ? filters.channelType as ChannelType : null;
  const selectedPage = safePage(filters.page);
  const accountContext = await getAccountContext();
  if (!accountContext?.workspaceId) return emptyData({ selectedChannelType, selectedPage, error: "Inbox could not be loaded." });
  const supabase = await createClient();
  const accountClient = createPrivilegedClient();
  const [{ data: accountData, error: accountError }, { data: profileData }, { data: tagData }] = await Promise.all([
    accountClient.from("channel_accounts").select("id,channel_type,display_name,status,operator_enabled,provider_health_status,provider_health_checked_at").eq("workspace_id", accountContext.workspaceId).order("channel_type").order("display_name"),
    supabase.from("profiles").select("id,full_name").eq("workspace_id", accountContext.workspaceId).order("full_name"),
    supabase.from("conversation_tags").select("id,name,color").eq("workspace_id", accountContext.workspaceId).order("name"),
  ]);
  const profiles = ((profileData ?? []) as ProfileRow[]).flatMap((row) => typeof row.id === "string" && typeof row.full_name === "string" ? [{ id: row.id, fullName: row.full_name }] : []);
  const tags = ((tagData ?? []) as TagRow[]).flatMap((row) => typeof row.id === "string" && typeof row.name === "string" ? [{ id: row.id, name: row.name, color: typeof row.color === "string" ? row.color : null }] : []);
  if (accountError) return emptyData({ selectedChannelType, selectedPage, profiles, tags, error: "Omnichannel Inbox is not available yet." });
  const mappedAccounts = (accountData as AccountRow[]).map(mapAccount);
  if (mappedAccounts.some((item) => !item)) return emptyData({ selectedChannelType, selectedPage, profiles, tags, error: "Inbox account data is unavailable." });
  const accounts = mappedAccounts as OmnichannelInboxAccount[];
  const requestedAccount = filters.accountId ? accounts.find((account) => account.id === filters.accountId) : undefined;
  const selectedAccountId = requestedAccount && (!selectedChannelType || requestedAccount.channelType === selectedChannelType) ? requestedAccount.id : null;

  let query = supabase.from("omnichannel_conversations")
    .select("id,channel_account_id,channel_type,contact_id,subject,status,takeover_mode,assigned_to,last_message_at,unread_count,metadata")
    .eq("workspace_id", accountContext.workspaceId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .range((selectedPage - 1) * PAGE_SIZE, selectedPage * PAGE_SIZE);
  if (selectedChannelType) query = query.eq("channel_type", selectedChannelType);
  if (selectedAccountId) query = query.eq("channel_account_id", selectedAccountId);
  const { data: conversationData, error: conversationError } = await query;
  if (conversationError) return emptyData({ accounts, selectedChannelType, selectedAccountId, selectedPage, profiles, tags, error: "Conversations could not be loaded." });
  const pageRows = conversationData as ConversationRow[];
  const hasNextPage = pageRows.length > PAGE_SIZE;
  const rows = pageRows.slice(0, PAGE_SIZE);
  const ids = rows.flatMap((row) => typeof row.id === "string" ? [row.id] : []);
  const contactIds = [...new Set(rows.flatMap((row) => typeof row.contact_id === "string" ? [row.contact_id] : []))];
  const latest = new Map<string, MessageRow>();
  const latestInbound = new Map<string, string>();
  const contactNames = new Map<string, string>();
  const tagIdsByConversation = new Map<string, string[]>();
  const proposedByConversation = new Map<string, Array<{ id: string; text: string | null; proposedBy: string }>>();
  if (ids.length > 0) {
    const [{ data: messageData }, { data: tagLinkData }, { data: actionData }, contactResult] = await Promise.all([
      supabase.from("omnichannel_messages").select("conversation_id,direction,sender_external_id,text_content,received_at,sent_at,created_at").in("conversation_id", ids).order("created_at", { ascending: false }).limit(Math.min(MAX_PREVIEW_MESSAGES, ids.length * 10)),
      supabase.from("conversation_tag_links").select("conversation_id,tag_id").in("conversation_id", ids),
      supabase.from("channel_outbound_actions").select("id,conversation_id,text_content,proposed_by").in("conversation_id", ids).eq("status", "PROPOSED").order("created_at", { ascending: false }),
      contactIds.length ? supabase.from("contacts").select("id,full_name").eq("workspace_id", accountContext.workspaceId).in("id", contactIds) : Promise.resolve({ data: [] as ContactRow[] }),
    ]);
    for (const message of (messageData ?? []) as MessageRow[]) {
      if (typeof message.conversation_id !== "string") continue;
      if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, message);
      const timestamp = messageTime(message);
      if (message.direction === "INBOUND" && timestamp && !latestInbound.has(message.conversation_id)) latestInbound.set(message.conversation_id, timestamp);
    }
    for (const contact of (contactResult.data ?? []) as ContactRow[]) if (typeof contact.id === "string" && typeof contact.full_name === "string") contactNames.set(contact.id, contact.full_name);
    for (const link of (tagLinkData ?? []) as TagLinkRow[]) if (typeof link.conversation_id === "string" && typeof link.tag_id === "string") tagIdsByConversation.set(link.conversation_id, [...(tagIdsByConversation.get(link.conversation_id) ?? []), link.tag_id]);
    for (const action of (actionData ?? []) as ActionRow[]) if (typeof action.id === "string" && typeof action.conversation_id === "string" && typeof action.proposed_by === "string") proposedByConversation.set(action.conversation_id, [...(proposedByConversation.get(action.conversation_id) ?? []), { id: action.id, text: typeof action.text_content === "string" ? action.text_content : null, proposedBy: action.proposed_by }]);
  }
  const accountNames = new Map(accounts.map((account) => [account.id, account.displayName]));
  const conversations: OmnichannelInboxConversation[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || typeof row.channel_account_id !== "string" || typeof row.channel_type !== "string" || !CHANNEL_TYPES.includes(row.channel_type as ChannelType) || typeof row.status !== "string" || !CONVERSATION_STATUSES.includes(row.status as never) || typeof row.takeover_mode !== "string" || !TAKEOVER_MODES.includes(row.takeover_mode as never) || !Number.isSafeInteger(row.unread_count)) return emptyData({ accounts, selectedChannelType, selectedAccountId, selectedPage, profiles, tags, error: "Conversation data is unavailable." });
    const message = latest.get(row.id);
    conversations.push({
      id: row.id, channelAccountId: row.channel_account_id, channelType: row.channel_type as ChannelType,
      subject: safeInboxPreview(typeof row.subject === "string" ? row.subject : null), status: row.status as OmnichannelInboxConversation["status"],
      takeoverMode: row.takeover_mode as OmnichannelInboxConversation["takeoverMode"], assignedTo: typeof row.assigned_to === "string" ? row.assigned_to : null,
      lastMessageAt: typeof row.last_message_at === "string" ? row.last_message_at : null, unreadCount: row.unread_count as number,
      latestText: safeInboxPreview(typeof message?.text_content === "string" ? message.text_content : null),
      latestDirection: message?.direction === "INBOUND" || message?.direction === "OUTBOUND" ? message.direction : null,
      senderExternalId: typeof message?.sender_external_id === "string" ? message.sender_external_id : null,
      contactName: typeof row.contact_id === "string" ? contactNames.get(row.contact_id) ?? null : null,
      participantName: participantName(row.metadata), accountDisplayName: accountNames.get(row.channel_account_id) ?? "Unknown account",
      lastInboundAt: latestInbound.get(row.id) ?? null, tagIds: tagIdsByConversation.get(row.id) ?? [], proposedActions: proposedByConversation.get(row.id) ?? [],
    });
  }
  return { accounts, conversations, profiles, tags, selectedChannelType, selectedAccountId, selectedPage, hasPreviousPage: selectedPage > 1, hasNextPage, error: null };
}
