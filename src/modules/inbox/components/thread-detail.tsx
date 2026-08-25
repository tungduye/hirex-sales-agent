import { AlertCircle, MailX, Paperclip } from "lucide-react";
import type { ReactNode } from "react";
import type { InboxMessage, ThreadDetailResult } from "@/modules/inbox/types/inbox";

export function ThreadDetail({ result }: { result: ThreadDetailResult }) {
  if (result.status === "not_found") return <DetailState icon={<MailX className="size-7" />} title="Thread not found" message="This conversation is unavailable or outside the selected account." />;
  if (result.status === "error") return <DetailState icon={<AlertCircle className="size-7" />} title="Unable to load conversation" message="The messages could not be loaded. Please try again." tone="error" />;
  if (result.messages.length === 0) return <DetailState icon={<MailX className="size-7" />} title="No messages in this thread" message="No synchronized message content is available." />;

  const subject = [...result.messages].reverse().find((message) => message.subject)?.subject ?? "(No subject)";
  return (
    <div>
      <header className="border-b bg-white px-5 py-4 md:px-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Conversation</p>
        <h2 className="mt-1 text-lg font-bold text-slate-950">{subject}</h2>
        <p className="mt-1 text-xs text-slate-500">{result.messages.length} synchronized {result.messages.length === 1 ? "message" : "messages"} · Readonly</p>
      </header>
      <div className="space-y-4 p-4 md:p-6">
        {result.messages.map((message) => <MessageCard key={message.id} message={message} />)}
      </div>
    </div>
  );
}

function MessageCard({ message }: { message: InboxMessage }) {
  const sender = message.fromName ?? message.fromEmail ?? "Unknown sender";
  const timestamp = message.providerInternalDate ?? message.receivedAt ?? message.sentAt;
  const body = message.bodyText ?? message.snippet ?? "No text content available.";
  return (
    <article className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="border-b px-4 py-3.5 md:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{initials(sender)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-900">{sender}</p>{message.fromName && message.fromEmail && <span className="text-xs text-slate-400">&lt;{message.fromEmail}&gt;</span>}<span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${message.direction === "INBOUND" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>{message.direction}</span></div>
            <AddressLine label="To" values={message.toEmails} />
            {message.ccEmails.length > 0 && <AddressLine label="Cc" values={message.ccEmails} />}
            {message.bccEmails.length > 0 && <AddressLine label="Bcc" values={message.bccEmails} />}
          </div>
          <time dateTime={timestamp ?? undefined} className="shrink-0 text-xs text-slate-400">{formatMessageTime(timestamp)}</time>
        </div>
      </div>
      <div className="px-4 py-5 md:px-5">
        {message.subject && <p className="mb-4 text-sm font-semibold text-slate-800">{message.subject}</p>}
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{body}</p>
        {message.hasAttachments && <div className="mt-5 inline-flex items-center gap-1.5 rounded-lg border bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600"><Paperclip className="size-3.5" />{message.attachmentCount} {message.attachmentCount === 1 ? "attachment" : "attachments"}</div>}
      </div>
    </article>
  );
}

function AddressLine({ label, values }: { label: string; values: string[] }) {
  return <p className="mt-0.5 truncate text-xs text-slate-400"><span className="font-medium text-slate-500">{label}:</span> {values.length ? values.join(", ") : "—"}</p>;
}

function DetailState({ icon, title, message, tone = "neutral" }: { icon: ReactNode; title: string; message: string; tone?: "neutral" | "error" }) {
  return <div className="flex min-h-[450px] flex-col items-center justify-center px-6 text-center"><div className={`flex size-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ${tone === "error" ? "text-rose-500 ring-rose-200" : "text-slate-400 ring-slate-200"}`}>{icon}</div><h2 className="mt-5 font-semibold text-slate-800">{title}</h2><p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p></div>;
}

function initials(value: string) { return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function formatMessageTime(value: string | null) { return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Time unavailable"; }
