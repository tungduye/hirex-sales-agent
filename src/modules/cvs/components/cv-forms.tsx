"use client";

import { RefreshCw } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { addCvBlock, refreshCvsFromHuman, saveRecLinks } from "../server/cv-actions";

const idle = { ok: false, message: "" };

export function RefreshCvsButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return <div className="flex flex-col items-end gap-1">
    <button type="button" disabled={pending} onClick={() => start(async () => setResult(await refreshCvsFromHuman()))}
      className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
      <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`}/>{pending ? "Đang lấy từ Human…" : "Cập nhật từ Human"}
    </button>
    {result ? <p role="status" className={`max-w-sm text-right text-xs ${result.ok ? "text-emerald-700" : "text-rose-600"}`}>{result.message}</p> : null}
  </div>;
}

export function AddCvBlockForm() {
  const [state, action, pending] = useActionState(addCvBlock, idle);
  return <form action={action} className="flex flex-wrap items-end gap-2">
    <label className="text-xs font-semibold text-slate-600">Mã khối<input name="blockKey" required pattern="[A-Za-z0-9_\-]+" placeholder="CV_GOC" className="mt-1 block h-9 w-40 rounded-lg border border-slate-200 px-2 text-sm"/></label>
    <label className="text-xs font-semibold text-slate-600">Tên hiển thị<input name="name" maxLength={80} placeholder="VD: CV gốc" className="mt-1 block h-9 w-56 rounded-lg border border-slate-200 px-2 text-sm"/></label>
    <button disabled={pending} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Đang thêm…" : "Thêm khối"}</button>
    {state.message ? <p role="status" className={`w-full text-xs ${state.ok ? "text-emerald-700" : "text-rose-600"}`}>{state.message}</p> : null}
  </form>;
}

export function RecLinksForm({ people, members }: { people: Array<{ humanId: string; humanName: string | null; profileId: string | null; cvs: number }>; members: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(saveRecLinks, idle);
  if (!people.length) return <p className="text-sm text-slate-500">Chưa thấy Rec nào trong dữ liệu CV. Cập nhật từ Human trước.</p>;
  return <form action={action}>
    <div className="overflow-hidden rounded-lg border border-slate-200"><table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Rec trên Human</th><th className="px-3 py-2">Số CV</th><th className="px-3 py-2">Là ai ở HireX</th></tr></thead>
      <tbody>{people.map((person) => <tr key={person.humanId} className="border-t border-slate-100">
        <td className="px-3 py-2"><span className="font-medium text-slate-800">{person.humanName ?? "Chưa rõ tên"}</span> <span className="text-xs text-slate-400">#{person.humanId}</span></td>
        <td className="px-3 py-2 text-slate-600">{person.cvs.toLocaleString("vi-VN")}</td>
        <td className="px-3 py-2"><select name={`link:${person.humanId}`} defaultValue={person.profileId ?? ""} className="h-8 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="">— Chưa liên kết —</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></td>
      </tr>)}</tbody>
    </table></div>
    <div className="mt-2 flex items-center gap-3"><button disabled={pending} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Đang lưu…" : "Lưu liên kết"}</button>{state.message ? <p role="status" className={`text-xs ${state.ok ? "text-emerald-700" : "text-rose-600"}`}>{state.message}</p> : null}</div>
  </form>;
}
