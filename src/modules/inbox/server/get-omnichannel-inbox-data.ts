import "server-only";

import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { CHANNEL_ACCOUNT_STATUSES, CHANNEL_TYPES, type ChannelType } from "@/modules/channels/core/channel-contracts";
import { PROVIDER_HEALTH_STATUSES, type ProviderHealthStatus } from "@/modules/channels/core/provider-health";
import { CONVERSATION_STATUSES, TAKEOVER_MODES } from "@/modules/channels/core/conversation-policy";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { safeInboxPreview } from "../core/safe-preview";
import { zaloProviderDisplayText } from "../core/zalo-provider-display-text";
import { isFacebookProfileSystemPlaceholder } from "../core/facebook-profile-system-text";
import type { OmnichannelInboxAccount, OmnichannelInboxConversation, OmnichannelInboxData } from "../types/omnichannel-inbox";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";
import { loadChannelAdapterByAccountId } from "@/modules/channels/server/load-channel-adapter";
import { isAutomatedSender, isGroupConversation, isZaloGroupThread } from "@/modules/assistant/core/assistant-tools";
import { ambiguousGroupKeys, groupKeyOf, mergeGroupCopies } from "@/modules/inbox/core/group-merge";
import { FacebookPageAdapter } from "@/modules/channels/adapters/facebook/facebook-adapter";

// Keep the first paint compact. The conversation list is paginated and realtime
// updates still bring newly active threads to the top.
const PAGE_SIZE = 50;
const ZALO_HEALTH_REFRESH_MS = 60 * 1000;

interface AccountRow {
  id: unknown; channel_type: unknown; display_name: unknown; status: unknown;
  operator_enabled: unknown; provider_health_status: unknown; provider_health_checked_at: unknown;
}
interface ConversationRow {
  id: unknown; channel_account_id: unknown; channel_type: unknown; contact_id: unknown; subject: unknown;
  provider_conversation_id: unknown; status: unknown; takeover_mode: unknown; assigned_to: unknown; last_message_at: unknown; unread_count: unknown; metadata: unknown;
}
interface MessageRow {
  conversation_id: unknown; direction: unknown; sender_external_id: unknown; text_content: unknown;
  received_at: unknown; sent_at: unknown; created_at: unknown;
}
interface PreviewRow extends MessageRow { last_inbound_at: unknown }
interface ContactRow { id: unknown; full_name: unknown }
interface ProfileRow { id: unknown; full_name: unknown; all_channel_accounts: unknown }
interface ProfileChannelAccessRow { profile_id: unknown; channel_account_id: unknown }
interface TagRow { id: unknown; name: unknown; color: unknown }
interface TagLinkRow { conversation_id: unknown; tag_id: unknown }
interface FirstMessageRow { conversation_id: unknown; first_message_at: unknown }
interface ActionRow { id: unknown; conversation_id: unknown; text_content: unknown; proposed_by: unknown }

const loadStableInboxMetadata = unstable_cache(async (workspaceId: string) => {
  const client = createPrivilegedClient();
  const [{ data: profiles }, { data: tags }, { data: access }] = await Promise.all([
    client.from("profiles").select("id,full_name,all_channel_accounts").eq("workspace_id", workspaceId).order("full_name"),
    client.from("conversation_tags").select("id,name,color").eq("workspace_id", workspaceId).order("name"),
    client.from("profile_channel_account_access").select("profile_id,channel_account_id").eq("workspace_id", workspaceId),
  ]);
  return { profiles: profiles ?? [], tags: tags ?? [], access: access ?? [] };
}, ["stable-inbox-metadata"], { revalidate: 60, tags: ["inbox-metadata"] });

type StableMetadata = Awaited<ReturnType<typeof loadStableInboxMetadata>>;
type InboxAccountContext = NonNullable<Awaited<ReturnType<typeof getAccountContext>>>;

