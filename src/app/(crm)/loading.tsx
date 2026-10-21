// Shown at once when moving to another screen, while the server prepares it (the menu stays in place).
export default function CrmLoading() {
  return <div className="space-y-4" aria-busy="true" aria-label="Đang tải">
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-2"><div className="h-7 w-48 animate-pulse rounded-lg bg-slate-200/80"/><div className="h-4 w-72 animate-pulse rounded bg-slate-100"/></div>
      <div className="h-9 w-32 animate-pulse rounded-lg bg-slate-100"/>
    </div>
    <div className="h-12 animate-pulse rounded-xl border border-slate-200 bg-white"/>
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {Array.from({ length: 8 }, (_, index) => <div key={index} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0">
        <div className="h-4 w-1/4 animate-pulse rounded bg-slate-100"/><div className="h-4 w-1/5 animate-pulse rounded bg-slate-100"/><div className="h-4 flex-1 animate-pulse rounded bg-slate-50"/>
      </div>)}
    </div>
  </div>;
}
