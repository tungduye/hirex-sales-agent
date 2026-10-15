"use client";

import { AlertCircle, ArrowLeft, CheckCheck, Download, Mail, MessageCircle, MoreHorizontal, Paperclip, UserRound } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { ConversationComposer } from "@/modules/channels/components/conversation-composer";
import { ConversationControls } from "@/modules/channels/components/conversation-controls";
import { UnknownDeliveryAcknowledgement } from "@/modules/channels/components/unknown-delivery-acknowledgement";
import type { QuickReplyTemplate } from "@/modules/channels/types/quick-reply";
import { ConversationMessageScroll } from "./conversation-message-scroll";
import { conversationDisplayName, waitBadge } from "./infinite-conversation-list";
import type { OmnichannelConversationDetailResult, OmnichannelInboxMessage, OmnichannelInboxProfile, OmnichannelInboxTag } from "../types/omnichannel-inbox";
import { INBOX_MESSAGE_EVENT, INBOX_OLDER_MESSAGES_EVENT, INBOX_OPTIMISTIC_EVENT, type OptimisticMessage, type RealtimeMessageRow } from "./inbox-live-events";

type DetailProps = { result: OmnichannelConversationDetailResult; profiles: OmnichannelInboxProfile[]; tags: OmnichannelInboxTag[]; quickReplies: QuickReplyTemplate[]; canUpdateConversation: boolean; emailDetail?: ReactNode };

export function OmnichannelConversationDetail(props: DetailProps) {
  if (props.result.status !== "ready") return <div className="flex h-full flex-col items-center justify-center p-8 text-center"><AlertCircle className="size-8 text-slate-300"/><h2 className="mt-4 font-semibold">{props.result.status === "not_found" ? "Không tìm thấy hội thoại" : "Hội thoại tạm thời không khả dụng"}</h2><p className="mt-1 text-sm text-slate-500">Hãy làm mới trang hoặc kiểm tra lại quyền truy cập.</p></div>;
  return <ReadyConversationDetail key={props.result.conversation.id} {...props} result={props.result} />;
}

