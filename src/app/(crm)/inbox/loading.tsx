export default function InboxLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-5 flex items-end justify-between"><div><div className="h-3 w-28 rounded bg-slate-200" /><div className="mt-3 h-8 w-36 rounded bg-slate-200" /><div className="mt-2 h-4 w-80 max-w-full rounded bg-slate-200" /></div><div className="hidden h-10 w-72 rounded-lg bg-slate-200 sm:block" /></div>
      <div className="grid min-h-[650px] overflow-hidden rounded-xl border bg-white shadow-sm xl:grid-cols-[390px_minmax(0,1fr)]">
        <div className="border-r"><div className="h-14 border-b" />{Array.from({ length: 6 }, (_, index) => <div key={index} className="flex gap-3 border-b p-4"><div className="size-8 rounded-full bg-slate-200" /><div className="flex-1"><div className="h-3 w-1/2 rounded bg-slate-200" /><div className="mt-3 h-3 w-3/4 rounded bg-slate-100" /><div className="mt-2 h-3 w-full rounded bg-slate-100" /></div></div>)}</div>
        <div className="hidden items-center justify-center bg-slate-50/60 xl:flex"><div className="size-14 rounded-2xl bg-slate-200" /></div>
      </div>
    </div>
  );
}
