"use client";

import { useEffect, useState, useTransition } from "react";
import { LoaderCircle, MessageCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getZaloAssistantState, requestZaloLinkCode, setZaloAssistantAccount, unlinkMyZalo, type ZaloAssistantState } from "@/modules/assistant/server/zalo-bot-actions";

/** "Trợ lý trên Zalo": link my Zalo with a 6-digit code; admins choose the nick. */
export function ZaloAssistantBox() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ZaloAssistantState | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [picked, setPicked] = useState("");
  const [pending, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!code) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [code]);

  function reload() { start(async () => { const next = await getZaloAssistantState(); setState(next); setPicked(next?.bot?.accountId ?? next?.zaloAccounts[0]?.id ?? ""); }); }
  function toggle() { if (!open) { setMessage(null); reload(); } setOpen((value) => !value); }
  function getCode() { setMessage(null); start(async () => { const result = await requestZaloLinkCode(); if (result.ok) { setCode({ code: result.code, expiresAt: result.expiresAt }); setNow(Date.now()); } else setMessage(result.message); }); }
  function unlink(id: string) { start(async () => { await unlinkMyZalo(id); reload(); }); }
  function choose(accountId: string | null) { start(async () => { const result = await setZaloAssistantAccount(accountId); setMessage(result.message); if (result.ok) reload(); }); }
  const left = code ? Math.max(0, Math.round((Date.parse(code.expiresAt) - now) / 1000)) : 0;

  return <div className="relative">
    <button type="button" onClick={toggle} aria-expanded={open} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold", open ? "bg-white text-blue-700" : "text-slate-600 hover:bg-white hover:text-blue-700")}><MessageCircle className="size-3.5" />Trợ lý trên Zalo</button>
    {open ? <div className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-xl">
      <div className="mb-2 flex items-center justify-between"><p className="font-bold text-slate-900">Trợ lý trên Zalo</p><button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="size-4" /></button></div>
      {!state ? <p className="flex items-center gap-2 text-xs text-slate-500"><LoaderCircle className="size-3.5 animate-spin" />Đang tải…</p> : <div className="space-y-3">
        {state.bot ? <p className="text-xs leading-5 text-slate-600">Nick Trợ lý: <b className="text-slate-900">{state.bot.name}</b>{state.bot.status !== "CONNECTED" ? <span className="ml-1 font-semibold text-rose-600">(đang mất kết nối)</span> : null}. Nhắn riêng cho nick này, hoặc trong nhóm gọi <b>@{state.bot.name}</b> / bắt đầu tin bằng <b>/tl</b>. Trợ lý trả lời theo quyền tài khoản HireX của bạn.</p>
          : <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Chưa bật Trợ lý trên Zalo.{state.canManage ? " Chọn nick ở dưới để bật." : " Nhờ quản trị viên bật."}</p>}

        {state.bot ? <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Zalo của bạn</p>
          {state.links.length ? <ul className="space-y-1">{state.links.map((link) => <li key={link.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs"><span>{link.zaloName ?? "Zalo đã liên kết"}</span><button type="button" onClick={() => unlink(link.id)} disabled={pending} className="font-semibold text-slate-500 hover:text-rose-600">Huỷ liên kết</button></li>)}</ul> : <p className="text-xs text-slate-500">Chưa liên kết Zalo nào.</p>}
          {code && left > 0 ? <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-center">
            <p className="text-xs text-blue-900">Nhắn mã này cho Zalo <b>{state.bot.name}</b> (nhắn riêng):</p>
            <p className="my-1 select-all font-mono text-3xl font-bold tracking-[0.3em] text-blue-700">{code.code}</p>
            <p className="text-[11px] text-blue-800">Hết hạn sau {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} · bấm “Làm mới” sau khi nhắn để thấy kết quả</p>
            <button type="button" onClick={reload} className="mt-1 text-xs font-semibold text-blue-700 hover:underline">Làm mới</button>
          </div> : <button type="button" onClick={getCode} disabled={pending} className="mt-2 w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{state.links.length ? "Liên kết thêm một Zalo khác" : "Lấy mã liên kết Zalo"}</button>}
        </div> : null}

        {state.canManage ? <div className="border-t border-slate-100 pt-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Quản trị: nick làm Trợ lý</p>
          <div className="flex gap-1.5"><select value={picked} onChange={(event) => setPicked(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs">{state.zaloAccounts.map((nick) => <option key={nick.id} value={nick.id}>{nick.name}{nick.status !== "CONNECTED" ? " (mất kết nối)" : ""}</option>)}</select>
            <button type="button" disabled={pending || !picked || picked === state.bot?.accountId} onClick={() => choose(picked)} className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-40">{state.bot ? "Đổi" : "Bật"}</button></div>
          {state.bot ? <button type="button" disabled={pending} onClick={() => choose(null)} className="mt-1.5 text-xs font-semibold text-rose-600 hover:underline">Tắt Trợ lý trên Zalo</button> : null}
          <p className="mt-1.5 text-[11px] leading-4 text-slate-500">Nick Trợ lý được ẩn khỏi Suối Nguồn. Người chưa liên kết (kể cả ứng viên) nhắn tới sẽ không được trả lời.</p>
        </div> : null}
        {message ? <p aria-live="polite" className="text-xs text-slate-600">{message}</p> : null}
      </div>}
    </div> : null}
  </div>;
}
