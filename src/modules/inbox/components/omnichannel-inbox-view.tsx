import { MessagesSquare } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ChannelType } from "@/modules/channels/core/channel-contracts";
import { InboxAutoRefresh } from "./inbox-auto-refresh";
import { InfiniteConversationList } from "./infinite-conversation-list";
import { InboxFilterPanel } from "./inbox-filter-panel";
import { InboxScopeSwitch } from "./inbox-scope-switch";
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
  const filterControl = <InboxFilterPanel accounts={filteredAccounts} profiles={props.profiles} tags={props.tags} channel={channelParam} selectedAccountId={selectedAccountId} selectedTagIds={props.selectedTagIds} tagMatchMode={props.tagMatchMode} selectedOwnerIds={props.selectedOwnerIds} firstMessageFrom={props.firstMessageFrom} firstMessageTo={props.firstMessageTo} clearHref={inboxHref({ channel: channelParam, account: null, page: 1 })}/>;
  // Channel chips: pick several at once; click a picked chip again to drop it. None picked = all channels.
  const channelChips = <nav className="flex flex-wrap items-center gap-1" aria-label="Lọc theo kênh (chọn được nhiều)">{chips.map((tab) => { const value = tab.value as ChannelType; const on = pickedChannels.includes(value); const next = on ? pickedChannels.filter((item) => item !== value) : [...pickedChannels, value]; return <Link prefetch={false} key={tab.label} href={inboxHref({ channel: next.length ? next.join(",") : null, account: null, ownerIds: props.selectedOwnerIds, page: 1, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode })} aria-pressed={on} title={on ? `Bỏ ${tab.label} khỏi bộ lọc` : `Thêm ${tab.label} vào bộ lọc`} className={`inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full border py-1 pl-1.5 pr-2 text-xs font-semibold transition ${on ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`}><ChannelLogo channel={value} size={15}/>{tab.short}</Link>; })}{pickedChannels.length ? <Link prefetch={false} href={inboxHref({ channel: null, account: null, ownerIds: props.selectedOwnerIds, page: 1, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode })} className="px-1 text-xs font-semibold text-slate-500 hover:text-blue-700">Bỏ chọn</Link> : null}</nav>;
  // Full-height, two panes: conversations on the left, the open conversation (with its composer pinned
  // to the bottom) on the right.
  return <div className="flex h-[calc(100dvh-4rem)] min-h-[520px] overflow-hidden bg-white">
    <aside className={`${props.selectedConversationId ? "hidden lg:flex" : "flex"} w-full min-w-0 shrink-0 flex-col border-r border-slate-200 bg-white lg:w-[340px]`}>
      <div className="flex shrink-0 items-center justify-between px-3.5 pt-3.5"><h1 className="text-lg font-bold tracking-tight text-slate-950">Suối Nguồn</h1><InboxAutoRefresh workspaceId={props.workspaceId} compact/></div>
      {props.scope && props.scopeCounts ? <div className="shrink-0 px-3.5 pt-2.5"><InboxScopeSwitch scope={props.scope} counts={props.scopeCounts}/></div> : null}
      <div className={`flex min-h-0 flex-1 flex-col transition-opacity ${props.listLoading ? "pointer-events-none opacity-60" : ""}`} aria-busy={props.listLoading || undefined}>{error ? <div className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</div> : <InfiniteConversationList key={props.scope ?? "ALL"} initialConversations={conversations} initialHasNextPage={props.hasNextPage} selectedConversationId={props.selectedConversationId} tags={props.tags} currentUserId={props.currentUserId} filterControl={filterControl} channelChips={channelChips} filters={{ channel: channelParam, account: selectedAccountId, ownerIds: props.selectedOwnerIds, tagIds: props.selectedTagIds, tagMatchMode: props.tagMatchMode, firstMessageFrom: props.firstMessageFrom, firstMessageTo: props.firstMessageTo }}/>}</div>
    </aside>
    <main className={`${props.selectedConversationId ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50`}>{props.detail}</main>
  </div>;
}

export function EmptyConversationSelection() { return <div className="flex h-full flex-col items-center justify-center p-8 text-center"><span className="flex size-16 items-center justify-center rounded-2xl bg-white shadow-sm"><MessagesSquare className="size-8 text-blue-500"/></span><h2 className="mt-4 font-bold text-slate-800">Chọn một cuộc hội thoại</h2><p className="mt-1 max-w-sm text-sm text-slate-500">Chọn khách hàng hoặc nhóm ở bên trái để xem và trả lời tin nhắn.</p></div>; }
function inboxHref(input: { channel: string | null; account: string | null; ownerIds?: string[]; page: number; conversationId?: string; tagIds?: string[]; tagMatchMode?: "all" | "any"; firstMessageFrom?: string | null; firstMessageTo?: string | null }): string { const query = new URLSearchParams(); if (input.channel) query.set("channel", input.channel); if (input.account) query.set("account", input.account); for (const owner of input.ownerIds ?? []) query.append("owner", owner); if (input.page > 1) query.set("page", String(input.page)); for (const tag of input.tagIds ?? []) query.append("tag", tag); if ((input.tagIds?.length ?? 0) > 0) query.set("tagMode", input.tagMatchMode ?? "all"); if (input.firstMessageFrom) query.set("firstFrom", input.firstMessageFrom); if (input.firstMessageTo) query.set("firstTo", input.firstMessageTo); const suffix = query.size ? `?${query.toString()}` : ""; return `/inbox/all${input.conversationId ? `/${input.conversationId}` : ""}${suffix}`; }
