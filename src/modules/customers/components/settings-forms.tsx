"use client";

import { useActionState, useState, useTransition } from "react";
import { addCustomerBlock, importHumanCodes, refreshGroupSuggestions, runCvPinsNow, saveCvPinSettings, saveHumanUserLinks } from "../server/customer-actions";

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

export function ImportCodesForm() {
  const [state, action, pending] = useActionState(importHumanCodes, idle);
  return <form action={action} className="space-y-2">
    <textarea name="codes" rows={5} placeholder={"Dán bảng bộ mã từ Human, ví dụ:\nHạng 1\t200223\tXếp hạng Công việc\tKích hoạt"} className="w-full rounded-lg border border-slate-200 p-2 font-mono text-xs"/>
    <div className="flex items-center gap-3"><button disabled={pending} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Đang lưu…" : "Lưu bộ mã"}</button>{state.message ? <p role="status" className={`text-xs ${state.ok ? "text-emerald-700" : "text-rose-600"}`}>{state.message}</p> : null}</div>
  </form>;
}

export function CvPinSettingsForm({ enabled, time }: { enabled: boolean; time: string }) {
  const [state, action, pending] = useActionState(saveCvPinSettings, idle);
  return <form action={action} className="flex flex-wrap items-end gap-3">
    <label className="inline-flex h-9 items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" name="enabled" defaultChecked={enabled}/>Bật ghim tự động mỗi ngày</label>
    <label className="text-xs font-semibold text-slate-600">Giờ ghim<input type="time" name="time" min="08:00" max="20:59" defaultValue={time} className="mt-1 block h-9 rounded-lg border border-slate-200 px-2 text-sm"/></label>
    <button disabled={pending} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Đang lưu…" : "Lưu"}</button>
    {state.message ? <p role="status" className={`w-full text-xs ${state.ok ? "text-emerald-700" : "text-rose-600"}`}>{state.message}</p> : null}
  </form>;
}

export function CvPinRunButtons() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" disabled={pending} onClick={() => start(async () => setResult(await refreshGroupSuggestions()))} className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Tìm gợi ý ghép nhóm</button>
    <button type="button" disabled={pending} onClick={() => { if (window.confirm("Soda sẽ gửi và ghim Tình trạng CV vào các nhóm đã duyệt có thay đổi (gửi thật, trong 8:00–21:00). Tiếp tục?")) start(async () => setResult(await runCvPinsNow())); }}
      className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">{pending ? "Đang chạy…" : "Ghim ngay"}</button>
    {result ? <p role="status" className={`w-full text-xs ${result.ok ? "text-emerald-700" : "text-rose-600"}`}>{result.message}</p> : null}
  </div>;
}
