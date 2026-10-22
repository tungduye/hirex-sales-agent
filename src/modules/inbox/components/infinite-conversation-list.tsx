"use client";

import Image from "next/image";
import { ChannelLogo } from "@/modules/channels/components/channel-logo";
import Link from "next/link";
import { Bell, BellOff, Bot, BotOff, Check, ChevronLeft, ChevronRight, LoaderCircle, Pin, Search, Star, Trash2, UserRound, UserX, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChannelType } from "@/modules/channels/core/channel-contracts";
import type { OmnichannelInboxConversation, OmnichannelInboxProfile, OmnichannelInboxTag } from "../types/omnichannel-inbox";
import { BulkUndoNotice, InboxBulkBar, readLastBulk, type BulkAction, type BulkDone, type BulkTarget } from "./inbox-bulk-bar";
import { INBOX_CONVERSATION_EVENT, INBOX_MESSAGE_EVENT, type RealtimeMessageRow } from "./inbox-live-events";
import { appendPage, rowIndexFor } from "../core/group-merge";
import { DRAFT_EVENT, draftStore, listDrafts } from "@/modules/channels/core/composer-drafts";
import { INBOX_REFRESH_EVENT } from "./inbox-refresh-event";

interface Filters { channel: string | null; account: string | null; ownerIds: string[]; tagIds: string[]; tagMatchMode: "all" | "any"; firstMessageFrom: string | null; firstMessageTo: string | null; view?: ViewMode; q?: string }

type ViewMode = "all" | "waiting" | "mine" | "groups" | "other" | "important";
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

