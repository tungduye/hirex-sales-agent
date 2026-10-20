"use client";

import Image from "next/image";
import { ChannelLogo } from "@/modules/channels/components/channel-logo";
import Link from "next/link";
import { BellOff, CheckCheck, LoaderCircle, MoreVertical, Pin, Search, Trash2, Undo2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChannelType } from "@/modules/channels/core/channel-contracts";
import type { OmnichannelInboxConversation, OmnichannelInboxTag } from "../types/omnichannel-inbox";
import { INBOX_CONVERSATION_EVENT, INBOX_MESSAGE_EVENT, type RealtimeMessageRow } from "./inbox-live-events";
import { appendPage, rowIndexFor } from "../core/group-merge";
import { DRAFT_EVENT, draftStore, listDrafts } from "@/modules/channels/core/composer-drafts";
import { INBOX_REFRESH_EVENT } from "./inbox-refresh-event";

interface Filters { channel: string | null; account: string | null; ownerIds: string[]; tagIds: string[]; tagMatchMode: "all" | "any"; firstMessageFrom: string | null; firstMessageTo: string | null; view?: ViewMode; q?: string }

type ViewMode = "all" | "waiting" | "mine" | "groups" | "other";
const VIEW_KEY = "hirex.inbox.view";
type ViewCounts = Record<ViewMode, number> & { capped: boolean };

/** The list filters as a query string (no conversation, no cursor). */
function filterQuery(filters: Filters) {
  const query = new URLSearchParams();
  if (filters.channel) query.set("channel", filters.channel);
  if (filters.account) query.set("account", filters.account);
  for (const owner of filters.ownerIds) query.append("owner", owner);
  for (const tag of filters.tagIds) query.append("tag", tag);
  if (filters.tagIds.length) query.set("tagMode", filters.tagMatchMode);
  if (filters.firstMessageFrom) query.set("firstFrom", filters.firstMessageFrom);
  if (filters.firstMessageTo) query.set("firstTo", filters.firstMessageTo);
  if (filters.view && filters.view !== "all") query.set("view", filters.view);
  if (filters.q) query.set("q", filters.q);
  return query;
}

// Tab badges per filter set, kept a minute so switching back and forth does not count again.
const countCache = new Map<string, { at: number; counts: ViewCounts }>();

