"use client";

import { Pencil, Route, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { FACT_FIELDS, flowSummary, REC_OUTCOME_LABEL, REC_OUTCOMES, REC_STEPS, type RecFlowState } from "../core/rec-flow";
import { loadRecFlow, saveRecFlow } from "../server/rec-flow-actions";

/** Fired after a Hola draft is sent (or the flow is edited) so the bar shows the new state. */
export const REC_FLOW_EVENT = "hirex:rec-flow";
export type RecFlowEventDetail = { conversationId: string; state: RecFlowState };

/** "Bước 4/8 · Tiếng Nhật · Đã biết … · Còn thiếu …" above the composer of a one-to-one candidate chat. */
export function RecFlowBar({ conversationId }: { conversationId: string }) {
  const [state, setState] = useState<RecFlowState | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let live = true;
    loadRecFlow(conversationId).then((value) => { if (live) setState(value); }).catch(() => {});
    const onEvent = (event: Event) => { const detail = (event as CustomEvent<RecFlowEventDetail>).detail; if (detail?.conversationId === conversationId) setState(detail.state); };
    window.addEventListener(REC_FLOW_EVENT, onEvent);
    return () => { live = false; window.removeEventListener(REC_FLOW_EVENT, onEvent); };
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
    {editing ? <FlowEditor conversationId={conversationId} state={state} onSaved={(next) => { setState(next); setEditing(false); }} onClose={() => setEditing(false)}/> : null}
  </div>;
}

function FlowEditor({ conversationId, state, onSaved, onClose }: { conversationId: string; state: RecFlowState; onSaved: (state: RecFlowState) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<RecFlowState>(state);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <div className="mt-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
    <div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Luồng Rec của ứng viên</p><button type="button" onClick={onClose} aria-label="Đóng" className="rounded p-0.5 text-slate-400 hover:bg-slate-100"><X className="size-3.5"/></button></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <label className="text-xs"><span className="mb-0.5 block font-semibold text-slate-600">Bước</span>
        <select value={draft.step} onChange={(event) => setDraft({ ...draft, step: Number(event.target.value) })} className="h-8 w-full rounded-lg border border-slate-200 px-2">{REC_STEPS.map((step) => <option key={step.step} value={step.step}>{step.step}. {step.label}</option>)}</select></label>
      <label className="text-xs"><span className="mb-0.5 block font-semibold text-slate-600">Kết quả</span>
        <select value={draft.outcome ?? ""} onChange={(event) => setDraft({ ...draft, outcome: (event.target.value || null) as RecFlowState["outcome"] })} className="h-8 w-full rounded-lg border border-slate-200 px-2"><option value="">—</option>{REC_OUTCOMES.map((value) => <option key={value} value={value}>{REC_OUTCOME_LABEL[value]}</option>)}</select></label>
      {FACT_FIELDS.map((field) => <label key={field.key} className="text-xs"><span className="mb-0.5 block font-semibold text-slate-600">{field.label}</span>
        <input value={draft.facts[field.key] ?? ""} maxLength={120} onChange={(event) => { const facts = { ...draft.facts }; if (event.target.value.trim()) facts[field.key] = event.target.value; else delete facts[field.key]; setDraft({ ...draft, facts }); }} className="h-8 w-full rounded-lg border border-slate-200 px-2"/></label>)}
    </div>
    <div className="mt-2.5 flex items-center justify-end gap-2">
      {error ? <span className="mr-auto text-xs text-rose-600">{error}</span> : null}
      <button type="button" onClick={onClose} className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">Huỷ</button>
      <button type="button" disabled={pending} onClick={() => start(async () => { const saved = await saveRecFlow({ conversationId, flow: draft }); if (saved) onSaved(saved); else setError("Chưa lưu được, thử lại."); })} className="h-8 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-60">{pending ? "Đang lưu…" : "Lưu"}</button>
    </div>
  </div>;
}
