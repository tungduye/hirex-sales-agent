import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { CHANNEL_TYPES, type ChannelType } from "@/modules/channels/core/channel-contracts";
import { CONVERSATION_STATUSES, TAKEOVER_MODES } from "@/modules/channels/core/conversation-policy";
import { PROVIDER_HEALTH_STATUSES } from "@/modules/channels/core/provider-health";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { zaloProviderDisplayText } from "../core/zalo-provider-display-text";
import { isFacebookProfileSystemPlaceholder } from "../core/facebook-profile-system-text";
import type { OmnichannelConversationDetail, OmnichannelConversationDetailResult, OmnichannelInboxMessage } from "../types/omnichannel-inbox";
import { canAccessChannelAccount } from "@/modules/access/server/access-control";
import { normalizeGroupName, oneCopyPerNick } from "../core/group-merge";

// Loading hundreds of messages and action rows on every realtime refresh makes
// active inboxes feel sluggish. Older history remains available through the
// existing truncation indicator while the working set stays responsive.
const MAX_MESSAGES = 40;

function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function metadataName(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  return text(metadata.conversationDisplayName) ?? text(metadata.groupName) ?? text(metadata.threadName) ??
    text(metadata.participantDisplayName) ?? text(metadata.participant_name) ?? text(metadata.sender_name) ?? text(metadata.from_name);
}
function metadataAvatar(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = text((value as Record<string, unknown>).avatarUrl);
  if (!candidate) return null;
  try { return new URL(candidate).protocol === "https:" ? candidate : null; } catch { return null; }
}
function messageAttachments(value: unknown, expectedCount: number): OmnichannelInboxMessage["attachments"] | null {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 0 || expectedCount > 20) return [];
  const fallback = () => Array.from({ length: expectedCount }, () => ({ id: null, filename: null, contentType: null, sizeBytes: null, downloadUrl: null }));
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback();
  const raw = (value as Record<string, unknown>).attachments;
  if (raw === undefined && expectedCount === 0) return [];
  if (!Array.isArray(raw) || raw.length !== expectedCount || raw.length > 20) return fallback();
  const attachments: OmnichannelInboxMessage["attachments"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fallback();
    const row = item as Record<string, unknown>;
    const filename = row.filename === null ? null : text(row.filename);
    const contentType = row.contentType === null ? null : text(row.contentType);
    const sizeBytes = row.sizeBytes === null ? null : row.sizeBytes;
    if ((row.filename !== null && (!filename || filename.length > 255 || /[\u0000-\u001f\u007f-\u009f]/u.test(filename))) ||
      (row.contentType !== null && (!contentType || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(contentType))) ||
      (sizeBytes !== null && (!Number.isSafeInteger(sizeBytes) || Number(sizeBytes) < 0 || Number(sizeBytes) > 100_000_000))) return fallback();
    attachments.push({ id: null, filename, contentType, sizeBytes: sizeBytes as number | null, downloadUrl: null });
  }
  return attachments;
}
function accountHealth(row: Record<string, unknown>, channelType: ChannelType): string {
  if (row.operator_enabled === false) return "Disabled";
  if (row.status !== "CONNECTED") return row.status === "REAUTH_REQUIRED" ? "Reconnect required" : row.status === "ERROR" ? "Error" : "Disconnected";
  if (channelType === "EMAIL") return "Connected";
  if (typeof row.provider_health_status !== "string" || !PROVIDER_HEALTH_STATUSES.includes(row.provider_health_status as never)) return "Health unavailable";
  if (channelType === "ZALO") {
    const checkedAt = typeof row.provider_health_checked_at === "string" ? Date.parse(row.provider_health_checked_at) : Number.NaN;
    if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > 5 * 60 * 1000) return "Disconnected";
  }
  if (row.provider_health_status === "HEALTHY") return "Healthy";
  if (row.provider_health_status === "AUTH_REQUIRED") return "Reconnect required";
  if (row.provider_health_status === "UNKNOWN" && channelType === "FACEBOOK") return "Connected";
  return row.provider_health_status.charAt(0) + row.provider_health_status.slice(1).toLowerCase();
}

