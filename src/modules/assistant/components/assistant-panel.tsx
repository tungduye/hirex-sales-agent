"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUp, BookOpen, FileSpreadsheet, LoaderCircle, Maximize2, Paperclip, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { assistantSuggestions, ChatMessages, useAssistantChat, useDocumentsSwitch } from "@/modules/assistant/components/assistant-chat";
import type { AccountContext } from "@/types/account";

/** The side panel (Ctrl + K). Its conversations are saved too and open in full on the Trợ lý page. */
export function AssistantPanel({ account, workspaceAdmin = false }: { account: AccountContext; workspaceAdmin?: boolean }) {
  const pathname = usePathname();
  const onAssistantPage = pathname === "/assistant" || pathname.startsWith("/assistant/c/");
  const canReadDocuments = workspaceAdmin || account.permissions.includes("documents.view");
  const [documentsOn, toggleDocuments] = useDocumentsSwitch(canReadDocuments);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const chat = useAssistantChat({ pagePath: pathname, allowDocuments: documentsOn });
  const { messages, busy, remaining, attachment, setAttachment, uploading, attach, ask, decide, reset, conversationId } = chat;
  const fileRef = useRef<HTMLInputElement>(null);
  const canAttach = account.permissions.includes("campaigns.create");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Ctrl/Cmd + K opens and closes the panel (on the Trợ lý page the page itself is the chat); Esc closes it.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { if (onAssistantPage) return; event.preventDefault(); setOpen((value) => !value); }
      else if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAssistantPage]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

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

  function send(text: string) { if (!text.trim() || busy) return; setDraft(""); void ask(text); }
  function submit(event: FormEvent) { event.preventDefault(); send(draft); }
  function onInputKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); }
  }
  async function onFile(file: File | undefined) { await attach(file); if (fileRef.current) fileRef.current.value = ""; setTimeout(() => inputRef.current?.focus(), 50); }

  const prompts = useMemo(() => assistantSuggestions(account.permissions, pathname, documentsOn), [account.permissions, pathname, documentsOn]);
  const closeOnMobile = () => { if (window.innerWidth < 640) setOpen(false); };

  return (
    <>
      {/* In Suối Nguồn, Tài khoản and the Trợ lý page the floating button would cover the page: the header "Trợ lý" button opens it there. */}
      {!open && !pathname.startsWith("/inbox") && pathname !== "/accounts" && !onAssistantPage && (
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
            {canReadDocuments && <button type="button" onClick={toggleDocuments} aria-pressed={documentsOn}
              title={documentsOn ? "Đang cho trợ lý đọc Thư viện tài liệu (gửi các đoạn liên quan tới OpenAI). Bấm để tắt." : "Cho trợ lý đọc Thư viện tài liệu: các đoạn liên quan sẽ được gửi tới OpenAI để trả lời."}
              className={cn("mt-0.5 flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-xs font-semibold transition-colors", documentsOn ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
              <BookOpen className="size-3.5" />Tài liệu<span className={cn("size-1.5 rounded-full", documentsOn ? "bg-indigo-600" : "bg-slate-300")} />
            </button>}
            <Button asChild variant="ghost" size="icon" title="Mở toàn màn hình (lịch sử trò chuyện)"><Link href={conversationId ? `/assistant/c/${conversationId}` : "/assistant"} onClick={() => setOpen(false)} aria-label="Mở toàn màn hình"><Maximize2 className="size-4" /></Link></Button>
            {messages.length > 0 && <Button variant="ghost" size="icon" onClick={reset} disabled={busy} aria-label="Cuộc trò chuyện mới" title="Cuộc trò chuyện mới"><RotateCcw className="size-4" /></Button>}
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Đóng trợ lý"><X className="size-5" /></Button>
          </header>

          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">Chào {account.fullName ?? "anh/chị"}, em có thể tra cứu tình trạng kênh, tin nhắn chờ trả lời, chi tiết liên hệ, công ty, chiến dịch, công việc, Kho content…, mở nhanh trang anh/chị cần, và đề xuất thao tác (soạn tin trả lời ứng viên, tạo công việc, đổi trạng thái lead, tạm dừng/tiếp tục chiến dịch, tạo content). Thao tác chỉ chạy khi anh/chị bấm Xác nhận.</p>
                {canReadDocuments && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-900">{documentsOn ? "Đang bật Tài liệu: em có thể tìm, đọc và trả lời từ Thư viện tài liệu, kèm nguồn." : "Bật nút “Tài liệu” ở trên để em tìm và trả lời từ Thư viện tài liệu (các đoạn liên quan sẽ được gửi tới OpenAI)."}</p>}
                <div className="flex flex-col gap-2">
                  {prompts.map((prompt) => (
                    <button key={prompt} type="button" onClick={() => send(prompt)} className="rounded-lg border px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50">{prompt}</button>
                  ))}
                </div>
              </div>
            )}
            <ChatMessages messages={messages} busy={busy} documentsOn={documentsOn} onDecide={decide} onNavigate={closeOnMobile} />
          </div>

          <form onSubmit={submit} className="border-t p-3">
            {attachment && <div className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
              <FileSpreadsheet className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate"><b>{attachment.fileName}</b> · {attachment.recipients.toLocaleString("vi-VN")} người nhận</span>
              <button type="button" onClick={() => setAttachment(null)} aria-label="Bỏ file đính kèm" className="rounded p-0.5 hover:bg-emerald-100"><X className="size-3.5" /></button>
            </div>}
            <div className="flex items-end gap-2 rounded-xl border bg-slate-50 p-2 focus-within:border-blue-500 focus-within:bg-white">
              {canAttach && <>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(event) => void onFile(event.target.files?.[0])} />
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
