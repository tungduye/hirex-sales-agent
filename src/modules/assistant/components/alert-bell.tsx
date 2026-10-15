"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, CircleAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AlertAction { id: string; preview: { title?: string; lines?: string[] } | null }
interface AlertItem { id: string; kind: string; severity: "high" | "medium"; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null; action: AlertAction | null }

const POLL_MS = 60_000;
const ago = (iso: string) => {
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return minutes < 60 ? `${minutes} phút trước` : minutes < 1440 ? `${Math.round(minutes / 60)} giờ trước` : `${Math.round(minutes / 1440)} ngày trước`;
};

/** Header bell: alerts from Trợ lý HireX (polled every minute while the tab is visible). */
export function AlertBell() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
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

  // A rule's proposal: confirm or dismiss it right here; the server re-checks permission and runs it once.
  async function decide(alert: AlertItem, decision: "confirm" | "cancel") {
    if (!alert.action) return;
    setResults((current) => ({ ...current, [alert.id]: "Đang xử lý…" }));
    try {
      const response = await fetch(`/api/assistant/actions/${alert.action.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const data = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      setResults((current) => ({ ...current, [alert.id]: data?.message ?? (data?.ok ? "Xong." : "Không thực hiện được.") }));
      setAlerts((current) => current.map((item) => item.id === alert.id ? { ...item, action: null } : item));
      void markRead([alert.id]);
    } catch {
      setResults((current) => ({ ...current, [alert.id]: "Mất kết nối, hãy thử lại." }));
    }
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
              <p className="text-[11px] text-slate-500">Kiểm tra 5 phút một lần · tự ẩn khi hết sự cố · <Link href="/assistant/rules" onClick={() => setOpen(false)} className="text-blue-700 hover:underline">Quy tắc tự động</Link></p>
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
                    {alert.action && (
                      <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/70 px-2.5 py-2">
                        <p className="text-[12px] font-semibold text-slate-800">Đề xuất: {alert.action.preview?.title ?? "Thao tác"}</p>
                        {alert.action.preview?.lines?.slice(0, 3).map((line, index) => <p key={index} className="text-[12px] text-slate-600">{line}</p>)}
                        <div className="mt-1.5 flex gap-2">
                          <Button size="sm" className="h-7 px-2.5 text-[12px]" onClick={() => void decide(alert, "confirm")}>Xác nhận</Button>
                          <Button size="sm" variant="outline" className="h-7 px-2.5 text-[12px]" onClick={() => void decide(alert, "cancel")}>Bỏ qua</Button>
                        </div>
                      </div>
                    )}
                    {results[alert.id] && <p className="mt-1 text-[12px] font-medium text-slate-700">{results[alert.id]}</p>}
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