/** Members (owner filter / assignee list) and tags the current member may see. */
function peopleAndTags(stableMetadata: StableMetadata, accountContext: InboxAccountContext, accessibleAccountIds: string[] | null) {
  const profileData = stableMetadata.profiles;
  const tagData = stableMetadata.tags;
  const profileAccessData = stableMetadata.access;
  const accessIdsByProfile = new Map<string, string[]>();
  for (const row of (profileAccessData ?? []) as ProfileChannelAccessRow[]) {
    if (typeof row.profile_id !== "string" || typeof row.channel_account_id !== "string") continue;
    accessIdsByProfile.set(row.profile_id, [...(accessIdsByProfile.get(row.profile_id) ?? []), row.channel_account_id]);
  }
  const canBrowseOwners = accountContext.permissions.includes("roles.view");
  const profiles = ((profileData ?? []) as ProfileRow[]).flatMap((row) => {
    if (typeof row.id !== "string" || typeof row.full_name !== "string") return [];
    const channelAccountIds = accessIdsByProfile.get(row.id) ?? [];
    const isCurrentUser = row.id === accountContext.userId;
    const overlapsCurrentScope = accessibleAccountIds === null
      || (row.all_channel_accounts !== true && channelAccountIds.some((id) => accessibleAccountIds.includes(id)));
    // Ordinary members only need their own owner option. Members allowed to
    // inspect roles may compare owners, but never outside their account scope.
    if (!isCurrentUser && (!canBrowseOwners || !overlapsCurrentScope)) return [];
    return [{ id: row.id, fullName: row.full_name, allChannelAccounts: row.all_channel_accounts === true, channelAccountIds }];
  });
  const tags = ((tagData ?? []) as TagRow[]).flatMap((row) => typeof row.id === "string" && typeof row.name === "string" ? [{ id: row.id, name: row.name, color: typeof row.color === "string" ? row.color : null }] : []);
  return { profiles, tags };
}

/** Members and tags for the conversation detail, without loading the whole conversation list. */
export async function getInboxPeopleAndTags() {
  const accountContext = await getAccountContext();
  if (!accountContext?.workspaceId) return { profiles: [], tags: [] };
  const [accessibleAccountIds, stableMetadata] = await Promise.all([getAccessibleChannelAccountIds(), loadStableInboxMetadata(accountContext.workspaceId)]);
  return peopleAndTags(stableMetadata, accountContext, accessibleAccountIds);
}

/**
 * Every named Zalo chat (only groups carry a name) with its nick, page by page. Used to spot a name one nick
 * has twice; names are compared after normalizing (spacing, letter case), so exact-text matching is not used.
 */
async function loadNamedZaloChats(client: Awaited<ReturnType<typeof createClient>>, workspaceId: string) {
  const rows: Array<{ subject: unknown; channel_account_id: unknown }> = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await client.from("omnichannel_conversations").select("subject,channel_account_id")
      .eq("workspace_id", workspaceId).eq("channel_type", "ZALO").not("subject", "is", null)
      .or("metadata->>hidden.is.null,metadata->>hidden.neq.true").order("id").range(from, from + 999);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return { data: rows, error: null };
}

async function loadTagLinks(client: Awaited<ReturnType<typeof createClient>>, conversationIds: string[]) {
  const rows: TagLinkRow[] = [];
  const batchSize = 75;
  for (let offset = 0; offset < conversationIds.length; offset += batchSize) {
    const batch = conversationIds.slice(offset, offset + batchSize);
    const { data, error } = await client.from("conversation_tag_links")
      .select("conversation_id,tag_id").in("conversation_id", batch);
    if (error) return { data: null, error };
    rows.push(...((data ?? []) as TagLinkRow[]));
  }
  return { data: rows, error: null };
}

function healthLabel(row: AccountRow, channelType: ChannelType): string {
  if (row.operator_enabled === false) return "Disabled";
  if (row.status !== "CONNECTED") return row.status === "REAUTH_REQUIRED" ? "Reconnect required" : row.status === "ERROR" ? "Error" : "Disconnected";
  if (channelType === "EMAIL") return "Connected";
  if (typeof row.provider_health_status !== "string" || !PROVIDER_HEALTH_STATUSES.includes(row.provider_health_status as ProviderHealthStatus)) return "Health unavailable";
  if (channelType === "ZALO" || channelType === "FACEBOOK_PROFILE") {
    const checkedAt = typeof row.provider_health_checked_at === "string" ? Date.parse(row.provider_health_checked_at) : Number.NaN;
    if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > 5 * 60 * 1000) return "Disconnected";
  }
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

