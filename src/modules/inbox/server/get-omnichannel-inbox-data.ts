import "server-only";

import { createClient } from "@/lib/supabase/server";
import { CHANNEL_ACCOUNT_STATUSES, CHANNEL_TYPES, type ChannelType } from "@/modules/channels/core/channel-contracts";
import { CONVERSATION_STATUSES, TAKEOVER_MODES } from "@/modules/channels/core/conversation-policy";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { OmnichannelInboxAccount, OmnichannelInboxConversation, OmnichannelInboxData } from "../types/omnichannel-inbox";

interface AccountRow { id: unknown; channel_type: unknown; external_account_id: unknown; display_name: unknown; status: unknown }
interface ConversationRow { id: unknown; channel_account_id: unknown; channel_type: unknown; subject: unknown; status: unknown; takeover_mode: unknown; assigned_to: unknown; last_message_at: unknown; unread_count: unknown }
interface MessageRow { conversation_id: unknown; direction: unknown; sender_external_id: unknown; text_content: unknown }
interface ProfileRow { id: unknown; full_name: unknown }
interface TagRow { id: unknown; name: unknown; color: unknown }
interface TagLinkRow { conversation_id: unknown; tag_id: unknown }
interface ActionRow { id: unknown; conversation_id: unknown; text_content: unknown; proposed_by: unknown }

function mapAccount(row: AccountRow): OmnichannelInboxAccount | null {
  if (typeof row.id !== "string" || typeof row.channel_type !== "string" || !CHANNEL_TYPES.includes(row.channel_type as ChannelType) || typeof row.status !== "string" || !CHANNEL_ACCOUNT_STATUSES.includes(row.status as never) || typeof row.external_account_id !== "string") return null;
  return { id: row.id, channelType: row.channel_type as ChannelType, displayName: typeof row.display_name === "string" ? row.display_name : row.external_account_id, status: row.status as OmnichannelInboxAccount["status"] };
}

