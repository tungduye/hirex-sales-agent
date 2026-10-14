"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUp, LoaderCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ASSISTANT_TOOLS } from "@/modules/assistant/core/assistant-tools";
import { parseAnswer, type Inline } from "@/modules/assistant/core/assistant-markdown";
import type { AccountContext } from "@/types/account";

interface Message { role: "user" | "assistant"; content: string; toolsUsed?: string[]; error?: boolean }

const TOOL_LABELS = new Map(ASSISTANT_TOOLS.map((tool) => [tool.name, tool.label]));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function suggestions(permissions: string[], pathname: string) {
  const list: string[] = [];
  if (pathname.startsWith("/inbox/all/") && UUID.test(pathname) && permissions.includes("inbox.view")) list.push("Tóm tắt hội thoại này và ứng viên đang ở bước nào?");
  list.push("Hôm nay có gì cần xử lý?");
  if (permissions.includes("inbox.view")) list.push("Tin nhắn nào chờ trả lời quá 2 giờ?");
  if (permissions.includes("channels.view")) list.push("Tài khoản kết nối nào đang lỗi?");
  if (permissions.includes("campaigns.view")) list.push("Các chiến dịch đang chạy thế nào?");
  if (permissions.includes("tasks.view")) list.push("Công việc nào của tôi sắp tới hạn?");
  return list.slice(0, 5);
}

export function AssistantPanel({ account }: { account: AccountContext }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
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
        body: JSON.stringify({ question: text, history, pagePath: pathname }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; answer?: string; toolsUsed?: string[]; remainingToday?: number; message?: string } | null;
      if (data?.ok && data.answer) {
        setMessages((current) => [...current, { role: "assistant", content: data.answer!, toolsUsed: data.toolsUsed ?? [] }]);
        if (typeof data.remainingToday === "number") setRemaining(data.remainingToday);
      } else {
        setMessages((current) => [...current, { role: "assistant", content: data?.message ?? "Trợ lý đang không phản hồi. Vui lòng thử lại.", error: true }]);
      }
    } catch {
      setMessages((current) => [...current, { role: "assistant", content: "Mất kết nối tới máy chủ. Vui lòng thử lại.", error: true }]);
    } finally {
      setBusy(false);
    }
  }, [busy, messages, pathname]);

  function submit(event: FormEvent) { event.preventDefault(); void ask(draft); }
  function onInputKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(draft); }
  }

  const prompts = useMemo(() => suggestions(account.permissions, pathname), [account.permissions, pathname]);
  const closeOnMobile = () => { if (window.innerWidth < 640) setOpen(false); };

  return (
    <>
      {!open && (
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
              <p className="text-xs text-slate-500">Chỉ tra cứu, không thay đổi dữ liệu · theo quyền của tài khoản</p>
            </div>
            {messages.length > 0 && <Button variant="ghost" size="icon" onClick={() => setMessages([])} disabled={busy} aria-label="Cuộc trò chuyện mới"><RotateCcw className="size-4" /></Button>}
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Đóng trợ lý"><X className="size-5" /></Button>
          </header>

          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">Chào {account.fullName ?? "anh/chị"}, em có thể tra cứu tình trạng kênh, tin nhắn chờ trả lời, chiến dịch, công việc, liên hệ, Kho content… Anh/chị cần xem gì?</p>
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
                {message.toolsUsed && message.toolsUsed.length > 0 && <p className="mt-2 text-[11px] text-slate-400">Đã tra: {message.toolsUsed.map((name) => TOOL_LABELS.get(name) ?? name).join(" · ")}</p>}
              </div>
            ))}
            {busy && <p className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Đang tra cứu dữ liệu…</p>}
          </div>

          <form onSubmit={submit} className="border-t p-3">
            <div className="flex items-end gap-2 rounded-xl border bg-slate-50 p-2 focus-within:border-blue-500 focus-within:bg-white">
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
