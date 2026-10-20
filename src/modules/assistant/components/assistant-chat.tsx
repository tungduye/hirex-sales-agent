"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, LoaderCircle, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ASSISTANT_TOOLS } from "@/modules/assistant/core/assistant-tools";
import { parseAnswer, type Inline } from "@/modules/assistant/core/assistant-markdown";
import type { ActionPreview, CardAction, ChatMessage } from "@/modules/assistant/core/assistant-conversation";

const TOOL_LABELS = new Map(ASSISTANT_TOOLS.map((tool) => [tool.name, tool.label]));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export const DOCUMENTS_KEY = "hirex.assistant.documents";
/** Fired after a saved conversation changes, so history lists refresh. */
export const ASSISTANT_SAVED_EVENT = "hirex:assistant-saved";

export function assistantSuggestions(permissions: string[], pathname: string, documents: boolean) {
  const list: string[] = [];
  if (documents) list.push("Thư viện tài liệu có những nhóm nào?");
  if (pathname.startsWith("/inbox/all/") && UUID.test(pathname) && permissions.includes("inbox.view")) list.push("Tóm tắt hội thoại này và ứng viên đang ở bước nào?");
  if (pathname.startsWith("/inbox/all/") && UUID.test(pathname) && permissions.includes("inbox.reply")) list.push("Soạn tin trả lời cho ứng viên này");
  list.push("Hôm nay có gì cần xử lý?");
  if (permissions.includes("inbox.view")) list.push("Tin nhắn nào chờ trả lời quá 2 giờ?");
  if (permissions.includes("channels.view")) list.push("Tài khoản kết nối nào đang lỗi?");
  if (permissions.includes("campaigns.view")) list.push("Các chiến dịch đang chạy thế nào?");
  if (permissions.includes("tasks.view")) list.push("Công việc nào của tôi sắp tới hạn?");
  return list.slice(0, 5);
}

/** The documents switch (admins only), remembered per browser. */
export function useDocumentsSwitch(workspaceAdmin: boolean) {
  const [documentsOn, setDocumentsOn] = useState(false);
  useEffect(() => {
    // Read after mount (storage is per browser); deferred so the first render matches the server.
    const timer = setTimeout(() => { try { setDocumentsOn(workspaceAdmin && window.localStorage.getItem(DOCUMENTS_KEY) === "1"); } catch { /* storage unavailable */ } }, 0);
    return () => clearTimeout(timer);
  }, [workspaceAdmin]);
  const toggle = useCallback(() => setDocumentsOn((value) => {
    const next = !value;
    try { window.localStorage.setItem(DOCUMENTS_KEY, next ? "1" : "0"); } catch { /* storage unavailable */ }
    return next;
  }), []);
  return [workspaceAdmin && documentsOn, toggle] as const;
}

/**
 * One conversation with Trợ lý: asking, proposal cards, an attached recipient file, and (save) keeping the
 * conversation in the member's history. Used by the side panel and the full Trợ lý page.
 */
