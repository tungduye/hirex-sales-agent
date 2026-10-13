"use client";

import { useState, useTransition } from "react";
import { Bot, ChevronDown, Send } from "lucide-react";
import Link from "next/link";
import { generateSalesReplyDraft, sendSalesReply } from "@/modules/inbox/server/sales-reply-actions";
import type { ReplyComposerContext } from "@/modules/inbox/types/inbox";

export function SalesReplyComposer({ context, threadId }: { context: ReplyComposerContext; threadId: string }) {
  const [draft, setDraft] = useState(""); const [instruction, setInstruction] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState(""); const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [aiPending, startAi] = useTransition(); const [sendPending, startSend] = useTransition();
  const ready = context.status === "READY" && context.emailAccountId && context.emailMessageId;
  const locked = notice.includes("uncertain");
  const enableSendHref = context.status === "SEND_SCOPE_REQUIRED" && context.emailAccountId
    ? `/api/integrations/gmail/enable-send?account=${encodeURIComponent(context.emailAccountId)}` : null;

  function generate() { if (!ready) return; startAi(async () => { setNotice(""); const result = await generateSalesReplyDraft({ threadId, emailAccountId: context.emailAccountId!, instruction }); if (result.status === "DRAFT_READY" && result.draftText) setDraft(result.draftText); else setNotice(result.status === "NOT_REPLYABLE" ? "Hiện chưa thể trả lời cuộc hội thoại này." : "Không thể tạo bản nháp AI. Bạn vẫn có thể tự soạn nội dung."); }); }
  function send() { if (!ready || !draft.trim() || locked) return; startSend(async () => { const result = await sendSalesReply({ emailAccountId: context.emailAccountId!, replyToEmailMessageId: context.emailMessageId!, bodyText: draft, idempotencyKey: attemptKey }); if (result.status === "SENT") { setDraft(""); setAttemptKey(crypto.randomUUID()); setNotice("Đã gửi trả lời. Cuộc hội thoại sẽ cập nhật sau khi đồng bộ hộp thư."); } else if (result.status === "DELIVERY_STATUS_UNKNOWN") setNotice("Chưa xác định được trạng thái giao. Không gửi lại tin này lúc này."); else if (result.status === "REAUTH_REQUIRED") setNotice("Hãy kết nối lại Gmail trước khi gửi."); else if (result.reason === "GMAIL_RATE_LIMITED") setNotice("Gmail đang tạm giới hạn tốc độ gửi."); else setNotice("Không thể gửi trả lời. Chỉ thử lại sau khi đã xác định rõ kết quả."); }); }

  return <section className="border-t bg-white p-3 md:px-4 md:py-3">
    <div className={`flex items-center justify-between gap-3 ${expanded ? "mb-2" : ""}`}><div className="min-w-0"><h3 className="text-sm font-bold text-slate-900">Trả lời email</h3><p className="truncate text-xs text-slate-500">{expanded ? "AI chỉ tạo bản nháp; bạn quyết định nội dung gửi." : notice || context.message}</p></div><div className="flex shrink-0 items-center gap-2">{enableSendHref ? <Link href={enableSendHref} className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">Bật quyền gửi Gmail</Link> : null}{expanded ? <button type="button" onClick={generate} disabled={!ready || aiPending || sendPending} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"><Bot className="size-4" />{aiPending ? "Đang soạn…" : "Tạo trả lời bằng AI"}</button> : null}{ready || expanded ? <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{expanded ? "Thu gọn" : "Soạn trả lời"}<ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}/></button> : null}</div></div>
    {expanded ? <><input value={instruction} onChange={(event) => setInstruction(event.target.value)} disabled={!ready || aiPending || sendPending} maxLength={1000} placeholder="Chỉ dẫn tùy chọn cho AI, ví dụ: đề nghị một cuộc hẹn" className="mb-2 h-9 w-full rounded-lg border px-3 text-xs" />
    <textarea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!ready || sendPending || locked} maxLength={100000} rows={3} placeholder={ready ? "Viết hoặc tạo nội dung trả lời…" : context.message} className="max-h-32 min-h-20 w-full resize-y rounded-xl border p-3 text-sm leading-5 disabled:bg-slate-50" />
    <div className="mt-2 flex items-center justify-between gap-3"><p className={`text-xs ${locked ? "font-semibold text-amber-700" : "text-slate-500"}`}>{notice || context.message}{context.status === "REAUTH_REQUIRED" && <> <Link href="/settings" className="font-semibold text-blue-600 underline">Mở Cài đặt</Link></>}</p><button type="button" onClick={send} disabled={!ready || !draft.trim() || sendPending || aiPending || locked} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Send className="size-4" />{sendPending ? "Đang gửi…" : "Gửi"}</button></div></> : null}
  </section>;
}
