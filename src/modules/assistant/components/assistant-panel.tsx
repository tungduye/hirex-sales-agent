"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUp, BookOpen, CheckCircle2, Clock, FileSpreadsheet, LoaderCircle, Paperclip, RotateCcw, ShieldCheck, Sparkles, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ASSISTANT_TOOLS } from "@/modules/assistant/core/assistant-tools";
import { parseAnswer, type Inline } from "@/modules/assistant/core/assistant-markdown";
import type { AccountContext } from "@/types/account";

interface ActionPreview { title: string; lines: string[]; warning?: string | null; link?: string | null; editableText?: string; editableKind?: "message" | "note" }
interface CardAction { id: string; preview: ActionPreview; expiresAt: string; state: "pending" | "running" | "done" | "failed" | "cancelled"; result?: string; link?: string | null }
interface Message { role: "user" | "assistant"; content: string; toolsUsed?: string[]; error?: boolean; actions?: CardAction[] }

const TOOL_LABELS = new Map(ASSISTANT_TOOLS.map((tool) => [tool.name, tool.label]));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const DOCUMENTS_KEY = "hirex.assistant.documents";

function suggestions(permissions: string[], pathname: string, documents: boolean) {
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

export function AssistantPanel({ account, workspaceAdmin = false }: { account: AccountContext; workspaceAdmin?: boolean }) {
  const pathname = usePathname();
  // Admins only: lets the assistant read the document library (passages are sent to OpenAI).
  const [documentsOn, setDocumentsOn] = useState(false);
  useEffect(() => { try { setDocumentsOn(workspaceAdmin && window.localStorage.getItem(DOCUMENTS_KEY) === "1"); } catch { /* storage unavailable */ } }, [workspaceAdmin]);
  const toggleDocuments = () => setDocumentsOn((value) => {
    const next = !value;
    try { window.localStorage.setItem(DOCUMENTS_KEY, next ? "1" : "0"); } catch { /* storage unavailable */ }
    return next;
  });
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  // A recipient file attached for this conversation (phase 3b): sent as uploadId with each question.
  const [attachment, setAttachment] = useState<{ id: string; fileName: string; recipients: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canAttach = account.permissions.includes("campaigns.create");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Ctrl/Cmd + K opens and closes the panel; Esc closes it.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen((value) => !value); }
      else if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  const ask = useCallback(async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const history = messages.filter((message) => !message.error).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: text }]);
    setDraft("");
    setBusy(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, history, pagePath: pathname, allowDocuments: workspaceAdmin && documentsOn, uploadId: attachment?.id ?? null }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; answer?: string; toolsUsed?: string[]; remainingToday?: number; message?: string; pendingActions?: { id: string; preview: ActionPreview; expiresAt: string }[] } | null;
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
  }, [busy, messages, pathname, workspaceAdmin, documentsOn, attachment]);

  // Other parts of the app (e.g. the dashboard brief) open the panel with a question.
  const askRef = useRef(ask);
  useEffect(() => { askRef.current = ask; }, [ask]);
  useEffect(() => {
    function onAsk(event: Event) {
      const question = (event as CustomEvent<{ question?: unknown }>).detail?.question;
      if (typeof question !== "string" || !question.trim()) return;
      setOpen(true);
      void askRef.current(question.slice(0, 1000));
    }
    // The rules page opens the panel with a sentence typed in, for the member to adjust and send.
    function onDraft(event: Event) {
      const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof text !== "string") return;
      setOpen(true);
      setDraft(text.slice(0, 1000));
      setTimeout(() => inputRef.current?.focus(), 80);
    }
    const onOpen = () => setOpen(true);
    window.addEventListener("hirex:assistant-ask", onAsk);
    window.addEventListener("hirex:assistant-draft", onDraft);
    window.addEventListener("hirex:assistant-open", onOpen);
    return () => { window.removeEventListener("hirex:assistant-ask", onAsk); window.removeEventListener("hirex:assistant-draft", onDraft); window.removeEventListener("hirex:assistant-open", onOpen); };
  }, []);

  function submit(event: FormEvent) { event.preventDefault(); void ask(draft); }
  async function attach(file: File | undefined) {
    if (!file || uploading) return;
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
        setTimeout(() => inputRef.current?.focus(), 50);
      } else setMessages((current) => [...current, { role: "assistant", content: data?.message ?? "Chưa đính kèm được file.", error: true }]);
    } catch {
      setMessages((current) => [...current, { role: "assistant", content: "Mất kết nối khi tải file lên. Vui lòng thử lại.", error: true }]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  function onInputKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(draft); }
  }

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

  const prompts = useMemo(() => suggestions(account.permissions, pathname, workspaceAdmin && documentsOn), [account.permissions, pathname, workspaceAdmin, documentsOn]);
  const closeOnMobile = () => { if (window.innerWidth < 640) setOpen(false); };

  return (
    <>
      {/* In Suối Nguồn (and Tài khoản) the floating button would cover the page: the header "Trợ lý" button (and Ctrl+K) open it there. */}
      {!open && !pathname.startsWith("/inbox") && pathname !== "/accounts" && (
        <button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" aria-label="Mở Trợ lý HireX (Ctrl + K)">
          <Sparkles className="size-4 text-blue-300" />Trợ lý<kbd className="hidden rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
        </button>
      )}
      {open && (
        <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-white shadow-2xl sm:w-[440px]" role="dialog" aria-modal="false" aria-labelledby="assistant-title">
          <header className="flex items-start gap-3 border-b px-4 py-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white"><Sparkles className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <h2 id="assistant-title" className="text-sm font-bold">Trợ lý HireX</h2>
              <p className="text-xs text-slate-500">Tra cứu theo quyền tài khoản · mọi thao tác cần anh/chị bấm Xác nhận</p>
            </div>
            {workspaceAdmin && <button type="button" onClick={toggleDocuments} aria-pressed={documentsOn}
              title={documentsOn ? "Đang cho trợ lý đọc Thư viện tài liệu (gửi các đoạn liên quan tới OpenAI). Bấm để tắt." : "Cho trợ lý đọc Thư viện tài liệu: các đoạn liên quan sẽ được gửi tới OpenAI để trả lời."}
              className={cn("mt-0.5 flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-xs font-semibold transition-colors", documentsOn ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
              <BookOpen className="size-3.5" />Tài liệu<span className={cn("size-1.5 rounded-full", documentsOn ? "bg-indigo-600" : "bg-slate-300")} />
            </button>}
            {messages.length > 0 && <Button variant="ghost" size="icon" onClick={() => { setMessages([]); setAttachment(null); }} disabled={busy} aria-label="Cuộc trò chuyện mới"><RotateCcw className="size-4" /></Button>}
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Đóng trợ lý"><X className="size-5" /></Button>
          </header>

          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">Chào {account.fullName ?? "anh/chị"}, em có thể tra cứu tình trạng kênh, tin nhắn chờ trả lời, chi tiết liên hệ, công ty, chiến dịch, công việc, Kho content…, mở nhanh trang anh/chị cần, và đề xuất thao tác (soạn tin trả lời ứng viên, tạo công việc, đổi trạng thái lead, tạm dừng/tiếp tục chiến dịch, tạo content). Thao tác chỉ chạy khi anh/chị bấm Xác nhận.</p>
                {workspaceAdmin && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-900">{documentsOn ? "Đang bật Tài liệu: em có thể tìm, đọc và trả lời từ Thư viện tài liệu, kèm nguồn." : "Bật nút “Tài liệu” ở trên để em tìm và trả lời từ Thư viện tài liệu (các đoạn liên quan sẽ được gửi tới OpenAI)."}</p>}
                <div className="flex flex-col gap-2">
                  {prompts.map((prompt) => (
                    <button key={prompt} type="button" onClick={() => void ask(prompt)} className="rounded-lg border px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50">{prompt}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => message.role === "user" ? (
              <div key={index} className="ml-8 rounded-2xl rounded-br-sm bg-blue-600 px-3.5 py-2.5 text-sm text-white">{message.content}</div>
            ) : (
              <div key={index} className={cn("mr-4 text-sm leading-6", message.error ? "rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700" : "text-slate-800")}>
                {message.error ? message.content : <Answer text={message.content} onNavigate={closeOnMobile} />}
                {message.actions?.map((action) => <ActionCard key={action.id} action={action} onDecide={decide} onNavigate={closeOnMobile} />)}
                {message.toolsUsed && message.toolsUsed.length > 0 && <p className="mt-2 text-[11px] text-slate-400">Đã tra: {message.toolsUsed.map((name) => TOOL_LABELS.get(name) ?? name).join(" · ")}</p>}
              </div>
            ))}
            {busy && <p className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Đang tra cứu dữ liệu…{documentsOn ? " (đọc tài liệu có thể mất tới 1 phút)" : ""}</p>}
          </div>

          <form onSubmit={submit} className="border-t p-3">
            {attachment && <div className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
              <FileSpreadsheet className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate"><b>{attachment.fileName}</b> · {attachment.recipients.toLocaleString("vi-VN")} người nhận</span>
              <button type="button" onClick={() => setAttachment(null)} aria-label="Bỏ file đính kèm" className="rounded p-0.5 hover:bg-emerald-100"><X className="size-3.5" /></button>
            </div>}
            <div className="flex items-end gap-2 rounded-xl border bg-slate-50 p-2 focus-within:border-blue-500 focus-within:bg-white">
              {canAttach && <>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(event) => void attach(event.target.files?.[0])} />
                <Button type="button" variant="ghost" size="icon" disabled={busy || uploading} onClick={() => fileRef.current?.click()} aria-label="Đính kèm file danh sách (.csv, .xlsx)" title="Đính kèm file danh sách người nhận (.csv, .xlsx, tối đa 5 MB)" className="size-9 shrink-0 rounded-lg">{uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}</Button>
              </>}
              <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onInputKey} rows={2} maxLength={1000} disabled={busy}
                placeholder="Hỏi về tình trạng HireX… (Enter để gửi)" aria-label="Câu hỏi cho trợ lý" className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-1 text-sm focus:outline-none disabled:opacity-60" />
              <Button type="submit" size="icon" disabled={busy || !draft.trim()} aria-label="Gửi câu hỏi" className="size-9 shrink-0 rounded-lg">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</Button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-slate-400">Trợ lý có thể sai; số liệu quan trọng hãy mở trang để kiểm tra.{remaining !== null ? ` Còn ${remaining} câu hôm nay.` : ""}</p>
          </form>
        </aside>
      )}
    </>
  );
}

function ActionCard({ action, onDecide, onNavigate }: { action: CardAction; onDecide: (id: string, decision: "confirm" | "cancel", text?: string) => void; onNavigate: () => void }) {
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

function Answer({ text, onNavigate }: { text: string; onNavigate: () => void }) {
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
