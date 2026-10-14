"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, CircleAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AlertItem { id: string; kind: string; severity: "high" | "medium"; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }

const POLL_MS = 60_000;
const ago = (iso: string) => {
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return minutes < 60 ? `${minutes} phút trước` : minutes < 1440 ? `${Math.round(minutes / 60)} giờ trước` : `${Math.round(minutes / 1440)} ngày trước`;
};

/** Header bell: alerts from Trợ lý HireX (polled every minute while the tab is visible). */
export function AlertBell() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/assistant/alerts", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { ok?: boolean; alerts?: AlertItem[] } | null;
      if (data?.ok && data.alerts) setAlerts(data.alerts);
    } catch { /* keep the last list */ }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  async function markRead(ids?: string[]) {
    const now = new Date().toISOString();
    setAlerts((current) => current.map((alert) => !ids || ids.includes(alert.id) ? { ...alert, read_at: alert.read_at ?? now } : alert));
    await fetch("/api/assistant/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids ? { action: "read", ids } : { action: "read" }) }).catch(() => null);
  }

  const unread = alerts.filter((alert) => !alert.read_at);
  const urgent = unread.some((alert) => alert.severity === "high");
  return (
    <div ref={boxRef} className="relative">
      <Button variant="ghost" size="icon" className="relative" aria-label={unread.length ? `Thông báo, ${unread.length} chưa xem` : "Thông báo"} aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) void load(); }}>
        <Bell className="size-5" />
        {unread.length > 0 && (
          <span className={cn("absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-[18px] text-white", urgent ? "bg-rose-600" : "bg-amber-500")}>{unread.length > 99 ? "99+" : unread.length}</span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(92vw,380px)] overflow-hidden rounded-xl border bg-white shadow-xl" role="dialog" aria-label="Thông báo của Trợ lý HireX">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Thông báo</p>
              <p className="text-[11px] text-slate-500">Trợ lý kiểm tra 5 phút một lần · tự ẩn khi sự cố đã hết</p>
            </div>
            {unread.length > 0 && <Button variant="ghost" size="sm" onClick={() => void markRead()}><CheckCheck className="size-4" />Đã xem hết</Button>}
          </div>
          {alerts.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Không có sự cố nào cần chú ý.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y overflow-y-auto">
              {alerts.map((alert) => (
                <li key={alert.id} className={cn("flex gap-2.5 px-4 py-3", !alert.read_at && "bg-blue-50/50")}>
                  {alert.severity === "high" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-600" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm text-slate-900", !alert.read_at && "font-semibold")}>{alert.title}</p>
                    {alert.body && <p className="mt-0.5 text-[13px] text-slate-600">{alert.body}</p>}
                    <div className="mt-1 flex items-center gap-3 text-[12px]">
                      <span className="text-slate-400">{ago(alert.created_at)}</span>
                      {alert.link && <Link href={alert.link} onClick={() => { void markRead([alert.id]); setOpen(false); }} className="font-medium text-blue-700 hover:underline">Mở</Link>}
                      {!alert.read_at && <button type="button" onClick={() => void markRead([alert.id])} className="text-slate-500 hover:text-slate-800">Đã xem</button>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
