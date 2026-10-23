import { MessagesSquare, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ChannelType } from "@/modules/channels/core/channel-contracts";
import { InboxAutoRefresh } from "./inbox-auto-refresh";
import { InfiniteConversationList } from "./infinite-conversation-list";
import { InboxFilterPanel } from "./inbox-filter-panel";
import { InboxScopeSwitch } from "./inbox-scope-switch";
import { InboxSavedFilters } from "./inbox-saved-filters";
import { InboxTagMenu } from "./inbox-tag-menu";
import { ChannelLogo } from "@/modules/channels/components/channel-logo";
import type { OmnichannelInboxData } from "../types/omnichannel-inbox";

const tabs: Array<{ label: string; short: string; value: ChannelType | null }> = [
  { label: "Tất cả", short: "Tất cả", value: null }, { label: "Zalo", short: "Zalo", value: "ZALO" },
  // The logo already says Facebook, so the chips say only which kind: all four fit on one line.
  { label: "Facebook Page", short: "Page", value: "FACEBOOK" }, { label: "Facebook cá nhân", short: "Cá nhân", value: "FACEBOOK_PROFILE" }, { label: "Email", short: "Email", value: "EMAIL" },
];

export function OmnichannelInboxView(props: OmnichannelInboxData & { selectedConversationId: string | null; detail: ReactNode; listLoading?: boolean }) {
  const { accounts, conversations, selectedAccountId, error } = props;
  const channelParam = props.channelParam;
  const pickedChannels = props.selectedChannelTypes;
  const filteredAccounts = accounts.filter((account) => pickedChannels.length === 0 || pickedChannels.includes(account.channelType));
  // Full-height, two panes: conversations on the left, the open conversation (with its composer pinned
  // to the bottom) on the right. Filters live in one compact block above the list.
  const chips = tabs.filter((tab) => tab.value !== null);
  // Filters that are not quick tabs (account, tags, owners) sit behind one icon button next to the search box.
  // Phân loại (like Zalo) sits right next to the search box: Chưa đọc and the tags, plus "Quản lý thẻ phân loại".
  const filterControl = <><InboxTagMenu tags={props.tags} selectedTagIds={props.selectedTagIds} unreadOnly={props.unreadOnly ?? false} canManage={props.canUpdate ?? false} canDelete={props.canDelete ?? false}/><InboxSavedFilters query={inboxHref({ channel: channelParam, account: selectedAccountId, ownerIds: props.selectedOwnerIds, page: 1, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode, firstMessageFrom: props.firstMessageFrom, firstMessageTo: props.firstMessageTo, unread: props.unreadOnly }).split("?")[1] ?? ""} scope={props.scope ?? null} accountName={(props.selectedAccountIds ?? []).length === 1 ? accounts.find((account) => account.id === props.selectedAccountIds?.[0])?.displayName ?? null : null} tagNames={props.tags.filter((tag) => props.selectedTagIds.includes(tag.id)).map((tag) => tag.name)} ownerNames={(props.owners ?? []).filter((owner) => props.selectedOwnerIds.includes(owner.id)).map((owner) => owner.fullName)}/><InboxFilterPanel accounts={filteredAccounts} owners={props.owners ?? []} view={props.view ?? "all"} search={props.search ?? ""} tags={props.tags} channel={channelParam} selectedAccountIds={props.selectedAccountIds ?? []} currentUserId={props.currentUserId} selectedTagIds={props.selectedTagIds} tagMatchMode={props.tagMatchMode} selectedOwnerIds={props.selectedOwnerIds} firstMessageFrom={props.firstMessageFrom} firstMessageTo={props.firstMessageTo} unreadOnly={props.unreadOnly ?? false} clearHref={inboxHref({ channel: channelParam, account: null, page: 1, view: props.view, q: props.search, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode, unread: props.unreadOnly })}/></>;
  // Channel chips: pick several at once; click a picked chip again to drop it. None picked = all channels.
  const channelChips = <nav className="flex flex-wrap items-center gap-1" aria-label="Lọc theo kênh (chọn được nhiều)"><Link prefetch={false} href={inboxHref({ channel: null, account: null, ownerIds: props.selectedOwnerIds, page: 1, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode, firstMessageFrom: props.firstMessageFrom, firstMessageTo: props.firstMessageTo, view: props.view, q: props.search, unread: props.unreadOnly })} aria-pressed={pickedChannels.length === 0} title="Mọi kênh" className={`inline-flex min-h-7 items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold transition ${pickedChannels.length === 0 ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`}>All kênh</Link>{chips.map((tab) => { const value = tab.value as ChannelType; const on = pickedChannels.includes(value); const next = on ? pickedChannels.filter((item) => item !== value) : [...pickedChannels, value]; return <Link prefetch={false} key={tab.label} href={inboxHref({ channel: next.length ? next.join(",") : null, account: null, ownerIds: props.selectedOwnerIds, page: 1, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode, firstMessageFrom: props.firstMessageFrom, firstMessageTo: props.firstMessageTo, view: props.view, q: props.search, unread: props.unreadOnly })} aria-pressed={on} title={on ? `Bỏ ${tab.label} khỏi bộ lọc` : `Thêm ${tab.label} vào bộ lọc`} className={`inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full border py-1 pl-1.5 pr-2 text-xs font-semibold transition ${on ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`}><ChannelLogo channel={value} size={15}/>{tab.short}</Link>; })}</nav>;
  const chipsBlock = <>{channelChips}<ActiveFilters {...props}/></>;
  // Full-height, two panes: conversations on the left, the open conversation (with its composer pinned
  // to the bottom) on the right.
  return <div className="flex h-[calc(100dvh-4rem)] min-h-[520px] overflow-hidden bg-white">
    <aside className={`${props.selectedConversationId ? "hidden lg:flex" : "flex"} w-full min-w-0 shrink-0 flex-col border-r border-slate-200 bg-white lg:w-[388px]`}>
      <div className="flex shrink-0 items-center justify-between px-3.5 pt-3.5"><h1 className="text-lg font-bold tracking-tight text-slate-950">Suối Nguồn</h1><InboxAutoRefresh workspaceId={props.workspaceId} compact/></div>
      {props.scope && props.scopeCounts ? <div className="shrink-0 px-3.5 pt-2.5"><InboxScopeSwitch scope={props.scope} counts={props.scopeCounts}/></div> : null}
      <div className={`flex min-h-0 flex-1 flex-col transition-opacity ${props.listLoading ? "pointer-events-none opacity-60" : ""}`} aria-busy={props.listLoading || undefined}>{error ? <div className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</div> : <InfiniteConversationList key={props.scope ?? "ALL"} initialConversations={conversations} initialHasNextPage={props.hasNextPage} initialNextCursor={props.nextCursor ?? null} canUpdate={props.canUpdate ?? false} canDelete={props.canDelete ?? false} profiles={props.profiles} selectedConversationId={props.selectedConversationId} tags={props.tags} currentUserId={props.currentUserId} filterControl={filterControl} channelChips={chipsBlock} filters={{ channel: channelParam, account: selectedAccountId, ownerIds: props.selectedOwnerIds, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode, firstMessageFrom: props.firstMessageFrom, firstMessageTo: props.firstMessageTo, view: props.view ?? "all", q: props.search ?? "", unread: props.unreadOnly ?? false }}/>}</div>
    </aside>
    <main className={`${props.selectedConversationId ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50`}>{props.detail}</main>
  </div>;
}

