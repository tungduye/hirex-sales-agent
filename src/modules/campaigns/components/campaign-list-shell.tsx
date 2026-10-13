import type { ReactNode } from "react";

export function CampaignListHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Chiến dịch Marketing</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </header>
  );
}

export function CampaignMetricGrid({
  items,
}: {
  items: Array<{ label: string; value: number | string }>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">{item.label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function CampaignSelectionHint() {
  return (
    <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
      Đánh dấu chiến dịch để xuất hoặc xóa/lưu trữ. Nếu xuất mà không chọn mục nào, hệ thống sẽ xuất tất cả phản hồi anh có quyền xem.
    </p>
  );
}

export function CampaignEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed bg-white p-16 text-center shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}
