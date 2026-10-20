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
import type { ZaloSendLock } from "@/modules/channels/core/send-locks";
import { toMessageReactions, type MessageReaction } from "@/modules/channels/core/zalo-reactions";

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
async function zaloGroupSendAs(client: ReturnType<typeof createPrivilegedClient>, workspaceId: string, conversationId: string, groupName: string | null, groupKey: string | null = null) {
  if (!groupKey && (!groupName || !normalizeGroupName(groupName))) return [];
  const { data: isGroup } = await client.rpc("is_zalo_group_conversation", { p_conversation_id: conversationId });
  if (isGroup !== true) return [];
  // Every named Zalo chat (only groups carry a name), page by page; names are compared after normalizing.
  const copies: Array<{ id: unknown; channel_account_id: unknown; subject: unknown }> = [];
  // Known identity (the copies share messages): exactly those copies, whatever each nick calls the group.
  if (groupKey) {
    const { data, error } = await client.from("omnichannel_conversations").select("id,channel_account_id,subject")
      .eq("workspace_id", workspaceId).eq("channel_type", "ZALO").eq("metadata->>zaloGroupKey", groupKey)
      .or("metadata->>hidden.is.null,metadata->>hidden.neq.true").limit(100);
    if (error) return [];
    copies.push(...(data ?? []));
  } else for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await client.from("omnichannel_conversations").select("id,channel_account_id,subject")
      .eq("workspace_id", workspaceId).eq("channel_type", "ZALO").not("subject", "is", null)
      .or("metadata->>hidden.is.null,metadata->>hidden.neq.true").order("id").range(from, from + 999);
    if (error) return [];
    copies.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const named = copies.filter((copy) => typeof copy.id === "string" && typeof copy.channel_account_id === "string"
    && (groupKey ? true : typeof copy.subject === "string" && normalizeGroupName(copy.subject) === normalizeGroupName(groupName)));
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

/**
 * The Page's inbox in Meta Business Suite. Replies sent there are not limited by the 24-hour window that applies
 * to HireX (Meta's Send API). Business Suite cannot open a chat from the customer's Page-scoped id (it shows
 * "Đã xảy ra lỗi"), so the link opens the Page inbox and the member picks the customer there.
 */
export function businessSuiteInboxUrl(pageId: string | null) {
  if (!pageId || !/^\d{1,30}$/.test(pageId)) return null;
  return `https://business.facebook.com/latest/inbox/all/?${new URLSearchParams({ asset_id: pageId }).toString()}`;
}

/**
 * Zalo group: member names/avatars as this nick sees them (synced from Deplao, read under row security so only
 * nicks the member may use), plus our own nicks by their Zalo id. Empty for one-to-one chats.
 */
async function zaloGroupParticipants(client: Awaited<ReturnType<typeof createClient>>, accountClient: ReturnType<typeof createPrivilegedClient>,
  workspaceId: string, channelAccountId: string, groupId: string, senderIds: string[]) {
  // member: listed in this group as this nick sees it (only these ids can be tagged).
  const people: Record<string, { name: string; avatarUrl: string | null; member?: boolean }> = {};
  const { data: members } = await client.from("zalo_group_members").select("member_id,display_name,avatar_url")
    .eq("workspace_id", workspaceId).eq("channel_account_id", channelAccountId).eq("group_id", groupId).limit(3000);
  if (!members?.length) return people;
  for (const member of members) if (typeof member.member_id === "string" && typeof member.display_name === "string")
    people[member.member_id] = { name: member.display_name, avatarUrl: typeof member.avatar_url === "string" ? member.avatar_url : null, member: true };
  // Someone who wrote here but is not in this group's list may be known to the same nick from another group.
  const missing = [...new Set(senderIds)].filter((id) => /^[0-9]{1,40}$/.test(id) && !people[id]).slice(0, 200);
  if (missing.length) {
    const { data: elsewhere } = await client.from("zalo_group_members").select("member_id,display_name,avatar_url")
      .eq("workspace_id", workspaceId).eq("channel_account_id", channelAccountId).in("member_id", missing).limit(1000);
    for (const member of elsewhere ?? []) if (typeof member.member_id === "string" && typeof member.display_name === "string" && !people[member.member_id])
      people[member.member_id] = { name: member.display_name, avatarUrl: typeof member.avatar_url === "string" ? member.avatar_url : null };
  }
  const { data: nicks } = await accountClient.from("channel_accounts").select("external_account_id,display_name")
    .eq("workspace_id", workspaceId).eq("channel_type", "ZALO").is("deleted_at", null);
  for (const nick of nicks ?? []) if (typeof nick.external_account_id === "string" && typeof nick.display_name === "string" && !people[nick.external_account_id])
    people[nick.external_account_id] = { name: nick.display_name, avatarUrl: null };
  return people;
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
    accountClient.from("channel_accounts").select("id,display_name,status,operator_enabled,provider_health_status,provider_health_checked_at,legacy_email_account_id,external_account_id,primary_profile_id").eq("id", row.channel_account_id).eq("workspace_id", accountContext.workspaceId).eq("channel_type", channelType).is("deleted_at", null).maybeSingle(),
    accountClient.from("omnichannel_messages").select("id,conversation_id,channel_type,direction,sender_external_id,text_content,provider_message_id,attachment_count,received_at,sent_at,created_at,metadata").eq("workspace_id", accountContext.workspaceId).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(MAX_MESSAGES + 1),
    accountClient.from("conversation_tag_links").select("tag_id").eq("workspace_id", accountContext.workspaceId).eq("conversation_id", conversationId),
    accountClient.from("channel_outbound_actions").select("id,text_content,proposed_by,status,attempt_count,created_at,updated_at,provider_message_id,attachment_ids,safe_error_code,reconciliation_status,idempotency_key").eq("workspace_id", accountContext.workspaceId).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(MAX_MESSAGES),
    typeof row.contact_id === "string" ? accountClient.from("contacts").select("full_name").eq("workspace_id", accountContext.workspaceId).eq("id", row.contact_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (accountError || messageError || !channelAccount) return { status: "error", conversation: null };
  const ownerId = text((channelAccount as Record<string, unknown>).primary_profile_id);
  // The lookups below do not depend on each other: they start together and are awaited once (fewer round trips).
  const ownerNamePromise = ownerId && ownerId !== accountContext.userId
    ? Promise.resolve(accountClient.from("profiles").select("full_name").eq("id", ownerId).eq("workspace_id", accountContext.workspaceId).maybeSingle()).then((result) => text(result.data?.full_name))
    : Promise.resolve(null);
  const legacyEmailAccountId = text(channelAccount.legacy_email_account_id);
  const legacyThreadPromise = channelType === "EMAIL" && legacyEmailAccountId
    ? Promise.resolve(accountClient.from("email_threads").select("id").eq("workspace_id", accountContext.workspaceId).eq("email_account_id", legacyEmailAccountId)
      .eq("provider_thread_id", row.provider_conversation_id).maybeSingle())
    : Promise.resolve({ data: null, error: null });
  const lockPromise = channelType === "ZALO"
    ? Promise.resolve(accountClient.from("zalo_account_send_locks").select("reason,locked_since,auto_release_at,conversation_id")
      .eq("workspace_id", accountContext.workspaceId).eq("channel_account_id", row.channel_account_id).maybeSingle()).then((result) => result.data)
    : Promise.resolve(null);
  const sendAsPromise = channelType === "ZALO"
    ? zaloGroupSendAs(accountClient, accountContext.workspaceId, row.id, text(row.subject),
      row.metadata && typeof row.metadata === "object" && typeof (row.metadata as Record<string, unknown>).zaloGroupKey === "string" ? (row.metadata as Record<string, unknown>).zaloGroupKey as string : null)
    : Promise.resolve([]);
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
  const attachmentsPromise = (async (): Promise<boolean> => {
  if (messageIds.length > 0) {
    const { data: links, error: linkError } = await accountClient.from("channel_message_attachments")
      .select("message_id,attachment_id,position").eq("workspace_id", accountContext.workspaceId)
      .in("message_id", messageIds).order("position", { ascending: true });
    if (linkError) return false;
    const attachmentIds = [...new Set((links ?? []).flatMap((link) => typeof link.attachment_id === "string" ? [link.attachment_id] : []))];
    const attachmentById = new Map<string, { id: string; filename: string; contentType: string; sizeBytes: number; downloadUrl: string }>();
    const shaById = new Map<string, string>();
    if (attachmentIds.length > 0) {
      const { data: stored, error: storedError } = await accountClient.from("channel_attachments")
        .select("id,filename,content_type,size_bytes,sha256").eq("workspace_id", accountContext.workspaceId).in("id", attachmentIds);
      if (storedError) return false;
      for (const item of stored ?? []) if (typeof item.id === "string" && typeof item.sha256 === "string") shaById.set(item.id, item.sha256);
      for (const item of stored ?? []) {
        if (typeof item.id !== "string" || typeof item.filename !== "string" || typeof item.content_type !== "string" || !Number.isSafeInteger(item.size_bytes))
          return false;
        attachmentById.set(item.id, { id: item.id, filename: item.filename, contentType: item.content_type,
          sizeBytes: item.size_bytes, downloadUrl: `/api/inbox/attachments/${item.id}` });
      }
    }
    const storedByMessage = new Map<string, OmnichannelInboxMessage["attachments"]>();
    for (const link of links ?? []) {
      if (typeof link.message_id !== "string" || typeof link.attachment_id !== "string" || !Number.isSafeInteger(link.position))
        return false;
      const attachment = attachmentById.get(link.attachment_id);
      if (!attachment) return false;
      const current = storedByMessage.get(link.message_id) ?? [];
      const sha = shaById.get(link.attachment_id);
      if (sha && current.some((item) => item.id && shaById.get(item.id) === sha)) continue;
      current.push(attachment);
      storedByMessage.set(link.message_id, current);
    }
    for (const message of messages) {
      const stored = storedByMessage.get(message.id);
      if (stored) message.attachments = stored;
    }
  }
  return true;
  })();
  const proposedActions = (actionRows ?? []).flatMap((action) => action.status === "PROPOSED" && typeof action.id === "string" && typeof action.proposed_by === "string" ? [{ id: action.id, text: text(action.text_content), proposedBy: action.proposed_by }] : []);
  const pendingActions = (actionRows ?? []).flatMap((action) => action.status === "APPROVED" && action.attempt_count === 0 && typeof action.id === "string" ? [{ id: action.id, text: text(action.text_content) }] : []).slice(-1);
  const persistedProviderIds = new Set(messages.map(message => message.providerMessageId));
  const successfullyRetriedKeys = new Set((actionRows ?? []).flatMap((action) => {
    if (action.status !== "SENT" || typeof action.idempotency_key !== "string") return [];
    const marker = action.idempotency_key.indexOf(":retry:");
    return marker > 0 ? [action.idempotency_key.slice(0, marker)] : [];
  }));
  // Files of replies still being sent (or that failed) show with their name and a download link.
  const actionFileIds = [...new Set((actionRows ?? []).flatMap((action) => ["APPROVED", "EXECUTING", "FAILED", "DELIVERY_UNKNOWN"].includes(String(action.status)) && Array.isArray(action.attachment_ids)
    ? action.attachment_ids.filter((id: unknown): id is string => typeof id === "string") : []))];
  const actionFiles = new Map<string, OmnichannelInboxMessage["attachments"][number]>();
  const [attachmentsOk, { data: stored }, { data: legacyThread, error: legacyThreadError }, lockRow, accountOwnerName, sendAs] = await Promise.all([
    attachmentsPromise,
    actionFileIds.length > 0 ? Promise.resolve(accountClient.from("channel_attachments").select("id,filename,content_type,size_bytes")
      .eq("workspace_id", accountContext.workspaceId).in("id", actionFileIds)) : Promise.resolve({ data: [] as Array<{ id: unknown; filename: unknown; content_type: unknown; size_bytes: unknown }> }),
    legacyThreadPromise, lockPromise, ownerNamePromise, sendAsPromise,
  ]);
  if (!attachmentsOk || legacyThreadError) return { status: "error", conversation: null };
  {
    for (const item of stored ?? []) if (typeof item.id === "string" && typeof item.filename === "string" && typeof item.content_type === "string" && Number.isSafeInteger(item.size_bytes))
      actionFiles.set(item.id, { id: item.id, filename: item.filename, contentType: item.content_type, sizeBytes: item.size_bytes, downloadUrl: `/api/inbox/attachments/${item.id}` });
  }
  for (const action of actionRows ?? []) {
    if (!["APPROVED", "EXECUTING", "FAILED", "DELIVERY_UNKNOWN"].includes(String(action.status)) || typeof action.id !== "string") continue;
    if (action.safe_error_code === "ACCOUNT_BUSY" && typeof action.idempotency_key === "string" && successfullyRetriedKeys.has(action.idempotency_key)) continue;
    if (typeof action.provider_message_id === "string" && persistedProviderIds.has(action.provider_message_id)) continue;
    const timestamp = text(action.updated_at) ?? text(action.created_at);
    if (!timestamp) continue;
    const status = action.safe_error_code === "ACCOUNT_BUSY" ? "BLOCKED" : action.status === "APPROVED" ? "PENDING" : action.status === "EXECUTING" ? "SENDING" : action.status;
    messages.push({ id: `action:${action.id}`, conversationId, channelType, direction: "OUTBOUND", senderExternalId: row.channel_account_id,
      text: text(action.text_content), timestamp, providerMessageId: typeof action.provider_message_id === "string" ? action.provider_message_id : `action:${action.id}`,
      attachmentCount: Array.isArray(action.attachment_ids) ? action.attachment_ids.length : 0,
      attachments: Array.isArray(action.attachment_ids) ? action.attachment_ids.flatMap((id: unknown) => typeof id === "string" && actionFiles.has(id) ? [actionFiles.get(id)!] : []) : [],
      deliveryStatus: status as OmnichannelInboxMessage["deliveryStatus"], actionId: action.id,
      reconciliationStatus: ["NONE","NEEDS_REVIEW","ACKNOWLEDGED_NO_RETRY"].includes(String(action.reconciliation_status)) ? action.reconciliation_status as OmnichannelInboxMessage["reconciliationStatus"] : undefined });
  }
  messages.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const legacyEmailThreadId = text(legacyThread?.id);
  const tagIds = (tagRows ?? []).flatMap((tag) => typeof tag.tag_id === "string" ? [tag.tag_id] : []);
  // Group members, reactions (❤️ 👍 ...) and quoted replies, together (reactions are synced from Deplao by sync-zalo-reactions.mjs).
  const zaloIds = channelType === "ZALO" ? [...new Set(messages.map((message) => message.providerMessageId).filter((id) => /^[0-9]{1,40}$/u.test(id)))].slice(0, 500) : [];
  const [participants, { data: reactionRows }, { data: quoteRows }] = await Promise.all([
    channelType === "ZALO" ? zaloGroupParticipants(supabase, accountClient, accountContext.workspaceId, row.channel_account_id, row.provider_conversation_id,
      messages.flatMap((message) => message.direction === "INBOUND" ? [message.senderExternalId] : [])) : Promise.resolve({}),
    zaloIds.length ? Promise.resolve(accountClient.from("zalo_message_reactions").select("provider_message_id,summary,mine")
      .eq("workspace_id", accountContext.workspaceId).eq("channel_account_id", row.channel_account_id).in("provider_message_id", zaloIds)) : Promise.resolve({ data: [] as Array<{ provider_message_id: unknown; summary: unknown; mine: unknown }> }),
    zaloIds.length ? Promise.resolve(accountClient.from("zalo_message_quotes").select("provider_message_id,quoted_message_id,quoted_text,quoted_sender")
      .eq("workspace_id", accountContext.workspaceId).eq("channel_account_id", row.channel_account_id).in("provider_message_id", zaloIds)) : Promise.resolve({ data: [] as Array<{ provider_message_id: unknown; quoted_message_id: unknown; quoted_text: unknown; quoted_sender: unknown }> }),
  ]);
  if (zaloIds.length > 0) {
    {
      const byId = new Map<string, MessageReaction[]>((reactionRows ?? []).map((reaction): [string, MessageReaction[]] => [String(reaction.provider_message_id), toMessageReactions(reaction.summary, reaction.mine)]));
      for (const message of messages) { const reactions = byId.get(message.providerMessageId); if (reactions?.length) message.reactions = reactions; }
      // Which earlier message each reply quoted (shown above the reply, like Zalo).
      const quoteById = new Map<string, NonNullable<OmnichannelInboxMessage["quote"]>>((quoteRows ?? []).map((quote): [string, NonNullable<OmnichannelInboxMessage["quote"]>] => [String(quote.provider_message_id),
        { text: String(quote.quoted_text ?? ""), sender: text(quote.quoted_sender), messageId: text(quote.quoted_message_id) }]));
      for (const message of messages) { const quote = quoteById.get(message.providerMessageId); if (quote?.text) message.quote = quote; }
    }
  }
  // A nick locked by an unsettled send cannot send; the composer says so (see reconcile-zalo-send-locks.mjs).
  const sendLock: ZaloSendLock | null = lockRow && (lockRow.reason === "DELIVERY_UNKNOWN" || lockRow.reason === "SENDING") && typeof lockRow.locked_since === "string"
    ? { channelAccountId: row.channel_account_id, accountName: text(channelAccount.display_name) ?? "Nick Zalo", reason: lockRow.reason,
      lockedSince: lockRow.locked_since, autoReleaseAt: text(lockRow.auto_release_at), conversationId: text(lockRow.conversation_id) }
    : null;
  return {
    status: "ready",
    conversation: {
      id: row.id,
      channelAccountId: row.channel_account_id,
      channelType,
      accountDisplayName: text(channelAccount.display_name) ?? "Tài khoản chưa đặt tên",
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
      accountExternalId: text(channelAccount.external_account_id),
      participants,
      businessSuiteUrl: channelType === "FACEBOOK" ? businessSuiteInboxUrl(text(channelAccount.external_account_id)) : null,
      sendLock,
      accountOwnerName,
    },
  };
}
