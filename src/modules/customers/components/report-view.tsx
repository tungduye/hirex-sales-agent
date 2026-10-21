import type { ReactNode } from "react";

// Human's CV report shown as it comes (lists of records, texts that may hold HTML), until its exact shape is
// settled: every field is readable, nothing is run as HTML.

const plain = (value: string) => value.replace(/<br\s*\/?>/giu, "\n").replace(/<\/(p|div|li)>/giu, "\n").replace(/<[^>]*>/gu, "").replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/\n\s*\n+/gu, "\n").trim();
const label = (key: string) => key.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/_/gu, " ");
const empty = (value: unknown) => value == null || value === "" || (Array.isArray(value) && value.length === 0);

export function ReportView({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (empty(value)) return <span className="text-slate-300">—</span>;
  if (typeof value === "string") return <span className="whitespace-pre-line">{plain(value).slice(0, 4000)}</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  if (depth > 4) return <span className="font-mono text-[11px]">{JSON.stringify(value).slice(0, 300)}</span>;
  if (Array.isArray(value)) {
    return <ol className="space-y-1.5">{value.slice(0, 200).map((item, index) => <li key={index} className={item && typeof item === "object" ? "rounded-lg border border-slate-100 bg-slate-50/60 p-2" : ""}>
      <ReportView value={item} depth={depth + 1}/>
    </li>)}{value.length > 200 ? <li className="text-xs text-slate-500">… và {value.length - 200} mục nữa</li> : null}</ol>;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => !empty(item));
  if (!entries.length) return <span className="text-slate-300">—</span>;
  return <dl className="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
    {entries.map(([key, item]) => <div key={key} className="contents"><dt className="truncate font-semibold text-slate-500" title={key}>{label(key)}</dt><dd className="min-w-0 break-words text-slate-800"><ReportView value={item} depth={depth + 1}/></dd></div>)}
  </dl>;
}
