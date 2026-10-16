"use client";

import Image from "next/image";
import Link from "next/link";
import { BellOff, CheckCheck, LoaderCircle, MoreVertical, Pin, Search, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChannelType } from "@/modules/channels/core/channel-contracts";
import type { OmnichannelInboxConversation, OmnichannelInboxTag } from "../types/omnichannel-inbox";
import { INBOX_CONVERSATION_EVENT, INBOX_MESSAGE_EVENT, type RealtimeMessageRow } from "./inbox-live-events";
import { appendPage, rowIndexFor } from "../core/group-merge";

interface Filters { channel: string | null; account: string | null; ownerIds: string[]; tagIds: string[]; tagMatchMode: "all" | "any"; firstMessageFrom: string | null; firstMessageTo: string | null }

type ViewMode = "all" | "waiting" | "mine" | "groups" | "other";
const VIEW_KEY = "hirex.inbox.view";

export function InfiniteConversationList(props: { initialConversations: OmnichannelInboxConversation[]; initialHasNextPage: boolean; selectedConversationId: string | null; tags: OmnichannelInboxTag[]; filters: Filters; currentUserId: string | null; filterControl?: ReactNode; channelChips?: ReactNode }) {
  const [conversations, setConversations] = useState(props.initialConversations);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(props.initialHasNextPage);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [viewMode, setViewModeState] = useState<ViewMode>("all");
  // Remember the member's tab between pages (per browser).
  useEffect(() => { try { const saved = window.localStorage.getItem(VIEW_KEY); if (saved && ["all", "waiting", "mine", "groups", "other"].includes(saved)) setViewModeState(saved as ViewMode); } catch { /* storage unavailable */ } }, []);
  const [search, setSearch] = useState("");
  const setViewMode = (mode: ViewMode) => { setViewModeState(mode); try { window.localStorage.setItem(VIEW_KEY, mode); } catch { /* storage unavailable */ } };
  // Waiting times stay current without reloading.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const filterKey = JSON.stringify(props.filters);
  const previousFilterKeyRef = useRef(filterKey);

  useEffect(() => {
    if (previousFilterKeyRef.current !== filterKey) {
      previousFilterKeyRef.current = filterKey;
      setConversations(props.initialConversations); setPage(1); setHasNextPage(props.initialHasNextPage); setLoading(false); setFailed(false);
      return;
    }
    setConversations((current) => {
      const refreshedIds = new Set(props.initialConversations.flatMap((item) => item.copyIds));
      const refreshedGroups = new Set(props.initialConversations.flatMap((item) => item.groupKey ? [item.groupKey] : []));
      return [...props.initialConversations, ...current.filter((item) => !item.copyIds.some((id) => refreshedIds.has(id)) && !(item.groupKey && refreshedGroups.has(item.groupKey)))];
    });
  }, [props.initialConversations, props.initialHasNextPage, filterKey]);

  useEffect(() => {
    const onMessage = (event: Event) => {
      const row = (event as CustomEvent<RealtimeMessageRow>).detail;
      if (!row?.conversation_id) return;
      setConversations((current) => {
        // A merged Zalo group gets the same message in every nick's copy: count it once (the copy the row opens).
        const index = rowIndexFor(current, row.conversation_id);
        if (index < 0) return current;
        const previous = current[index];
        const timestamp = row.received_at ?? row.sent_at ?? row.created_at;
        const updated = { ...previous, latestText: row.text_content, latestDirection: row.direction, lastMessageAt: timestamp,
          lastInboundAt: row.direction === "INBOUND" ? timestamp : previous.lastInboundAt,
          unreadCount: row.direction === "INBOUND" && row.conversation_id === previous.id && row.conversation_id !== props.selectedConversationId ? previous.unreadCount + 1 : previous.unreadCount };
        return [updated, ...current.slice(0, index), ...current.slice(index + 1)];
      });
    };
    const onConversation = (event: Event) => {
      const row = (event as CustomEvent<Record<string, unknown>>).detail;
      if (typeof row?.id !== "string") return;
      setConversations((current) => current.map((item) => item.id === row.id ? { ...item,
        unreadCount: Number.isSafeInteger(row.unread_count) ? Number(row.unread_count) : item.unreadCount,
        lastMessageAt: typeof row.last_message_at === "string" ? row.last_message_at : item.lastMessageAt } : item));
    };
    window.addEventListener(INBOX_MESSAGE_EVENT, onMessage);
    window.addEventListener(INBOX_CONVERSATION_EVENT, onConversation);
    return () => { window.removeEventListener(INBOX_MESSAGE_EVENT, onMessage); window.removeEventListener(INBOX_CONVERSATION_EVENT, onConversation); };
  }, [props.selectedConversationId]);

  const loadMore = useCallback(async () => {
    if (loading || !hasNextPage) return;
    setLoading(true); setFailed(false);
    const nextPage = page + 1;
    const query = new URLSearchParams({ page: String(nextPage) });
    if (props.filters.channel) query.set("channel", props.filters.channel);
    if (props.filters.account) query.set("account", props.filters.account);
    for (const owner of props.filters.ownerIds) query.append("owner", owner);
    for (const tag of props.filters.tagIds) query.append("tag", tag);
    if (props.filters.tagIds.length) query.set("tagMode", props.filters.tagMatchMode);
    if (props.filters.firstMessageFrom) query.set("firstFrom", props.filters.firstMessageFrom);
    if (props.filters.firstMessageTo) query.set("firstTo", props.filters.firstMessageTo);
    try {
      const response = await fetch(`/api/inbox/conversations?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("LOAD_FAILED");
      const payload = await response.json() as { conversations: OmnichannelInboxConversation[]; hasNextPage: boolean; page: number };
      setConversations((current) => appendPage(current, payload.conversations));
      setPage(payload.page); setHasNextPage(payload.hasNextPage);
    } catch { setFailed(true); } finally { setLoading(false); }
  }, [hasNextPage, loading, page, props.filters]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) void loadMore(); }, { rootMargin: "300px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, loadMore]);

  // "Khác": the OTHER folder plus e-mails from robots (no-reply, notifications…) that nobody needs to answer.
  const isOther = (item: OmnichannelInboxConversation) => item.folder === "OTHER" || item.automated;
  const people = conversations.filter((item) => !item.isGroup && !isOther(item));
  const counts: Record<ViewMode, number> = {
    all: people.length,
    waiting: people.filter((item) => item.latestDirection === "INBOUND").length,
    mine: people.filter((item) => props.currentUserId !== null && item.assignedTo === props.currentUserId).length,
    groups: conversations.filter((item) => item.isGroup).length,
    other: conversations.filter((item) => !item.isGroup && isOther(item)).length,
  };
  const matches = (item: OmnichannelInboxConversation) => viewMode === "groups" ? item.isGroup
    : viewMode === "other" ? !item.isGroup && isOther(item)
    : !item.isGroup && !isOther(item) && (viewMode === "all" || (viewMode === "waiting" ? item.latestDirection === "INBOUND" : props.currentUserId !== null && item.assignedTo === props.currentUserId));
  // "Chưa trả lời": longest wait first. Elsewhere: pinned first, then newest.
  // Search covers the conversations already loaded: name, e-mail/phone id, account and last message.
  const needle = normalize(search);
  const found = (item: OmnichannelInboxConversation) => !needle || normalize([conversationDisplayName(item), item.senderExternalId, item.accountDisplayName, item.latestText].filter(Boolean).join(" ")).includes(needle);
  const visible = conversations.filter((item) => matches(item) && found(item)).sort((a, b) => viewMode === "waiting"
    ? (Date.parse(a.lastInboundAt ?? a.lastMessageAt ?? "") || 0) - (Date.parse(b.lastInboundAt ?? b.lastMessageAt ?? "") || 0)
    : Number(b.isPinned) - Number(a.isPinned));
  const tabs: Array<[ViewMode, string]> = [["all", "Tất cả"], ["waiting", "Chưa trả lời"], ["mine", "Của tôi"], ["groups", "Nhóm"], ["other", "Khác"]];
  return <div className="min-h-0 flex flex-1 flex-col">
    <div className="relative flex shrink-0 flex-col gap-2.5 border-b border-slate-100 px-3.5 pb-2.5 pt-2.5">
      <div className="flex gap-2"><label className="relative block min-w-0 flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Tìm theo tên, số điện thoại, nội dung" placeholder="Tìm tên, SĐT, nội dung…" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-8 text-[13px] outline-none focus:border-blue-400 focus:bg-white"/>{search ? <button type="button" onClick={() => setSearch("")} aria-label="Xóa tìm kiếm" className="absolute right-1.5 top-1.5 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4"/></button> : null}</label>{props.filterControl}</div>
      <div role="tablist" aria-label="Lọc nhanh hội thoại" className="flex flex-wrap gap-0.5">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={viewMode === key} onClick={() => setViewMode(key)} className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold transition ${viewMode === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}<span className={`rounded-full px-1.5 text-[11px] leading-[18px] ${viewMode === key ? "bg-slate-700 text-white" : key === "waiting" && counts[key] ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{counts[key]}{hasNextPage ? "+" : ""}</span></button>)}</div>
      {props.channelChips}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><div className="flex flex-col gap-0.5 px-2 py-1.5">{visible.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} selected={conversation.id === props.selectedConversationId || (props.selectedConversationId !== null && conversation.copyIds.includes(props.selectedConversationId))} tags={props.tags} filters={props.filters} now={now}/>)}{visible.length === 0 && !loading ? <p className="px-4 py-10 text-center text-sm text-slate-500">{viewMode === "waiting" ? "Không có khách nào đang chờ trả lời trong danh sách đã tải." : needle || conversations.length ? "Không có hội thoại nào khớp bộ lọc." : "Chưa có cuộc hội thoại. Tin nhắn mới sẽ xuất hiện tại đây."}</p> : null}</div>
    <div ref={sentinelRef} className="flex min-h-14 items-center justify-center px-3 py-3">{loading ? <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500"><LoaderCircle className="size-4 animate-spin"/>Đang tải thêm hội thoại…</span> : failed ? <button type="button" onClick={() => void loadMore()} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">Thử tải lại</button> : hasNextPage ? <span className="text-xs text-slate-400">Cuộn xuống để tải thêm</span> : <span className="text-xs text-slate-400">Đã hiển thị toàn bộ hội thoại</span>}</div></div>
  </div>;
}

/** Name to show: contact, then the name from the channel, then the e-mail address; never a raw numeric id. */
export function conversationDisplayName(item: { contactName: string | null; participantName: string | null; senderExternalId: string | null; channelType: ChannelType }) {
  const participant = item.participantName && !/^\d+$/u.test(item.participantName) ? item.participantName : null;
  const contact = item.contactName && !/^\d+$/u.test(item.contactName) ? item.contactName : null;
  return contact ?? participant ?? (item.channelType === "EMAIL" ? item.senderExternalId : null) ?? "Khách chưa rõ tên";
}

/** "chờ 3 giờ" with a colour: grey under 2 hours, amber from 2 hours, red from 1 day. */
export function waitBadge(lastInboundAt: string | null, now: number): { text: string; className: string } | null {
  const since = lastInboundAt ? Date.parse(lastInboundAt) : Number.NaN;
  if (!Number.isFinite(since)) return null;
  const minutes = Math.max(0, Math.round((now - since) / 60_000));
  const text = minutes < 60 ? `chờ ${Math.max(1, minutes)} phút` : minutes < 1440 ? `chờ ${Math.floor(minutes / 60)} giờ` : `chờ ${Math.floor(minutes / 1440)} ngày`;
  const className = minutes >= 1440 ? "bg-rose-100 text-rose-800" : minutes >= 120 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600";
  return { text, className };
}

const CHANNEL_BADGE: Record<string, { short: string; className: string }> = {
  ZALO: { short: "Z", className: "bg-[#0068ff]" }, FACEBOOK: { short: "f", className: "bg-[#1877f2]" },
  FACEBOOK_PROFILE: { short: "f", className: "bg-indigo-600" }, EMAIL: { short: "@", className: "bg-slate-600" },
};

function ConversationRow({ conversation, selected, tags, filters, now }: { conversation: OmnichannelInboxConversation; selected: boolean; tags: OmnichannelInboxTag[]; filters: Filters; now: number }) {
  const label = conversationDisplayName(conversation);
  const conversationTags = tags.filter((tag) => conversation.tagIds.includes(tag.id));
  const waiting = conversation.latestDirection === "INBOUND" && !conversation.isGroup ? waitBadge(conversation.lastInboundAt ?? conversation.lastMessageAt, now) : null;
  const badge = CHANNEL_BADGE[conversation.channelType] ?? CHANNEL_BADGE.EMAIL;
  return <div className={`group relative rounded-[10px] border transition ${selected ? "border-blue-200 bg-blue-50" : "border-transparent hover:bg-slate-50"}`}><Link prefetch={false} href={inboxHref(conversation.id, filters)} className="block px-3 py-2.5" aria-label={`${label}${waiting ? `, ${waiting.text}` : ""}`}><div className="flex items-start gap-2.5">
    <span className="relative shrink-0">{conversation.avatarUrl ? <Image unoptimized src={conversation.avatarUrl} alt="" width={40} height={40} className="size-10 rounded-full bg-slate-100 object-cover"/> : <span className="flex size-10 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: avatarColor(label) }}>{initials(label)}</span>}<span className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white px-1 text-[9px] font-bold leading-[13px] text-white ${badge.className}`} aria-hidden="true">{badge.short}</span></span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2"><span className={`min-w-0 truncate text-sm ${conversation.unreadCount ? "font-bold text-slate-950" : "font-semibold text-slate-800"}`}>{conversation.isPinned ? <Pin className="mr-1 inline size-3 text-blue-600"/> : null}{label}</span>{waiting ? <span className={`ml-auto shrink-0 rounded-full px-[7px] py-0.5 text-[11px] font-bold transition group-hover:opacity-0 ${waiting.className}`}>{waiting.text}</span> : <time className="ml-auto shrink-0 text-[11px] text-slate-500 transition group-hover:opacity-0">{formatCompactTime(conversation.lastMessageAt)}</time>}</div>
      <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><span className="truncate">{channelLabel(conversation.channelType)} · {conversation.accountDisplayName}</span>{conversation.copyIds.length > 1 ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold leading-4 text-slate-600" title="Nhóm có nhiều nick của mình, chỉ hiện một dòng">{conversation.copyIds.length} nick</span> : null}{conversation.isMuted ? <BellOff className="size-3 shrink-0 text-slate-400"/> : null}</div>
      <div className="mt-0.5 flex items-center gap-2"><p className={`min-w-0 flex-1 truncate text-[13px] ${conversation.unreadCount ? "font-semibold text-slate-800" : "text-slate-500"}`}>{conversation.latestDirection === "OUTBOUND" ? "Bạn: " : ""}{conversation.latestText ?? "Tệp đính kèm hoặc sự kiện"}</p>{conversation.unreadCount ? <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-blue-600 px-[5px] text-[11px] font-bold text-white">{conversation.unreadCount}</span> : null}</div>
      {conversationTags.length ? <div className="mt-1 flex gap-1 overflow-hidden">{conversationTags.slice(0, 3).map((tag) => <span key={tag.id} className="max-w-24 truncate rounded-full border px-1.5 py-0.5 text-[9px]" style={{ borderColor: tag.color ?? "#94a3b8" }}>{tag.name}</span>)}</div> : null}
    </div></div></Link><ConversationMenu conversation={conversation}/></div>;
}

function ConversationMenu({conversation}:{conversation:OmnichannelInboxConversation}){
  // A merged Zalo group row stands for every nick's copy, so read/unread, mute, pin, folder and delete apply to all of them.
  const mutate=async(action:string)=>{const responses=await Promise.all(conversation.copyIds.map((id)=>fetch(`/api/inbox/conversations/${id}/preferences`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action})}).catch(()=>null)));if(responses.some((response)=>response?.ok))window.location.reload()};
  const item="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-slate-50";
  return <details className="absolute right-1.5 top-1.5 z-20 opacity-0 focus-within:opacity-100 group-hover:opacity-100 [&[open]]:opacity-100" onClick={event=>event.stopPropagation()}><summary aria-label="Tùy chọn hội thoại" className="flex size-7 cursor-pointer list-none items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700"><MoreVertical className="size-4"/></summary><div className="absolute right-0 top-9 w-48 overflow-hidden rounded-xl border bg-white py-1 shadow-xl"><button className={item} onClick={()=>void mutate(conversation.unreadCount?"MARK_READ":"MARK_UNREAD")}><CheckCheck className="size-4"/>{conversation.unreadCount?"Đánh dấu đã đọc":"Đánh dấu chưa đọc"}</button><button className={item} onClick={()=>void mutate("TOGGLE_MUTE")}><BellOff className="size-4"/>{conversation.isMuted?"Bật thông báo":"Tắt thông báo"}</button><button className={item} onClick={()=>void mutate("TOGGLE_PIN")}><Pin className="size-4"/>{conversation.isPinned?"Bỏ ghim":"Ghim trong HireX"}</button><button className={item} onClick={()=>void mutate("TOGGLE_OTHER")}><Undo2 className="size-4"/>{conversation.folder==="OTHER"?"Chuyển về Chính":"Chuyển vào Khác"}</button><button className={`${item} text-rose-600`} onClick={()=>void mutate("SOFT_DELETE")}><Trash2 className="size-4"/>Xóa hội thoại</button></div></details>;
}

function inboxHref(conversationId: string, filters: Filters) { const query = new URLSearchParams(); if (filters.channel) query.set("channel", filters.channel); if (filters.account) query.set("account", filters.account); for (const owner of filters.ownerIds) query.append("owner", owner); for (const tag of filters.tagIds) query.append("tag", tag); if (filters.tagIds.length) query.set("tagMode", filters.tagMatchMode); if (filters.firstMessageFrom) query.set("firstFrom", filters.firstMessageFrom); if (filters.firstMessageTo) query.set("firstTo", filters.firstMessageTo); return `/inbox/all/${conversationId}${query.size ? `?${query}` : ""}`; }
const AVATAR_COLORS = ["#7c3aed", "#0891b2", "#ea580c", "#059669", "#2563eb", "#db2777", "#4f46e5", "#0d9488"];
function avatarColor(name: string) { let hash = 0; for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return AVATAR_COLORS[hash % AVATAR_COLORS.length]; }
export function initials(name: string) { const words = name.replace(/@.*$/u, "").split(/[\s._-]+/u).filter((word) => /\p{L}|\d/u.test(word)); if (words.length === 0) return "?"; const pick = words.length === 1 ? [words[0]] : [words[words.length - 2], words[words.length - 1]]; return pick.map((word) => Array.from(word)[0] ?? "").join("").toUpperCase(); }
function normalize(value: string) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().trim(); }
function channelLabel(channel: ChannelType) { return channel === "EMAIL" ? "Email" : channel === "FACEBOOK" ? "Facebook Page" : channel === "FACEBOOK_PROFILE" ? "Facebook cá nhân" : channel === "ZALO" ? "Zalo" : channel; }
function formatCompactTime(value: string | null) { if (!value) return "—"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "—"; return new Intl.DateTimeFormat("vi-VN", date.toDateString() === new Date().toDateString() ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" }).format(date); }
