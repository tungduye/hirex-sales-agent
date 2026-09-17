import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { CHANNEL_TYPES, type ChannelType } from "@/modules/channels/core/channel-contracts";
import { CONVERSATION_STATUSES, TAKEOVER_MODES } from "@/modules/channels/core/conversation-policy";
import { PROVIDER_HEALTH_STATUSES } from "@/modules/channels/core/provider-health";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { OmnichannelConversationDetail, OmnichannelConversationDetailResult, OmnichannelInboxMessage } from "../types/omnichannel-inbox";

const MAX_MESSAGES = 200;

function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function metadataName(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  return text(metadata.participantDisplayName) ?? text(metadata.participant_name) ?? text(metadata.sender_name) ?? text(metadata.from_name);
}
function accountHealth(row: Record<string, unknown>, channelType: ChannelType): string {
  if (row.operator_enabled === false) return "Disabled";
  if (row.status !== "CONNECTED") return row.status === "REAUTH_REQUIRED" ? "Reconnect required" : row.status === "ERROR" ? "Error" : "Disconnected";
  if (channelType === "EMAIL") return "Connected";
  if (typeof row.provider_health_status !== "string" || !PROVIDER_HEALTH_STATUSES.includes(row.provider_health_status as never)) return "Health unavailable";
  if (row.provider_health_status === "HEALTHY") return "Healthy";
  if (row.provider_health_status === "AUTH_REQUIRED") return "Reconnect required";
  if (row.provider_health_status === "UNKNOWN" && channelType === "FACEBOOK") return "Connected";
  return row.provider_health_status.charAt(0) + row.provider_health_status.slice(1).toLowerCase();
}

export async function getOmnichannelConversationDetail(conversationId: string): Promise<OmnichannelConversationDetailResult> {
  if (!z.uuid().safeParse(conversationId).success) return { status: "not_found", conversation: null };
  const accountContext = await getAccountContext();
  if (!accountContext?.workspaceId) return { status: "not_found", conversation: null };
  const supabase = await createClient();
  const accountClient = createPrivilegedClient();
  const { data: row, error } = await supabase.from("omnichannel_conversations")
    .select("id,channel_account_id,channel_type,provider_conversation_id,contact_id,subject,status,takeover_mode,assigned_to,metadata")
    .eq("id", conversationId).eq("workspace_id", accountContext.workspaceId).maybeSingle();
  if (error) return { status: "error", conversation: null };
  if (!row) return { status: "not_found", conversation: null };
  if (typeof row.channel_type !== "string" || !CHANNEL_TYPES.includes(row.channel_type as ChannelType)
    || typeof row.channel_account_id !== "string" || typeof row.provider_conversation_id !== "string"
    || typeof row.status !== "string" || !CONVERSATION_STATUSES.includes(row.status as never)
    || typeof row.takeover_mode !== "string" || !TAKEOVER_MODES.includes(row.takeover_mode as never)) {
    return { status: "error", conversation: null };
  }
  const channelType = row.channel_type as ChannelType;
  const [{ data: channelAccount, error: accountError }, { data: messageRows, error: messageError }, { data: tagRows }, { data: actionRows }, contactResult] = await Promise.all([
    accountClient.from("channel_accounts").select("id,display_name,status,operator_enabled,provider_health_status,legacy_email_account_id").eq("id", row.channel_account_id).eq("workspace_id", accountContext.workspaceId).eq("channel_type", channelType).maybeSingle(),
    supabase.from("omnichannel_messages").select("id,conversation_id,channel_type,direction,sender_external_id,text_content,provider_message_id,attachment_count,received_at,sent_at,created_at").eq("workspace_id", accountContext.workspaceId).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(MAX_MESSAGES + 1),
    supabase.from("conversation_tag_links").select("tag_id").eq("workspace_id", accountContext.workspaceId).eq("conversation_id", conversationId),
    supabase.from("channel_outbound_actions").select("id,text_content,proposed_by").eq("workspace_id", accountContext.workspaceId).eq("conversation_id", conversationId).eq("status", "PROPOSED").order("created_at", { ascending: false }),
    typeof row.contact_id === "string" ? supabase.from("contacts").select("full_name").eq("workspace_id", accountContext.workspaceId).eq("id", row.contact_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (accountError || messageError || !channelAccount) return { status: "error", conversation: null };
  const rawMessages = (messageRows ?? []).slice(0, MAX_MESSAGES).reverse();
  const messages: OmnichannelInboxMessage[] = [];
  let lastInboundAt: string | null = null;
  for (const message of rawMessages) {
    const timestamp = text(message.received_at) ?? text(message.sent_at) ?? text(message.created_at);
    if (typeof message.id !== "string" || message.conversation_id !== conversationId || message.channel_type !== channelType
      || (message.direction !== "INBOUND" && message.direction !== "OUTBOUND") || typeof message.sender_external_id !== "string"
      || typeof message.provider_message_id !== "string" || !timestamp || !Number.isSafeInteger(message.attachment_count) || message.attachment_count < 0) {
      return { status: "error", conversation: null };
    }
    if (message.direction === "INBOUND") lastInboundAt = timestamp;
    messages.push({ id: message.id, conversationId, channelType, direction: message.direction, senderExternalId: message.sender_external_id, text: text(message.text_content), timestamp, providerMessageId: message.provider_message_id, attachmentCount: message.attachment_count });
  }
  const proposedActions = (actionRows ?? []).flatMap((action) => typeof action.id === "string" && typeof action.proposed_by === "string" ? [{ id: action.id, text: text(action.text_content), proposedBy: action.proposed_by }] : []);
  const tagIds = (tagRows ?? []).flatMap((tag) => typeof tag.tag_id === "string" ? [tag.tag_id] : []);
  return {
    status: "ready",
    conversation: {
      id: row.id,
      channelAccountId: row.channel_account_id,
      channelType,
      accountDisplayName: text(channelAccount.display_name) ?? "Unnamed account",
      accountHealthLabel: accountHealth(channelAccount as Record<string, unknown>, channelType),
      contactName: text(contactResult.data?.full_name),
      participantName: metadataName(row.metadata),
      senderExternalId: messages.find((message) => message.direction === "INBOUND")?.senderExternalId ?? null,
      providerConversationId: row.provider_conversation_id,
      subject: text(row.subject),
      status: row.status as OmnichannelConversationDetail["status"],
      takeoverMode: row.takeover_mode as OmnichannelConversationDetail["takeoverMode"],
      assignedTo: text(row.assigned_to),
      lastInboundAt,
      messages,
      timelineTruncated: (messageRows ?? []).length > MAX_MESSAGES,
      tagIds,
      proposedActions,
      legacyEmailAccountId: text(channelAccount.legacy_email_account_id),
    },
  };
}