export function InfiniteConversationList(props: { initialConversations: OmnichannelInboxConversation[]; initialHasNextPage: boolean; initialNextCursor: string | null; selectedConversationId: string | null; tags: OmnichannelInboxTag[]; filters: Filters; currentUserId: string | null; filterControl?: ReactNode; channelChips?: ReactNode; canUpdate?: boolean; canDelete?: boolean; profiles?: OmnichannelInboxProfile[] }) {
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
  // Bulk actions: picked rows (by row id), or every conversation the filters select.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [lastPick, setLastPick] = useState<string | null>(null);
  const [filterPick, setFilterPick] = useState<{ count: number; more: boolean } | null>(null);
  const [pickingFilter, setPickingFilter] = useState(false);
  const [createdTags, setCreatedTags] = useState<OmnichannelInboxTag[]>([]);
  const [lastBulk, setLastBulk] = useState<BulkDone | null>(() => typeof window === "undefined" ? null : readLastBulk());
  const allTags = [...props.tags, ...createdTags.filter((tag) => !props.tags.some((item) => item.id === tag.id))];
  const clearPick = useCallback(() => { setPicked(new Set()); setFilterPick(null); setLastPick(null); }, []);
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
      setPicked(new Set()); setFilterPick(null); setLastPick(null);
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

  // E-mail from robots (no-reply, notifications…) and the old "Khác" folder: left out of the tabs, found by searching.
  const isOther = (item: OmnichannelInboxConversation) => item.folder === "OTHER" || item.automated;
  const needle = normalize(props.filters.q ?? "");
  const searching = needle !== "";
  // The server already picked the tab's rows; this second look keeps rows changed live (a reply, a
  // mark, a new owner) in the right tab until the next load. Của tôi: assigned to me, or (unassigned)
  // on my nick — the server only sends unassigned rows of my nicks.
  const matches = (item: OmnichannelInboxConversation) => viewMode === "groups" ? item.isGroup
    : viewMode === "important" ? item.isImportant
    : viewMode === "other" ? !item.isGroup && isOther(item)
    : viewMode === "waiting" ? !item.isGroup && !isOther(item) && item.latestDirection === "INBOUND"
    : viewMode === "mine" ? (!isOther(item) || searching) && props.currentUserId !== null && (item.assignedTo === props.currentUserId || (!item.isGroup && item.assignedTo === null))
    : !item.isGroup && (!isOther(item) || searching);
  // "Chưa trả lời": longest wait first. Elsewhere: pinned (for everyone or just me) first, then newest.
  const visible = conversations.filter(matches).sort((a, b) => viewMode === "waiting"
    ? (Date.parse(a.lastInboundAt ?? a.lastMessageAt ?? "") || 0) - (Date.parse(b.lastInboundAt ?? b.lastMessageAt ?? "") || 0)
    : Number(b.isPinned || b.isMyPin) - Number(a.isPinned || a.isMyPin));
  // A page may hold no row for this tab (the server stops looking after a while): keep loading until a few show.
  useEffect(() => {
    if (loading || failed || !hasNextPage || visible.length >= 15) return;
    const timer = window.setTimeout(() => void loadMore(), 0);
    return () => window.clearTimeout(timer);
  }, [failed, hasNextPage, loadMore, loading, visible.length]);
  // Menu actions change the row here at once; the list reloads quietly in the background.
  const applyLocal = useCallback((conversation: OmnichannelInboxConversation, action: string, value?: string | null) => {
    setConversations((current) => action === "SOFT_DELETE" ? current.filter((item) => item.id !== conversation.id) : current.map((item) => item.id !== conversation.id ? item
      : action === "MARK_READ" ? { ...item, unreadCount: 0 } : action === "MARK_UNREAD" ? { ...item, unreadCount: Math.max(1, item.unreadCount) }
      : action === "TOGGLE_MUTE" ? { ...item, isMuted: !item.isMuted } : action === "TOGGLE_PIN" ? { ...item, isPinned: !item.isPinned }
      : action === "TOGGLE_OTHER" ? { ...item, folder: item.folder === "OTHER" ? "PRIMARY" : "OTHER" }
      : action === "TOGGLE_MY_PIN" ? { ...item, isMyPin: !item.isMyPin } : action === "TOGGLE_IMPORTANT" ? { ...item, isImportant: !item.isImportant }
      : action === "ASSIGN" ? { ...item, assignedTo: value ?? null }
      : action === "AI_ON" ? { ...item, takeoverMode: "BOT_ALLOWED", aiBotId: value ?? null } : action === "AI_OFF" ? { ...item, takeoverMode: "HUMAN_TAKEOVER" } : item));
    countCache.clear();
    window.dispatchEvent(new Event(INBOX_REFRESH_EVENT));
  }, []);
  // Picking: a click toggles one row, Shift+click picks every row between the last pick and this one.
  const pickRow = (id: string, range: boolean) => {
    setFilterPick(null);
    setPicked((current) => {
      const next = new Set(current);
      const from = lastPick ? visible.findIndex((item) => item.id === lastPick) : -1;
      const to = visible.findIndex((item) => item.id === id);
      if (range && from >= 0 && to >= 0) for (const item of visible.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(item.id);
      else if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setLastPick(id);
  };
  const pickedRows = visible.filter((item) => picked.has(item.id));
  const bulkTarget: BulkTarget | null = filterPick ? { kind: "filter", filterQuery: filterQuery(props.filters).toString(), count: filterPick.count, more: filterPick.more }
    : pickedRows.length ? { kind: "rows", conversationIds: pickedRows.flatMap((item) => item.copyIds.length ? item.copyIds : [item.id]), rowCount: pickedRows.length } : null;
  const pickFilter = async () => {
    setPickingFilter(true);
    try {
      const response = await fetch("/api/inbox/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "MARK_READ", dryRun: true, filterQuery: filterQuery(props.filters).toString() }) });
      const payload = await response.json().catch(() => null) as { count?: number; more?: boolean } | null;
      if (response.ok && typeof payload?.count === "number") setFilterPick({ count: payload.count, more: Boolean(payload.more) });
    } finally { setPickingFilter(false); }
  };
  const bulkActive = bulkTarget !== null;
  useEffect(() => {
    if (!bulkActive) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !(event.target instanceof HTMLInputElement)) clearPick(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bulkActive, clearPick]);
  const onBulkDone = (action: BulkAction, input: { tagIds: string[]; assigneeId: string | null }, done: BulkDone) => {
    if (!filterPick) {
      const ids = new Set(pickedRows.map((item) => item.id));
      setConversations((current) => current.map((item) => !ids.has(item.id) ? item
        : action === "TAG_ADD" ? { ...item, tagIds: [...new Set([...item.tagIds, ...input.tagIds])] }
        : action === "TAG_REMOVE" ? { ...item, tagIds: item.tagIds.filter((id) => !input.tagIds.includes(id)) }
        : action === "MARK_READ" ? { ...item, unreadCount: 0 }
        : action === "MOVE_OTHER" ? { ...item, folder: "OTHER" } : action === "MOVE_PRIMARY" ? { ...item, folder: "PRIMARY" }
        : { ...item, assignedTo: input.assigneeId }));
    }
    clearPick(); setLastBulk(done); countCache.clear();
    window.dispatchEvent(new Event(INBOX_REFRESH_EVENT));
  };
  const tabs: Array<[ViewMode, string]> = [["all", "All"], ["mine", "Của tôi"], ["groups", "Nhóm"], ["waiting", "Chưa trả lời"], ["important", "Quan trọng"]];
  const menuContext: MenuContext = { profiles: props.profiles ?? [], canUpdate: props.canUpdate ?? false, canDelete: props.canDelete ?? false };
  return <div className="min-h-0 flex flex-1 flex-col">
    <div className="relative flex shrink-0 flex-col gap-2.5 border-b border-slate-100 px-3.5 pb-2.5 pt-2.5">
      <div className="flex gap-2"><label className="relative block min-w-0 flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Tìm theo tên, số điện thoại, email, tên nhóm" placeholder="Tìm tên, SĐT, email, nhóm…" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-8 text-[13px] outline-none focus:border-blue-400 focus:bg-white"/>{search ? <button type="button" onClick={() => setSearch("")} aria-label="Xóa tìm kiếm" className="absolute right-1.5 top-1.5 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4"/></button> : null}</label>{props.filterControl}</div>
      {bulkTarget ? <InboxBulkBar target={bulkTarget} visibleCount={visible.length} allVisiblePicked={pickedRows.length === visible.length} tags={allTags} profiles={props.profiles ?? []}
        onPickVisible={() => { setFilterPick(null); setPicked(new Set(visible.map((item) => item.id))); }} onPickFilter={() => void pickFilter()} pickingFilter={pickingFilter} onClear={clearPick}
        onTagCreated={(tag) => setCreatedTags((current) => [...current, tag])} onDone={onBulkDone}/> : null}
      {lastBulk && !bulkTarget ? <BulkUndoNotice done={lastBulk} onClose={() => setLastBulk(null)} onUndone={() => { setLastBulk(null); countCache.clear(); window.dispatchEvent(new Event(INBOX_REFRESH_EVENT)); }}/> : null}
      <div role="tablist" aria-label="Lọc nhanh hội thoại" className={`${bulkTarget ? "hidden" : "flex"} flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none]`}>{tabs.map(([key, label]) => {
        const active = viewMode === key;
        const urgent = key === "waiting";
        // Numbers only where they mean work to do (Chưa trả lời, Quan trọng): the tabs stay on one line.
        const count = counts && (key === "waiting" || key === "important") ? counts[key] : null;
        // Chưa trả lời always stands out: red with white text.
        const tone = urgent ? (active ? "bg-rose-600 text-white ring-2 ring-rose-300" : "bg-rose-500 text-white hover:bg-rose-600") : active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100";
        return <button key={key} type="button" role="tab" aria-selected={active} onClick={() => setViewMode(key)} className={`inline-flex min-h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-[12.5px] font-semibold transition ${tone}`}>{label}{count !== null ? <span title="Hội thoại có tin trong 30 ngày gần nhất" className={`rounded-full px-1.5 text-[10.5px] leading-[17px] tabular-nums ${urgent ? "bg-white/25 text-white" : active ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}>{count !== null && count > 999 ? "999+" : count}{counts?.capped && count !== null && count <= 999 ? "+" : ""}</span> : null}</button>;
      })}</div>
      {props.channelChips}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><div className="flex flex-col gap-0.5 px-2 py-1.5">{visible.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} selected={conversation.id === props.selectedConversationId || (props.selectedConversationId !== null && conversation.copyIds.includes(props.selectedConversationId))} tags={allTags} filters={props.filters} now={now} draft={[conversation.id, ...conversation.copyIds].map((id) => drafts.get(id)).find(Boolean) ?? null} onChanged={applyLocal} menu={menuContext}
      pick={props.canUpdate ? { picked: Boolean(filterPick) || picked.has(conversation.id), picking: Boolean(bulkTarget), toggle: (range) => pickRow(conversation.id, range) } : null}/>)}{visible.length === 0 && !loading && !hasNextPage ? <p className="px-4 py-10 text-center text-sm text-slate-500">{viewMode === "waiting" ? "Không có khách nào đang chờ trả lời." : needle ? `Không tìm thấy hội thoại nào với “${props.filters.q}”.` : conversations.length ? "Không có hội thoại nào khớp bộ lọc." : "Chưa có cuộc hội thoại. Tin nhắn mới sẽ xuất hiện tại đây."}</p> : null}</div>
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

function ConversationRow({ conversation, selected, tags, filters, now, draft = null, onChanged, pick, menu }: { conversation: OmnichannelInboxConversation; selected: boolean; tags: OmnichannelInboxTag[]; filters: Filters; now: number; draft?: string | null; onChanged: (conversation: OmnichannelInboxConversation, action: string, value?: string | null) => void; pick: { picked: boolean; picking: boolean; toggle: (range: boolean) => void } | null; menu: MenuContext }) {
  const label = conversationDisplayName(conversation);
  const conversationTags = tags.filter((tag) => conversation.tagIds.includes(tag.id));
  const waiting = conversation.latestDirection === "INBOUND" && !conversation.isGroup ? waitBadge(conversation.lastInboundAt ?? conversation.lastMessageAt, now) : null;
  const badgeChannel = (LOGO_CHANNELS as readonly string[]).includes(conversation.channelType) ? conversation.channelType : "EMAIL";
  const [menuOpen, setMenuOpen] = useState(false);
  const avatar = conversation.avatarUrl ? <Image unoptimized src={conversation.avatarUrl} alt="" width={40} height={40} className="size-10 rounded-full bg-slate-100 object-cover"/> : <span className="flex size-10 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: avatarColor(label) }}>{initials(label)}</span>;
  return <div className={`group relative rounded-[10px] border transition ${pick?.picked ? "border-blue-300 bg-blue-50/70" : selected ? "border-blue-200 bg-blue-50" : "border-transparent hover:bg-slate-50"} ${menuOpen ? "z-30" : ""}`}>
    {/* Tick box to pick several rows: appears on hover (always while picking). Shift+click picks a range. */}
    {pick ? <button type="button" role="checkbox" aria-checked={pick.picked} aria-label={`Chọn ${label}`} title="Chọn nhiều (Shift+bấm để chọn một dải)"
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); pick.toggle(event.shiftKey); }}
      className={`absolute left-0.5 top-1/2 z-10 flex size-4 -translate-y-1/2 items-center justify-center rounded border transition ${pick.picked ? "border-blue-600 bg-blue-600 opacity-100" : pick.picking ? "border-slate-400 bg-white opacity-100" : "border-slate-400 bg-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}>
      {pick.picked ? <Check className="size-3 text-white" strokeWidth={3}/> : null}</button> : null}
    <Link prefetch={false} href={inboxHref(conversation.id, filters)} className="block py-2.5 pl-5 pr-3" aria-label={`${label}${waiting ? `, ${waiting.text}` : ""}`}><div className="flex items-start gap-2.5">
    <span className="relative shrink-0"><button type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Tùy chọn cho ${label}`} title="Tùy chọn hội thoại"
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen((open) => !open); }}
      className="block rounded-full outline-none ring-blue-400 transition hover:ring-2 focus-visible:ring-2">{avatar}</button><span className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex rounded-full bg-white p-[1.5px]" aria-hidden="true"><ChannelLogo channel={badgeChannel} size={15}/></span></span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2"><span className={`min-w-0 truncate text-sm ${conversation.unreadCount ? "font-bold text-slate-950" : "font-semibold text-slate-800"}`}>{conversation.isPinned ? <Pin className="mr-1 inline size-3 text-blue-600" aria-label="Ghim trong tất cả"/> : null}{conversation.isMyPin ? <Pin className="mr-1 inline size-3 text-violet-600" aria-label="Ghim trong cá nhân"/> : null}{conversation.isImportant ? <Star className="mr-1 inline size-3 fill-amber-400 text-amber-500" aria-label="Quan trọng"/> : null}{label}</span>{waiting ? <span className={`ml-auto shrink-0 rounded-full px-[7px] py-0.5 text-[11px] font-bold ${waiting.className}`}>{waiting.text}</span> : <time className="ml-auto shrink-0 text-[11px] text-slate-500">{formatCompactTime(conversation.lastMessageAt)}</time>}</div>
      <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><span className="truncate">{channelLabel(conversation.channelType)} · {conversation.accountDisplayName}</span>{conversation.copyIds.length > 1 ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold leading-4 text-slate-600" title="Nhóm có nhiều nick của mình, chỉ hiện một dòng">{conversation.copyIds.length} nick</span> : null}{conversation.isMuted ? <BellOff className="size-3 shrink-0 text-slate-400"/> : null}</div>
      <div className="mt-0.5 flex items-center gap-2"><p className={`min-w-0 flex-1 truncate text-[13px] ${conversation.unreadCount ? "font-semibold text-slate-800" : "text-slate-500"}`}>{draft && !selected ? <><span className="font-semibold text-rose-600">Nháp: </span>{draft}</> : <>{conversation.latestDirection === "OUTBOUND" ? "Bạn: " : ""}{conversation.latestText ?? "Tệp đính kèm hoặc sự kiện"}</>}</p>{conversation.unreadCount ? <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-blue-600 px-[5px] text-[11px] font-bold text-white">{conversation.unreadCount}</span> : null}</div>
      {conversationTags.length ? <div className="mt-1 flex gap-1 overflow-hidden">{conversationTags.slice(0, 3).map((tag) => <span key={tag.id} className="max-w-24 truncate rounded-full border px-1.5 py-0.5 text-[9px]" style={{ borderColor: tag.color ?? "#94a3b8" }}>{tag.name}</span>)}</div> : null}
    </div></div></Link>{menuOpen ? <ConversationMenu conversation={conversation} onChanged={onChanged} onClose={() => setMenuOpen(false)} context={menu}/> : null}</div>;
}

/** What the avatar menu needs besides the row: who can be given the conversation, the AI versions, and rights. */
interface MenuContext { profiles: OmnichannelInboxProfile[]; canUpdate: boolean; canDelete: boolean }
type AiBots = { bots: Array<{ id: string; name: string; botType: string }>; bindings: Record<string, string> };
let aiBotsRequest: Promise<AiBots | null> | null = null;
function loadAiBots() {
  aiBotsRequest ??= fetch("/api/inbox/ai-bots", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<AiBots> : null).catch(() => null)
    .then((value) => { if (!value) aiBotsRequest = null; return value; });
  return aiBotsRequest;
}

/** Menu opened by clicking the avatar. A merged Zalo group row stands for every nick's copy: each action applies to all of them. */
function ConversationMenu({ conversation, onChanged, onClose, context }: { conversation: OmnichannelInboxConversation; onChanged: (conversation: OmnichannelInboxConversation, action: string, value?: string | null) => void; onClose: () => void; context: MenuContext }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"main" | "assign" | "ai">("main");
  const [ai, setAi] = useState<AiBots | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [onClose]);
  useEffect(() => { if (panel === "ai" && !ai) void loadAiBots().then((value) => { if (value) setAi(value); else setError("Chưa tải được danh sách phiên bản AI."); }); }, [panel, ai]);
  const run = async (action: string, send: (id: string) => Promise<Response | null>, value?: string | null) => {
    if (busy) return;
    setBusy(true); setError(null);
    const responses = await Promise.all(conversation.copyIds.map(send));
    setBusy(false);
    if (responses.some((response) => response?.ok)) { onChanged(conversation, action, value); onClose(); }
    else setError("Chưa làm được, vui lòng thử lại.");
  };
  const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const preference = (action: string) => { if (action === "SOFT_DELETE" && !window.confirm("Xóa hội thoại này khỏi Suối Nguồn?")) return; void run(action, (id) => post(`/api/inbox/conversations/${id}/preferences`, { action })); };
  const assign = (assigneeId: string | null) => void run("ASSIGN", async () => post("/api/inbox/bulk", { action: "ASSIGN", conversationIds: conversation.copyIds, assigneeId }), assigneeId);
  const setAiMode = (enabled: boolean, botId: string | null) => void run(enabled ? "AI_ON" : "AI_OFF", (id) => post(`/api/inbox/conversations/${id}/ai`, { enabled, botId }), botId);
  // Only people who may see this nick can be given the conversation.
  const people = context.profiles.filter((profile) => profile.allChannelAccounts || conversation.copyAccountIds.some((id) => profile.channelAccountIds.includes(id)));
  const owner = context.profiles.find((profile) => profile.id === conversation.assignedTo)?.fullName ?? null;
  const aiOn = conversation.takeoverMode === "BOT_ALLOWED";
  const nickBot = ai ? ai.bots.find((bot) => bot.id === ai.bindings[conversation.channelAccountId]) ?? null : null;
  const item = "flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
  const back = <button type="button" className={`${item} border-b border-slate-100 font-semibold text-slate-500`} onClick={() => { setPanel("main"); setError(null); }}><ChevronLeft className="size-4"/>Quay lại</button>;
  return <div ref={ref} role="menu" aria-label="Tùy chọn hội thoại" onClick={(event) => event.stopPropagation()} className="absolute left-4 top-[3.25rem] z-40 w-60 overflow-hidden rounded-xl border bg-white py-1 shadow-xl">
    {!context.canUpdate ? <p className="px-3 py-2 text-xs text-slate-500">Bạn chỉ có quyền xem hội thoại này.</p>
    : panel === "assign" ? <>{back}<div className="max-h-64 overflow-y-auto">
      <button type="button" disabled={busy} className={item} onClick={() => assign(null)}><UserX className="size-4"/>Bỏ giao (Owner là người dùng chính của nick)</button>
      {people.map((profile) => <button key={profile.id} type="button" disabled={busy} className={item} onClick={() => assign(profile.id)}><UserRound className="size-4"/><span className="min-w-0 flex-1 truncate">{profile.fullName}</span>{profile.id === conversation.assignedTo ? <Check className="size-3.5 text-blue-600"/> : null}</button>)}
    </div></>
    : panel === "ai" ? <>{back}
      <button type="button" disabled={busy} className={item} onClick={() => setAiMode(false, null)}><BotOff className="size-4"/><span className="flex-1">Tắt AI</span>{!aiOn ? <Check className="size-3.5 text-blue-600"/> : null}</button>
      <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Bật AI · chọn phiên bản</p>
      {!ai ? <p className="px-3 py-2 text-xs text-slate-500">Đang tải…</p> : <>
        <button type="button" disabled={busy || !nickBot} className={item} onClick={() => setAiMode(true, null)}><Bot className="size-4"/><span className="min-w-0 flex-1 truncate">Theo nick{nickBot ? ` (${nickBot.name})` : " (nick chưa gắn AI)"}</span>{aiOn && !conversation.aiBotId ? <Check className="size-3.5 text-blue-600"/> : null}</button>
        {ai.bots.map((bot) => <button key={bot.id} type="button" disabled={busy} className={item} onClick={() => setAiMode(true, bot.id)}><Bot className="size-4"/><span className="min-w-0 flex-1 truncate">{bot.name}</span>{aiOn && conversation.aiBotId === bot.id ? <Check className="size-3.5 text-blue-600"/> : null}</button>)}
        {ai.bots.length === 0 ? <p className="px-3 py-2 text-xs text-slate-500">Chưa có phiên bản AI nào đang bật.</p> : null}
      </>}
    </>
    : <>
      <button type="button" disabled={busy} className={item} onClick={() => preference("TOGGLE_MUTE")}>{conversation.isMuted ? <Bell className="size-4"/> : <BellOff className="size-4"/>}{conversation.isMuted ? "Bật thông báo" : "Tắt thông báo"}</button>
      <button type="button" disabled={busy} className={item} onClick={() => preference("TOGGLE_PIN")}><Pin className="size-4 text-blue-600"/>{conversation.isPinned ? "Bỏ ghim trong tất cả" : "Ghim trong tất cả"}</button>
      <button type="button" disabled={busy} className={item} onClick={() => preference("TOGGLE_MY_PIN")}><Pin className="size-4 text-violet-600"/>{conversation.isMyPin ? "Bỏ ghim trong cá nhân" : "Ghim trong cá nhân"}</button>
      <button type="button" disabled={busy} className={item} onClick={() => preference("TOGGLE_IMPORTANT")}><Star className="size-4 text-amber-500"/>{conversation.isImportant ? "Bỏ khỏi Quan trọng" : "Chuyển vào Quan trọng"}</button>
      <button type="button" disabled={busy} className={item} onClick={() => setPanel("assign")}><UserRound className="size-4"/><span className="min-w-0 flex-1 truncate">Giao việc{owner ? ` · ${owner}` : ""}</span><ChevronRight className="size-3.5 text-slate-400"/></button>
      <button type="button" disabled={busy} className={item} onClick={() => setPanel("ai")}><Bot className="size-4"/><span className="flex-1">Phiên bản AI</span><span className={`rounded-full px-1.5 text-[10px] font-semibold ${aiOn ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{aiOn ? "Bật" : "Tắt"}</span><ChevronRight className="size-3.5 text-slate-400"/></button>
      {context.canDelete ? <button type="button" disabled={busy} className={`${item} border-t border-slate-100 text-rose-600`} onClick={() => preference("SOFT_DELETE")}><Trash2 className="size-4"/>Xóa hội thoại</button> : null}
    </>}
    {busy ? <p className="px-3 py-1.5 text-[11px] text-slate-500">Đang lưu…</p> : null}{error ? <p role="alert" className="px-3 py-1.5 text-[11px] text-rose-600">{error}</p> : null}
  </div>;
}

function inboxHref(conversationId: string, filters: Filters) { const query = filterQuery(filters); return `/inbox/all/${conversationId}${query.size ? `?${query}` : ""}`; }
const AVATAR_COLORS = ["#7c3aed", "#0891b2", "#ea580c", "#059669", "#2563eb", "#db2777", "#4f46e5", "#0d9488"];
function avatarColor(name: string) { let hash = 0; for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return AVATAR_COLORS[hash % AVATAR_COLORS.length]; }
export function initials(name: string) { const words = name.replace(/@.*$/u, "").split(/[\s._-]+/u).filter((word) => /\p{L}|\d/u.test(word)); if (words.length === 0) return "?"; const pick = words.length === 1 ? [words[0]] : [words[words.length - 2], words[words.length - 1]]; return pick.map((word) => Array.from(word)[0] ?? "").join("").toUpperCase(); }
function normalize(value: string) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().trim(); }
function channelLabel(channel: ChannelType) { return channel === "EMAIL" ? "Email" : channel === "FACEBOOK" ? "Facebook Page" : channel === "FACEBOOK_PROFILE" ? "Facebook cá nhân" : channel === "ZALO" ? "Zalo" : channel; }
function formatCompactTime(value: string | null) { if (!value) return "—"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "—"; return new Intl.DateTimeFormat("vi-VN", date.toDateString() === new Date().toDateString() ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" }).format(date); }
