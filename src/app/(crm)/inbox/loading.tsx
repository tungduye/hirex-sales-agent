export default function InboxLoading() {
  return <div className="space-y-4" aria-label="Đang tải hộp thư">
    <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
    <div className="grid h-[min(780px,calc(100vh-245px))] min-h-[600px] overflow-hidden rounded-2xl border border-slate-200 bg-white lg:grid-cols-[370px_minmax(0,1fr)]">
      <div className="space-y-3 border-r p-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
      <div className="m-6 animate-pulse rounded-2xl bg-slate-50" />
    </div>
  </div>;
}
