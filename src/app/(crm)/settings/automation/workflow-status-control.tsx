"use client";

import { useActionState, useState } from "react";
import { changeWorkflowStatus, type WorkflowActionState } from "./actions";

const initialState: WorkflowActionState = { ok: true, message: "" };

export function WorkflowStatusControl({ workflowId, active, instanceId }: { workflowId: string; active: boolean; instanceId: string }) {
  const [state, formAction, pending] = useActionState(changeWorkflowStatus, initialState);
  const [confirming, setConfirming] = useState(false);
  const operation = active ? "deactivate" : "activate";
  return <div className="flex min-w-32 flex-col items-end gap-1">
    <form action={formAction} onSubmit={(event) => {
      if (!confirming) { event.preventDefault(); setConfirming(true); } else { setConfirming(false); }
    }} className="flex items-center gap-1">
      <input type="hidden" name="workflowId" value={workflowId}/>
      <input type="hidden" name="instanceId" value={instanceId}/>
      <input type="hidden" name="operation" value={operation}/>
      <button type="submit" disabled={pending} className={`rounded-lg px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${confirming ? "bg-amber-600 text-white hover:bg-amber-700" : active ? "border border-slate-300 text-slate-700 hover:bg-slate-50" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
        {pending ? "Đang xử lý…" : confirming ? `Xác nhận ${active ? "tắt" : "bật"}` : active ? "Tắt" : "Bật"}
      </button>
      {confirming && <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border px-2 py-2 text-xs font-semibold text-slate-600">Hủy</button>}
    </form>
    {state.message && <p role="status" className={`max-w-56 text-right text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.message}</p>}
  </div>;
}
