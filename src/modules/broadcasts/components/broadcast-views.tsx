"use client";

import { ArrowLeft, Megaphone, Pause, Pin, Play, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { changeBroadcastAction } from "../server/broadcast-actions";
import type { BroadcastSummary } from "../server/broadcast-data";

const STATUS: Record<string, [string, string]> = {
  DRAFT: ["Nháp – chưa gửi", "border-slate-200 bg-slate-100 text-slate-600"], RUNNING: ["Đang gửi", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  PAUSED: ["Tạm dừng", "border-amber-200 bg-amber-50 text-amber-800"], DONE: ["Đã xong", "border-blue-200 bg-blue-50 text-blue-700"], CANCELLED: ["Đã huỷ", "border-rose-200 bg-rose-50 text-rose-700"],
};
const TARGET: Record<string, string> = { PENDING: "Chờ gửi", SENT: "Đã gửi", FAILED: "Lỗi", UNKNOWN: "Chưa rõ", SKIPPED: "Bỏ qua", CANCELLED: "Đã huỷ" };
const PIN: Record<string, string> = { NONE: "", PENDING: "Chờ ghim tin", PINNED: "Đã ghim tin", FAILED: "Ghim tin lỗi" };
const NOTE: Record<string, string> = { NONE: "", PENDING: "Chờ ghi chú", PINNED: "Đã thêm ghi chú", FAILED: "Ghi chú lỗi" };
const what = (item: BroadcastSummary) => [item.sendMessage ? "Gửi tin" : "", item.pinMessage ? "ghim tin" : "", item.pinNote ? "ghi chú" : ""].filter(Boolean).join(" + ");
const when = (iso: string | null) => iso ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso)) : "—";

function Badge({ status }: { status: string }) {
  const [label, style] = STATUS[status] ?? [status, "border-slate-200 bg-slate-100 text-slate-600"];
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${style}`}>{label}</span>;
}

function Controls({ item }: { item: BroadcastSummary }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!item.canManage || ["DONE", "CANCELLED"].includes(item.status)) return null;
  const run = (action: "START" | "PAUSE" | "CANCEL", question?: string) => { if (question && !window.confirm(question)) return; start(async () => { const result = await changeBroadcastAction(item.id, action); setError(result.ok ? null : result.error ?? "Chưa thực hiện được."); }); };
  return <div className="flex flex-wrap items-center gap-2">
    {item.status === "DRAFT" || item.status === "PAUSED" ? <button type="button" disabled={pending} onClick={() => run("START", item.status === "DRAFT" ? `Bắt đầu gửi vào ${item.total} nhóm? Mỗi nick tối đa ${item.dailyCapPerNick} nhóm/ngày, cách nhau 90–180 giây, chỉ từ 8:00 đến 21:00.` : undefined)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"><Play className="size-3.5"/>{item.status === "DRAFT" ? "Bắt đầu gửi" : "Tiếp tục"}</button> : null}
    {item.status === "RUNNING" ? <button type="button" disabled={pending} onClick={() => run("PAUSE")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"><Pause className="size-3.5"/>Tạm dừng</button> : null}
    <button type="button" disabled={pending} onClick={() => run("CANCEL", "Huỷ đợt gửi? Các nhóm chưa gửi sẽ không được gửi nữa.")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"><X className="size-3.5"/>Huỷ</button>
    {error ? <span className="text-xs text-rose-600">{error}</span> : null}
  </div>;
}

export function BroadcastList({ items, canCreate }: { items: BroadcastSummary[]; canCreate: boolean }) {
  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-950"><Megaphone className="size-6 text-blue-600"/>Gửi nhóm Zalo</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">Gửi một tin vào nhiều nhóm Zalo, có thể ghim tin đó lên đầu nhóm và/hoặc thêm ghi chú. Mỗi nhóm gửi từ một nick đang ở trong nhóm; mỗi nick tối đa 30 nhóm/ngày, cách nhau ngẫu nhiên 90–180 giây, chỉ từ 8:00 đến 21:00. Không gửi gì cho đến khi bấm “Bắt đầu gửi”.</p>
      </div>
      {canCreate ? <Link href="/broadcasts/new" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-sm font-semibold text-white hover:bg-blue-700"><Plus className="size-4"/>Tạo đợt gửi</Link> : null}
    </header>
    <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-sm">
      {items.map((item) => <article key={item.id} className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-[260px] flex-1">
          <Link href={`/broadcasts/${item.id}`} className="font-semibold text-slate-900 hover:text-blue-700">{item.name}</Link>
          <p className="mt-0.5 text-xs text-slate-500">{item.createdBy} · {when(item.createdAt)} · {what(item)}</p>
        </div>
        <Badge status={item.status}/>
        <p className="text-sm text-slate-700"><b>{item.sent}</b>/{item.total} nhóm{item.pinMessage ? <span className="text-slate-500"> · {item.pinnedMessages} đã ghim tin</span> : null}{item.pinNote ? <span className="text-slate-500"> · {item.pinned} ghi chú</span> : null}{item.failed ? <span className="text-rose-600"> · {item.failed} lỗi</span> : null}</p>
        <Controls item={item}/>
      </article>)}
      {items.length === 0 ? <p className="px-4 py-12 text-center text-sm text-slate-500">Chưa có đợt gửi nào.</p> : null}
    </div>
  </div>;
}

export function BroadcastDetail({ item, targets }: { item: BroadcastSummary; targets: Array<{ id: string; groupName: string; nick: string; status: string; pinStatus: string; messagePinStatus: string; attempts: number; doneAt: string | null; error: string | null }> }) {
  return <div className="space-y-5">
    <Link href="/broadcasts" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-blue-700"><ArrowLeft className="size-4"/>Gửi nhóm Zalo</Link>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">{item.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500"><Badge status={item.status}/>{item.createdBy} · {when(item.createdAt)} · {item.sent}/{item.total} nhóm đã gửi{item.pinMessage ? <span className="inline-flex items-center gap-1"><Pin className="size-3.5"/>{item.pinnedMessages} đã ghim tin</span> : null}{item.pinNote ? <span> · {item.pinned} ghi chú</span> : null}</p>
      </div>
      <Controls item={item}/>
    </header>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Nội dung</p><p className="whitespace-pre-wrap text-sm text-slate-800">{item.textContent}</p></section>
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2.5">Nhóm</th><th className="px-3 py-2.5">Gửi từ nick</th><th className="px-3 py-2.5">Trạng thái</th><th className="px-3 py-2.5">Lúc</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {targets.map((target) => <tr key={target.id}>
            <td className="px-3 py-2 font-medium text-slate-900">{target.groupName}</td>
            <td className="px-3 py-2 text-slate-700">{target.nick}</td>
            <td className="px-3 py-2 text-slate-700">{TARGET[target.status] ?? target.status}{PIN[target.messagePinStatus] ? ` · ${PIN[target.messagePinStatus]}` : ""}{NOTE[target.pinStatus] ? ` · ${NOTE[target.pinStatus]}` : ""}{target.error ? <span className="block text-[11px] text-rose-600">{target.error}{target.attempts > 1 ? ` (thử ${target.attempts} lần)` : ""}</span> : null}</td>
            <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{when(target.doneAt)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </div>;
}
