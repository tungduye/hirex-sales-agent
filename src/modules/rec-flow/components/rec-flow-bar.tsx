"use client";

import { Pencil, Route, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { FACT_FIELDS, flowSummary, REC_OUTCOME_LABEL, REC_OUTCOMES, REC_STEPS, type FactKey, type RecFlowState } from "../core/rec-flow";
import { confirmRecFact, loadRecFactSources, loadRecFlow, saveRecFlow, type FactSource } from "../server/rec-flow-actions";

/** Fired after a Hola draft is sent (or the flow is edited) so the bar shows the new state. */
export const REC_FLOW_EVENT = "hirex:rec-flow";
export type RecFlowEventDetail = { conversationId: string; state: RecFlowState };

/** "Bước 4/8 · Tiếng Nhật · Đã biết … · Còn thiếu …" above the composer of a one-to-one candidate chat. */
export function RecFlowBar({ conversationId }: { conversationId: string }) {
  const [state, setState] = useState<RecFlowState | null>(null);
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const outcomeRef = useRef<RecFlowState["outcome"] | undefined>(undefined);
  // A new outcome tags the chat (and on a CV assigns it and opens a care task): refresh so the panel shows it.
  const show = (next: RecFlowState | null, saved: boolean) => {
    if (saved && next && outcomeRef.current !== undefined && next.outcome !== outcomeRef.current) router.refresh();
    outcomeRef.current = next?.outcome ?? null;
    setState(next);
  };
  const showRef = useRef(show);
  useEffect(() => { showRef.current = show; });
  useEffect(() => {
    let live = true;
    loadRecFlow(conversationId).then((value) => { if (live) showRef.current(value, false); }).catch(() => {});
    const onEvent = (event: Event) => { const detail = (event as CustomEvent<RecFlowEventDetail>).detail; if (detail?.conversationId === conversationId) showRef.current(detail.state, true); };
    window.addEventListener(REC_FLOW_EVENT, onEvent);
    // What the candidate writes is filed in the background about a minute later: look again now and then.
    const timer = window.setInterval(() => { if (!document.hidden) loadRecFlow(conversationId).then((value) => { if (live && value) showRef.current(value, false); }).catch(() => {}); }, 45_000);
    return () => { live = false; window.clearInterval(timer); window.removeEventListener(REC_FLOW_EVENT, onEvent); };
  }, [conversationId]);
  if (!state) return null;
  const summary = flowSummary(state);
  return <div className="mb-2">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-1.5 text-xs text-slate-600">
      <Route className="size-3.5 shrink-0 text-indigo-600"/>
      <span className="font-semibold text-indigo-800">{summary.stepLabel} · {summary.stepName}</span>
      {summary.known.length ? <span>· Đã biết: <span className="text-slate-800">{summary.known.join(", ")}</span></span> : null}
      {summary.missing.length && !summary.outcome ? <span>· Còn thiếu: <span className="text-amber-700">{summary.missing.join(", ")}</span></span> : null}
      {summary.offered ? <span>· Đã gửi {summary.offered} job</span> : null}
      {summary.outcome ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">{summary.outcome}</span> : null}
      <button type="button" onClick={() => setEditing((open) => !open)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-indigo-700 hover:bg-indigo-100" title="Sửa bước hoặc thông tin ứng viên nếu AI hiểu sai"><Pencil className="size-3"/>Sửa</button>
    </div>
    {editing ? <FlowEditor conversationId={conversationId} state={state} onSaved={(next) => { show(next, true); setEditing(false); }} onClose={() => setEditing(false)}/> : null}
  </div>;
}

const SOURCE_LABEL: Record<FactSource["source"], string> = { AI_CHAT: "AI ghi từ tin nhắn", AI_DRAFT: "AI (Hola/Hole)", MEMBER: "Recer nhập" };
const day = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }); };

