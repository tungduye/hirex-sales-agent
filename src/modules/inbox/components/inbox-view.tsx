import Link from "next/link";
import type { ReactNode } from "react";
import { Inbox, Mail, MailOpen, MessagesSquare, Star } from "lucide-react";
import type { InboxData, InboxThread } from "@/modules/inbox/types/inbox";

interface Props extends InboxData {
  selectedThreadId: string | null;
  detail: ReactNode;
}

export function InboxView({ accounts, threads, selectedAccountId, selectedThreadId, error, detail }: Props) {
  return (
    <>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Sales workspace</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">Sales Inbox</h1>
          <p className="mt-1 text-sm text-slate-500">Read conversations, draft with AI, and approve every reply.</p>
        </div>
        <form action="/inbox" method="get" className="flex items-center gap-2">
          <label htmlFor="account" className="text-xs font-semibold text-slate-500">Email account</label>
          <select id="account" name="account" defaultValue={selectedAccountId ?? ""} className="h-10 min-w-56 rounded-lg border bg-white px-3 text-sm font-medium text-slate-700 focus:border-blue-500 focus:outline-none">
            <option value="">All accounts</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName ? `${account.displayName} · ` : ""}{account.emailAddress}</option>)}
          </select>
          <button type="submit" className="h-10 rounded-lg border bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Apply</button>
        </form>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-white px-6 py-16 text-center shadow-sm">
          <Mail className="mx-auto size-8 text-rose-500" />
          <h2 className="mt-4 font-semibold">Unable to load Inbox</h2>
          <p className="mt-1 text-sm text-slate-500">{error}</p>
        </div>
      ) : threads.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white px-6 py-16 text-center shadow-sm">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Inbox className="size-7" /></div>
          <h2 className="mt-5 text-xl font-bold">No synchronized messages yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Messages will appear here after a manual readonly sync from Settings.</p>
        </div>
      ) : (
        <section className="grid min-h-[650px] overflow-hidden rounded-xl border bg-white shadow-sm xl:grid-cols-[390px_minmax(0,1fr)]">
          <div className="border-b xl:border-b-0 xl:border-r">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <div><h2 className="text-sm font-semibold">Conversations</h2><p className="text-xs text-slate-400">Latest 50 synchronized threads</p></div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{threads.length}</span>
            </div>
            <div className="max-h-[590px] divide-y overflow-y-auto xl:max-h-[calc(100vh-250px)]">
              {threads.map((thread) => <ThreadRow key={thread.id} thread={thread} selected={thread.id === selectedThreadId} selectedAccountId={selectedAccountId} />)}
            </div>
          </div>
          <div className="min-w-0 bg-slate-50/60">{detail}</div>
        </section>
      )}
    </>
  );
}

function ThreadRow({ thread, selected, selectedAccountId }: { thread: InboxThread; selected: boolean; selectedAccountId: string | null }) {
  const href = selectedAccountId ? `/inbox/${thread.id}?account=${encodeURIComponent(selectedAccountId)}` : `/inbox/${thread.id}`;
  const sender = thread.senderName ?? thread.senderEmail ?? "Unknown sender";
  return (
    <Link href={href} className={`block border-l-2 px-4 py-3.5 transition-colors ${selected ? "border-l-blue-600 bg-blue-50/80" : "border-l-transparent hover:bg-slate-50"}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${thread.isUnread ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>
          {thread.isUnread ? <Mail className="size-3.5" /> : <MailOpen className="size-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`min-w-0 flex-1 truncate text-sm ${thread.isUnread ? "font-bold text-slate-950" : "font-semibold text-slate-700"}`}>{sender}</p>
            <time dateTime={thread.lastMessageAt ?? undefined} className="shrink-0 text-[11px] text-slate-400">{formatCompactTime(thread.lastMessageAt)}</time>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            {thread.isStarred && <Star className="size-3.5 fill-amber-400 text-amber-400" aria-label="Starred" />}
            <p className={`truncate text-xs ${thread.isUnread ? "font-semibold text-slate-800" : "text-slate-600"}`}>{thread.subject ?? "(No subject)"}</p>
            {thread.messageCount > 1 && <span className="shrink-0 text-[11px] font-semibold text-slate-400">{thread.messageCount}</span>}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{thread.snippet ?? "No preview available."}</p>
        </div>
      </div>
    </Link>
  );
}

export function SelectThreadPrompt() {
  return <div className="flex min-h-[450px] flex-col items-center justify-center px-6 text-center"><div className="flex size-14 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200"><MessagesSquare className="size-7" /></div><h2 className="mt-5 font-semibold text-slate-800">Select a conversation</h2><p className="mt-1 max-w-sm text-sm text-slate-500">Choose a synchronized thread to read its plain-text messages.</p></div>;
}

function formatCompactTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);
  if (date.getFullYear() === now.getFullYear()) return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "2-digit" }).format(date);
}
