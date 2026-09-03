"use client";

import { useState, useTransition } from "react";
import { Bot, Send } from "lucide-react";
import Link from "next/link";
import { generateSalesReplyDraft, sendSalesReply } from "@/modules/inbox/server/sales-reply-actions";
import type { ReplyComposerContext } from "@/modules/inbox/types/inbox";

export function SalesReplyComposer({ context, threadId }: { context: ReplyComposerContext; threadId: string }) {
  const [draft, setDraft] = useState(""); const [instruction, setInstruction] = useState("");
  const [notice, setNotice] = useState(""); const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [aiPending, startAi] = useTransition(); const [sendPending, startSend] = useTransition();
  const ready = context.status === "READY" && context.emailAccountId && context.emailMessageId;
  const locked = notice.includes("uncertain");

  function generate() { if (!ready) return; startAi(async () => { setNotice(""); const result = await generateSalesReplyDraft({ threadId, emailAccountId: context.emailAccountId!, instruction }); if (result.status === "DRAFT_READY" && result.draftText) setDraft(result.draftText); else setNotice(result.status === "NOT_REPLYABLE" ? "This conversation is not currently replyable." : "AI draft could not be generated. You can still write manually."); }); }
  function send() { if (!ready || !draft.trim() || locked) return; startSend(async () => { const result = await sendSalesReply({ emailAccountId: context.emailAccountId!, replyToEmailMessageId: context.emailMessageId!, bodyText: draft, idempotencyKey: attemptKey }); if (result.status === "SENT") { setDraft(""); setAttemptKey(crypto.randomUUID()); setNotice("Reply sent. The conversation will update after mailbox sync."); } else if (result.status === "DELIVERY_STATUS_UNKNOWN") setNotice("Delivery status is uncertain. Do not send this reply again yet."); else if (result.status === "REAUTH_REQUIRED") setNotice("Reconnect Gmail before sending."); else if (result.reason === "GMAIL_RATE_LIMITED") setNotice("Gmail temporarily rate-limited this send."); else setNotice("Reply could not be sent. Review the account and try again only after a definitive result."); }); }

  return <section className="sticky bottom-0 border-t bg-white p-4 md:p-5">
    <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900">Reply</h3><p className="text-xs text-slate-500">AI drafts only. You approve every send.</p></div><button type="button" onClick={generate} disabled={!ready || aiPending || sendPending} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"><Bot className="size-4" />{aiPending ? "Drafting…" : "Generate AI Reply"}</button></div>
    <input value={instruction} onChange={(event) => setInstruction(event.target.value)} disabled={!ready || aiPending || sendPending} maxLength={1000} placeholder="Optional AI instruction, e.g. Ask for a meeting" className="mb-2 h-9 w-full rounded-lg border px-3 text-xs" />
    <textarea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!ready || sendPending || locked} maxLength={100000} rows={6} placeholder={ready ? "Write or generate a reply…" : context.message} className="w-full resize-y rounded-xl border p-3 text-sm leading-6 disabled:bg-slate-50" />
    <div className="mt-3 flex items-center justify-between gap-3"><p className={`text-xs ${notice.includes("uncertain") ? "font-semibold text-amber-700" : "text-slate-500"}`}>{notice || context.message}{(context.status === "REAUTH_REQUIRED" || context.status === "SEND_SCOPE_REQUIRED") && <> <Link href="/settings" className="font-semibold text-blue-600 underline">Open Settings</Link></>}</p><button type="button" onClick={send} disabled={!ready || !draft.trim() || sendPending || aiPending || locked} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Send className="size-4" />{sendPending ? "Sending…" : "Send"}</button></div>
  </section>;
}