export function useAssistantChat(options: { pagePath: string; allowDocuments: boolean; conversationId?: string | null; onSaved?: (conversation: { id: string; title: string }) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [attachment, setAttachment] = useState<{ id: string; fileName: string; recipients: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(options.conversationId ?? null);
  const [loading, setLoading] = useState(false);
  const onSavedRef = useRef(options.onSaved);
  useEffect(() => { onSavedRef.current = options.onSaved; }, [options.onSaved]);

  const reset = useCallback(() => { setMessages([]); setAttachment(null); setConversationId(null); }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true); setConversationId(id); setMessages([]); setAttachment(null);
    try {
      const response = await fetch(`/api/assistant/conversations/${id}`, { cache: "no-store" });
      const data = await response.json().catch(() => null) as { ok?: boolean; messages?: ChatMessage[] } | null;
      setMessages(data?.ok ? data.messages ?? [] : [{ role: "assistant", content: "Không mở được cuộc trò chuyện này (có thể đã bị xoá).", error: true }]);
    } catch { setMessages([{ role: "assistant", content: "Mất kết nối tới máy chủ. Vui lòng thử lại.", error: true }]); }
    finally { setLoading(false); }
  }, []);

  const ask = useCallback(async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const history = messages.filter((message) => !message.error).map(({ role, content }) => ({ role, content: content.slice(0, 8000) })).slice(-40);
    setMessages((current) => [...current, { role: "user", content: text }]);
    setBusy(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, history, pagePath: options.pagePath, allowDocuments: options.allowDocuments, uploadId: attachment?.id ?? null, save: true, conversationId }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; answer?: string; toolsUsed?: string[]; remainingToday?: number; message?: string; pendingActions?: { id: string; preview: ActionPreview; expiresAt: string }[]; conversationId?: string; title?: string } | null;
      if (data?.conversationId) {
        setConversationId(data.conversationId);
        onSavedRef.current?.({ id: data.conversationId, title: data.title ?? "" });
        window.dispatchEvent(new CustomEvent(ASSISTANT_SAVED_EVENT, { detail: { id: data.conversationId } }));
      }
      if (data?.ok && data.answer) {
        const actions = (data.pendingActions ?? []).map((action) => ({ ...action, state: "pending" as const }));
        setMessages((current) => [...current, { role: "assistant", content: data.answer!, toolsUsed: data.toolsUsed ?? [], actions }]);
        if (typeof data.remainingToday === "number") setRemaining(data.remainingToday);
      } else {
        setMessages((current) => [...current, { role: "assistant", content: data?.message ?? "Trợ lý đang không phản hồi. Vui lòng thử lại.", error: true }]);
      }
    } catch {
      setMessages((current) => [...current, { role: "assistant", content: "Mất kết nối tới máy chủ. Vui lòng thử lại.", error: true }]);
    } finally {
      setBusy(false);
    }
  }, [busy, messages, options.pagePath, options.allowDocuments, attachment, conversationId]);

  const attach = useCallback(async (file: File | undefined) => {
    if (!file || uploading) return false;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/assistant/files", { method: "POST", body: form });
      const data = await response.json().catch(() => null) as { ok?: boolean; id?: string; fileName?: string; message?: string; stats?: { recipients?: number; invalidEmailRows?: number; duplicateRows?: number; suppressedRows?: number } } | null;
      if (data?.ok && data.id) {
        setAttachment({ id: data.id, fileName: data.fileName ?? file.name, recipients: data.stats?.recipients ?? 0 });
        const removed = (data.stats?.invalidEmailRows ?? 0) + (data.stats?.duplicateRows ?? 0) + (data.stats?.suppressedRows ?? 0);
        setMessages((current) => [...current, { role: "assistant", content: `Đã nhận file **${data.fileName ?? file.name}**: ${(data.stats?.recipients ?? 0).toLocaleString("vi-VN")} người nhận hợp lệ${removed ? ` (đã loại ${removed.toLocaleString("vi-VN")} dòng sai, trùng hoặc bị chặn)` : ""}. Anh/chị muốn làm gì với danh sách này?` }]);
        return true;
      }
      setMessages((current) => [...current, { role: "assistant", content: data?.message ?? "Chưa đính kèm được file.", error: true }]);
    } catch {
      setMessages((current) => [...current, { role: "assistant", content: "Mất kết nối khi tải file lên. Vui lòng thử lại.", error: true }]);
    } finally { setUploading(false); }
    return false;
  }, [uploading]);

  // Confirm or cancel a proposal card. The server runs it at most once and re-checks permission.
  const decide = useCallback(async (actionId: string, decision: "confirm" | "cancel", text?: string) => {
    const update = (patch: Partial<CardAction>) => setMessages((current) => current.map((message) => message.actions?.some((action) => action.id === actionId)
      ? { ...message, actions: message.actions.map((action) => action.id === actionId ? { ...action, ...patch } : action) }
      : message));
    update({ state: "running" });
    try {
      const response = await fetch(`/api/assistant/actions/${actionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(text === undefined ? { decision } : { decision, text }) });
      const data = await response.json().catch(() => null) as { ok?: boolean; message?: string; link?: string | null } | null;
      if (decision === "cancel") update({ state: "cancelled", result: data?.message ?? "Đã huỷ." });
      else update({ state: data?.ok ? "done" : "failed", result: data?.message ?? "Không thực hiện được.", link: data?.link ?? null });
    } catch {
      update({ state: "failed", result: "Mất kết nối tới máy chủ. Hãy kiểm tra lại trên trang trước khi thử lại." });
    }
  }, []);

  return { messages, setMessages, busy, remaining, attachment, setAttachment, uploading, attach, ask, decide, reset, load, loading, conversationId };
}

/** The messages of one conversation. */
export function ChatMessages({ messages, busy, documentsOn, onDecide, onNavigate, large = false }: { messages: ChatMessage[]; busy: boolean; documentsOn: boolean; onDecide: (id: string, decision: "confirm" | "cancel", text?: string) => void; onNavigate: () => void; large?: boolean }) {
  return <>
    {messages.map((message, index) => message.role === "user" ? (
      <div key={index} className={cn("whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-blue-600 px-3.5 py-2.5 text-white", large ? "ml-auto w-fit max-w-[85%] text-[15px] leading-6" : "ml-8 text-sm")}>{message.content}</div>
    ) : (
      <div key={index} className={cn(large ? "text-[15px] leading-7" : "mr-4 text-sm leading-6", message.error ? "rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700" : "text-slate-800")}>
        {message.error ? message.content : <Answer text={message.content} onNavigate={onNavigate} />}
        {message.actions?.map((action) => <ActionCard key={action.id} action={action} onDecide={onDecide} onNavigate={onNavigate} />)}
        {message.toolsUsed && message.toolsUsed.length > 0 && <p className="mt-2 text-[11px] text-slate-400">Đã tra: {message.toolsUsed.map((name) => TOOL_LABELS.get(name) ?? name).join(" · ")}</p>}
      </div>
    ))}
    {busy && <p className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Đang tra cứu dữ liệu…{documentsOn ? " (đọc tài liệu có thể mất tới 1 phút)" : ""}</p>}
  </>;
}

export function ActionCard({ action, onDecide, onNavigate }: { action: CardAction; onDecide: (id: string, decision: "confirm" | "cancel", text?: string) => void; onNavigate: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const editable = action.preview.editableText !== undefined;
  const isNote = action.preview.editableKind === "note";
  const [text, setText] = useState(action.preview.editableText ?? "");
  useEffect(() => { if (action.state !== "pending") return; const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, [action.state]);
  const expired = action.state === "pending" && Date.parse(action.expiresAt) < now;
  const tone = action.state === "done" ? "border-emerald-200 bg-emerald-50" : action.state === "failed" ? "border-rose-200 bg-rose-50" : action.state === "cancelled" || expired ? "border-slate-200 bg-slate-50" : "border-blue-200 bg-blue-50/60";
  return (
    <div className={cn("mt-3 rounded-xl border p-3", tone)} role="group" aria-label={`Đề xuất: ${action.preview.title}`}>
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500"><ShieldCheck className="size-3.5" />Cần xác nhận</p>
      <p className="mt-1 font-semibold text-slate-900">{action.preview.title}</p>
      <ul className="mt-1 space-y-0.5 text-[13px] text-slate-700">{action.preview.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
      {editable && (action.state === "pending" && !expired
        ? <textarea value={text} onChange={(event) => setText(event.target.value)} rows={Math.min(10, Math.max(3, text.split("\n").length + 1))} maxLength={5000}
            aria-label={isNote ? "Nội dung ghi chú" : "Nội dung tin sẽ gửi"} className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[13px] leading-5 text-slate-900 focus:border-blue-500 focus:outline-none" />
        : <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-slate-200 bg-white/70 px-2.5 py-2 text-[13px] leading-5 text-slate-700">{text}</p>)}
      {action.preview.warning && <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[13px] text-amber-800">{action.preview.warning}</p>}
      {action.preview.link && action.state === "pending" && <Link href={action.preview.link} onClick={onNavigate} className="mt-2 inline-block text-[13px] font-medium text-blue-700 hover:underline">Mở trang liên quan</Link>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {action.state === "pending" && !expired && <>
          <Button size="sm" disabled={editable && !text.trim()} onClick={() => onDecide(action.id, "confirm", editable ? text : undefined)}>{editable ? (isNote ? "Xác nhận lưu" : "Xác nhận gửi") : "Xác nhận"}</Button>
          <Button size="sm" variant="outline" onClick={() => onDecide(action.id, "cancel")}>Huỷ</Button>
          <span className="flex items-center gap-1 text-[11px] text-slate-500"><Clock className="size-3" />Hết hạn lúc {new Date(action.expiresAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>
        </>}
        {expired && <span className="text-[13px] text-slate-500">Đề xuất đã hết hạn. Hãy hỏi lại nếu vẫn muốn làm.</span>}
        {action.state === "running" && <span className="flex items-center gap-1.5 text-[13px] text-slate-600"><LoaderCircle className="size-4 animate-spin" />Đang thực hiện…</span>}
        {(action.state === "done" || action.state === "failed" || action.state === "cancelled") && (
          <span className={cn("flex items-start gap-1.5 text-[13px]", action.state === "done" ? "text-emerald-700" : action.state === "failed" ? "text-rose-700" : "text-slate-600")}>
            {action.state === "done" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
            <span>{action.result}{action.link && action.state === "done" && <> · <Link href={action.link} onClick={onNavigate} className="font-medium underline-offset-2 hover:underline">Mở</Link></>}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function InlineText({ inlines, onNavigate }: { inlines: Inline[]; onNavigate: () => void }) {
  return <>{inlines.map((part, index) => part.type === "bold" ? <strong key={index} className="font-semibold">{part.text}</strong>
    : part.type === "link" ? <Link key={index} href={part.href} onClick={onNavigate} className="font-medium text-blue-700 underline-offset-2 hover:underline">{part.text}</Link>
    : <Fragment key={index}>{part.text}</Fragment>)}</>;
}

export function Answer({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const blocks = useMemo(() => parseAnswer(text), [text]);
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => block.type === "paragraph" ? <p key={index}><InlineText inlines={block.inlines} onNavigate={onNavigate} /></p>
        : block.type === "heading" ? <p key={index} className="font-semibold text-slate-900"><InlineText inlines={block.inlines} onNavigate={onNavigate} /></p>
        : block.ordered
          ? <ol key={index} start={block.start} className="list-decimal space-y-1 pl-5">{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineText inlines={item} onNavigate={onNavigate} /></li>)}</ol>
          : <ul key={index} className="list-disc space-y-1 pl-5">{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineText inlines={item} onNavigate={onNavigate} /></li>)}</ul>)}
    </div>
  );
}
