export default function ConversationLoading() {
  return <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Đang mở hội thoại">
    <div className="flex h-[61px] shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4"><div className="size-10 animate-pulse rounded-full bg-slate-100"/><div className="space-y-1.5"><div className="h-3.5 w-40 animate-pulse rounded bg-slate-100"/><div className="h-3 w-24 animate-pulse rounded bg-slate-100"/></div></div>
    <div className="flex-1 space-y-3 p-6">{[60, 40, 55, 35].map((width, index) => <div key={index} className={`h-12 animate-pulse rounded-2xl bg-white ${index % 2 ? "ml-auto" : ""}`} style={{ width: `${width}%` }}/>)}</div>
    <div className="m-3 h-24 animate-pulse rounded-xl bg-white"/>
  </div>;
}