async function refreshStaleBridgeHealth(rows: AccountRow[], workspaceId: string): Promise<void> {
  const client = createPrivilegedClient();
  const now = Date.now();
  await Promise.all(rows.map(async (row) => {
    if (!["ZALO","FACEBOOK_PROFILE"].includes(String(row.channel_type)) || row.status !== "CONNECTED" || row.operator_enabled === false || typeof row.id !== "string") return;
    const previousCheck = typeof row.provider_health_checked_at === "string" ? Date.parse(row.provider_health_checked_at) : Number.NaN;
    if (Number.isFinite(previousCheck) && now - previousCheck < ZALO_HEALTH_REFRESH_MS) return;

    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    let health: ProviderHealthStatus = "UNKNOWN";
    try {
      const loaded = await loadChannelAdapterByAccountId(row.id);
      const result = await loaded.adapter.healthCheck();
      if (PROVIDER_HEALTH_STATUSES.includes(result as ProviderHealthStatus)) health = result as ProviderHealthStatus;
    } catch {
      health = "UNKNOWN";
    }
    await client.rpc("record_channel_account_provider_health", {
      p_workspace_id: workspaceId,
      p_channel_account_id: row.id,
      p_status: health,
      p_checked_at: checkedAt,
      p_safe_reason_code: health === "HEALTHY" ? null : health,
      p_latency_ms: Math.min(Date.now() - startedAt, 60_000),
    });
    row.provider_health_status = health;
    row.provider_health_checked_at = checkedAt;
  }));
}

function participantName(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const values = ["conversationDisplayName", "groupName", "threadName", "participantDisplayName"]
    .map((key) => (metadata as Record<string, unknown>)[key]);
  const value = values.find((item) => typeof item === "string" && item.trim());
  return typeof value === "string" ? value.trim() : null;
}
function preference(metadata:unknown,key:string){return Boolean(metadata&&typeof metadata==="object"&&!Array.isArray(metadata)&&(metadata as Record<string,unknown>)[key]===true)}
function conversationFolder(metadata:unknown):"PRIMARY"|"OTHER"{return metadata&&typeof metadata==="object"&&!Array.isArray(metadata)&&(metadata as Record<string,unknown>).folder==="OTHER"?"OTHER":"PRIMARY"}

function missingFacebookName(row: ConversationRow): boolean {
  const name = participantName(row.metadata);
  return row.channel_type === "FACEBOOK" && (!name || /^\d+$/u.test(name));
}

async function refreshMissingFacebookNames(rows: ConversationRow[]): Promise<void> {
  const pending = rows.filter((row) => missingFacebookName(row) && typeof row.id === "string" && typeof row.channel_account_id === "string" && typeof row.provider_conversation_id === "string" && /^\d+$/u.test(row.provider_conversation_id)).slice(0, 30);
  if (!pending.length) return;
  const client = createPrivilegedClient();
  const adapters = new Map<string, FacebookPageAdapter | null>();
  for (const row of pending) {
    const accountId = row.channel_account_id as string;
    if (!adapters.has(accountId)) {
      try {
        const loaded = await loadChannelAdapterByAccountId(accountId);
        adapters.set(accountId, loaded.adapter instanceof FacebookPageAdapter ? loaded.adapter : null);
      } catch { adapters.set(accountId, null); }
    }
    const adapter = adapters.get(accountId);
    if (!adapter) continue;
    const externalId = row.provider_conversation_id as string;
    const name = await adapter.resolveParticipantName(externalId);
    if (!name) continue;
    const previous = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {};
    const metadata = { ...previous, participantExternalId: externalId, participantDisplayName: name };
    const { error } = await client.from("omnichannel_conversations").update({ metadata }).eq("id", row.id as string).eq("channel_account_id", accountId);
    if (!error) row.metadata = metadata;
  }
}

function avatarUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).avatarUrl;
  if (typeof value !== "string" || value.length > 2048) return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.toString() : null; } catch { return null; }
}

function emptyData(input: {
  accounts?: OmnichannelInboxAccount[]; selectedChannelType: ChannelType | null; selectedAccountId?: string | null;
  selectedOwnerIds?: string[];
  selectedPage: number; profiles?: OmnichannelInboxData["profiles"]; tags?: OmnichannelInboxData["tags"];
  selectedTagIds?: string[]; tagMatchMode?: "all" | "any"; firstMessageFrom?: string | null; firstMessageTo?: string | null; error: string;
}): OmnichannelInboxData {
  return { workspaceId: null, currentUserId: null, accounts: input.accounts ?? [], conversations: [], profiles: input.profiles ?? [], tags: input.tags ?? [], selectedChannelType: input.selectedChannelType, selectedChannelTypes: input.selectedChannelType ? [input.selectedChannelType] : [], channelParam: input.selectedChannelType, selectedAccountId: input.selectedAccountId ?? null, selectedOwnerIds: input.selectedOwnerIds ?? [], selectedTagIds: input.selectedTagIds ?? [], tagMatchMode: input.tagMatchMode ?? "all", firstMessageFrom: input.firstMessageFrom ?? null, firstMessageTo: input.firstMessageTo ?? null, selectedPage: input.selectedPage, hasPreviousPage: input.selectedPage > 1, hasNextPage: false, error: input.error };
}

