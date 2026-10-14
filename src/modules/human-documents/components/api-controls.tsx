"use client";
import { useActionState, useRef, useState, useTransition } from "react";
import { refreshHumanDocuments, saveHumanApiToken } from "../server/actions";
export function HumanRefreshButton() {
  const [pending, start] = useTransition(); const [message, setMessage] = useState("");
  return <div><div className="flex flex-wrap items-center gap-3"><button disabled={pending} onClick={() => start(async () => { const result = await refreshHumanDocuments(); setMessage(result.message); })} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? "Đang tải từ Human…" : "Cập nhật từ Human"}</button><HumanApiSettings /></div><p role="status" className="mt-2 text-sm">{message}</p></div>;
}
export function HumanApiSettings() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => { setOpen(true); dialog.current?.showModal(); }} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700">Cài đặt API Human</button>
    <dialog ref={dialog} aria-labelledby="human-api-settings-title" onClose={() => setOpen(false)} className="fixed inset-0 m-auto max-h-[90vh] w-[min(95vw,560px)] overflow-y-auto rounded-2xl border-0 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/50">
      <div className="flex items-center justify-between gap-4"><h2 id="human-api-settings-title" className="text-xl font-semibold">Cài đặt kết nối Human</h2><button type="button" aria-label="Đóng cài đặt" onClick={() => dialog.current?.close()} className="rounded-lg px-3 py-2 hover:bg-slate-100">✕</button></div>
      <p className="mt-3 break-all rounded-lg bg-slate-50 p-3 text-xs">POST http://52.220.196.215:8088/document/all</p>
      {open && <HumanApiTokenForm />}
    </dialog></>;
}
export function HumanApiTokenForm() {
  const [state, action, pending] = useActionState(saveHumanApiToken, { ok: false, message: "" });
  return <form action={action} className="my-5 space-y-3 rounded-xl border p-4"><h2 className="font-semibold">Đồng bộ API Human (lab)</h2><p className="text-sm text-amber-700">Máy chủ 52.220.196.215:8088 dùng HTTP: token và dữ liệu truyền tới Human không được mã hóa. Token được lưu mã hóa trên HireX, không hiển thị lại.</p><label className="block text-sm">Bearer token<input name="token" type="password" required maxLength={8192} autoComplete="off" className="mt-1 block w-full rounded border p-2" /></label><label className="block text-sm"><input name="consent" type="checkbox" value="yes" required /> Tôi chấp nhận sử dụng HTTP cho máy chủ lab này.</label><button disabled={pending} className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">{pending ? "Đang lưu…" : "Lưu token API"}</button><p role="status">{state.message}</p></form>;
}
