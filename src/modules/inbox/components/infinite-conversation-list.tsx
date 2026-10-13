"use client";

import Image from "next/image";
import Link from "next/link";
import { BellOff, CheckCheck, LoaderCircle, Mail, MessageCircle, MoreVertical, Pin, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelType } from "@/modules/channels/core/channel-contracts";
import type { OmnichannelInboxConversation, OmnichannelInboxTag } from "../types/omnichannel-inbox";
import { INBOX_CONVERSATION_EVENT, INBOX_MESSAGE_EVENT, type RealtimeMessageRow } from "./inbox-live-events";

interface Filters { channel: ChannelType | null; account: string | null; ownerIds: string[]; tagIds: string[]; tagMatchMode: "all" | "any"; firstMessageFrom: string | null; firstMessageTo: string | null }

export function InfiniteConversationList(props: { initialConversations: OmnichannelInboxConversation[]; initialHasNextPage: boolean; selectedConversationId: string | null; tags: OmnichannelInboxTag[]; filters: Filters }) {
  const [conversations, setConversations] = useState(props.initialConversations);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(props.initialHasNextPage);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [viewMode,setViewMode]=useState<"all"|"unread"|"labels"|"other">("all");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const filterKey = JSON.stringify(props.filters);
  const previousFilterKeyRef = useRef(filterKey);

  useEffect(() => {
    if (previousFilterKeyRef.current !== filterKey) {
      previousFilterKeyRef.current = filterKey;
      setConversations(props.initialConversations); setPage(1); setHasNextPage(props.initialHasNextPage); setLoading(false); setFailed(false);
      return;
    }
    setConversations((current) => { const refreshedIds = new Set(props.initialConversations.map((item) => item.id)); return [...props.initialConversations, ...current.filter((item) => !refreshedIds.has(item.id))]; });
  }, [props.initialConversations, props.initialHasNextPage, filterKey]);

  useEffect(() => {
    const onMessage = (event: Event) => {
      const row = (event as CustomEvent<RealtimeMessageRow>).detail;
      if (!row?.conversation_id) return;
      setConversations((current) => {
        const index = current.findIndex((item) => item.id === row.conversation_id);
        if (index < 0) return current;
        const previous = current[index];
        const timestamp = row.received_at ?? row.sent_at ?? row.created_at;
        const updated = { ...previous, latestText: row.text_content, latestDirection: row.direction, lastMessageAt: timestamp,
          lastInboundAt: row.direction === "INBOUND" ? timestamp : previous.lastInboundAt,
          unreadCount: row.direction === "INBOUND" && row.conversation_id !== props.selectedConversationId ? previous.unreadCount + 1 : previous.unreadCount };
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
      setConversations((current) => { const ids = new Set(current.map((item) => item.id)); return [...current, ...payload.conversations.filter((item) => !ids.has(item.id))]; });
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

  const visible=conversations.filter(item=>viewMode==="all"?item.folder!=="OTHER":viewMode==="unread"?item.unreadCount>0:viewMode==="labels"?item.tagIds.length>0:item.folder==="OTHER").sort((a,b)=>Number(b.isPinned)-Number(a.isPinned));
  return <div className="min-h-0 flex flex-1 flex-col"><div className="flex shrink-0 border-b px-3 pt-1">{([['all','Tất cả'],['unread',`Chưa đọc ${conversations.filter(x=>x.unreadCount>0).length||''}`],['labels','Nhãn'],['other','Khác']] as const).map(([key,label])=><button key={key} onClick={()=>setViewMode(key)} className={`border-b-2 px-3 py-2 text-xs font-semibold ${viewMode===key?"border-blue-600 text-blue-600":"border-transparent text-slate-500"}`}>{label}</button>)}</div><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><div className="divide-y divide-slate-100">{visible.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} selected={conversation.id === props.selectedConversationId} tags={props.tags} filters={props.filters}/>)}</div><div ref={sentinelRef} className="flex min-h-14 items-center justify-center px-3 py-3">{loading ? <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500"><LoaderCircle className="size-4 animate-spin"/>Đang tải thêm hội thoại…</span> : failed ? <button type="button" onClick={() => void loadMore()} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">Thử tải lại</button> : hasNextPage ? <span className="text-xs text-slate-400">Cuộn xuống để tải thêm</span> : <span className="text-xs text-slate-400">Đã hiển thị toàn bộ hội thoại</span>}</div></div></div>;
}

function ConversationRow({ conversation, selected, tags, filters }: { conversation: OmnichannelInboxConversation; selected: boolean; tags: OmnichannelInboxTag[]; filters: Filters }) {
  const label = conversation.contactName ?? conversation.participantName ?? conversation.senderExternalId ?? "Liên hệ chưa xác định";
  const conversationTags = tags.filter((tag) => conversation.tagIds.includes(tag.id));
  return <div className={`group relative border-l-4 transition ${selected ? "border-l-blue-600 bg-blue-50/80" : "border-l-transparent hover:bg-slate-50"}`}><Link href={inboxHref(conversation.id, filters)} className="block px-3 py-3.5 pr-10"><div className="flex items-start gap-3">{conversation.avatarUrl ? <Image unoptimized src={conversation.avatarUrl} alt="" width={44} height={44} className="size-11 shrink-0 rounded-full bg-slate-100 object-cover ring-2 ring-white"/> : <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">{channelIcon(conversation.channelType)}</span>}<div className="min-w-0 flex-1"><div className="flex items-baseline gap-2"><span className="truncate text-sm font-bold text-slate-900">{conversation.isPinned?<Pin className="mr-1 inline size-3 text-blue-600"/>:null}{label}</span><time className="ml-auto shrink-0 text-[10px] text-slate-400">{formatCompactTime(conversation.lastMessageAt)}</time></div><div className="mt-0.5 flex gap-1.5"><span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">{channelLabel(conversation.channelType)}</span><span className="truncate text-[11px] text-slate-400">{conversation.accountDisplayName}</span>{conversation.isMuted?<BellOff className="size-3 text-slate-400"/>:null}</div>{conversationTags.length?<div className="mt-1 flex gap-1 overflow-hidden">{conversationTags.slice(0,3).map(tag=><span key={tag.id} className="max-w-24 truncate rounded-full border px-1.5 py-0.5 text-[9px]" style={{borderColor:tag.color??"#94a3b8"}}>{tag.name}</span>)}</div>:null}<div className="mt-1 flex items-center gap-2"><p className={`min-w-0 flex-1 truncate text-xs ${conversation.unreadCount?"font-semibold text-slate-700":"text-slate-500"}`}>{conversation.latestDirection==="OUTBOUND"?"Bạn: ":""}{conversation.latestText??"Tệp đính kèm hoặc sự kiện"}</p>{conversation.unreadCount?<span className="min-w-5 rounded-full bg-blue-600 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">{conversation.unreadCount}</span>:null}</div></div></div></Link><ConversationMenu conversation={conversation}/></div>;
}

function ConversationMenu({conversation}:{conversation:OmnichannelInboxConversation}){
  const mutate=async(action:string)=>{const response=await fetch(`/api/inbox/conversations/${conversation.id}/preferences`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action})});if(response.ok)window.location.reload()};
  const item="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-slate-50";
  return <details className="absolute right-1 top-2 z-20" onClick={event=>event.stopPropagation()}><summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700"><MoreVertical className="size-4"/></summary><div className="absolute right-0 top-9 w-48 overflow-hidden rounded-xl border bg-white py-1 shadow-xl"><button className={item} onClick={()=>void mutate(conversation.unreadCount?"MARK_READ":"MARK_UNREAD")}><CheckCheck className="size-4"/>{conversation.unreadCount?"Đánh dấu đã đọc":"Đánh dấu chưa đọc"}</button><button className={item} onClick={()=>void mutate("TOGGLE_MUTE")}><BellOff className="size-4"/>{conversation.isMuted?"Bật thông báo":"Tắt thông báo"}</button><button className={item} onClick={()=>void mutate("TOGGLE_PIN")}><Pin className="size-4"/>{conversation.isPinned?"Bỏ ghim":"Ghim trong HireX"}</button><button className={item} onClick={()=>void mutate("TOGGLE_OTHER")}><Undo2 className="size-4"/>{conversation.folder==="OTHER"?"Chuyển về Chính":"Chuyển vào Khác"}</button><button className={`${item} text-rose-600`} onClick={()=>void mutate("SOFT_DELETE")}><Trash2 className="size-4"/>Xóa hội thoại</button></div></details>;
}

function inboxHref(conversationId: string, filters: Filters) { const query = new URLSearchParams(); if (filters.channel) query.set("channel", filters.channel); if (filters.account) query.set("account", filters.account); for (const owner of filters.ownerIds) query.append("owner", owner); for (const tag of filters.tagIds) query.append("tag", tag); if (filters.tagIds.length) query.set("tagMode", filters.tagMatchMode); if (filters.firstMessageFrom) query.set("firstFrom", filters.firstMessageFrom); if (filters.firstMessageTo) query.set("firstTo", filters.firstMessageTo); return `/inbox/all/${conversationId}${query.size ? `?${query}` : ""}`; }
function channelIcon(channel: ChannelType) { if (channel === "EMAIL") return <Mail className="size-4"/>; if (channel === "FACEBOOK" || channel === "FACEBOOK_PROFILE") return <span className="text-xs font-black">f</span>; return <MessageCircle className="size-4"/>; }
function channelLabel(channel: ChannelType) { return channel === "EMAIL" ? "Email" : channel === "FACEBOOK" ? "Facebook Page" : channel === "FACEBOOK_PROFILE" ? "Facebook cá nhân" : channel === "ZALO" ? "Zalo" : channel; }
function formatCompactTime(value: string | null) { if (!value) return "—"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "—"; return new Intl.DateTimeFormat("vi-VN", date.toDateString() === new Date().toDateString() ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" }).format(date); }
