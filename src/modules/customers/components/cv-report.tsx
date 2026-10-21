import { CalendarClock, MapPin, UserRound } from "lucide-react";
import { parseCvReport, type CvItem } from "../core/partner-parse";
import { ReportView } from "./report-view";

const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }) : null;
const dateTime = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
const TONE: Record<string, string> = { waitingList: "bg-slate-100 text-slate-700", sentList: "bg-blue-50 text-blue-800", falseList: "bg-rose-50 text-rose-700" };
function statusTone(status: string | null) {
  const value = (status ?? "").toLowerCase();
  if (/fail|từ chối|loại/u.test(value)) return "bg-rose-50 text-rose-700";
  if (/offer|pass|đạt|onboard/u.test(value)) return "bg-emerald-50 text-emerald-700";
  if (/pv|phỏng vấn|interview/u.test(value)) return "bg-violet-50 text-violet-700";
  if (/gửi|sent/u.test(value)) return "bg-blue-50 text-blue-700";
  return "bg-slate-100 text-slate-700";
}

/** "Tình trạng CV" like the box on Human: CV chờ gửi / đã gửi / fail, each candidate with its status and the companies it went to. */
export function CvReport({ data, codes }: { data: unknown; codes: Record<string, string> }) {
  const lists = parseCvReport(data);
  if (!lists.length) return data == null ? <p className="text-xs text-slate-500">Chưa có dữ liệu.</p> : <ReportView value={data}/>;
  const total = lists.reduce((sum, list) => sum + list.items.length, 0);
  if (!total) return <p className="text-xs text-slate-500">Chưa có CV nào cho công ty này.</p>;
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-1.5">{lists.map((list) => <span key={list.key} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[list.key] ?? "bg-slate-100 text-slate-700"}`}>{list.label}: {list.items.length}</span>)}</div>
    {lists.filter((list) => list.items.length).map((list, index) => <section key={list.key}>
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">{["I", "II", "III", "IV", "V"][index] ?? index + 1}. {list.label} ({list.items.length})</h4>
      <ol className="mt-1.5 space-y-1.5">{list.items.map((item, position) => <CvLine key={`${item.cvId ?? item.name}-${position}`} item={item} codes={codes}/>)}</ol>
    </section>)}
  </div>;
}

function CvLine({ item, codes }: { item: CvItem; codes: Record<string, string> }) {
  const place = item.address ? codes[item.address] ?? `Mã ${item.address}` : null;
  return <li className="rounded-lg border border-slate-100 bg-white p-2">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-semibold text-slate-900">{item.name.replace(/^\$\s*/u, "")}</span>
      {item.status ? <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${statusTone(item.status)}`}>{item.status}</span> : null}
      {item.statusCode ? <span className="rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-600" title="Xếp loại CV">{item.statusCode}</span> : null}
      <span className="ml-auto text-[11px] text-slate-400">{date(item.updatedAt)}</span>
    </div>
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-600">
      <span>{[item.position, item.skill].filter(Boolean).join(" · ")}</span>
      {place ? <span className="inline-flex items-center gap-0.5"><MapPin className="size-3"/>{place}</span> : null}
      {item.code ? <span className="inline-flex items-center gap-0.5" title="Mã người phụ trách CV"><UserRound className="size-3"/>{item.code}</span> : null}
      {item.interviewAt ? <span className="inline-flex items-center gap-0.5 text-violet-700"><CalendarClock className="size-3"/>PV {dateTime(item.interviewAt)}</span> : null}
    </p>
    {item.companies.length ? <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-slate-500 hover:text-slate-700">Đã gửi tới {item.companies.length} công ty</summary>
      <p className="mt-1 leading-relaxed text-slate-600">{item.companies.join(", ")}</p>
      <p className="mt-0.5 text-[10px] text-slate-400">* và ** là đánh dấu của Human.</p>
    </details> : null}
  </li>;
}
