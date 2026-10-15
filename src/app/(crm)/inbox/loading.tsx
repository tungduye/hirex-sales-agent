export default function InboxLoading() {
  return <div className="flex h-[calc(100dvh-4rem)] min-h-0 overflow-hidden bg-white" aria-label="Đang tải hộp thư">
    <div className="flex w-full flex-col border-r border-slate-200 lg:w-[360px] lg:shrink-0">
      <div className="space-y-3 border-b border-slate-100 p-4">
        <div className="h-6 w-32 animate-pulse rounded bg-slate-100" />
        <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-7 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <div className="space-y-2 p-3">{Array.from({ length: 9 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />)}</div>
    </div>
    <div className="hidden flex-1 flex-col lg:flex">
      <div className="h-14 animate-pulse border-b border-slate-100 bg-slate-50" />
      <div className="flex-1 bg-slate-50/60" />
      <div className="m-3 h-24 animate-pulse rounded-xl bg-slate-100" />
    </div>
  </div>;
}