export async function getOmnichannelInboxData(filters: { channelType?: string | string[]; accountId?: string; ownerIds?: string[]; page?: string; tagIds?: string[]; tagMatchMode?: string; firstMessageFrom?: string; firstMessageTo?: string }): Promise<OmnichannelInboxData> {
  // Several channels may be picked at once: ?channel=ZALO,EMAIL (repeated ?channel= works too).
  const selectedChannelTypes = [...new Set((Array.isArray(filters.channelType) ? filters.channelType : [filters.channelType ?? ""]).flatMap((value) => value.split(",")).map((value) => value.trim()).filter((value): value is ChannelType => CHANNEL_TYPES.includes(value as ChannelType)))];
  const selectedChannelType = selectedChannelTypes.length === 1 ? selectedChannelTypes[0] : null;
  const channelParam = selectedChannelTypes.length ? selectedChannelTypes.join(",") : null;
  const requestedPage = Number(filters.page ?? "1");
  const selectedPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100) : 1;
  const requestedTagIds = [...new Set((filters.tagIds ?? []).filter(isUuid))].slice(0, 50);
  const requestedOwnerIds = [...new Set((filters.ownerIds ?? []).filter(isUuid))].slice(0, 50);
  const tagMatchMode = filters.tagMatchMode === "any" ? "any" : "all";
  const firstMessageFrom = validDate(filters.firstMessageFrom) ? filters.firstMessageFrom! : null;
  const firstMessageTo = validDate(filters.firstMessageTo) ? filters.firstMessageTo! : null;
  const accountContext = await getAccountContext();
  if (!accountContext?.workspaceId) return emptyData({ selectedChannelType, selectedPage, error: "Inbox could not be loaded." });
  const supabase = await createClient();
  const accountClient = createPrivilegedClient();
  const [accessibleAccountIds, stableMetadata] = await Promise.all([getAccessibleChannelAccountIds(), loadStableInboxMetadata(accountContext.workspaceId)]);
  if(accessibleAccountIds?.length===0)return emptyData({selectedChannelType,selectedPage,error:"Bạn chưa được cấp tài khoản Email, Facebook hoặc Zalo nào."});
  let accountQuery=accountClient.from("channel_accounts").select("id,channel_type,display_name,status,operator_enabled,provider_health_status,provider_health_checked_at").eq("workspace_id", accountContext.workspaceId).is("deleted_at", null).order("channel_type").order("display_name");
  if(accessibleAccountIds)accountQuery=accountQuery.in("id",accessibleAccountIds);
  const { data: accountData, error: accountError } = await accountQuery;
  const { profiles, tags } = peopleAndTags(stableMetadata, accountContext, accessibleAccountIds);
  const availableTagIds = new Set(tags.map((tag) => tag.id));
  const selectedTagIds = requestedTagIds.filter((id) => availableTagIds.has(id));
  if (accountError) return emptyData({ selectedChannelType, selectedPage, profiles, tags, error: "Omnichannel Inbox is not available yet." });
  const accountRows = (accountData ?? []) as AccountRow[];
  // Provider checks are best-effort background work. Never hold up the inbox UI on an external bridge.
  void refreshStaleBridgeHealth(accountRows, accountContext.workspaceId).catch(() => undefined);
  const mappedAccounts = accountRows.map(mapAccount);
  if (mappedAccounts.some((item) => !item)) return emptyData({ selectedChannelType, selectedPage, profiles, tags, error: "Inbox account data is unavailable." });
  const accounts = mappedAccounts as OmnichannelInboxAccount[];
  const activeAccountIds = accounts.map((account) => account.id);
  if (activeAccountIds.length === 0) return { ...emptyData({ selectedChannelType, selectedPage, profiles, tags, error: "" }), workspaceId: accountContext.workspaceId, currentUserId: accountContext.userId, error: null };
  const requestedAccount = filters.accountId ? accounts.find((account) => account.id === filters.accountId) : undefined;
  const selectedAccountId = requestedAccount && (selectedChannelTypes.length === 0 || selectedChannelTypes.includes(requestedAccount.channelType)) ? requestedAccount.id : null;
  const availableOwnerIds = new Set(profiles.map((profile) => profile.id));
  const selectedOwnerIds = requestedOwnerIds.filter((id) => availableOwnerIds.has(id));
  const selectedOwnerProfiles = profiles.filter((profile) => selectedOwnerIds.includes(profile.id));
  const ownerAccountIds = selectedOwnerIds.length === 0 || selectedOwnerProfiles.some((profile) => profile.allChannelAccounts)
    ? activeAccountIds
    : activeAccountIds.filter((id) => selectedOwnerProfiles.some((profile) => profile.channelAccountIds.includes(id)));

  let query = supabase.from("omnichannel_conversations")
    .select("id,channel_account_id,channel_type,contact_id,subject,provider_conversation_id,status,takeover_mode,assigned_to,last_message_at,unread_count,metadata")
    .eq("workspace_id", accountContext.workspaceId)
    .or("metadata->>hidden.is.null,metadata->>hidden.neq.true")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .range((selectedPage - 1) * PAGE_SIZE, selectedPage * PAGE_SIZE);
  if (selectedChannelTypes.length) query = query.in("channel_type", selectedChannelTypes);
  if (selectedAccountId && ownerAccountIds.includes(selectedAccountId)) query = query.eq("channel_account_id", selectedAccountId);
  else if (selectedAccountId || ownerAccountIds.length === 0) query = query.eq("channel_account_id", "00000000-0000-0000-0000-000000000000");
  else query=query.in("channel_account_id",ownerAccountIds);
  const { data: conversationData, error: conversationError } = await query;
  if (conversationError) return emptyData({ accounts, selectedChannelType, selectedAccountId, selectedPage, profiles, tags, error: "Conversations could not be loaded." });
  const pageRows = conversationData as ConversationRow[];
  // Name enrichment may call Meta. Refresh it asynchronously so a slow provider cannot block rendering.
  void refreshMissingFacebookNames(pageRows.slice(0, PAGE_SIZE)).catch(() => undefined);
  const hasNextPage = pageRows.length > PAGE_SIZE;
  const rows = pageRows.slice(0, PAGE_SIZE);
  const ids = rows.flatMap((row) => typeof row.id === "string" ? [row.id] : []);
  const facebookProfileConversationIds = new Set(rows.flatMap((row) => row.channel_type === "FACEBOOK_PROFILE" && typeof row.id === "string" ? [row.id] : []));
  const contactIds = [...new Set(rows.flatMap((row) => typeof row.contact_id === "string" ? [row.contact_id] : []))];
  const latest = new Map<string, MessageRow>();
  const latestInbound = new Map<string, string>();
  const zaloGroupIds = new Set<string>();
  const contactNames = new Map<string, string>();
  const tagIdsByConversation = new Map<string, string[]>();
  const firstMessageAtByConversation = new Map<string, string>();
  const proposedByConversation = new Map<string, Array<{ id: string; text: string | null; proposedBy: string }>>();
  if (ids.length > 0) {
    const previewStartedAt = performance.now();
    const [{ data: previewData, error: previewError }, { data: tagLinkData }, { data: actionData }, contactResult, { data: firstMessageData }, { data: zaloGroupData }] = await Promise.all([
      supabase.rpc("get_inbox_conversation_previews", { p_conversation_ids: ids }),
      loadTagLinks(supabase, ids),
      supabase.from("channel_outbound_actions").select("id,conversation_id,text_content,proposed_by").in("conversation_id", ids).eq("status", "PROPOSED").order("created_at", { ascending: false }),
      contactIds.length ? supabase.from("contacts").select("id,full_name").eq("workspace_id", accountContext.workspaceId).in("id", contactIds) : Promise.resolve({ data: [] as ContactRow[] }),
      firstMessageFrom || firstMessageTo
        ? supabase.rpc("get_conversation_first_message_times", { p_conversation_ids: ids })
        : Promise.resolve({ data: [] as FirstMessageRow[] }),
      // Zalo groups (someone other than the thread wrote to us), in the same round trip as the previews.
      rows.some((row) => row.channel_type === "ZALO") ? supabase.rpc("get_inbox_zalo_group_ids", { p_conversation_ids: ids }) : Promise.resolve({ data: [] as string[] }),
    ]);
    for (const id of (zaloGroupData ?? []) as unknown[]) if (typeof id === "string") zaloGroupIds.add(id);
    if (previewError) console.warn("[slow-query] inbox preview RPC unavailable", { durationMs: Math.round(performance.now() - previewStartedAt), code: previewError.code });
    else if (performance.now() - previewStartedAt > 250) console.warn("[slow-query] inbox previews", { durationMs: Math.round(performance.now() - previewStartedAt), conversations: ids.length });
    for (const message of (previewData ?? []) as PreviewRow[]) {
      if (typeof message.conversation_id !== "string") continue;
      if (facebookProfileConversationIds.has(message.conversation_id) && isFacebookProfileSystemPlaceholder(message.text_content)) continue;
      if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, message);
      if (typeof message.last_inbound_at === "string") latestInbound.set(message.conversation_id, message.last_inbound_at);
    }
    for (const contact of (contactResult.data ?? []) as ContactRow[]) if (typeof contact.id === "string" && typeof contact.full_name === "string") contactNames.set(contact.id, contact.full_name);
    for (const link of (tagLinkData ?? []) as TagLinkRow[]) if (typeof link.conversation_id === "string" && typeof link.tag_id === "string") tagIdsByConversation.set(link.conversation_id, [...(tagIdsByConversation.get(link.conversation_id) ?? []), link.tag_id]);
    for (const item of (firstMessageData ?? []) as FirstMessageRow[]) if (typeof item.conversation_id === "string" && typeof item.first_message_at === "string") firstMessageAtByConversation.set(item.conversation_id, item.first_message_at);
    for (const action of (actionData ?? []) as ActionRow[]) if (typeof action.id === "string" && typeof action.conversation_id === "string" && typeof action.proposed_by === "string") proposedByConversation.set(action.conversation_id, [...(proposedByConversation.get(action.conversation_id) ?? []), { id: action.id, text: typeof action.text_content === "string" ? action.text_content : null, proposedBy: action.proposed_by }]);
  }
  const accountNames = new Map(accounts.map((account) => [account.id, account.displayName]));
  const conversations: OmnichannelInboxConversation[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || typeof row.channel_account_id !== "string" || typeof row.channel_type !== "string" || !CHANNEL_TYPES.includes(row.channel_type as ChannelType) || typeof row.status !== "string" || !CONVERSATION_STATUSES.includes(row.status as never) || typeof row.takeover_mode !== "string" || !TAKEOVER_MODES.includes(row.takeover_mode as never) || !Number.isSafeInteger(row.unread_count)) return emptyData({ accounts, selectedChannelType, selectedAccountId, selectedPage, profiles, tags, error: "Conversation data is unavailable." });
    const message = latest.get(row.id);
    const conversationTagIds = tagIdsByConversation.get(row.id) ?? [];
    if (selectedTagIds.length > 0) {
      const matches = tagMatchMode === "all"
        ? selectedTagIds.every((id) => conversationTagIds.includes(id))
        : selectedTagIds.some((id) => conversationTagIds.includes(id));
      if (!matches) continue;
    }
    if (firstMessageFrom || firstMessageTo) {
      const firstAt = firstMessageAtByConversation.get(row.id);
      if (!firstAt) continue;
      const timestamp = Date.parse(firstAt);
      if (!Number.isFinite(timestamp)) continue;
      if (firstMessageFrom && timestamp < startOfDate(firstMessageFrom)) continue;
      if (firstMessageTo && timestamp >= startOfNextDate(firstMessageTo)) continue;
    }
    conversations.push({
      id: row.id, channelAccountId: row.channel_account_id, channelType: row.channel_type as ChannelType,
      subject: safeInboxPreview(typeof row.subject === "string" ? row.subject : null), status: row.status as OmnichannelInboxConversation["status"],
      takeoverMode: row.takeover_mode as OmnichannelInboxConversation["takeoverMode"], assignedTo: typeof row.assigned_to === "string" ? row.assigned_to : null,
      lastMessageAt: typeof row.last_message_at === "string" ? row.last_message_at : null, unreadCount: row.unread_count as number,
      isPinned: preference(row.metadata,"appPinned"), isMuted: preference(row.metadata,"muted"), folder: conversationFolder(row.metadata),
      latestText: safeInboxPreview(row.channel_type === "ZALO" ? zaloProviderDisplayText(typeof message?.text_content === "string" ? message.text_content : null) : typeof message?.text_content === "string" ? message.text_content : null),
      latestDirection: message?.direction === "INBOUND" || message?.direction === "OUTBOUND" ? message.direction : null,
      senderExternalId: typeof message?.sender_external_id === "string" ? message.sender_external_id : null,
      contactName: typeof row.contact_id === "string" ? contactNames.get(row.contact_id) ?? null : null,
      participantName: participantName(row.metadata), avatarUrl: avatarUrl(row.metadata), accountDisplayName: accountNames.get(row.channel_account_id) ?? "Unknown account",
      lastInboundAt: latestInbound.get(row.id) ?? null, tagIds: conversationTagIds, proposedActions: proposedByConversation.get(row.id) ?? [],
      // Zalo one-to-one threads are keyed by the other person's id; a message from someone else means a group.
      automated: row.channel_type === "EMAIL" && isAutomatedSender(typeof message?.sender_external_id === "string" ? message.sender_external_id : null),
      isGroup: isGroupConversation(row.metadata) || zaloGroupIds.has(row.id) || isZaloGroupThread(row.channel_type, typeof row.provider_conversation_id === "string" ? row.provider_conversation_id : null, message?.direction === "INBOUND" && typeof message.sender_external_id === "string" ? message.sender_external_id : null),
      providerConversationId: typeof row.provider_conversation_id === "string" ? row.provider_conversation_id : null,
      groupKey: null, copyIds: [row.id], copyAccountIds: [row.channel_account_id],
    });
  }
  // A Zalo group several of our nicks are in is listed once; it opens the copy of the nick that last wrote there.
  const keyCounts = new Map<string, number>();
  for (const item of conversations) { const key = groupKeyOf(item); if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1); }
  const sharedCopyIds = conversations.flatMap((item) => { const key = groupKeyOf(item); return key && (keyCounts.get(key) ?? 0) > 1 ? [item.id] : []; });
  const lastOutboundAt = new Map<string, string>();
  // Names some nick has twice (two different groups) are never merged; checked over all conversations, not just this page.
  let ambiguous = new Set<string>();
  if (sharedCopyIds.length) {
    const [{ data: outboundData }, { data: sameNameData, error: sameNameError }] = await Promise.all([
      supabase.rpc("get_inbox_last_outbound_at", { p_conversation_ids: sharedCopyIds }),
      loadNamedZaloChats(supabase, accountContext.workspaceId),
    ]);
    for (const item of (outboundData ?? []) as Array<{ conversation_id?: unknown; last_outbound_at?: unknown }>)
      if (typeof item.conversation_id === "string" && typeof item.last_outbound_at === "string") lastOutboundAt.set(item.conversation_id, item.last_outbound_at);
    // Unknown means "do not merge".
    ambiguous = sameNameError ? new Set(sharedCopyIds.flatMap((id) => { const item = conversations.find((c) => c.id === id); const key = item ? groupKeyOf(item) : null; return key ? [key] : []; }))
      : ambiguousGroupKeys(((sameNameData ?? []) as Array<{ subject: unknown; channel_account_id: unknown }>).flatMap((item) =>
        typeof item.channel_account_id === "string" ? [{ subject: typeof item.subject === "string" ? item.subject : null, channelAccountId: item.channel_account_id }] : []));
  }
  const listed = mergeGroupCopies(conversations, lastOutboundAt, ambiguous);
  return { workspaceId: accountContext.workspaceId, currentUserId: accountContext.userId, accounts, conversations: listed, profiles, tags, selectedChannelType, selectedChannelTypes, channelParam, selectedAccountId, selectedOwnerIds, selectedTagIds, tagMatchMode, firstMessageFrom, firstMessageTo, selectedPage, hasPreviousPage: selectedPage > 1, hasNextPage, error: null };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function validDate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00+07:00`));
}
function startOfDate(value: string): number { return Date.parse(`${value}T00:00:00+07:00`); }
function startOfNextDate(value: string): number { return startOfDate(value) + 24 * 60 * 60 * 1000; }
