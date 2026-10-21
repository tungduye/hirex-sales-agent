import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Download, ExternalLink, Globe, Mail, MapPin, MessagesSquare, Phone, Search, Settings2, UserRound, X } from "lucide-react";
import { ChannelLogo } from "@/modules/channels/components/channel-logo";
import { RefreshFromHumanButton } from "@/modules/customers/components/refresh-button";
import { customerFilters, getCustomer, listCustomers, type CustomerFilters, type CustomerRow } from "@/modules/customers/server/customer-data";

type Params = Record<string, string | string[] | undefined>;

function href(filters: CustomerFilters, change: Partial<CustomerFilters> & { id?: number | null } = {}) {
  const next = { ...filters, page: 1, ...change };
  const query = new URLSearchParams();
  if (next.q) query.set("q", next.q);
  if (next.block) query.set("block", String(next.block));
  if (next.status) query.set("status", next.status);
  if (next.type) query.set("type", next.type);
  if (next.owner) query.set("owner", next.owner);
  if (next.has) query.set("has", next.has);
  if (next.page > 1) query.set("page", String(next.page));
  if (change.id) query.set("id", String(change.id));
  return `/customers${query.size ? `?${query}` : ""}`;
}
const time = (value: string | null | undefined) => value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const filters = customerFilters(params);
  const selectedId = Number(typeof params.id === "string" ? params.id : "");
  const [list, detail] = await Promise.all([listCustomers(filters), Number.isSafeInteger(selectedId) && selectedId > 0 ? getCustomer(selectedId) : Promise.resolve(null)]);
  if (!list) redirect("/");
  const { context } = list;
  const filtered = Boolean(filters.q || filters.status || filters.type || filters.owner || filters.has);
  const blockLabel = (id: number) => list.blocks.find((block) => block.block_id === id)?.name || `Khối ${id}`;
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
      <label className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400"/><input name="q" defaultValue={filters.q} placeholder="Tìm tên, email, SĐT, website, địa chỉ, mã…" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-sm outline-none focus:border-blue-400 focus:bg-white"/></label>
      <Select name="status" label="Trạng thái" value={filters.status} options={list.statuses}/>
      <Select name="type" label="Loại" value={filters.type} options={list.types}/>
      <select name="owner" defaultValue={filters.owner ?? ""} aria-label="Phụ trách" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
        <option value="">Mọi người phụ trách</option><option value="me">Tôi là Sale/AM</option>
        {context.viewAll ? list.linkedPeople.filter((person) => person.id !== context.userId).map((person) => <option key={person.id} value={person.id}>{person.name}</option>) : null}
      </select>
      <select name="has" defaultValue={filters.has ?? ""} aria-label="Có thông tin liên hệ" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
        <option value="">Mọi khách</option><option value="email">Có email</option><option value="phone">Có SĐT</option>
      </select>
      <button className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">Lọc</button>
      {filtered ? <Link href={href({ ...filters, q: "", status: null, type: null, owner: null, has: null })} className="inline-flex h-9 items-center gap-1 px-2 text-sm font-semibold text-slate-500 hover:text-rose-600"><X className="size-4"/>Xóa lọc</Link> : null}
    </form>

    {list.error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{list.error}</div> : null}
    {!list.lastSync && !list.total ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <Building2 className="mx-auto size-10 text-slate-300"/>
      <p className="mt-3 font-semibold text-slate-800">Chưa có khách hàng nào</p>
      <p className="mt-1 text-sm text-slate-500">{context.canManage ? "Bấm \"Cập nhật từ Human\". Nếu báo thiếu token, dán token trong Cài đặt → Cài đặt API Human." : "Quản trị viên cần cập nhật dữ liệu từ Human."}</p>
    </div> : <div className={`grid items-start gap-4 ${detail ? "xl:grid-cols-[minmax(0,1fr)_420px]" : ""}`}>
      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 text-sm"><span className="font-semibold text-slate-800">{list.total.toLocaleString("vi-VN")} khách hàng</span><span className="text-xs text-slate-500">Trang {filters.page}/{list.pages}</span></div>
        <div className="max-h-[calc(100dvh-20rem)] overflow-auto">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr>
              <th className="px-4 py-2">Khách hàng</th><th className="px-3 py-2">Trạng thái</th><th className="px-3 py-2">Liên hệ</th><th className="px-3 py-2">Email / SĐT</th><th className="px-3 py-2">Sale / AM</th><th className="px-3 py-2">Gửi email</th>
            </tr></thead>
            <tbody>{list.rows.map((row) => <CustomerLine key={row.partner_id} row={row} filters={filters} selected={row.partner_id === selectedId}/>)}</tbody>
          </table>
          {list.rows.length === 0 ? <p className="px-4 py-10 text-center text-sm text-slate-500">Không có khách hàng nào khớp bộ lọc.</p> : null}
        </div>
        {list.pages > 1 ? <nav className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm" aria-label="Trang">
          {filters.page > 1 ? <Link href={href(filters, { page: filters.page - 1 })} className="font-semibold text-blue-700 hover:underline">← Trang trước</Link> : <span/>}
          {filters.page < list.pages ? <Link href={href(filters, { page: filters.page + 1 })} className="font-semibold text-blue-700 hover:underline">Trang sau →</Link> : <span/>}
        </nav> : null}
      </section>
      {detail ? <CustomerPanel detail={detail} closeHref={href({ ...filters })} blockLabel={blockLabel}/> : null}
    </div>}
  </div>;
}