/** What is filtered right now, one chip each; ✕ drops just that filter. */
function ActiveFilters(props: OmnichannelInboxData) {
  const base = { channel: props.channelParam, account: props.selectedAccountId, ownerIds: props.selectedOwnerIds, page: 1, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode, firstMessageFrom: props.firstMessageFrom, firstMessageTo: props.firstMessageTo, view: props.view, q: props.search, unread: props.unreadOnly };
  const chips: Array<{ key: string; label: string; title?: string; href: string; color?: string | null }> = [];
  const pickedAccounts = props.accounts.filter((account) => (props.selectedAccountIds ?? []).includes(account.id));
  if (pickedAccounts.length) chips.push({ key: "account", label: pickedAccounts.length === 1 ? pickedAccounts[0].displayName : `${pickedAccounts.length} tài khoản`, title: pickedAccounts.map((account) => account.displayName).join(", "), href: inboxHref({ ...base, account: null }) });
  for (const id of props.selectedOwnerIds) { const owner = (props.owners ?? []).find((profile) => profile.id === id); chips.push({ key: `owner-${id}`, label: `Phụ trách: ${owner?.fullName ?? "?"}`, href: inboxHref({ ...base, ownerIds: props.selectedOwnerIds.filter((item) => item !== id) }) }); }
  for (const id of props.selectedTagIds) { const tag = props.tags.find((item) => item.id === id); chips.push({ key: `tag-${id}`, label: tag?.name ?? "Nhãn", color: tag?.color ?? "#94a3b8", href: inboxHref({ ...base, tagIds: props.selectedTagIds.filter((item) => item !== id) }) }); }
  if (props.firstMessageFrom || props.firstMessageTo) chips.push({ key: "date", label: `Tin đầu: ${props.firstMessageFrom ?? "…"} → ${props.firstMessageTo ?? "…"}`, href: inboxHref({ ...base, firstMessageFrom: null, firstMessageTo: null }) });
  if (props.unreadOnly) chips.push({ key: "unread", label: "Chưa đọc", href: inboxHref({ ...base, unread: false }) });
  if (props.search) chips.push({ key: "search", label: `Tìm: ${props.search}`, href: inboxHref({ ...base, q: null }) });
  if (!chips.length) return null;
  return <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-label="Bộ lọc đang bật">
    {chips.map((chip) => <Link prefetch={false} key={chip.key} href={chip.href} title={`Bỏ lọc: ${chip.title ?? chip.label}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-blue-600/10 py-0.5 pl-2 pr-1 text-[11px] font-semibold text-blue-800 hover:bg-rose-50 hover:text-rose-700">{chip.color ? <span className="size-2 shrink-0 rounded-full" style={{ background: chip.color }}/> : null}<span className="truncate">{chip.label}</span><X className="size-3 shrink-0"/></Link>)}
    {chips.length > 1 ? <Link prefetch={false} href={inboxHref({ channel: props.channelParam, account: null, page: 1, view: props.view })} className="px-1 text-[11px] font-semibold text-slate-500 hover:text-rose-600">Xóa tất cả</Link> : null}
  </div>;
}

export function EmptyConversationSelection() { return <div className="flex h-full flex-col items-center justify-center p-8 text-center"><span className="flex size-16 items-center justify-center rounded-2xl bg-white shadow-sm"><MessagesSquare className="size-8 text-blue-500"/></span><h2 className="mt-4 font-bold text-slate-800">Chọn một cuộc hội thoại</h2><p className="mt-1 max-w-sm text-sm text-slate-500">Chọn khách hàng hoặc nhóm ở bên trái để xem và trả lời tin nhắn.</p></div>; }
function inboxHref(input: { channel: string | null; account: string | null; ownerIds?: string[]; page: number; conversationId?: string; tagIds?: string[]; tagMatchMode?: "all" | "any"; firstMessageFrom?: string | null; firstMessageTo?: string | null; view?: string | null; q?: string | null; unread?: boolean }): string { const query = new URLSearchParams(); if (input.channel) query.set("channel", input.channel); if (input.account) query.set("account", input.account); for (const owner of input.ownerIds ?? []) query.append("owner", owner); if (input.page > 1) query.set("page", String(input.page)); for (const tag of input.tagIds ?? []) query.append("tag", tag); if ((input.tagIds?.length ?? 0) > 0) query.set("tagMode", input.tagMatchMode ?? "all"); if (input.firstMessageFrom) query.set("firstFrom", input.firstMessageFrom); if (input.firstMessageTo) query.set("firstTo", input.firstMessageTo); if (input.view && input.view !== "all") query.set("view", input.view); if (input.q) query.set("q", input.q); if (input.unread) query.set("unread", "1"); const suffix = query.size ? `?${query.toString()}` : ""; return `/inbox/all${input.conversationId ? `/${input.conversationId}` : ""}${suffix}`; }