export function InfiniteConversationList(props: { initialConversations: OmnichannelInboxConversation[]; initialHasNextPage: boolean; initialNextCursor: string | null; selectedConversationId: string | null; tags: OmnichannelInboxTag[]; filters: Filters; currentUserId: string | null; filterControl?: ReactNode; channelChips?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState(props.initialConversations);
  const [cursor, setCursor] = useState<string | null>(props.initialNextCursor);
  const [hasNextPage, setHasNextPage] = useState(props.initialHasNextPage);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Tab and search are decided by the server over every conversation; they travel in the URL (?view=&q=).
  const viewMode: ViewMode = props.filters.view ?? "all";
  const [search, setSearch] = useState(props.filters.q ?? "");
  // The address changed the search (a chip ✕, back button): show it in the box.
  const [shownQ, setShownQ] = useState(props.filters.q ?? "");
  if (shownQ !== (props.filters.q ?? "")) { setShownQ(props.filters.q ?? ""); setSearch(props.filters.q ?? ""); }
  const [loadedCounts, setLoadedCounts] = useState<{ key: string; counts: ViewCounts } | null>(null);
  const navigate = useCallback((change: (query: URLSearchParams) => void) => {
    const query = new URLSearchParams(searchParams.toString());
    change(query);
    const next = query.toString();
    router.replace(`${pathname}${next ? `?${next}` : ""}`, { scroll: false });
  }, [pathname, router, searchParams]);
  const setViewMode = (mode: ViewMode) => {
    try { window.localStorage.setItem(VIEW_KEY, mode); } catch { /* storage unavailable */ }
    navigate((query) => query.set("view", mode));
  };
  // Search runs on the server a moment after typing stops.
  useEffect(() => {
    const value = search.replace(/\s+/gu, " ").trim();
    if (value === (props.filters.q ?? "")) return;
    const timer = window.setTimeout(() => navigate((query) => { if (value) query.set("q", value); else query.delete("q"); }), 400);
    return () => window.clearTimeout(timer);
  }, [search, props.filters.q, navigate]);
  // Waiting times stay current without reloading.
  const [now, setNow] = useState(() => Date.now());
  // Unsent drafts kept in this browser: the row shows "Nháp: ..." like Zalo.
  const [drafts, setDrafts] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    const refresh = () => setDrafts(listDrafts(draftStore(), Date.now()));
    const first = window.setTimeout(refresh, 0);
    window.addEventListener(DRAFT_EVENT, refresh); window.addEventListener("storage", refresh);
    return () => { window.clearTimeout(first); window.removeEventListener(DRAFT_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const filterKey = JSON.stringify(props.filters);
  const previousFilterKeyRef = useRef(filterKey);

  useEffect(() => {
    if (previousFilterKeyRef.current !== filterKey) {
      previousFilterKeyRef.current = filterKey;
      setConversations(props.initialConversations); setCursor(props.initialNextCursor); setHasNextPage(props.initialHasNextPage); setLoading(false); setFailed(false);
      return;
    }
    setConversations((current) => {
      const refreshedIds = new Set(props.initialConversations.flatMap((item) => item.copyIds));
      const refreshedGroups = new Set(props.initialConversations.flatMap((item) => item.groupKey ? [item.groupKey] : []));
      return [...props.initialConversations, ...current.filter((item) => !item.copyIds.some((id) => refreshedIds.has(id)) && !(item.groupKey && refreshedGroups.has(item.groupKey)))];
    });
  }, [props.initialConversations, props.initialHasNextPage, props.initialNextCursor, filterKey]);

  // Tab badges load after the list, so they never slow it down.
  const countKey = (() => { const query = filterQuery({ ...props.filters, view: "all" }); return query.toString(); })();
  const counts = loadedCounts?.key === countKey ? loadedCounts.counts : null;
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const cached = countCache.get(countKey);
      if (cached && Date.now() - cached.at < 60_000) { setLoadedCounts({ key: countKey, counts: cached.counts }); return; }
      fetch(`/api/inbox/view-counts${countKey ? `?${countKey}` : ""}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<ViewCounts> : null)
        .then((value) => { if (value) { countCache.set(countKey, { at: Date.now(), counts: value }); setLoadedCounts({ key: countKey, counts: value }); } })
        .catch(() => undefined);
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [countKey]);

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
    if (loading || !hasNextPage || !cursor) return;
    setLoading(true); setFailed(false);
    const query = filterQuery(props.filters);
    query.set("cursor", cursor);
    try {
      const response = await fetch(`/api/inbox/conversations?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("LOAD_FAILED");
      const payload = await response.json() as { conversations: OmnichannelInboxConversation[]; hasNextPage: boolean; nextCursor: string | null };
      setConversations((current) => appendPage(current, payload.conversations));
      setCursor(payload.nextCursor); setHasNextPage(payload.hasNextPage && Boolean(payload.nextCursor));
    } catch { setFailed(true); } finally { setLoading(false); }
  }, [cursor, hasNextPage, loading, props.filters]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) void loadMore(); }, { rootMargin: "300px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, loadMore]);

  // "Khác": the OTHER folder plus e-mails from robots (no-reply, notifications…) that nobody needs to answer.
  const isOther = (item: OmnichannelInboxConversation) => item.folder === "OTHER" || item.automated;
  // The server already picked the tab's rows; this second look keeps rows changed live (a reply, a
  // folder move) in the right tab until the next load.
  const matches = (item: OmnichannelInboxConversation) => viewMode === "groups" ? item.isGroup
    : viewMode === "other" ? !item.isGroup && isOther(item)
    : !item.isGroup && !isOther(item) && (viewMode === "all" || (viewMode === "waiting" ? item.latestDirection === "INBOUND" : props.currentUserId !== null && item.assignedTo === props.currentUserId));
  // "Chưa trả lời": longest wait first. Elsewhere: pinned first, then newest.
  const needle = normalize(props.filters.q ?? "");
  const visible = conversations.filter(matches).sort((a, b) => viewMode === "waiting"
    ? (Date.parse(a.lastInboundAt ?? a.lastMessageAt ?? "") || 0) - (Date.parse(b.lastInboundAt ?? b.lastMessageAt ?? "") || 0)
    : Number(b.isPinned) - Number(a.isPinned));
  // A page may hold no row for this tab (the server stops looking after a while): keep loading until a few show.
  useEffect(() => {
    if (loading || failed || !hasNextPage || visible.length >= 15) return;
    const timer = window.setTimeout(() => void loadMore(), 0);
    return () => window.clearTimeout(timer);
  }, [failed, hasNextPage, loadMore, loading, visible.length]);
  // Menu actions change the row here at once; the list reloads quietly in the background.
  const applyLocal = useCallback((conversation: OmnichannelInboxConversation, action: string) => {
    setConversations((current) => action === "SOFT_DELETE" ? current.filter((item) => item.id !== conversation.id) : current.map((item) => item.id !== conversation.id ? item
      : action === "MARK_READ" ? { ...item, unreadCount: 0 } : action === "MARK_UNREAD" ? { ...item, unreadCount: Math.max(1, item.unreadCount) }
      : action === "TOGGLE_MUTE" ? { ...item, isMuted: !item.isMuted } : action === "TOGGLE_PIN" ? { ...item, isPinned: !item.isPinned }
      : action === "TOGGLE_OTHER" ? { ...item, folder: item.folder === "OTHER" ? "PRIMARY" : "OTHER" } : item));
    countCache.clear();
    window.dispatchEvent(new Event(INBOX_REFRESH_EVENT));
  }, []);
  const tabs: Array<[ViewMode, string]> = [["all", "Tất cả"], ["waiting", "Chưa trả lời"], ["mine", "Giao cho tôi"], ["groups", "Nhóm"], ["other", "Khác"]];
  return <div className="min-h-0 flex flex-1 flex-col">
    <div className="relative flex shrink-0 flex-col gap-2.5 border-b border-slate-100 px-3.5 pb-2.5 pt-2.5">
      <div className="flex gap-2"><label className="relative block min-w-0 flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Tìm theo tên, số điện thoại, email, tên nhóm" placeholder="Tìm tên, SĐT, email, nhóm…" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-8 text-[13px] outline-none focus:border-blue-400 focus:bg-white"/>{search ? <button type="button" onClick={() => setSearch("")} aria-label="Xóa tìm kiếm" className="absolute right-1.5 top-1.5 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4"/></button> : null}</label>{props.filterControl}</div>
      <div role="tablist" aria-label="Lọc nhanh hội thoại" className="flex flex-wrap gap-0.5">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={viewMode === key} onClick={() => setViewMode(key)} className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold transition ${viewMode === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}{counts ? <span title="Hội thoại có tin trong 30 ngày gần nhất" className={`rounded-full px-1.5 text-[11px] leading-[18px] ${viewMode === key ? "bg-slate-700 text-white" : key === "waiting" && counts[key] ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{counts[key]}{counts.capped ? "+" : ""}</span> : null}</button>)}</div>
      {props.channelChips}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><div className="flex flex-col gap-0.5 px-2 py-1.5">{visible.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} selected={conversation.id === props.selectedConversationId || (props.selectedConversationId !== null && conversation.copyIds.includes(props.selectedConversationId))} tags={props.tags} filters={props.filters} now={now} draft={[conversation.id, ...conversation.copyIds].map((id) => drafts.get(id)).find(Boolean) ?? null} onChanged={applyLocal}/>)}{visible.length === 0 && !loading && !hasNextPage ? <p className="px-4 py-10 text-center text-sm text-slate-500">{viewMode === "waiting" ? "Không có khách nào đang chờ trả lời." : needle ? `Không tìm thấy hội thoại nào với “${props.filters.q}”.` : conversations.length ? "Không có hội thoại nào khớp bộ lọc." : "Chưa có cuộc hội thoại. Tin nhắn mới sẽ xuất hiện tại đây."}</p> : null}</div>
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

const LOGO_CHANNELS = ["ZALO", "FACEBOOK", "FACEBOOK_PROFILE", "EMAIL"] as const;

function ConversationRow({ conversation, selected, tags, filters, now, draft = null, onChanged }: { conversation: OmnichannelInboxConversation; selected: boolean; tags: OmnichannelInboxTag[]; filters: Filters; now: number; draft?: string | null; onChanged: (conversation: OmnichannelInboxConversation, action: string) => void }) {
  const label = conversationDisplayName(conversation);
  const conversationTags = tags.filter((tag) => conversation.tagIds.includes(tag.id));
  const waiting = conversation.latestDirection === "INBOUND" && !conversation.isGroup ? waitBadge(conversation.lastInboundAt ?? conversation.lastMessageAt, now) : null;
  const badgeChannel = (LOGO_CHANNELS as readonly string[]).includes(conversation.channelType) ? conversation.channelType : "EMAIL";
  return <div className={`group relative rounded-[10px] border transition ${selected ? "border-blue-200 bg-blue-50" : "border-transparent hover:bg-slate-50"}`}><Link prefetch={false} href={inboxHref(conversation.id, filters)} className="block px-3 py-2.5" aria-label={`${label}${waiting ? `, ${waiting.text}` : ""}`}><div className="flex items-start gap-2.5">
    <span className="relative shrink-0">{conversation.avatarUrl ? <Image unoptimized src={conversation.avatarUrl} alt="" width={40} height={40} className="size-10 rounded-full bg-slate-100 object-cover"/> : <span className="flex size-10 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: avatarColor(label) }}>{initials(label)}</span>}<span className="absolute -bottom-0.5 -right-0.5 flex rounded-full bg-white p-[1.5px]" aria-hidden="true"><ChannelLogo channel={badgeChannel} size={15}/></span></span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2"><span className={`min-w-0 truncate text-sm ${conversation.unreadCount ? "font-bold text-slate-950" : "font-semibold text-slate-800"}`}>{conversation.isPinned ? <Pin className="mr-1 inline size-3 text-blue-600"/> : null}{label}</span>{waiting ? <span className={`ml-auto shrink-0 rounded-full px-[7px] py-0.5 text-[11px] font-bold transition group-hover:opacity-0 ${waiting.className}`}>{waiting.text}</span> : <time className="ml-auto shrink-0 text-[11px] text-slate-500 transition group-hover:opacity-0">{formatCompactTime(conversation.lastMessageAt)}</time>}</div>
      <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><span className="truncate">{channelLabel(conversation.channelType)} · {conversation.accountDisplayName}</span>{conversation.copyIds.length > 1 ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold leading-4 text-slate-600" title="Nhóm có nhiều nick của mình, chỉ hiện một dòng">{conversation.copyIds.length} nick</span> : null}{conversation.isMuted ? <BellOff className="size-3 shrink-0 text-slate-400"/> : null}</div>
      <div className="mt-0.5 flex items-center gap-2"><p className={`min-w-0 flex-1 truncate text-[13px] ${conversation.unreadCount ? "font-semibold text-slate-800" : "text-slate-500"}`}>{draft && !selected ? <><span className="font-semibold text-rose-600">Nháp: </span>{draft}</> : <>{conversation.latestDirection === "OUTBOUND" ? "Bạn: " : ""}{conversation.latestText ?? "Tệp đính kèm hoặc sự kiện"}</>}</p>{conversation.unreadCount ? <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-blue-600 px-[5px] text-[11px] font-bold text-white">{conversation.unreadCount}</span> : null}</div>
      {conversationTags.length ? <div className="mt-1 flex gap-1 overflow-hidden">{conversationTags.slice(0, 3).map((tag) => <span key={tag.id} className="max-w-24 truncate rounded-full border px-1.5 py-0.5 text-[9px]" style={{ borderColor: tag.color ?? "#94a3b8" }}>{tag.name}</span>)}</div> : null}
    </div></div></Link><ConversationMenu conversation={conversation} onChanged={onChanged}/></div>;
}

function ConversationMenu({conversation,onChanged}:{conversation:OmnichannelInboxConversation;onChanged:(conversation:OmnichannelInboxConversation,action:string)=>void}){
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const menuRef=useRef<HTMLDetailsElement>(null);
  // A merged Zalo group row stands for every nick's copy, so read/unread, mute, pin, folder and delete apply to all of them.
  // The row changes at once; no page reload.
  const mutate=async(action:string)=>{if(busy)return;if(action==="SOFT_DELETE"&&!window.confirm("Xóa hội thoại này khỏi Suối Nguồn?"))return;setBusy(true);setError(null);const responses=await Promise.all(conversation.copyIds.map((id)=>fetch(`/api/inbox/conversations/${id}/preferences`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action})}).catch(()=>null)));setBusy(false);if(responses.some((response)=>response?.ok)){menuRef.current?.removeAttribute("open");onChanged(conversation,action)}else setError("Chưa làm được, vui lòng thử lại.")};
  const item="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-slate-50";
  return <details ref={menuRef} className="absolute right-1.5 top-1.5 z-20 opacity-0 focus-within:opacity-100 group-hover:opacity-100 [&[open]]:opacity-100" onClick={event=>event.stopPropagation()}><summary aria-label="Tùy chọn hội thoại" className="flex size-7 cursor-pointer list-none items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700"><MoreVertical className="size-4"/></summary><div className="absolute right-0 top-9 w-48 overflow-hidden rounded-xl border bg-white py-1 shadow-xl"><button className={item} onClick={()=>void mutate(conversation.unreadCount?"MARK_READ":"MARK_UNREAD")}><CheckCheck className="size-4"/>{conversation.unreadCount?"Đánh dấu đã đọc":"Đánh dấu chưa đọc"}</button><button className={item} onClick={()=>void mutate("TOGGLE_MUTE")}><BellOff className="size-4"/>{conversation.isMuted?"Bật thông báo":"Tắt thông báo"}</button><button className={item} onClick={()=>void mutate("TOGGLE_PIN")}><Pin className="size-4"/>{conversation.isPinned?"Bỏ ghim":"Ghim trong HireX"}</button><button className={item} onClick={()=>void mutate("TOGGLE_OTHER")}><Undo2 className="size-4"/>{conversation.folder==="OTHER"?"Chuyển về Chính":"Chuyển vào Khác"}</button><button className={`${item} text-rose-600`} onClick={()=>void mutate("SOFT_DELETE")}><Trash2 className="size-4"/>Xóa hội thoại</button>{busy?<p className="px-3 py-1.5 text-[11px] text-slate-500">Đang lưu…</p>:null}{error?<p role="alert" className="px-3 py-1.5 text-[11px] text-rose-600">{error}</p>:null}</div></details>;
}

function inboxHref(conversationId: string, filters: Filters) { const query = filterQuery(filters); return `/inbox/all/${conversationId}${query.size ? `?${query}` : ""}`; }
const AVATAR_COLORS = ["#7c3aed", "#0891b2", "#ea580c", "#059669", "#2563eb", "#db2777", "#4f46e5", "#0d9488"];
function avatarColor(name: string) { let hash = 0; for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return AVATAR_COLORS[hash % AVATAR_COLORS.length]; }
export function initials(name: string) { const words = name.replace(/@.*$/u, "").split(/[\s._-]+/u).filter((word) => /\p{L}|\d/u.test(word)); if (words.length === 0) return "?"; const pick = words.length === 1 ? [words[0]] : [words[words.length - 2], words[words.length - 1]]; return pick.map((word) => Array.from(word)[0] ?? "").join("").toUpperCase(); }
function normalize(value: string) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().trim(); }
function channelLabel(channel: ChannelType) { return channel === "EMAIL" ? "Email" : channel === "FACEBOOK" ? "Facebook Page" : channel === "FACEBOOK_PROFILE" ? "Facebook cá nhân" : channel === "ZALO" ? "Zalo" : channel; }
function formatCompactTime(value: string | null) { if (!value) return "—"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "—"; return new Intl.DateTimeFormat("vi-VN", date.toDateString() === new Date().toDateString() ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" }).format(date); }