function Select({ name, label, value, options }: { name: string; label: string; value: string | null; options: Array<{ value: string; total: number }> }) {
  return <select name={name} defaultValue={value ?? ""} aria-label={label} className="h-9 max-w-[200px] rounded-lg border border-slate-200 bg-white px-2 text-sm">
    <option value="">{label}: tất cả</option>
    {options.slice(0, 200).map((option) => <option key={option.value} value={option.value}>{option.value === "—" ? "(trống)" : option.value} ({option.total.toLocaleString("vi-VN")})</option>)}
  </select>;
}

function CustomerLine({ row, filters, selected }: { row: CustomerRow; filters: CustomerFilters; selected: boolean }) {
  const link = href({ ...filters }, { id: row.partner_id, page: filters.page });
  return <tr className={`border-t border-slate-100 align-top ${selected ? "bg-blue-50" : "hover:bg-slate-50"}`}>
    <td className="px-4 py-2.5"><Link href={link} scroll={false} className="block min-w-0"><span className="block truncate font-semibold text-slate-900">{row.name ?? `Khách #${row.partner_id}`}</span>
      <span className="block truncate text-xs text-slate-500">#{row.partner_id}{row.partner_type ? ` · ${row.partner_type}` : ""}{row.website ? ` · ${row.website.replace(/^https?:\/\//u, "")}` : ""}</span></Link></td>
    <td className="px-3 py-2.5">{row.status ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{row.status}</span> : <span className="text-slate-400">—</span>}</td>
    <td className="max-w-[180px] px-3 py-2.5"><span className="block truncate text-slate-800">{row.contact_name ?? "—"}</span>{row.position ? <span className="block truncate text-xs text-slate-500">{row.position}</span> : null}</td>
    <td className="max-w-[220px] px-3 py-2.5"><span className="block truncate text-slate-800">{row.email ?? "—"}</span>{row.phone ? <span className="block truncate text-xs text-slate-500">{row.phone}</span> : null}</td>
    <td className="max-w-[160px] px-3 py-2.5 text-xs text-slate-600"><span className="block truncate">{row.sale_name ?? row.sale_human_id ?? "—"}</span>{row.am_name || row.am_human_id ? <span className="block truncate text-slate-500">AM: {row.am_name ?? row.am_human_id}</span> : null}</td>
    <td className="px-3 py-2.5 text-xs text-slate-500">{row.email_sent_at ?? "—"}</td>
  </tr>;
}

