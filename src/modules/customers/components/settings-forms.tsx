"use client";

import { useActionState } from "react";
import { addCustomerBlock, saveHumanUserLinks } from "../server/customer-actions";

const idle = { ok: false, message: "" };

export function AddBlockForm() {
  const [state, action, pending] = useActionState(addCustomerBlock, idle);
  return <form action={action} className="flex flex-wrap items-end gap-2">
    <label className="text-xs font-semibold text-slate-600">Mã khối<input name="blockId" required inputMode="numeric" pattern="[0-9]+" placeholder="36311" className="mt-1 block h-9 w-32 rounded-lg border border-slate-200 px-2 text-sm"/></label>
    <label className="text-xs font-semibold text-slate-600">Tên hiển thị<input name="name" maxLength={80} placeholder="VD: Khách IT Hà Nội" className="mt-1 block h-9 w-56 rounded-lg border border-slate-200 px-2 text-sm"/></label>
    <button disabled={pending} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Đang thêm…" : "Thêm khối"}</button>
    {state.message ? <p role="status" className={`w-full text-xs ${state.ok ? "text-emerald-700" : "text-rose-600"}`}>{state.message}</p> : null}
  </form>;
}

export function UserLinksForm({ people, members }: { people: Array<{ humanId: string; humanName: string | null; profileId: string | null; customers: number }>; members: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(saveHumanUserLinks, idle);
  if (!people.length) return <p className="text-sm text-slate-500">Chưa thấy Sale/AM nào trong dữ liệu. Cập nhật từ Human trước.</p>;
  return <form action={action}>
    <div className="overflow-hidden rounded-lg border border-slate-200"><table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Người trên Human</th><th className="px-3 py-2">Số khách</th><th className="px-3 py-2">Là ai ở HireX</th></tr></thead>
      <tbody>{people.map((person) => <tr key={person.humanId} className="border-t border-slate-100">
        <td className="px-3 py-2"><span className="font-medium text-slate-800">{person.humanName ?? "Chưa rõ tên"}</span> <span className="text-xs text-slate-400">#{person.humanId}</span></td>
        <td className="px-3 py-2 text-slate-600">{person.customers.toLocaleString("vi-VN")}</td>
        <td className="px-3 py-2"><select name={`link:${person.humanId}`} defaultValue={person.profileId ?? ""} className="h-8 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="">— Chưa liên kết —</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></td>
      </tr>)}</tbody>
    </table></div>
    <div className="mt-2 flex items-center gap-3"><button disabled={pending} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Đang lưu…" : "Lưu liên kết"}</button>{state.message ? <p role="status" className={`text-xs ${state.ok ? "text-emerald-700" : "text-rose-600"}`}>{state.message}</p> : null}</div>
  </form>;
}
