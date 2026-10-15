"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RuleRow { id: string; name: string; enabled: boolean; lastMatchedAt: string | null; createdAt: string; owner: string; lines: string[] }

const EXAMPLES = [
  "Ứng viên nhắn Zalo chờ quá 3 giờ thì nhắc tôi",
  "Khách chờ trả lời quá 6 giờ thì đề xuất tạo công việc cho tôi, hạn 2 giờ",
  "Công việc của tôi quá hạn thì báo tôi",
  "Lead mới quá 2 ngày chưa liên hệ thì báo tôi",
];

/** Opens Trợ lý HireX with a sentence already typed (the member can edit it, then send). */
function draftInAssistant(text: string) {
  window.dispatchEvent(new CustomEvent("hirex:assistant-draft", { detail: { text } }));
}

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }) : "chưa có";

export function RulesView({ rules }: { rules: RuleRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(String(body.id));
    setError(null);
    try {
      const response = await fetch("/api/assistant/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      if (!data?.ok) setError(data?.message ?? "Không lưu được thay đổi.");
      router.refresh();
    } catch {
      setError("Mất kết nối tới máy chủ.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-blue-600" />Tạo quy tắc bằng một câu</h2>
        <p className="mt-1 text-sm text-slate-500">Bấm một gợi ý (hoặc tự gõ trong Trợ lý), trợ lý sẽ hiện thẻ để anh/chị kiểm tra và bấm Xác nhận. Quy tắc chỉ gửi thông báo hoặc đề xuất công việc, không tự gửi tin hay sửa dữ liệu.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => <button key={example} type="button" onClick={() => draftInAssistant(example)} className="rounded-full border px-3 py-1.5 text-sm text-slate-700 hover:border-blue-300 hover:bg-blue-50">{example}</button>)}
        </div>
      </section>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}

      {rules.length === 0 ? (
        <p className="rounded-xl border bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-sm">Chưa có quy tắc nào.</p>
      ) : (
        <ul className="space-y-3">
          {rules.map((rule) => (
            <li key={rule.id} className={cn("rounded-xl border bg-white p-4 shadow-sm", !rule.enabled && "opacity-70")}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{rule.name}</p>
                  <ul className="mt-1 space-y-0.5 text-[13px] text-slate-600">{rule.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
                  <p className="mt-2 text-[12px] text-slate-400">Người tạo: {rule.owner} · Tạo lúc {when(rule.createdAt)} · Khớp gần nhất: {when(rule.lastMatchedAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {busy === rule.id && <LoaderCircle className="size-4 animate-spin text-slate-400" />}
                  <Button size="sm" variant={rule.enabled ? "outline" : "default"} disabled={busy !== null} onClick={() => void send({ action: "toggle", id: rule.id, enabled: !rule.enabled })}>
                    {rule.enabled ? "Tắt" : "Bật"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null} aria-label={`Xóa quy tắc ${rule.name}`} onClick={() => { if (window.confirm(`Xóa quy tắc “${rule.name}”?`)) void send({ action: "delete", id: rule.id }); }}>
                    <Trash2 className="size-4 text-rose-600" />
                  </Button>
                </div>
              </div>
              <p className={cn("mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold", rule.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{rule.enabled ? "Đang bật" : "Đang tắt"}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