/**
 * "Gửi bằng" for a Zalo group several of our nicks are in: every copy of the group whose account this
 * member may use, the current one first. Zalo gives each nick a different id for the same group, so
 * copies are found by group name (as in the inbox list); a name one nick has twice is ambiguous and
 * gets no choice. Empty for one-to-one chats and when only one copy is usable.
 */
async function zaloGroupSendAs(client: ReturnType<typeof createPrivilegedClient>, workspaceId: string, conversationId: string, groupName: string | null) {
  if (!groupName || !normalizeGroupName(groupName)) return [];
  const { data: isGroup } = await client.rpc("is_zalo_group_conversation", { p_conversation_id: conversationId });
  if (isGroup !== true) return [];
  const { data: copies } = await client.from("omnichannel_conversations").select("id,channel_account_id,subject,metadata")
    .eq("workspace_id", workspaceId).eq("channel_type", "ZALO").ilike("subject", groupName.replace(/[\\%_]/g, (char) => `\\${char}`)).limit(30);
  const named = (copies ?? []).filter((copy) => typeof copy.id === "string" && typeof copy.channel_account_id === "string"
    && typeof copy.subject === "string" && normalizeGroupName(copy.subject) === normalizeGroupName(groupName)
    && !(copy.metadata && typeof copy.metadata === "object" && (copy.metadata as Record<string, unknown>).hidden === true));
  if (named.length < 2 || !oneCopyPerNick(named.map((copy) => copy.channel_account_id as string))) return [];
  const groupFlags = await Promise.all(named.map((copy) => copy.id === conversationId ? Promise.resolve(true)
    : client.rpc("is_zalo_group_conversation", { p_conversation_id: copy.id }).then(({ data }) => data === true)));
  const visible = named.filter((_, index) => groupFlags[index]);
  if (visible.length < 2) return [];
  const { data: accounts } = await client.from("channel_accounts").select("id,display_name")
    .eq("workspace_id", workspaceId).eq("channel_type", "ZALO").is("deleted_at", null).in("id", visible.map((copy) => copy.channel_account_id as string));
  const names = new Map<string, string>((accounts ?? []).map((account) => [account.id as string, text(account.display_name) ?? "Nick Zalo"]));
  const options: Array<{ conversationId: string; accountDisplayName: string }> = [];
  for (const copy of visible) {
    const accountId = copy.channel_account_id as string;
    if (!names.has(accountId) || !await canAccessChannelAccount(accountId)) continue;
    options.push({ conversationId: copy.id as string, accountDisplayName: names.get(accountId)! });
  }
  options.sort((a, b) => (a.conversationId === conversationId ? -1 : b.conversationId === conversationId ? 1 : a.accountDisplayName.localeCompare(b.accountDisplayName, "vi")));
  return options.length > 1 ? options : [];
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
  if(typeof row.channel_account_id!=="string"||!await canAccessChannelAccount(row.channel_account_id))return {status:"not_found",conversation:null};
  if (typeof row.channel_type !== "string" || !CHANNEL_TYPES.includes(row.channel_type as ChannelType)
    || typeof row.channel_account_id !== "string" || typeof row.provider_conversation_id !== "string"
    || typeof row.status !== "string" || !CONVERSATION_STATUSES.includes(row.status as never)
    || typeof row.takeover_mode !== "string" || !TAKEOVER_MODES.includes(row.takeover_mode as never)) {
    return { status: "error", conversation: null };
  }
  const channelType = row.channel_type as ChannelType;
  const [{ data: channelAccount, error: accountError }, { data: messageRows, error: messageError }, { data: tagRows }, { data: actionRows }, contactResult] = await Promise.all([
    accountClient.from("channel_accounts").select("id,display_name,status,operator_enabled,provider_health_status,provider_health_checked_at,legacy_email_account_id").eq("id", row.channel_account_id).eq("workspace_id", accountContext.workspaceId).eq("channel_type", channelType).is("deleted_at", null).maybeSingle(),
    accountClient.from("omnichannel_messages").select("id,conversation_id,channel_type,direction,sender_external_id,text_content,provider_message_id,attachment_count,received_at,sent_at,created_at,metadata").eq("workspace_id", accountContext.workspaceId).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(MAX_MESSAGES + 1),
    accountClient.from("conversation_tag_links").select("tag_id").eq("workspace_id", accountContext.workspaceId).eq("conversation_id", conversationId),
    accountClient.from("channel_outbound_actions").select("id,text_content,proposed_by,status,attempt_count,created_at,updated_at,provider_message_id,attachment_ids,safe_error_code,reconciliation_status,idempotency_key").eq("workspace_id", accountContext.workspaceId).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(MAX_MESSAGES),
    typeof row.contact_id === "string" ? accountClient.from("contacts").select("full_name").eq("workspace_id", accountContext.workspaceId).eq("id", row.contact_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (accountError || messageError || !channelAccount) return { status: "error", conversation: null };
  const rawMessages = (messageRows ?? []).slice(0, MAX_MESSAGES).reverse();
  const messages: OmnichannelInboxMessage[] = [];
  let lastInboundAt: string | null = null;
  for (const message of rawMessages) {
    if (channelType === "FACEBOOK_PROFILE" && isFacebookProfileSystemPlaceholder(message.text_content) && message.attachment_count === 0) continue;
    const timestamp = text(message.received_at) ?? text(message.sent_at) ?? text(message.created_at);
    if (typeof message.id !== "string" || message.conversation_id !== conversationId || message.channel_type !== channelType
      || (message.direction !== "INBOUND" && message.direction !== "OUTBOUND") || typeof message.sender_external_id !== "string"
      || typeof message.provider_message_id !== "string" || !timestamp || !Number.isSafeInteger(message.attachment_count) || message.attachment_count < 0) {
      return { status: "error", conversation: null };
    }
    const attachments = messageAttachments(message.metadata, message.attachment_count);
    if (!attachments) return { status: "error", conversation: null };
    if (message.direction === "INBOUND") lastInboundAt = timestamp;
    const rawText = text(message.text_content);
    messages.push({ id: message.id, conversationId, channelType, direction: message.direction, senderExternalId: message.sender_external_id, text: channelType === "ZALO" ? zaloProviderDisplayText(rawText) : rawText, timestamp, providerMessageId: message.provider_message_id, attachmentCount: message.attachment_count, attachments, deliveryStatus: message.direction === "OUTBOUND" ? "SENT" : "RECEIVED" });
  }
  const messageIds = messages.filter((message) => !message.id.startsWith("action:")).map((message) => message.id);
  if (messageIds.length > 0) {
    const { data: links, error: linkError } = await accountClient.from("channel_message_attachments")
      .select("message_id,attachment_id,position").eq("workspace_id", accountContext.workspaceId)
      .in("message_id", messageIds).order("position", { ascending: true });
    if (linkError) return { status: "error", conversation: null };
    const attachmentIds = [...new Set((links ?? []).flatMap((link) => typeof link.attachment_id === "string" ? [link.attachment_id] : []))];
    const attachmentById = new Map<string, { id: string; filename: string; contentType: string; sizeBytes: number; downloadUrl: string }>();
    if (attachmentIds.length > 0) {
      const { data: stored, error: storedError } = await accountClient.from("channel_attachments")
        .select("id,filename,content_type,size_bytes").eq("workspace_id", accountContext.workspaceId).in("id", attachmentIds);
      if (storedError) return { status: "error", conversation: null };
      for (const item of stored ?? []) {
        if (typeof item.id !== "string" || typeof item.filename !== "string" || typeof item.content_type !== "string" || !Number.isSafeInteger(item.size_bytes))
          return { status: "error", conversation: null };
        attachmentById.set(item.id, { id: item.id, filename: item.filename, contentType: item.content_type,
          sizeBytes: item.size_bytes, downloadUrl: `/api/inbox/attachments/${item.id}` });
      }
    }
    const storedByMessage = new Map<string, OmnichannelInboxMessage["attachments"]>();
    for (const link of links ?? []) {
      if (typeof link.message_id !== "string" || typeof link.attachment_id !== "string" || !Number.isSafeInteger(link.position))
        return { status: "error", conversation: null };
      const attachment = attachmentById.get(link.attachment_id);
      if (!attachment) return { status: "error", conversation: null };
      const current = storedByMessage.get(link.message_id) ?? [];
      current.push(attachment);
      storedByMessage.set(link.message_id, current);
    }
    for (const message of messages) {
      const stored = storedByMessage.get(message.id);
      if (stored) message.attachments = stored;
    }
  }
  const proposedActions = (actionRows ?? []).flatMap((action) => action.status === "PROPOSED" && typeof action.id === "string" && typeof action.proposed_by === "string" ? [{ id: action.id, text: text(action.text_content), proposedBy: action.proposed_by }] : []);
  const pendingActions = (actionRows ?? []).flatMap((action) => action.status === "APPROVED" && action.attempt_count === 0 && typeof action.id === "string" ? [{ id: action.id, text: text(action.text_content) }] : []).slice(-1);
  const persistedProviderIds = new Set(messages.map(message => message.providerMessageId));
  const successfullyRetriedKeys = new Set((actionRows ?? []).flatMap((action) => {
    if (action.status !== "SENT" || typeof action.idempotency_key !== "string") return [];
    const marker = action.idempotency_key.indexOf(":retry:");
    return marker > 0 ? [action.idempotency_key.slice(0, marker)] : [];
  }));
  for (const action of actionRows ?? []) {
    if (!["APPROVED", "EXECUTING", "FAILED", "DELIVERY_UNKNOWN"].includes(String(action.status)) || typeof action.id !== "string") continue;
    if (action.safe_error_code === "ACCOUNT_BUSY" && typeof action.idempotency_key === "string" && successfullyRetriedKeys.has(action.idempotency_key)) continue;
    if (typeof action.provider_message_id === "string" && persistedProviderIds.has(action.provider_message_id)) continue;
    const timestamp = text(action.updated_at) ?? text(action.created_at);
    if (!timestamp) continue;
    const status = action.safe_error_code === "ACCOUNT_BUSY" ? "BLOCKED" : action.status === "APPROVED" ? "PENDING" : action.status === "EXECUTING" ? "SENDING" : action.status;
    messages.push({ id: `action:${action.id}`, conversationId, channelType, direction: "OUTBOUND", senderExternalId: row.channel_account_id,
      text: text(action.text_content), timestamp, providerMessageId: typeof action.provider_message_id === "string" ? action.provider_message_id : `action:${action.id}`,
      attachmentCount: Array.isArray(action.attachment_ids) ? action.attachment_ids.length : 0, attachments: [],
      deliveryStatus: status as OmnichannelInboxMessage["deliveryStatus"], actionId: action.id,
      reconciliationStatus: ["NONE","NEEDS_REVIEW","ACKNOWLEDGED_NO_RETRY"].includes(String(action.reconciliation_status)) ? action.reconciliation_status as OmnichannelInboxMessage["reconciliationStatus"] : undefined });
  }
  messages.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  let legacyEmailThreadId: string | null = null;
  const legacyEmailAccountId = text(channelAccount.legacy_email_account_id);
  if (channelType === "EMAIL" && legacyEmailAccountId) {
    const { data: legacyThread, error: legacyThreadError } = await accountClient.from("email_threads").select("id")
      .eq("workspace_id", accountContext.workspaceId).eq("email_account_id", legacyEmailAccountId)
      .eq("provider_thread_id", row.provider_conversation_id).maybeSingle();
    if (legacyThreadError) return { status: "error", conversation: null };
    legacyEmailThreadId = text(legacyThread?.id);
  }
  const tagIds = (tagRows ?? []).flatMap((tag) => typeof tag.tag_id === "string" ? [tag.tag_id] : []);
  const sendAs = channelType === "ZALO" ? await zaloGroupSendAs(accountClient, accountContext.workspaceId, row.id, text(row.subject)) : [];
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
      avatarUrl: metadataAvatar(row.metadata),
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
      pendingActions,
      legacyEmailAccountId,
      legacyEmailThreadId,
      sendAs,
    },
  };
}
