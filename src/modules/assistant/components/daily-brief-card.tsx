"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AREA_LABELS, type DailyBrief } from "@/modules/assistant/core/daily-brief";

/** Opens Trợ lý HireX with a question (listened to by AssistantPanel). */
export function askAssistant(question: string) {
  window.dispatchEvent(new CustomEvent("hirex:assistant-ask", { detail: { question } }));
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });

export function DailyBriefCard({ initial }: { initial: DailyBrief | null }) {
  const [brief, setBrief] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initial ? null : "Chưa tải được bản tin.");

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/assistant/brief", { method: "POST" });
      const data = await response.json().catch(() => null) as { ok?: boolean; brief?: DailyBrief; message?: string } | null;
      if (data?.ok && data.brief) setBrief(data.brief);
      else setError(data?.message ?? "Không làm mới được bản tin.");
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  const high = brief?.items.filter((item) => item.severity === "high").length ?? 0;
  return (
    <section className="mb-6 overflow-hidden rounded-xl border bg-white shadow-sm" aria-labelledby="daily-brief-title">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-blue-600 text-white"><Sparkles className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 id="daily-brief-title" className="font-semibold">Bản tin hôm nay</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {brief ? <>Theo quyền của tài khoản · cập nhật lúc {time(brief.generatedAt)}</> : "Trợ lý HireX tổng hợp việc cần xử lý"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => askAssistant("Hôm nay có gì cần xử lý?")}>Hỏi trợ lý</Button>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={busy} aria-label="Làm mới bản tin">
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Làm mới
        </Button>
      </div>

      {error && <p className="border-b bg-rose-50 px-5 py-2 text-sm text-rose-700">{error}</p>}

      {brief && (
        <div className="px-5 py-4">
          {brief.items.length === 0 ? (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="size-4" />Không có việc gì cần xử lý gấp. Mọi thứ đang ổn.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">
                {high > 0 ? <><strong className="text-rose-700">{high} việc cần xử lý ngay</strong>{brief.items.length > high ? `, ${brief.items.length - high} việc nên xem` : ""}.</> : <>{brief.items.length} việc nên xem.</>}
              </p>
              <ul className="space-y-2.5">
                {brief.items.map((item, index) => (
                  <li key={index} className={cn("rounded-lg border px-3.5 py-2.5", item.severity === "high" ? "border-rose-200 bg-rose-50/60" : "border-amber-200 bg-amber-50/50")}>
                    <div className="flex items-start gap-2.5">
                      {item.severity === "high" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-600" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{AREA_LABELS[item.area]} · {item.severity === "high" ? "Gấp" : "Nên xem"}</p>
                        {item.details.length > 0 && <ul className="mt-1 space-y-0.5 text-[13px] text-slate-600">{item.details.map((line, lineIndex) => <li key={lineIndex} className="truncate">{line}</li>)}</ul>}
                      </div>
                      {item.link && <Link href={item.link} className="flex shrink-0 items-center gap-0.5 text-[13px] font-medium text-blue-700 hover:underline">Mở<ArrowUpRight className="size-3.5" /></Link>}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {(brief.ok.length > 0 || brief.failed.length > 0) && (
            <div className="mt-4 grid gap-1.5 border-t pt-3 text-[13px] sm:grid-cols-2">
              {brief.ok.map((item, index) => <p key={index} className="flex items-start gap-1.5 text-slate-600"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />{item.text}</p>)}
              {brief.failed.map((area) => <p key={area} className="flex items-start gap-1.5 text-slate-500"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />Chưa tải được phần {AREA_LABELS[area]}</p>)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function DailyBriefSkeleton() {
  return (
    <section className="mb-6 rounded-xl border bg-white px-5 py-4 shadow-sm" aria-busy="true">
      <p className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Trợ lý đang tổng hợp bản tin hôm nay…</p>
    </section>
  );
}
