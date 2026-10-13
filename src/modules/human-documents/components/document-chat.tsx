"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUp, BookOpen, LoaderCircle, Sparkles, Trash2 } from "lucide-react";
import { askDocuments } from "../server/ask-documents";

type Turn = { question: string; answer: string; error: boolean; sources: { id: number; name: string; quote: string }[] };
export function DocumentChat({ selectedId, selectedName }: { selectedId?: number; selectedName?: string }) {
  const [question, setQuestion] = useState("");
  const [consent, setConsent] = useState(false);
  const [scope, setScope] = useState("selected");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, startTransition] = useTransition();
  function send() {
    const value = question.trim();
    if (pending || value.length < 3) return;
    startTransition(async () => {
      try {
        const answer = await askDocuments({ question: value, selectedId: scope === "selected" ? selectedId : undefined, consent });
        setTurns(previous => [...previous.slice(-9), { question: value, ...answer }]);
        if (!answer.error) setQuestion("");
      } catch {
        setTurns(previous => [...previous.slice(-9), { question: value, answer: "Không thể gửi câu hỏi. Anh kiểm tra phiên đăng nhập và thử lại nhé.", error: true, sources: [] }]);
      }
    });
  }
  return <aside className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-indigo-100 bg-white shadow-sm">
    <div className="flex items-center justify-between border-b border-indigo-100 bg-indigo-50/70 p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-indigo-600 p-2 text-white"><Sparkles size={18} /></div><div><h2 className="font-semibold text-slate-900">Trợ lý tài liệu</h2><p className="text-xs text-indigo-600">Hỏi đáp có nguồn tham chiếu</p></div></div><button type="button" onClick={() => setTurns([])} disabled={pending} aria-label="Xóa hội thoại trên màn hình" className="rounded-lg p-2 text-slate-400 hover:bg-white"><Trash2 size={16} /></button></div>
    <div className="border-b p-4"><label className="mb-2 block text-xs font-medium text-slate-500" htmlFor="document-scope">PHẠM VI TÌM KIẾM</label><select id="document-scope" value={selectedId ? scope : "all"} onChange={event => setScope(event.target.value)} disabled={pending} className="w-full rounded-lg border bg-slate-50 p-2 text-sm"><option value="all">Toàn bộ thư viện đã nhập</option>{selectedId && <option value="selected">Tài liệu đang mở · #{selectedId}</option>}</select>{selectedName && scope === "selected" && <p className="mt-2 line-clamp-2 text-xs text-slate-500">{selectedName}</p>}</div>
    <div className="max-h-[58vh] min-h-64 flex-1 space-y-5 overflow-y-auto p-4" role="log" aria-live="polite">
      {!turns.length && <div className="py-5"><BookOpen className="mb-4 text-indigo-300" size={32}/><h3 className="font-medium text-slate-800">Anh muốn tìm hiểu điều gì?</h3><p className="mt-2 text-sm leading-6 text-slate-500">Em tìm trong nội dung status và dẫn nguồn để anh kiểm tra. Không đọc file đính kèm hoặc dữ liệu mới trên Human.</p><div className="mt-4 space-y-2">{(selectedId ? ["Tóm tắt các nội dung chính của tài liệu đang mở", "Những việc cần thực hiện trong tài liệu này là gì?"] : ["Tìm quy trình nghiệm thu", "Tìm tài liệu hướng dẫn sử dụng CRM"]).map(value => <button key={value} type="button" onClick={() => setQuestion(value)} className="block w-full rounded-xl border border-slate-200 p-3 text-left text-xs text-slate-600 hover:border-indigo-300 hover:bg-indigo-50">{value}</button>)}</div></div>}
      {turns.map((turn, index) => <div key={index} className="space-y-3"><div className="ml-5 whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-3 text-sm text-white">{turn.question}</div><div className={`whitespace-pre-wrap text-sm leading-7 ${turn.error ? "text-amber-700" : "text-slate-700"}`}>{turn.answer}</div>{turn.sources.map((source, sourceIndex) => <details key={`${source.id}-${sourceIndex}`} className="rounded-xl border bg-slate-50 p-3 text-xs"><summary className="cursor-pointer font-medium text-indigo-700">Nguồn #{source.id} · {source.name}</summary><blockquote className="my-2 border-l-2 border-indigo-200 pl-3 leading-6 text-slate-600">{source.quote}</blockquote><Link href={`/documents?id=${source.id}`} className="text-indigo-700 underline">Mở tài liệu →</Link></details>)}</div>)}
      {pending && <p className="flex items-center gap-2 text-sm text-indigo-600"><LoaderCircle size={16} className="animate-spin"/>Đang tìm nguồn và soạn trả lời…</p>}
    </div>
    <form onSubmit={event => { event.preventDefault(); send(); }} className="border-t bg-slate-50/60 p-4"><label className="mb-3 flex items-start gap-2 text-[11px] leading-5 text-slate-500"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={pending} className="mt-1"/>Cho phép gửi câu hỏi và các đoạn status liên quan tới OpenAI để trả lời.</label><div className="rounded-xl border bg-white p-2 focus-within:border-indigo-400"><textarea aria-label="Câu hỏi cho trợ lý tài liệu" value={question} onChange={event => setQuestion(event.target.value)} maxLength={1200} rows={3} placeholder="Nhập câu hỏi cụ thể…" disabled={pending} className="w-full resize-none p-2 text-sm outline-none"/><div className="flex items-center justify-between"><span className="pl-2 text-[10px] text-slate-400">{question.length}/1200</span><button type="submit" disabled={pending || question.trim().length < 3} aria-label="Gửi câu hỏi" className="rounded-lg bg-indigo-600 p-2 text-white disabled:opacity-40"><ArrowUp size={18}/></button></div></div><p className="mt-2 text-[10px] leading-4 text-slate-400">Tìm/đếm nội bộ không cần gửi OpenAI. AI có thể sai; hãy đối chiếu nguồn. Mỗi câu hỏi độc lập, lịch sử chỉ giữ trên màn hình.</p></form>
  </aside>;
}