function ReadyConversationDetail(props: DetailProps & { result: Extract<OmnichannelConversationDetailResult, { status: "ready" }> }) {
  const readyConversation = props.result.conversation;
  const [messages, setMessages] = useState<OmnichannelInboxMessage[]>(readyConversation.messages);
  useEffect(() => {
    if (!readyConversation) return;
    const onMessage = (event: Event) => {
      const row = (event as CustomEvent<RealtimeMessageRow>).detail;
      if (row?.conversation_id !== readyConversation.id) return;
      const timestamp = row.received_at ?? row.sent_at ?? row.created_at;
      const incoming: OmnichannelInboxMessage = { id: row.id, conversationId: row.conversation_id, channelType: readyConversation.channelType, direction: row.direction,
        senderExternalId: row.sender_external_id, text: row.text_content, timestamp, providerMessageId: row.provider_message_id,
        attachmentCount: row.attachment_count ?? 0, attachments: [], deliveryStatus: row.direction === "OUTBOUND" ? "SENT" : "RECEIVED" };
      setMessages((current) => { const next = row.direction === "OUTBOUND" ? current.filter((item) => !(item.id.startsWith("optimistic:") && item.text === row.text_content)) : current; return next.some((item) => item.id === row.id) ? next : [...next, incoming]; });
    };
    const onOptimistic = (event: Event) => {
      const item = (event as CustomEvent<OptimisticMessage>).detail;
      if (item?.conversationId !== readyConversation.id) return;
      const optimistic: OmnichannelInboxMessage = { id: `optimistic:${item.id}`, conversationId: item.conversationId, channelType: readyConversation.channelType,
        direction: "OUTBOUND", senderExternalId: readyConversation.channelAccountId, text: item.text, timestamp: item.timestamp, providerMessageId: item.id,
        attachmentCount: 0, attachments: [], deliveryStatus: item.status };
      setMessages((current) => current.some((message) => message.id === optimistic.id) ? current.map((message) => message.id === optimistic.id ? optimistic : message) : [...current, optimistic]);
    };
    const onOlderMessages = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId: string; messages: OmnichannelInboxMessage[] }>).detail;
      if (detail?.conversationId !== readyConversation.id) return;
      setMessages((current) => { const currentIds = new Set(current.map((message) => message.id)); return [...detail.messages.filter((message) => !currentIds.has(message.id)), ...current]; });
    };
    window.addEventListener(INBOX_MESSAGE_EVENT, onMessage); window.addEventListener(INBOX_OPTIMISTIC_EVENT, onOptimistic); window.addEventListener(INBOX_OLDER_MESSAGES_EVENT, onOlderMessages);
    return () => { window.removeEventListener(INBOX_MESSAGE_EVENT, onMessage); window.removeEventListener(INBOX_OPTIMISTIC_EVENT, onOptimistic); window.removeEventListener(INBOX_OLDER_MESSAGES_EVENT, onOlderMessages); };
  }, [readyConversation]);
  const conversation = { ...props.result.conversation, messages };
  const displayName = conversationDisplayName(conversation);
  const assignee = props.profiles.find((profile) => profile.id === conversation.assignedTo)?.fullName ?? null;
  const lastMessage = conversation.messages.at(-1);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const waiting = lastMessage?.direction === "INBOUND" ? waitBadge(lastMessage.timestamp, now) : null;
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-4">
      <Link href={`/inbox/all?channel=${conversation.channelType}`} className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-slate-100 lg:hidden" aria-label="Quay lại danh sách"><ArrowLeft className="size-5"/></Link>
      {conversation.avatarUrl ? <Image unoptimized src={conversation.avatarUrl} alt="" width={40} height={40} className="size-10 shrink-0 rounded-full bg-slate-100 object-cover"/> : <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">{conversation.channelType === "EMAIL" ? <Mail className="size-4"/> : conversation.channelType === "FACEBOOK" ? <span className="text-xs font-black">f</span> : <MessageCircle className="size-4"/>}</span>}
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-bold text-slate-950" title={conversation.senderExternalId ?? undefined}>{displayName}</h2>
        <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-slate-500"><span className="truncate">{channelName(conversation.channelType)} · {conversation.accountDisplayName}</span>{waiting ? <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${waiting.className}`}>Khách {waiting.text}</span> : null}</p>
      </div>
      <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 sm:inline-flex" title={healthName(conversation.accountHealthLabel)}><span className={`size-2 rounded-full ${conversation.status === "OPEN" ? "bg-emerald-500" : conversation.status === "PENDING" ? "bg-amber-500" : "bg-slate-400"}`}/>{statusName(conversation.status)}</span>
      <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 md:inline-flex"><UserRound className="size-3.5"/>{assignee ?? "Chưa giao"}</span>
      {props.canUpdateConversation ? <details className="relative shrink-0"><summary className="flex size-9 cursor-pointer list-none items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 marker:content-none" aria-label="Trạng thái, người phụ trách, AI, nhãn" title="Trạng thái, người phụ trách, AI, nhãn"><MoreHorizontal className="size-4"/></summary><div className="absolute right-0 top-11 z-40 w-[min(92vw,320px)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl"><ConversationControls conversationId={conversation.id} status={conversation.status} takeoverMode={conversation.takeoverMode} assignedTo={conversation.assignedTo} profiles={props.profiles} tags={props.tags} tagIds={conversation.tagIds}/></div></details> : null}
    </header>
    {conversation.channelType === "EMAIL" ? props.emailDetail ?? <UnavailableEmail/> : <><ConversationMessageScroll conversationId={conversation.id} latestMessageId={conversation.messages.at(-1)?.id ?? null} className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] px-4 py-5 sm:px-6">{conversation.messages.length === 0 ? <p className="py-16 text-center text-sm text-slate-500">Chưa có tin nhắn được đồng bộ.</p> : conversation.messages.map((message) => <article key={message.id} className={`flex ${message.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}><div className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 shadow-sm sm:max-w-[72%] ${message.direction === "OUTBOUND" ? message.deliveryStatus === "DELIVERY_UNKNOWN" ? "rounded-br-md bg-amber-500 text-white" : message.deliveryStatus === "FAILED" ? "rounded-br-md bg-red-500 text-white" : message.deliveryStatus === "BLOCKED" ? "rounded-br-md bg-slate-600 text-white" : "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-800"}`}><p className="whitespace-pre-wrap break-words text-sm leading-5">{message.text ?? (message.attachmentCount > 0 ? null : "Sự kiện từ nhà cung cấp")}</p>{message.attachments.length > 0 ? <div className="mt-2 space-y-2">{message.attachments.map((attachment, index) => <div key={`${message.id}:attachment:${index}`} className={`rounded-xl p-2 text-xs ${message.direction === "OUTBOUND" ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700"}`}>{attachment.downloadUrl && attachment.contentType?.startsWith("image/") ? <a href={attachment.downloadUrl} target="_blank" rel="noreferrer" className="mb-2 block overflow-hidden rounded-lg bg-white"><Image unoptimized src={attachment.downloadUrl} alt={attachment.filename ?? "Ảnh Zalo"} width={1280} height={720} className="max-h-80 h-auto w-auto max-w-full object-contain"/></a> : null}<div className="flex items-center gap-2"><Paperclip className="size-3.5 shrink-0"/><span className="min-w-0 flex-1 truncate font-medium">{attachment.filename ?? "Tệp đính kèm Zalo"}</span>{attachment.sizeBytes !== null ? <span className="shrink-0 opacity-75">{formatBytes(attachment.sizeBytes)}</span> : null}{attachment.downloadUrl ? <a href={attachment.downloadUrl} download className="rounded p-1 hover:bg-black/10" aria-label={`Tải ${attachment.filename ?? "tệp"}`}><Download className="size-3.5"/></a> : null}</div></div>)}</div> : message.attachmentCount > 0 ? <p className="mt-2 inline-flex items-center gap-1 text-xs opacity-80"><Paperclip className="size-3"/>{message.attachmentCount} tệp đính kèm</p> : null}<div className={`mt-1.5 flex items-center justify-end gap-1 text-[10px] ${message.direction === "OUTBOUND" ? "text-white/75" : "text-slate-400"}`}>{message.direction === "OUTBOUND" ? <span>{deliveryName(message.deliveryStatus, message.reconciliationStatus)}</span> : null}<time>{formatTime(message.timestamp)}</time>{message.direction === "OUTBOUND" && message.deliveryStatus === "SENT" ? <CheckCheck className="size-3.5"/> : null}</div>{conversation.channelType === "ZALO" && message.deliveryStatus === "DELIVERY_UNKNOWN" && message.reconciliationStatus !== "ACKNOWLEDGED_NO_RETRY" && message.actionId ? <UnknownDeliveryAcknowledgement actionId={message.actionId}/> : null}</div></article>)}</ConversationMessageScroll>{conversation.channelType === "FACEBOOK" || conversation.channelType === "ZALO" ? <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 pb-3 pt-2.5 sm:px-4"><ConversationComposer conversationId={conversation.id} channelType={conversation.channelType} conversationStatus={conversation.status} lastInboundAt={conversation.lastInboundAt} pendingActions={conversation.pendingActions} proposedActions={conversation.proposedActions} quickReplies={props.quickReplies}/></div> : null}</>}
    {conversation.channelType === "FACEBOOK_PROFILE" ? <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 pb-3 pt-2.5 sm:px-4"><ConversationComposer conversationId={conversation.id} channelType={conversation.channelType} conversationStatus={conversation.status} lastInboundAt={conversation.lastInboundAt} pendingActions={conversation.pendingActions} proposedActions={conversation.proposedActions} quickReplies={props.quickReplies}/></div> : null}
  </div>;
}

function UnavailableEmail() { return <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-500">Nội dung email đồng bộ hiện không khả dụng.</div>; }
function channelName(value: string) { return value === "ZALO" ? "Zalo" : value === "FACEBOOK" ? "Facebook Page" : value === "FACEBOOK_PROFILE" ? "Facebook cá nhân" : "Email"; }
function healthName(value: string) { return value === "Healthy" ? "Đang hoạt động" : value === "Connected" ? "Đã kết nối" : value === "Unknown" ? "Đang kiểm tra" : value; }
function statusName(value: string) { return value === "OPEN" ? "Đang mở" : value === "PENDING" ? "Đang chờ" : value === "CLOSED" ? "Đã đóng" : value; }
function deliveryName(value: string, reconciliation?: string) { if (value === "SENT") return "Đã gửi"; if (value === "PENDING") return "Đang chờ"; if (value === "SENDING") return "Đang gửi"; if (value === "BLOCKED") return "Chưa gửi · tài khoản đang bận"; if (value === "FAILED") return "Gửi không thành công"; if (value === "DELIVERY_UNKNOWN") return reconciliation === "ACKNOWLEDGED_NO_RETRY" ? "Chưa rõ kết quả · không gửi lại" : "Chưa rõ kết quả"; return value; }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Không rõ thời gian" : new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(date); }
function formatBytes(value: number) { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`; }
