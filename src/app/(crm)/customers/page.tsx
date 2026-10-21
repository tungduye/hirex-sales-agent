import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Building2, Download, ExternalLink, FileUser, Globe, History, Mail, MapPin, MessagesSquare, Phone, Search, Settings2, UserRound, X } from "lucide-react";
import { ChannelLogo } from "@/modules/channels/components/channel-logo";
import { RefreshFromHumanButton } from "@/modules/customers/components/refresh-button";
import { cvReportCounts, statusEntries } from "@/modules/customers/core/partner-parse";
import { CvReport } from "@/modules/customers/components/cv-report";
import { customerFilters, getCustomer, listCustomers, type CustomerFilters, type CustomerRow } from "@/modules/customers/server/customer-data";

type Params = Record<string, string | string[] | undefined>;
type Detail = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

function href(filters: CustomerFilters, change: Partial<CustomerFilters> & { id?: number | null } = {}) {
  const next = { ...filters, page: 1, ...change };
  const query = new URLSearchParams();
  if (next.q) query.set("q", next.q);
  if (next.block) query.set("block", String(next.block));
  if (next.rank) query.set("rank", next.rank);
  if (next.job) query.set("job", next.job);
  if (next.amRank) query.set("amrank", next.amRank);
  if (next.loc) query.set("loc", next.loc);
  if (next.owner) query.set("owner", next.owner);
  if (next.has) query.set("has", next.has);
  if (next.page > 1) query.set("page", String(next.page));
  if (change.id) query.set("id", String(change.id));
  return `/customers${query.size ? `?${query}` : ""}`;
}
const time = (value: string | null | undefined) => value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const day = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const shortDay = (value: string | null | undefined) => value && /^\d{4}-\d{2}-\d{2}/u.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : "";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const filters = customerFilters(params);
  const selectedId = Number(typeof params.id === "string" ? params.id : "");
  const [list, detail] = await Promise.all([listCustomers(filters), Number.isSafeInteger(selectedId) && selectedId > 0 ? getCustomer(selectedId) : Promise.resolve(null)]);
  if (!list) redirect("/");
  const { context } = list;
  const filtered = Boolean(filters.q || filters.rank || filters.job || filters.amRank || filters.loc || filters.owner || filters.has);
  const blockLabel = (id: number) => list.blocks.find((block) => block.block_id === id)?.name || `Khối ${id}`;
  const person = (id: string | null) => id ? list.personName[id] ?? `#${id}` : null;
  const exportQuery = href({ ...filters, page: 1 }).split("?")[1] ?? "";
  return <div className="space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Khách hàng</h1>
        <p className="mt-0.5 text-sm text-slate-500">Từ Human · {list.lastSync ? <>cập nhật {time(list.lastSync.finished_at ?? list.lastSync.started_at)}{list.lastSync.ok === false ? <span className="text-amber-700"> (lần gần nhất có lỗi)</span> : null}</> : "chưa cập nhật lần nào"} · tự cập nhật mỗi 6 giờ{context.viewAll ? "" : " · bạn thấy khách mình là Sale/AM"}</p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <a href={`/api/customers/export${exportQuery ? `?${exportQuery}` : ""}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download className="size-4"/>Xuất CSV</a>
        {context.canManage ? <Link href="/customers/settings" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Settings2 className="size-4"/>Cài đặt</Link> : null}
        {context.canManage ? <RefreshFromHumanButton/> : null}
      </div>
    </header>

    <nav aria-label="Khối" className="flex flex-wrap gap-1.5">
      {[null, ...list.blocks.filter((block) => block.enabled).map((block) => block.block_id)].map((id) => {
        const on = filters.block === id;
        const total = id === null ? null : list.blockCounts[String(id)] ?? 0;
        return <Link key={id ?? "all"} href={href(filters, { block: id })} aria-current={on ? "page" : undefined}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
          {id === null ? "Tất cả khối" : blockLabel(id)}{total !== null ? <span className={`rounded-full px-1.5 text-[11px] ${on ? "bg-slate-700" : "bg-slate-100 text-slate-600"}`}>{total.toLocaleString("vi-VN")}</span> : null}
        </Link>;
      })}
    </nav>

    <form action="/customers" className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5">
      {filters.block ? <input type="hidden" name="block" value={filters.block}/> : null}
      <label className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400"/><input name="q" defaultValue={filters.q} placeholder="Tìm tên công ty, website, mã, người tạo, xếp hạng…" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-sm outline-none focus:border-blue-400 focus:bg-white"/></label>
      <Select name="rank" label="Xếp hạng dự án" value={filters.rank} options={list.projectRanks}/>
      <Select name="job" label="Hạng" value={filters.job} options={list.jobRanks}/>
      <Select name="amrank" label="Xếp hạng AM" value={filters.amRank} options={list.amRanks}/>
      <Select name="loc" label="Địa điểm" value={filters.loc} options={list.locations}/>
      <select name="owner" defaultValue={filters.owner ?? ""} aria-label="Phụ trách" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
        <option value="">Mọi Sale/AM</option><option value="me">Tôi là Sale/AM</option>
        {context.viewAll ? list.linkedPeople.filter((item) => item.id !== context.userId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : null}
      </select>
      <button className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">Lọc</button>
      {filtered ? <Link href={href({ ...filters, q: "", rank: null, job: null, amRank: null, loc: null, owner: null, has: null })} className="inline-flex h-9 items-center gap-1 px-2 text-sm font-semibold text-slate-500 hover:text-rose-600"><X className="size-4"/>Xóa lọc</Link> : null}
    </form>

    {list.error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{list.error}</div> : null}
    {!list.lastSync && !list.total ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <Building2 className="mx-auto size-10 text-slate-300"/>
      <p className="mt-3 font-semibold text-slate-800">Chưa có khách hàng nào</p>
      <p className="mt-1 text-sm text-slate-500">{context.canManage ? "Bấm \"Cập nhật từ Human\". Nếu báo thiếu token, dán token trong Cài đặt → Cài đặt API Human." : "Quản trị viên cần cập nhật dữ liệu từ Human."}</p>
    </div> : <div className={`grid items-start gap-4 ${detail ? "xl:grid-cols-[minmax(0,1fr)_440px]" : ""}`}>
      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 text-sm"><span className="font-semibold text-slate-800">{list.total.toLocaleString("vi-VN")} khách hàng</span><span className="text-xs text-slate-500">Trang {filters.page}/{list.pages}</span></div>
        <div className="max-h-[calc(100dvh-20rem)] overflow-auto">
          <table className="w-full min-w-[980px] text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr>
              <th className="px-4 py-2">Công ty</th><th className="px-3 py-2">Xếp hạng dự án</th><th className="px-3 py-2">Hạng</th><th className="px-3 py-2">Xếp hạng AM</th><th className="px-3 py-2">Sale / AM</th><th className="px-3 py-2 text-right">CV</th><th className="px-3 py-2">Ghi chú mới nhất</th>
            </tr></thead>
            <tbody>{list.rows.map((row) => <CustomerLine key={row.partner_id} row={row} filters={filters} selected={row.partner_id === selectedId} person={person}/>)}</tbody>
          </table>
          {list.rows.length === 0 ? <p className="px-4 py-10 text-center text-sm text-slate-500">Không có khách hàng nào khớp bộ lọc.</p> : null}
        </div>
        {list.pages > 1 ? <nav className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm" aria-label="Trang">
          {filters.page > 1 ? <Link href={href(filters, { page: filters.page - 1 })} className="font-semibold text-blue-700 hover:underline">← Trang trước</Link> : <span/>}
          {filters.page < list.pages ? <Link href={href(filters, { page: filters.page + 1 })} className="font-semibold text-blue-700 hover:underline">Trang sau →</Link> : <span/>}
        </nav> : null}
      </section>
      {detail ? <CustomerPanel detail={detail} closeHref={href({ ...filters }, { page: filters.page })} blockLabel={blockLabel} person={person}/> : null}
    </div>}
  </div>;
}

function Select({ name, label, value, options }: { name: string; label: string; value: string | null; options: Array<{ value: string; total: number }> }) {
  return <select name={name} defaultValue={value ?? ""} aria-label={label} className="h-9 max-w-[190px] rounded-lg border border-slate-200 bg-white px-2 text-sm">
    <option value="">{label}: tất cả</option>
    {options.slice(0, 300).map((option) => <option key={option.value} value={option.value}>{option.value === "—" ? "(trống)" : option.value} ({option.total.toLocaleString("vi-VN")})</option>)}
  </select>;
}

function CustomerLine({ row, filters, selected, person }: { row: CustomerRow; filters: CustomerFilters; selected: boolean; person: (id: string | null) => string | null }) {
  const link = href({ ...filters }, { id: row.partner_id, page: filters.page });
  const pill = (value: string | null, tone = "bg-slate-100 text-slate-700") => value ? <span className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`} title={value}>{value}</span> : <span className="text-slate-300">—</span>;
  return <tr className={`border-t border-slate-100 align-top ${selected ? "bg-blue-50" : "hover:bg-slate-50"}`}>
    <td className="max-w-[240px] px-4 py-2.5"><Link href={link} scroll={false} className="block min-w-0"><span className="block truncate font-semibold text-slate-900">{row.name ?? `Khách #${row.partner_id}`}</span>
      <span className="block truncate text-xs text-slate-500">{[row.location, row.website?.replace(/^https?:\/\//u, "").replace(/\/$/u, "")].filter(Boolean).join(" · ") || `#${row.partner_id}`}</span></Link></td>
    <td className="max-w-[190px] px-3 py-2.5">{pill(row.project_rank, "bg-indigo-50 text-indigo-800")}</td>
    <td className="px-3 py-2.5">{pill(row.job_rank)}</td>
    <td className="max-w-[190px] px-3 py-2.5"><div className="flex flex-wrap items-start gap-0.5">{row.am_ranks?.length ? row.am_ranks.slice(0, 3).map((rank) => <span key={rank} className="max-w-full truncate rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800" title={rank}>{rank}</span>) : <span className="text-slate-300">—</span>}{(row.am_ranks?.length ?? 0) > 3 ? <span className="text-[11px] text-slate-500">+{row.am_ranks.length - 3}</span> : null}</div></td>
    <td className="max-w-[150px] px-3 py-2.5 text-xs text-slate-700"><span className="block truncate">{person(row.sale_human_id) ?? "—"}</span>{row.am_human_id ? <span className="block truncate text-slate-500">AM: {person(row.am_human_id)}</span> : null}</td>
    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-700">{row.report_sent != null || row.cv_total != null ? <>
      <span className="font-semibold" title="CV đã gửi">{row.report_sent ?? row.cv_sent ?? 0} gửi</span>
      {row.report_waiting ? <span className="block text-slate-500">{row.report_waiting} chờ</span> : null}
      {row.report_failed ? <span className="block text-rose-600">{row.report_failed} fail</span> : null}
      {row.cv_offer ? <span className="block text-emerald-700">{row.cv_offer} offer</span> : null}</> : "—"}</td>
    <td className="max-w-[300px] px-3 py-2.5 text-xs text-slate-600">{row.last_note ? <><span className="mr-1 font-semibold text-slate-500">{shortDay(row.last_note_at)}</span><span className="line-clamp-2">{row.last_note}</span></> : "—"}</td>
  </tr>;
}

function CustomerPanel({ detail, closeHref, blockLabel, person }: { detail: Detail; closeHref: string; blockLabel: (id: number) => string; person: (id: string | null) => string | null }) {
  const { customer } = detail;
  const data = customer.data ?? {};
  const log = statusEntries(data.statusNew).reverse();
  const counts = cvReportCounts(detail.report?.data);
  const contacts = [1, 2, 3, 4, 5].flatMap((index) => { const value = data[`contactInfo${index}`]; return typeof value === "string" && value.trim() ? [value.trim()] : []; });
  const field = (icon: ReactNode, label: string, value: ReactNode) => value ? <div className="flex gap-2.5"><span className="mt-0.5 text-slate-400">{icon}</span><div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><div className="break-words text-sm text-slate-800">{value}</div></div></div> : null;
  const stat = (label: string, value: number | null) => <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center"><p className="text-base font-bold tabular-nums text-slate-900">{value ?? "—"}</p><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p></div>;
  const showValue = (key: string, value: unknown) => {
    if (value == null || value === "") return <span className="text-slate-300">—</span>;
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    const named = /^(rate|rank|type$|address$)/iu.test(key) ? text.split(/[,;]+/u).map((part) => detail.codes[part.trim()] ?? part.trim()).join(", ") : text;
    return named.replace(/<[^>]*>/gu, " ").slice(0, 400);
  };
  return <aside className="fixed inset-0 z-40 overflow-y-auto bg-white p-5 xl:sticky xl:inset-auto xl:top-4 xl:z-auto xl:max-h-[calc(100dvh-6rem)] xl:rounded-xl xl:border xl:border-slate-200" aria-label="Chi tiết khách hàng">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-xs font-semibold text-slate-500">Khách #{customer.partner_id}{customer.block_ids.length ? ` · ${customer.block_ids.map(blockLabel).join(", ")}` : ""}</p>
        <h2 className="mt-0.5 break-words text-lg font-bold text-slate-950">{customer.name ?? "Chưa có tên"}</h2>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {customer.project_rank ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-800">{customer.project_rank}</span> : null}
          {customer.job_rank ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{customer.job_rank}</span> : null}
          {(customer.am_ranks ?? []).map((value) => <span key={value} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{value}</span>)}
          {!customer.active ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Không còn trong khối đang bật</span> : null}
        </div>
      </div>
      <Link href={closeHref} scroll={false} aria-label="Đóng" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-5"/></Link>
    </div>

    <section className="mt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><FileUser className="size-4"/>Tình trạng CV</h3>
      <div className="mt-2 grid grid-cols-5 gap-1.5">{stat("Tổng CV", customer.cv_total)}{stat("Chờ gửi", counts?.report_waiting ?? customer.report_waiting)}{stat("Đã gửi", counts?.report_sent ?? customer.report_sent ?? customer.cv_sent)}{stat("Fail", counts?.report_failed ?? customer.report_failed)}{stat("Offer", customer.cv_offer)}</div>
      <div className="mt-2 max-h-[520px] overflow-y-auto rounded-lg bg-slate-50/70 p-2 text-sm">
        {detail.report?.data != null ? <CvReport data={detail.report.data} codes={detail.plainCodes}/> : <p className="text-xs text-slate-500">{detail.report?.error === "HUMAN_TOKEN_EXPIRED" ? "Token Human hết hạn, chưa lấy được Tình trạng CV." : "Chưa lấy được Tình trạng CV từ Human."}</p>}
      </div>
      {detail.report?.fetchedAt ? <p className="mt-1 text-[11px] text-slate-400">Tình trạng CV lấy lúc {time(detail.report.fetchedAt)}{detail.report.error ? " (lần lấy lại vừa rồi lỗi, đang hiện bản cũ)" : ""}</p> : null}
    </section>

    <div className="mt-4 space-y-3">
      {field(<UserRound className="size-4"/>, "Sale", person(customer.sale_human_id))}
      {field(<UserRound className="size-4"/>, "AM", person(customer.am_human_id))}
      {field(<MapPin className="size-4"/>, "Địa điểm", customer.location)}
      {customer.website ? field(<Globe className="size-4"/>, "Website", <a href={/^https?:\/\//u.test(customer.website) ? customer.website : `https://${customer.website}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 break-all text-blue-700 hover:underline">{customer.website}<ExternalLink className="size-3"/></a>) : null}
      {field(<UserRound className="size-4"/>, "Người liên hệ", [customer.contact_name, customer.position].filter(Boolean).join(" · ") || null)}
      {field(<Mail className="size-4"/>, "Email", customer.email)}
      {field(<Phone className="size-4"/>, "Điện thoại", customer.phone)}
      {contacts.length ? field(<UserRound className="size-4"/>, "Liên hệ khác", <ul className="list-disc pl-4">{contacts.map((item) => <li key={item}>{item}</li>)}</ul>) : null}
      {field(<History className="size-4"/>, "Tạo trên Human", [day(customer.human_created_at), customer.human_created_by].filter((value) => value && value !== "—").join(" · ") || null)}
    </div>

    {log.length ? <section className="mt-5">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><History className="size-4"/>Status ({log.length})</h3>
      <ol className="mt-2 space-y-2 border-l-2 border-slate-100 pl-3">{log.slice(0, 30).map((entry, index) => <li key={`${entry.date}-${index}`} className="text-sm">
        <p className="text-[11px] font-semibold text-slate-500">{entry.date.split("-").reverse().join("/")}{entry.author ? ` · ${entry.author}` : ""}</p>
        <p className="whitespace-pre-line text-slate-800">{entry.text || "—"}</p>
      </li>)}</ol>
    </section> : null}

    <section className="mt-5">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><MessagesSquare className="size-4"/>Hội thoại ở Suối Nguồn</h3>
      {detail.conversations.length ? <ul className="mt-2 space-y-1">{detail.conversations.map((item) => <li key={item.id}><Link href={`/inbox/all/${item.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><ChannelLogo channel={item.channel as "ZALO"} size={16}/><span className="min-w-0 flex-1 truncate">{item.name}</span><span className="shrink-0 text-xs text-slate-500">{item.account} · {time(item.at)}</span></Link></li>)}</ul>
        : <p className="mt-1.5 text-xs text-slate-500">Chưa thấy hội thoại nào khớp email/SĐT của khách (chỉ tính hội thoại bạn được xem).</p>}
    </section>

    <details className="mt-5 rounded-lg border border-slate-200">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-700">Tất cả trường từ Human ({Object.keys(data).length})</summary>
      <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-slate-100 px-3 py-2 text-xs">
        {Object.entries(data).filter(([key]) => key !== "statusNew").map(([key, value]) => <div key={key} className="contents"><dt className="truncate font-mono text-slate-500" title={key}>{key}</dt><dd className="break-words text-slate-800">{showValue(key, value)}</dd></div>)}
      </dl>
    </details>
    <p className="mt-3 text-[11px] text-slate-400">Bản sao chỉ đọc · lấy lúc {time(customer.synced_at)} · sửa thông tin trên Human</p>
  </aside>;
}