function FlowEditor({ conversationId, state, onSaved, onClose }: { conversationId: string; state: RecFlowState; onSaved: (state: RecFlowState) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<RecFlowState>(state);
  const [sources, setSources] = useState<Partial<Record<FactKey, FactSource>>>({});
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let live = true; loadRecFactSources(conversationId).then((value) => { if (live && value) setSources(value); }).catch(() => {}); return () => { live = false; }; }, [conversationId]);
  const confirm = (key: FactKey) => start(async () => { const next = await confirmRecFact({ conversationId, key }); if (next) setSources(next); else setError("Chưa xác nhận được, thử lại."); });
  const field = (item: (typeof FACT_FIELDS)[number]) => {
    const source = sources[item.key];
    const edited = (draft.facts[item.key] ?? "") !== (state.facts[item.key] ?? "");
    const value = state.facts[item.key];
    const own = Boolean(value && source && source.value === value);
    return <div key={item.key} className="min-w-0 text-xs">
      <span className="mb-0.5 block truncate font-semibold text-slate-600" title={item.label}>{item.label}</span>
      <input value={draft.facts[item.key] ?? ""} maxLength={120} onChange={(event) => { const facts = { ...draft.facts }; if (event.target.value.trim()) facts[item.key] = event.target.value; else delete facts[item.key]; setDraft({ ...draft, facts }); }} className="h-8 w-full rounded-lg border border-slate-200 px-2"/>
      {value ? <div className="mt-0.5 flex min-w-0 items-center gap-1">
        {own && source ? <span title={`${SOURCE_LABEL[source.source]}${source.by ? ` · ${source.by}` : ""} · ${day(source.at)}`}
          className={`max-w-[60%] shrink-0 truncate rounded px-1 text-[10px] font-semibold ${source.confirmed ? "bg-emerald-50 text-emerald-700" : source.source === "AI_CHAT" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
          {source.confirmed ? `✓ ${source.by ?? "Đã xác nhận"}` : source.source === "AI_CHAT" ? "AI ghi" : source.source === "AI_DRAFT" ? "Hola/Hole" : "Recer"}</span> : null}
        {!edited && !(own && source?.confirmed) ? <button type="button" disabled={pending} onClick={() => confirm(item.key)} title="Xác nhận thông tin này đúng"
          className="shrink-0 rounded px-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">✓ Đúng</button> : null}
        {own && source?.quote ? <span className="min-w-0 truncate text-[10.5px] italic text-slate-500" title={`Ứng viên nhắn: “${source.quote}”`}>“{source.quote}”</span> : null}
      </div> : null}
      {own && source?.previous.length ? <p className="truncate text-[10.5px] text-slate-400" title={source.previous.map((entry) => `${entry.value ?? "(trống)"} · ${day(entry.at)}`).join("\n")}>Trước: {source.previous.map((entry) => entry.value ?? "(trống)").join(", ")}</p> : null}
    </div>;
  };
  return <div className="mt-1.5 max-h-[60dvh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
    <div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Luồng Rec của ứng viên</p><button type="button" onClick={onClose} aria-label="Đóng" className="rounded p-0.5 text-slate-400 hover:bg-slate-100"><X className="size-3.5"/></button></div>
    <p className="mb-2 text-[11px] text-slate-500">Ứng viên nhắn tới đâu, AI tự ghi tới đó (kèm câu ứng viên đã nói). Bấm <b className="text-emerald-700">✓ Đúng</b> để xác nhận, sửa ô nếu AI hiểu sai.</p>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <label className="text-xs"><span className="mb-0.5 block font-semibold text-slate-600">Bước</span>
        <select value={draft.step} onChange={(event) => setDraft({ ...draft, step: Number(event.target.value) })} className="h-8 w-full rounded-lg border border-slate-200 px-2">{REC_STEPS.map((step) => <option key={step.step} value={step.step}>{step.step}. {step.label}</option>)}</select></label>
      <label className="text-xs"><span className="mb-0.5 block font-semibold text-slate-600">Kết quả</span>
        <select value={draft.outcome ?? ""} onChange={(event) => setDraft({ ...draft, outcome: (event.target.value || null) as RecFlowState["outcome"] })} className="h-8 w-full rounded-lg border border-slate-200 px-2"><option value="">—</option>{REC_OUTCOMES.map((value) => <option key={value} value={value}>{REC_OUTCOME_LABEL[value]}</option>)}</select></label>
      {FACT_FIELDS.filter((item) => item.summary).map(field)}
    </div>
    <p className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Thêm về ứng viên</p>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{FACT_FIELDS.filter((item) => !item.summary).map(field)}</div>
    <div className="mt-2.5 flex items-center justify-end gap-2">
      {error ? <span className="mr-auto text-xs text-rose-600">{error}</span> : null}
      <button type="button" onClick={onClose} className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">Huỷ</button>
      <button type="button" disabled={pending} onClick={() => start(async () => { const saved = await saveRecFlow({ conversationId, flow: draft, source: "edit" }); if (saved) onSaved(saved); else setError("Chưa lưu được, thử lại."); })} className="h-8 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-60">{pending ? "Đang lưu…" : "Lưu"}</button>
    </div>
  </div>;
}
