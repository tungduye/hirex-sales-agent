"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowUp, BookOpen, Check, FileSpreadsheet, History, LoaderCircle, MessageSquarePlus, Paperclip, Pencil, Pin, PinOff, Search, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ASSISTANT_SAVED_EVENT, assistantSuggestions, ChatMessages, useAssistantChat, useDocumentsSwitch } from "@/modules/assistant/components/assistant-chat";
import { recencyGroup, type ConversationSummary } from "@/modules/assistant/core/assistant-conversation";
import { useAccount } from "@/modules/identity/components/account-context";

const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase();
const idFromPath = (path: string) => /^\/assistant\/c\/([0-9a-f-]{36})$/iu.exec(path)?.[1] ?? null;

/** The full Trợ lý page: saved conversations on the left, one conversation in the middle (like a chat app). */
export function AssistantWorkspace({ conversationId: initialId, workspaceAdmin }: { conversationId: string | null; workspaceAdmin: boolean }) {
  const account = useAccount();
  const [documentsOn, toggleDocuments] = useDocumentsSwitch(workspaceAdmin);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const refreshList = useCallback(async () => {
    try {
      const data = await fetch("/api/assistant/conversations", { cache: "no-store" }).then((response) => response.json()) as { ok?: boolean; conversations?: ConversationSummary[] };
      setConversations(data.ok ? data.conversations ?? [] : []);
    } catch { setConversations((current) => current ?? []); }
  }, []);

  const onSaved = useCallback((conversation: { id: string }) => {
    if (window.location.pathname === "/assistant") window.history.replaceState(null, "", `/assistant/c/${conversation.id}`);
    void refreshList();
  }, [refreshList]);
  const chat = useAssistantChat({ pagePath: "/assistant", allowDocuments: documentsOn, onSaved });
  const { messages, busy, remaining, attachment, setAttachment, uploading, attach, ask, decide, reset, load, loading, conversationId } = chat;

  // First load: the list, and the conversation in the address (if any).
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    const timer = setTimeout(() => { void refreshList(); if (initialId) void loadRef.current(initialId); }, 0);
    return () => clearTimeout(timer);
  }, [initialId, refreshList]);
  useEffect(() => {
    const onSavedElsewhere = () => void refreshList();
    // Back/forward between conversations.
    const onPop = () => { const id = idFromPath(window.location.pathname); if (id) void loadRef.current(id); else reset(); };
    window.addEventListener(ASSISTANT_SAVED_EVENT, onSavedElsewhere);
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener(ASSISTANT_SAVED_EVENT, onSavedElsewhere); window.removeEventListener("popstate", onPop); };
  }, [refreshList, reset]);
  // Ctrl/Cmd + K jumps to the message box on this page.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); inputRef.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);
  // The box grows with the text, up to a limit.
  useEffect(() => { const box = inputRef.current; if (!box) return; box.style.height = "auto"; box.style.height = `${Math.min(box.scrollHeight, 260)}px`; }, [draft]);

  function newChat() { reset(); setDraft(""); setHistoryOpen(false); window.history.pushState(null, "", "/assistant"); setTimeout(() => inputRef.current?.focus(), 30); }
  function open(id: string) { setHistoryOpen(false); if (id === conversationId) return; window.history.pushState(null, "", `/assistant/c/${id}`); void load(id); }
  function send(text: string) { if (!text.trim() || busy) return; setDraft(""); void ask(text); }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); } }

  async function rename(id: string, title: string) {
    setConversations((current) => current?.map((item) => item.id === id ? { ...item, title } : item) ?? current);
    await fetch(`/api/assistant/conversations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }).catch(() => null);
  }
  async function togglePin(item: ConversationSummary) {
    await fetch(`/api/assistant/conversations/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !item.pinned }) }).catch(() => null);
    void refreshList();
  }
  async function remove(id: string) {
    setConversations((current) => current?.filter((item) => item.id !== id) ?? current);
    await fetch(`/api/assistant/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    if (id === conversationId) newChat();
  }

  const prompts = useMemo(() => assistantSuggestions(account.permissions, "/assistant", documentsOn), [account.permissions, documentsOn]);
  const firstName = (account.fullName ?? "").trim().split(/\s+/u).at(-1) || "anh/chị";
  const title = conversations?.find((item) => item.id === conversationId)?.title ?? null;
  const empty = messages.length === 0 && !loading;

  const composer = <form onSubmit={(event) => { event.preventDefault(); send(draft); }} className="w-full">
    {attachment && <div className="mb-2 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900">
      <FileSpreadsheet className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate"><b>{attachment.fileName}</b> · {attachment.recipients.toLocaleString("vi-VN")} người nhận</span>
      <button type="button" onClick={() => setAttachment(null)} aria-label="Bỏ file đính kèm" className="rounded p-0.5 hover:bg-emerald-100"><X className="size-3.5" /></button>
    </div>}
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_2px_12px_rgba(15,23,42,0.06)] transition focus-within:border-blue-400 focus-within:shadow-[0_2px_16px_rgba(37,99,235,0.12)]">
      <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKey} rows={empty ? 3 : 1} maxLength={1000} disabled={busy} autoFocus
        placeholder={empty ? "Hôm nay em có thể giúp gì cho anh/chị?" : "Trả lời Trợ lý… (Enter để gửi, Shift+Enter xuống dòng)"} aria-label="Câu hỏi cho trợ lý"
        className="block w-full resize-none bg-transparent px-1 text-[15px] leading-6 text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-60" />
      <div className="mt-2 flex items-center gap-1.5">
        <AttachButton disabled={busy || uploading} uploading={uploading} allowed={account.permissions.includes("campaigns.create")} onFile={(file) => void attach(file).then(() => inputRef.current?.focus())} />
        {workspaceAdmin && <button type="button" onClick={toggleDocuments} aria-pressed={documentsOn}
          title={documentsOn ? "Đang cho trợ lý đọc Thư viện tài liệu (gửi các đoạn liên quan tới OpenAI). Bấm để tắt." : "Cho trợ lý đọc Thư viện tài liệu: các đoạn liên quan sẽ được gửi tới OpenAI để trả lời."}
          className={cn("flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors", documentsOn ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
          <BookOpen className="size-3.5" />Tài liệu<span className={cn("size-1.5 rounded-full", documentsOn ? "bg-indigo-600" : "bg-slate-300")} />
        </button>}
        <span className="ml-auto hidden text-[11px] text-slate-400 sm:inline">{remaining !== null ? `Còn ${remaining} câu hôm nay` : "Mọi thao tác cần bấm Xác nhận"}</span>
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Gửi câu hỏi" className="flex size-9 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</button>
      </div>
    </div>
  </form>;

  return <div className="flex h-[calc(100dvh-4rem)] min-h-[520px] overflow-hidden bg-white">
    {historyOpen ? <button type="button" aria-label="Đóng lịch sử" onClick={() => setHistoryOpen(false)} className="fixed inset-0 z-30 bg-slate-950/30 md:hidden" /> : null}
    <aside className={cn("z-40 flex w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50", historyOpen ? "fixed inset-y-0 left-0 shadow-2xl md:static md:shadow-none" : "hidden md:flex")} aria-label="Lịch sử trò chuyện">
      <div className="space-y-2 p-3">
        <button type="button" onClick={newChat} className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-blue-300 hover:text-blue-700"><MessageSquarePlus className="size-4 text-blue-600" />Cuộc trò chuyện mới</button>
        <label className="relative block"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm cuộc trò chuyện…" aria-label="Tìm cuộc trò chuyện" className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-sm outline-none focus:border-blue-400" /></label>
      </div>
      <HistoryList conversations={conversations} query={query} activeId={conversationId} onOpen={open} onRename={rename} onPin={togglePin} onDelete={remove} />
      <div className="border-t border-slate-200 p-3"><Link href="/assistant/rules" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white hover:text-blue-700"><Settings2 className="size-3.5" />Quy tắc tự động của Trợ lý</Link></div>
    </aside>

    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-100 px-3 sm:px-5">
        <button type="button" onClick={() => setHistoryOpen(true)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Mở lịch sử trò chuyện"><History className="size-5" /></button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">{empty ? "Trợ lý HireX" : title ?? "Cuộc trò chuyện mới"}</p>
        {!empty ? <button type="button" onClick={newChat} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-blue-700"><MessageSquarePlus className="size-4" /><span className="hidden sm:inline">Mới</span></button> : null}
      </div>
      {empty ? <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-16">
        <div className="w-full max-w-2xl">
          <h1 className="mb-6 flex items-center justify-center gap-3 text-center text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl"><Sparkles className="size-7 shrink-0 text-blue-600" />Chào {firstName}, hôm nay cần em giúp gì?</h1>
          {composer}
          <div className="mt-4 flex flex-wrap justify-center gap-2">{prompts.map((prompt) => <button key={prompt} type="button" onClick={() => send(prompt)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800">{prompt}</button>)}</div>
          <p className="mt-6 text-center text-xs text-slate-400">Trợ lý tra cứu theo quyền tài khoản của anh/chị và chỉ thao tác khi anh/chị bấm Xác nhận. Các cuộc trò chuyện được lưu riêng cho anh/chị ở cột bên trái.</p>
        </div>
      </div> : <>
        <div ref={listRef} className="flex-1 overflow-y-auto" aria-live="polite">
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
            {loading ? <p className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Đang mở cuộc trò chuyện…</p> : null}
            <ChatMessages large messages={messages} busy={busy} documentsOn={documentsOn} onDecide={decide} onNavigate={() => undefined} />
          </div>
        </div>
        <div className="shrink-0 bg-gradient-to-t from-white via-white to-white/0 px-4 pb-4 pt-2 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">{composer}<p className="mt-1.5 text-center text-[11px] text-slate-400">Trợ lý có thể sai; số liệu quan trọng hãy mở trang để kiểm tra.</p></div>
        </div>
      </>}
    </section>
  </div>;
}

function AttachButton({ disabled, uploading, allowed, onFile }: { disabled: boolean; uploading: boolean; allowed: boolean; onFile: (file: File | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  if (!allowed) return null;
  return <>
    <input ref={ref} type="file" accept=".csv,.xlsx" className="hidden" onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ""; }} />
    <button type="button" disabled={disabled} onClick={() => ref.current?.click()} aria-label="Đính kèm file danh sách (.csv, .xlsx)" title="Đính kèm file danh sách người nhận (.csv, .xlsx, tối đa 5 MB)" className="flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50">{uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}</button>
  </>;
}

function HistoryList({ conversations, query, activeId, onOpen, onRename, onPin, onDelete }: { conversations: ConversationSummary[] | null; query: string; activeId: string | null; onOpen: (id: string) => void; onRename: (id: string, title: string) => void; onPin: (item: ConversationSummary) => void; onDelete: (id: string) => void }) {
  const [now] = useState(() => Date.now());
  if (conversations === null) return <p className="flex flex-1 items-start gap-2 px-4 py-3 text-xs text-slate-500"><LoaderCircle className="size-3.5 animate-spin" />Đang tải…</p>;
  const needle = fold(query.trim());
  const shown = conversations.filter((item) => !needle || fold(item.title).includes(needle));
  const groups: Array<[string, ConversationSummary[]]> = [];
  for (const item of shown) {
    const label = item.pinned ? "Đã ghim" : recencyGroup(item.updatedAt, now);
    const group = groups.find(([name]) => name === label);
    if (group) group[1].push(item); else groups.push([label, [item]]);
  }
  return <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
    {!shown.length ? <p className="px-2 py-4 text-xs text-slate-500">{conversations.length ? "Không tìm thấy cuộc trò chuyện." : "Chưa có cuộc trò chuyện nào. Hỏi Trợ lý một câu để bắt đầu."}</p> : null}
    {groups.map(([label, items]) => <div key={label} className="mt-2">
      <p className="px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      {items.map((item) => <HistoryItem key={item.id} item={item} active={item.id === activeId} onOpen={onOpen} onRename={onRename} onPin={onPin} onDelete={onDelete} />)}
    </div>)}
  </nav>;
}

function HistoryItem({ item, active, onOpen, onRename, onPin, onDelete }: { item: ConversationSummary; active: boolean; onOpen: (id: string) => void; onRename: (id: string, title: string) => void; onPin: (item: ConversationSummary) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [value, setValue] = useState(item.title);
  if (editing) return <form className="flex items-center gap-1 px-1 py-0.5" onSubmit={(event) => { event.preventDefault(); const title = value.trim(); if (title) onRename(item.id, title.slice(0, 120)); setEditing(false); }}>
    <input value={value} onChange={(event) => setValue(event.target.value)} autoFocus maxLength={120} aria-label="Tên cuộc trò chuyện" onKeyDown={(event) => { if (event.key === "Escape") { setValue(item.title); setEditing(false); } }} className="h-8 min-w-0 flex-1 rounded-md border border-blue-400 bg-white px-2 text-sm outline-none" />
    <button type="submit" aria-label="Lưu tên" className="rounded p-1 text-blue-700 hover:bg-blue-50"><Check className="size-4" /></button>
  </form>;
  if (confirming) return <div className="flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1.5 text-xs text-rose-800">
    <span className="min-w-0 flex-1 truncate">Xoá “{item.title}”?</span>
    <button type="button" onClick={() => { setConfirming(false); onDelete(item.id); }} className="rounded px-1.5 py-0.5 font-semibold hover:bg-rose-100">Xoá</button>
    <button type="button" onClick={() => setConfirming(false)} className="rounded px-1.5 py-0.5 hover:bg-rose-100">Huỷ</button>
  </div>;
  return <div className={cn("group flex items-center rounded-lg", active ? "bg-white shadow-sm ring-1 ring-slate-200" : "hover:bg-white/70")}>
    <button type="button" onClick={() => onOpen(item.id)} onDoubleClick={() => setEditing(true)} title={item.title} className={cn("min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm", active ? "font-semibold text-slate-900" : "text-slate-700")}>{item.title}</button>
    <span className={cn("flex shrink-0 items-center pr-1", active ? "flex" : "hidden group-hover:flex group-focus-within:flex")}>
      <button type="button" onClick={() => onPin(item)} aria-label={item.pinned ? "Bỏ ghim" : "Ghim"} title={item.pinned ? "Bỏ ghim" : "Ghim lên đầu"} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">{item.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}</button>
      <button type="button" onClick={() => { setValue(item.title); setEditing(true); }} aria-label="Đổi tên" title="Đổi tên" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-3.5" /></button>
      <button type="button" onClick={() => setConfirming(true)} aria-label="Xoá" title="Xoá" className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-3.5" /></button>
    </span>
  </div>;
}
