"use client";

import { useActionState, useState } from "react";
import { updateWorkflowName } from "./actions";

export function WorkflowNameForm({ workflowId, name, instanceId }: { workflowId: string; name: string; instanceId: string }) {
  const [state, formAction, pending] = useActionState(updateWorkflowName, { ok: true, message: "" });
  const [confirming, setConfirming] = useState(false);
  return <form action={formAction} className="space-y-2" onSubmit={(event) => {
    if (!confirming) { event.preventDefault(); setConfirming(true); } else { setConfirming(false); }
  }}>
    <input type="hidden" name="workflowId" value={workflowId}/>
    <input type="hidden" name="instanceId" value={instanceId}/>
    <label htmlFor="workflow-name" className="block text-sm font-semibold text-slate-700">Tên workflow</label>
    <div className="flex flex-col gap-2 sm:flex-row">
      <input id="workflow-name" name="name" defaultValue={name} required maxLength={160} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500"/>
      <button type="submit" disabled={pending} className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${confirming ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"}`}>{pending ? "Đang lưu…" : confirming ? "Xác nhận lưu" : "Lưu tên"}</button>
      {confirming && <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border px-4 py-2 text-sm font-semibold text-slate-700">Hủy</button>}
    </div>
    {confirming && <p className="text-xs font-medium text-amber-700">Bấm “Xác nhận lưu” lần nữa để cập nhật trực tiếp trên n8n.</p>}
    {state.message && <p role="status" className={`text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.message}</p>}
  </form>;
}