function CustomerPanel({ detail, closeHref, blockLabel }: { detail: NonNullable<Awaited<ReturnType<typeof getCustomer>>>; closeHref: string; blockLabel: (id: number) => string }) {
  const { customer } = detail;
  const field = (icon: React.ReactNode, label: string, value: string | null | undefined) => value ? <div className="flex gap-2.5"><span className="mt-0.5 text-slate-400">{icon}</span><div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="break-words text-sm text-slate-800">{value}</p></div></div> : null;
  const person = (id: string | null, name: string | null) => {
    if (!id && !name) return null;
    const member = detail.member(id);
    return `${name ?? id}${member ? ` → ${member}` : id ? " (chưa liên kết người HireX)" : ""}`;
  };
  return <aside className="fixed inset-0 z-40 overflow-y-auto bg-white p-5 xl:sticky xl:top-4 xl:inset-auto xl:z-auto xl:max-h-[calc(100dvh-6rem)] xl:rounded-xl xl:border xl:border-slate-200" aria-label="Chi tiết khách hàng">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-xs font-semibold text-slate-500">Khách #{customer.partner_id}{customer.block_ids.length ? ` · ${customer.block_ids.map(blockLabel).join(", ")}` : ""}</p>
        <h2 className="mt-0.5 break-words text-lg font-bold text-slate-950">{customer.name ?? "Chưa có tên"}</h2>
        <div className="mt-1.5 flex flex-wrap gap-1.5">{customer.status ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">{customer.status}</span> : null}{customer.partner_type ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{customer.partner_type}</span> : null}{!customer.active ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Không còn trong khối đang bật</span> : null}</div>
      </div>
      <Link href={closeHref} scroll={false} aria-label="Đóng" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-5"/></Link>
    </div>
    <div className="mt-4 space-y-3">
      {field(<UserRound className="size-4"/>, "Người liên hệ", [customer.contact_name, customer.position].filter(Boolean).join(" · ") || null)}
      {field(<Mail className="size-4"/>, "Email", customer.email)}
      {field(<Phone className="size-4"/>, "Điện thoại", customer.phone)}
      {customer.website ? <div className="flex gap-2.5"><span className="mt-0.5 text-slate-400"><Globe className="size-4"/></span><div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Website</p><a href={/^https?:\/\//u.test(customer.website) ? customer.website : `https://${customer.website}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 break-all text-sm text-blue-700 hover:underline">{customer.website}<ExternalLink className="size-3"/></a></div></div> : null}
      {field(<MapPin className="size-4"/>, "Địa chỉ", customer.address)}
      {field(<UserRound className="size-4"/>, "Sale", person(customer.sale_human_id, customer.sale_name))}
      {field(<UserRound className="size-4"/>, "AM", [person(customer.am_human_id, customer.am_name), person(customer.am2_human_id, customer.am2_name)].filter(Boolean).join("; ") || null)}
      {field(<Mail className="size-4"/>, "Ghi chú email", [customer.email_sent_at ? `Gửi ${customer.email_sent_at}` : null, customer.note].filter(Boolean).join(" · ") || null)}
    </div>
    <section className="mt-5">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><MessagesSquare className="size-4"/>Hội thoại ở Suối Nguồn</h3>
      {detail.conversations.length ? <ul className="mt-2 space-y-1">{detail.conversations.map((item) => <li key={item.id}><Link href={`/inbox/all/${item.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><ChannelLogo channel={item.channel as "ZALO"} size={16}/><span className="min-w-0 flex-1 truncate">{item.name}</span><span className="shrink-0 text-xs text-slate-500">{item.account} · {time(item.at)}</span></Link></li>)}</ul>
        : <p className="mt-1.5 text-xs text-slate-500">Chưa thấy hội thoại nào khớp email/SĐT của khách (chỉ tính hội thoại bạn được xem).</p>}
    </section>
    <details className="mt-5 rounded-lg border border-slate-200">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-700">Tất cả trường từ Human ({Object.keys(customer.data ?? {}).length})</summary>
      <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-slate-100 px-3 py-2 text-xs">
        {Object.entries(customer.data ?? {}).map(([key, value]) => <div key={key} className="contents"><dt className="truncate font-mono text-slate-500" title={key}>{key}</dt><dd className="break-words text-slate-800">{value == null || value === "" ? <span className="text-slate-300">—</span> : typeof value === "object" ? JSON.stringify(value).slice(0, 400) : String(value).slice(0, 400)}</dd></div>)}
      </dl>
    </details>
    <p className="mt-3 text-[11px] text-slate-400">Bản sao chỉ đọc · lấy lúc {time(customer.synced_at)} · sửa thông tin trên Human</p>
  </aside>;
}
