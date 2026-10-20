"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { rescanCampaignSignals } from "@/modules/campaigns/server/campaign-signal-actions";

/** Re-checks every sent thread for replies and delivery failures that were missed. */
export function RescanSignalsButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  function run() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await rescanCampaignSignals();
        setMessage(!result.ok ? "Chưa quét xong, thử lại sau ít phút." : result.replies || result.bounces ? `Tìm thêm ${result.replies} phản hồi, ${result.bounces} thư gửi lỗi.` : "Không có phản hồi mới bị sót.");
      } catch { setMessage("Bạn chưa có quyền hoặc phiên đã hết hạn."); }
    });
  }
  return <span className="inline-flex items-center gap-2">
    {message ? <span aria-live="polite" className="text-xs text-slate-600">{message}</span> : null}
    <Button type="button" variant="outline" onClick={run} disabled={pending} title="Kiểm tra lại mọi thư đã gửi xem người nhận đã trả lời hoặc thư bị gửi lỗi chưa">{pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Quét lại phản hồi</Button>
  </span>;
}
