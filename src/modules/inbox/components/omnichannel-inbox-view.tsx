import { MessagesSquare, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ChannelType } from "@/modules/channels/core/channel-contracts";
import type { QuickReplyTemplate } from "@/modules/channels/types/quick-reply";
import { AutoSubmitSelect } from "./auto-submit-select";
import { InboxAutoRefresh } from "./inbox-auto-refresh";
import { ConversationTagFilter } from "./conversation-tag-filter";
import { InfiniteConversationList } from "./infinite-conversation-list";
import { OwnerMultiFilter } from "./owner-multi-filter";
import type { OmnichannelInboxData } from "../types/omnichannel-inbox";

const tabs: Array<{ label: string; short: string; value: ChannelType | null }> = [
  { label: "Tất cả", short: "Tất cả", value: null }, { label: "Zalo", short: "Zalo", value: "ZALO" },
  { label: "Facebook Page", short: "FB Page", value: "FACEBOOK" }, { label: "Facebook cá nhân", short: "FB cá nhân", value: "FACEBOOK_PROFILE" }, { label: "Email", short: "Email", value: "EMAIL" },
];

export function OmnichannelInboxView(props: OmnichannelInboxData & { quickReplies: QuickReplyTemplate[]; selectedConversationId: string | null; detail: ReactNode }) {
  const { accounts, conversations, selectedAccountId, error } = props;
  const channelParam = props.channelParam;
  const pickedChannels = props.selectedChannelTypes;
  const filteredAccounts = accounts.filter((account) => pickedChannels.length === 0 || pickedChannels.includes(account.channelType));
  const activeFilters = (selectedAccountId ? 1 : 0) + (props.selectedTagIds.length ? 1 : 0) + (props.selectedOwnerIds.length ? 1 : 0) + (props.firstMessageFrom || props.firstMessageTo ? 1 : 0);
  // Full-height, two panes: conversations on the left, the open conversation (with its composer pinned
  // to the bottom) on the right. Filters live in one compact block above the list.
  const chips = tabs.filter((tab) => tab.value !== null);
  // Filters that are not quick tabs (account, tags, owners) sit behind one icon button next to the search box.
  const filterControl = <details className="relative shrink-0">
    <summary className={`relative flex size-9 cursor-pointer list-none items-center justify-center rounded-lg border marker:content-none ${activeFilters ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`} aria-label="Bộ lọc: tài khoản, nhãn, người phụ trách" title="Bộ lọc: tài khoản, nhãn, người phụ trách"><SlidersHorizontal className="size-4"/>{activeFilters ? <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">{activeFilters}</span> : null}</summary>
    <div className="absolute right-0 top-11 z-40 w-[min(92vw,340px)] space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
      <form className="space-y-1">{props.selectedTagIds.map((id) => <input key={id} type="hidden" name="tag" value={id}/>)}{props.selectedOwnerIds.map((id) => <input key={id} type="hidden" name="owner" value={id}/>)}<input type="hidden" name="tagMode" value={props.tagMatchMode}/><input type="hidden" name="channel" value={channelParam ?? ""}/>{props.firstMessageFrom ? <input type="hidden" name="firstFrom" value={props.firstMessageFrom}/> : null}{props.firstMessageTo ? <input type="hidden" name="firstTo" value={props.firstMessageTo}/> : null}<label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500" htmlFor="inbox-account">Tài khoản</label><AutoSubmitSelect id="inbox-account" name="account" defaultValue={selectedAccountId ?? ""} aria-label="Lọc theo tài khoản" className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-blue-400"><option value="">Tất cả tài khoản</option>{filteredAccounts.map((account) => <option key={account.id} value={account.id}>{channelLabel(account.channelType)} — {account.displayName}</option>)}</AutoSubmitSelect><button className="sr-only">Áp dụng</button></form>
      <div><ConversationTagFilter tags={props.tags} selectedTagIds={props.selectedTagIds} tagMatchMode={props.tagMatchMode} channel={channelParam} account={selectedAccountId} ownerIds={props.selectedOwnerIds} firstMessageFrom={props.firstMessageFrom} firstMessageTo={props.firstMessageTo}/></div>
      <div><p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Người phụ trách</p><OwnerMultiFilter profiles={props.profiles} accounts={filteredAccounts} selectedOwnerIds={props.selectedOwnerIds} channel={channelParam} account={selectedAccountId} tagIds={props.selectedTagIds} tagMatchMode={props.tagMatchMode} clearHref={inboxHref({ channel: channelParam, account: selectedAccountId, page: 1, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode })}/></div>
      {activeFilters ? <Link href={inboxHref({ channel: channelParam, account: null, page: 1 })} className="block text-center text-xs font-semibold text-blue-700 hover:underline">Xóa bộ lọc</Link> : null}
    </div>
  </details>;
  // Channel chips: pick several at once; click a picked chip again to drop it. None picked = all channels.
  const channelChips = <nav className="flex flex-wrap items-center gap-1.5" aria-label="Lọc theo kênh (chọn được nhiều)">{chips.map((tab) => { const value = tab.value as ChannelType; const on = pickedChannels.includes(value); const next = on ? pickedChannels.filter((item) => item !== value) : [...pickedChannels, value]; return <Link key={tab.label} href={inboxHref({ channel: next.length ? next.join(",") : null, account: null, ownerIds: props.selectedOwnerIds, page: 1, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode })} aria-pressed={on} title={on ? `Bỏ ${tab.label} khỏi bộ lọc` : `Thêm ${tab.label} vào bộ lọc`} className={`min-h-7 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${on ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`}>{tab.short}</Link>; })}{pickedChannels.length ? <Link href={inboxHref({ channel: null, account: null, ownerIds: props.selectedOwnerIds, page: 1, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode })} className="px-1 text-xs font-semibold text-slate-500 hover:text-blue-700">Bỏ chọn</Link> : null}</nav>;
  // Full-height, two panes: conversations on the left, the open conversation (with its composer pinned
  // to the bottom) on the right.
  return <div className="flex h-[calc(100dvh-4rem)] min-h-[520px] overflow-hidden bg-white">
    <aside className={`${props.selectedConversationId ? "hidden lg:flex" : "flex"} w-full min-w-0 shrink-0 flex-col border-r border-slate-200 bg-white lg:w-[340px]`}>
      <div className="flex shrink-0 items-center justify-between px-3.5 pt-3.5"><h1 className="text-lg font-bold tracking-tight text-slate-950">Hồ Chứa</h1><InboxAutoRefresh workspaceId={props.workspaceId} compact/></div>
      {error ? <div className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</div> : <InfiniteConversationList initialConversations={conversations} initialHasNextPage={props.hasNextPage} selectedConversationId={props.selectedConversationId} tags={props.tags} currentUserId={props.currentUserId} filterControl={filterControl} channelChips={channelChips} filters={{ channel: channelParam, account: selectedAccountId, ownerIds: props.selectedOwnerIds, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode, firstMessageFrom: props.firstMessageFrom, firstMessageTo: props.firstMessageTo }}/>}
    </aside>
    <main className={`${props.selectedConversationId ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50`}>{props.detail}</main>
  </div>;
}

export function EmptyConversationSelection() { return <div className="flex h-full flex-col items-center justify-center p-8 text-center"><span className="flex size-16 items-center justify-center rounded-2xl bg-white shadow-sm"><MessagesSquare className="size-8 text-blue-500"/></span><h2 className="mt-4 font-bold text-slate-800">Chọn một cuộc hội thoại</h2><p className="mt-1 max-w-sm text-sm text-slate-500">Chọn khách hàng hoặc nhóm ở bên trái để xem và trả lời tin nhắn.</p></div>; }
function inboxHref(input: { channel: string | null; account: string | null; ownerIds?: string[]; page: number; conversationId?: string; tagIds?: string[]; tagMatchMode?: "all" | "any"; firstMessageFrom?: string | null; firstMessageTo?: string | null }): string { const query = new URLSearchParams(); if (input.channel) query.set("channel", input.channel); if (input.account) query.set("account", input.account); for (const owner of input.ownerIds ?? []) query.append("owner", owner); if (input.page > 1) query.set("page", String(input.page)); for (const tag of input.tagIds ?? []) query.append("tag", tag); if ((input.tagIds?.length ?? 0) > 0) query.set("tagMode", input.tagMatchMode ?? "all"); if (input.firstMessageFrom) query.set("firstFrom", input.firstMessageFrom); if (input.firstMessageTo) query.set("firstTo", input.firstMessageTo); const suffix = query.size ? `?${query.toString()}` : ""; return `/inbox/all${input.conversationId ? `/${input.conversationId}` : ""}${suffix}`; }
function channelLabel(channel: ChannelType) { return channel === "EMAIL" ? "Email" : channel === "FACEBOOK" ? "Facebook Page" : channel === "FACEBOOK_PROFILE" ? "Facebook cá nhân" : channel === "ZALO" ? "Zalo" : channel; }
