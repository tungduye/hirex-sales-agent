"use client";

import { RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { refreshCustomersFromHuman } from "../server/customer-actions";

export function RefreshFromHumanButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return <div className="flex flex-col items-end gap-1">
    <button type="button" disabled={pending} onClick={() => start(async () => setResult(await refreshCustomersFromHuman()))}
      className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
      <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`}/>{pending ? "Đang lấy từ Human…" : "Cập nhật từ Human"}
    </button>
    {result ? <p role="status" className={`max-w-sm text-right text-xs ${result.ok ? "text-emerald-700" : "text-rose-600"}`}>{result.message}</p> : null}
  </div>;
}
