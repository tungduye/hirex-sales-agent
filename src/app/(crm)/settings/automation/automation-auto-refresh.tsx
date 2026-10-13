"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function AutomationAutoRefresh() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    router.refresh();
    window.setTimeout(() => setRefreshing(false), 700);
  };
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [router]);
  return <button type="button" onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">
    <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}/>{refreshing ? "Đang làm mới…" : "Tự làm mới 15 giây"}
  </button>;
}