export async function getOmnichannelInboxData(filters: { channelType?: string; accountId?: string }): Promise<OmnichannelInboxData> {
  const accountContext = await getAccountContext();
  if (!accountContext?.workspaceId) return { accounts: [], conversations: [], profiles: [], tags: [], selectedChannelType: null, selectedAccountId: null, error: "Inbox could not be loaded." };
  const selectedChannelType = filters.channelType && CHANNEL_TYPES.includes(filters.channelType as ChannelType) ? filters.channelType as ChannelType : null;
  const supabase = await createClient();
  const [{ data: accountData, error: accountError }, { data: profileData }, { data: tagData }] = await Promise.all([
    supabase.from("channel_accounts").select("id,channel_type,external_account_id,display_name,status").eq("workspace_id", accountContext.workspaceId).order("channel_type"),
    supabase.from("profiles").select("id,full_name").eq("workspace_id", accountContext.workspaceId).order("full_name"),
    supabase.from("conversation_tags").select("id,name,color").eq("workspace_id", accountContext.workspaceId).order("name"),
  ]);
  const profiles = ((profileData ?? []) as ProfileRow[]).flatMap((row) => typeof row.id === "string" && typeof row.full_name === "string" ? [{ id: row.id, fullName: row.full_name }] : []);
  const tags = ((tagData ?? []) as TagRow[]).flatMap((row) => typeof row.id === "string" && typeof row.name === "string" ? [{ id: row.id, name: row.name, color: typeof row.color === "string" ? row.color : null }] : []);
  if (accountError) return { accounts: [], conversations: [], profiles, tags, selectedChannelType, selectedAccountId: null, error: "Omnichannel Inbox is not available yet." };
  const mappedAccounts = (accountData as AccountRow[]).map(mapAccount);
  if (mappedAccounts.some((item) => !item)) return { accounts: [], conversations: [], profiles, tags, selectedChannelType, selectedAccountId: null, error: "Inbox account data is unavailable." };
  const accounts = mappedAccounts as OmnichannelInboxAccount[];
  const selectedAccountId = filters.accountId && accounts.some((account) => account.id === filters.accountId) ? filters.accountId : null;
  let query = supabase.from("omnichannel_conversations").select("id,channel_account_id,channel_type,subject,status,takeover_mode,assigned_to,last_message_at,unread_count").eq("workspace_id", accountContext.workspaceId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(50);
  if (selectedChannelType) query = query.eq("channel_type", selectedChannelType);
  if (selectedAccountId) query = query.eq("channel_account_id", selectedAccountId);
  const { data: conversationData, error: conversationError } = await query;
  if (conversationError) return { accounts, conversations: [], profiles, tags, selectedChannelType, selectedAccountId, error: "Conversations could not be loaded." };
  const rows = conversationData as ConversationRow[];
  const ids = rows.flatMap((row) => typeof row.id === "string" ? [row.id] : []);
  const latest = new Map<string, MessageRow>();
  const tagIdsByConversation = new Map<string, string[]>();
  const proposedByConversation = new Map<string, Array<{ id: string; text: string | null; proposedBy: string }>>();
  if (ids.length > 0) {
    const [{ data: messageData }, { data: tagLinkData }, { data: actionData }] = await Promise.all([
      supabase.from("omnichannel_messages").select("conversation_id,direction,sender_external_id,text_content,created_at").in("conversation_id", ids).order("created_at", { ascending: false }),
      supabase.from("conversation_tag_links").select("conversation_id,tag_id").in("conversation_id", ids),
      supabase.from("channel_outbound_actions").select("id,conversation_id,text_content,proposed_by").in("conversation_id", ids).eq("status", "PROPOSED").order("created_at", { ascending: false }),
    ]);
    for (const message of (messageData ?? []) as MessageRow[]) if (typeof message.conversation_id === "string" && !latest.has(message.conversation_id)) latest.set(message.conversation_id, message);
    for (const link of (tagLinkData ?? []) as TagLinkRow[]) if (typeof link.conversation_id === "string" && typeof link.tag_id === "string") tagIdsByConversation.set(link.conversation_id, [...(tagIdsByConversation.get(link.conversation_id) ?? []), link.tag_id]);
    for (const action of (actionData ?? []) as ActionRow[]) if (typeof action.id === "string" && typeof action.conversation_id === "string" && typeof action.proposed_by === "string") proposedByConversation.set(action.conversation_id, [...(proposedByConversation.get(action.conversation_id) ?? []), { id: action.id, text: typeof action.text_content === "string" ? action.text_content : null, proposedBy: action.proposed_by }]);
  }
  const conversations: OmnichannelInboxConversation[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || typeof row.channel_account_id !== "string" || typeof row.channel_type !== "string" || !CHANNEL_TYPES.includes(row.channel_type as ChannelType) || typeof row.status !== "string" || !CONVERSATION_STATUSES.includes(row.status as never) || typeof row.takeover_mode !== "string" || !TAKEOVER_MODES.includes(row.takeover_mode as never) || !Number.isSafeInteger(row.unread_count)) return { accounts, conversations: [], profiles, tags, selectedChannelType, selectedAccountId, error: "Conversation data is unavailable." };
    const message = latest.get(row.id);
    conversations.push({ id: row.id, channelAccountId: row.channel_account_id, channelType: row.channel_type as ChannelType, subject: typeof row.subject === "string" ? row.subject : null, status: row.status as OmnichannelInboxConversation["status"], takeoverMode: row.takeover_mode as OmnichannelInboxConversation["takeoverMode"], assignedTo: typeof row.assigned_to === "string" ? row.assigned_to : null, lastMessageAt: typeof row.last_message_at === "string" ? row.last_message_at : null, unreadCount: row.unread_count as number, latestText: typeof message?.text_content === "string" ? message.text_content : null, latestDirection: message?.direction === "INBOUND" || message?.direction === "OUTBOUND" ? message.direction : null, senderExternalId: typeof message?.sender_external_id === "string" ? message.sender_external_id : null, tagIds: tagIdsByConversation.get(row.id) ?? [], proposedActions: proposedByConversation.get(row.id) ?? [] });
  }
  return { accounts, conversations, profiles, tags, selectedChannelType, selectedAccountId, error: null };
}
