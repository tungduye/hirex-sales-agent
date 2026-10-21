import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Briefcase, Building2, Code2, FileUser, Globe, History, Languages, Mail, MapPin, MessagesSquare, Phone, Search, Settings2, UserRound, Wallet, X } from "lucide-react";
import { ChannelLogo } from "@/modules/channels/components/channel-logo";
import { RefreshCvsButton } from "@/modules/cvs/components/cv-forms";
import { cvFilters, getCv, listCvs, type CvFilters, type CvRow } from "@/modules/cvs/server/cv-data";
import { detailPairs } from "@/modules/cvs/core/cv-detail";

type Params = Record<string, string | string[] | undefined>;
type Detail = NonNullable<Awaited<ReturnType<typeof getCv>>>;

function href(filters: CvFilters, change: Partial<CvFilters> & { id?: number | null } = {}) {
  const next = { ...filters, page: 1, ...change };
  const query = new URLSearchParams();
  if (next.q) query.set("q", next.q);
  if (next.block) query.set("block", next.block);
  if (next.status1) query.set("s1", next.status1);
  if (next.status2) query.set("s2", next.status2);
  if (next.position) query.set("pos", next.position);
  if (next.loc) query.set("loc", next.loc);
  if (next.owner) query.set("owner", next.owner);
  if (next.page > 1) query.set("page", String(next.page));
  if (change.id) query.set("id", String(change.id));
  return `/cvs${query.size ? `?${query}` : ""}`;
}
const time = (value: string | null | undefined) => value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const day = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

export default async function CvsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const filters = cvFilters(params);
  const selectedId = Number(typeof params.id === "string" ? params.id : "");
  const [list, detail] = await Promise.all([listCvs(filters), Number.isSafeInteger(selectedId) && selectedId > 0 ? getCv(selectedId) : Promise.resolve(null)]);
  if (!list) redirect("/");
  const { context } = list;
  const filtered = Boolean(filters.q || filters.status1 || filters.status2 || filters.position || filters.loc || filters.owner);
  const blockLabel = (key: string) => list.blocks.find((block) => block.block_key === key)?.name || key;
  const person = (id: string | null, fallback: string | null) => id ? list.personName[id] ?? fallback ?? `#${id}` : fallback;
  return <div className="space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">CV</h1>
        <p className="mt-0.5 text-sm text-slate-500">Từ Human · {list.lastSync ? <>cập nhật {time(list.lastSync.finished_at ?? list.lastSync.started_at)}{list.lastSync.ok === false ? <span className="text-amber-700"> (lần gần nhất có lỗi)</span> : null}</> : "chưa cập nhật lần nào"} · tự cập nhật mỗi 6 giờ{context.viewAll ? "" : " · bạn thấy CV mình phụ trách"}</p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {context.canManage ? <Link href="/cvs/settings" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Settings2 className="size-4"/>Cài đặt</Link> : null}
        {context.canManage ? <RefreshCvsButton/> : null}
      </div>
    </header>

    {list.blocks.filter((block) => block.enabled).length > 1 ? <nav aria-label="Khối" className="flex flex-wrap gap-1.5">
      {[null, ...list.blocks.filter((block) => block.enabled).map((block) => block.block_key)].map((key) => {
        const on = filters.block === key;
        const total = key === null ? null : list.blockCounts[key] ?? 0;
        return <Link key={key ?? "all"} href={href(filters, { block: key })} aria-current={on ? "page" : undefined}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
          {key === null ? "Tất cả khối" : blockLabel(key)}{total !== null ? <span className={`rounded-full px-1.5 text-[11px] ${on ? "bg-slate-700" : "bg-slate-100 text-slate-600"}`}>{total.toLocaleString("vi-VN")}</span> : null}
        </Link>;
      })}
    </nav> : null}

    <form action="/cvs" className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5">
      {filters.block ? <input type="hidden" name="block" value={filters.block}/> : null}
      <label className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400"/><input name="q" defaultValue={filters.q} placeholder="Tìm tên, SĐT, email, mã UV, kỹ năng, công ty đã gửi…" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-sm outline-none focus:border-blue-400 focus:bg-white"/></label>
      <Select name="s1" label="Trạng thái" value={filters.status1} options={list.statuses1}/>
      <Select name="s2" label="Tình trạng" value={filters.status2} options={list.statuses2}/>
      <Select name="pos" label="Vị trí" value={filters.position} options={list.positions}/>
      <Select name="loc" label="Địa điểm" value={filters.loc} options={list.locations}/>
      <select name="owner" defaultValue={filters.owner ?? ""} aria-label="Rec" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
        <option value="">Mọi Rec</option><option value="me">CV của tôi</option>
        {context.viewAll ? list.linkedPeople.filter((item) => item.id !== context.userId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : null}
      </select>
      <button className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">Lọc</button>
      {filtered ? <Link href={href({ ...filters, q: "", status1: null, status2: null, position: null, loc: null, owner: null })} className="inline-flex h-9 items-center gap-1 px-2 text-sm font-semibold text-slate-500 hover:text-rose-600"><X className="size-4"/>Xóa lọc</Link> : null}
    </form>

    {list.error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{list.error}</div> : null}
    {!list.lastSync && !list.total ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <FileUser className="mx-auto size-10 text-slate-300"/>
      <p className="mt-3 font-semibold text-slate-800">Chưa có CV nào</p>
      <p className="mt-1 text-sm text-slate-500">{context.canManage ? "Bấm \"Cập nhật từ Human\". Nếu báo thiếu token, dán token trong Cài đặt → Kết nối Human." : "Quản trị viên cần cập nhật dữ liệu từ Human."}</p>
    </div> : <div className={`grid items-start gap-4 ${detail ? "xl:grid-cols-[minmax(0,1fr)_440px]" : ""}`}>
      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 text-sm"><span className="font-semibold text-slate-800">{list.total.toLocaleString("vi-VN")} CV</span><span className="text-xs text-slate-500">Trang {filters.page}/{list.pages}</span></div>
        <div className="max-h-[calc(100dvh-20rem)] overflow-auto">
          <table className="w-full min-w-[980px] text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr>
              <th className="px-4 py-2">Ứng viên</th><th className="px-3 py-2">Vị trí · Kỹ năng</th><th className="px-3 py-2">Trạng thái</th><th className="px-3 py-2">Rec</th><th className="px-3 py-2">Đã gửi công ty</th><th className="px-3 py-2">Cập nhật</th>
            </tr></thead>
            <tbody>{list.rows.map((row) => <CvLine key={row.cv_id} row={row} filters={filters} selected={row.cv_id === selectedId} person={person}/>)}</tbody>
          </table>
          {list.rows.length === 0 ? <p className="px-4 py-10 text-center text-sm text-slate-500">Không có CV nào khớp bộ lọc.</p> : null}
        </div>
        {list.pages > 1 ? <nav className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm" aria-label="Trang">
          {filters.page > 1 ? <Link href={href(filters, { page: filters.page - 1 })} className="font-semibold text-blue-700 hover:underline">← Trang trước</Link> : <span/>}
          {filters.page < list.pages ? <Link href={href(filters, { page: filters.page + 1 })} className="font-semibold text-blue-700 hover:underline">Trang sau →</Link> : <span/>}
        </nav> : null}
      </section>
      {detail ? <CvPanel detail={detail} closeHref={href({ ...filters }, { page: filters.page })} blockLabel={blockLabel}/> : null}
    </div>}
  </div>;
}

function Select({ name, label, value, options }: { name: string; label: string; value: string | null; options: Array<{ value: string; total: number }> }) {
  return <select name={name} defaultValue={value ?? ""} aria-label={label} className="h-9 max-w-[190px] rounded-lg border border-slate-200 bg-white px-2 text-sm">
    <option value="">{label}: tất cả</option>
    {options.slice(0, 300).map((option) => <option key={option.value} value={option.value}>{option.value === "—" ? "(trống)" : option.value} ({option.total.toLocaleString("vi-VN")})</option>)}
  </select>;
}

function CvLine({ row, filters, selected, person }: { row: CvRow; filters: CvFilters; selected: boolean; person: (id: string | null, fallback: string | null) => string | null }) {
  const link = href({ ...filters }, { id: row.cv_id, page: filters.page });
  const companies = (row.companies ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return <tr className={`border-t border-slate-100 align-top ${selected ? "bg-blue-50" : "hover:bg-slate-50"}`}>
    <td className="max-w-[230px] px-4 py-2.5"><Link href={link} scroll={false} className="block min-w-0"><span className="block truncate font-semibold text-slate-900">{row.name ?? `CV #${row.cv_id}`}</span>
      <span className="block truncate text-xs text-slate-500">{[row.code, row.location].filter(Boolean).join(" · ") || `#${row.cv_id}`}</span></Link></td>
    <td className="max-w-[220px] px-3 py-2.5 text-xs text-slate-700"><span className="block truncate font-medium" title={row.position ?? ""}>{row.position ?? "—"}</span><span className="block truncate text-slate-500" title={row.skill ?? ""}>{[row.skill, row.skill_tech].filter(Boolean).join(" · ") || ""}</span></td>
    <td className="max-w-[200px] px-3 py-2.5">{row.status2 || row.status1 ? <span className="inline-block max-w-full truncate rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-800" title={[row.status1, row.status2].filter(Boolean).join(" · ")}>{row.status2 ?? row.status1}</span> : <span className="text-slate-300">—</span>}</td>
    <td className="max-w-[140px] px-3 py-2.5 text-xs text-slate-700"><span className="block truncate">{person(row.recer_human_id, row.recer_name) ?? "—"}</span></td>
    <td className="max-w-[240px] px-3 py-2.5 text-xs text-slate-600"><span className="line-clamp-2" title={row.companies ?? ""}>{companies.length ? `${companies.length} công ty: ${companies.slice(0, 3).join(", ")}${companies.length > 3 ? "…" : ""}` : row.partner_name ?? "—"}</span></td>
    <td className="px-3 py-2.5 text-xs text-slate-500">{day(row.human_updated_at ?? row.human_created_at)}</td>
  </tr>;
}

function CvPanel({ detail, closeHref, blockLabel }: { detail: Detail; closeHref: string; blockLabel: (key: string) => string }) {
  const { cv } = detail;
  const data = cv.data ?? {};
  const field = (icon: ReactNode, label: string, value: ReactNode) => value ? <div className="flex gap-2.5"><span className="mt-0.5 text-slate-400">{icon}</span><div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><div className="break-words text-sm text-slate-800">{value}</div></div></div> : null;
  const companies = (cv.companies ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  // Every filled field of the hồ sơ; coded values get their bộ mã name.
  const codeLike = /(id$|rate|rank|address|position|skill|status)/iu;
  const detailRows = detail.detail?.detail ? detailPairs(detail.detail.detail).map(([path, value]) => [path, codeLike.test(path.split(" › ").at(-1) ?? "") ? value.split(/[,;]+/u).map((part) => detail.codes[part.trim()] ?? part.trim()).join(", ") : value] as const) : [];
  const links = Object.entries(data).flatMap(([key, value]) => typeof value === "string" && /^https?:\/\//iu.test(value.trim()) ? [{ key, url: value.trim() }] : []).slice(0, 8);
  const showValue = (key: string, value: unknown) => {
    if (value == null || value === "") return <span className="text-slate-300">—</span>;
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    const named = /(id$|rate|rank|address|position|skill|status)/iu.test(key) ? text.split(/[,;]+/u).map((part) => detail.codes[part.trim()] ?? part.trim()).join(", ") : text;
    return named.replace(/<[^>]*>/gu, " ").slice(0, 400);
  };
  return <aside className="fixed inset-0 z-40 overflow-y-auto bg-white p-5 xl:sticky xl:inset-auto xl:top-4 xl:z-auto xl:max-h-[calc(100dvh-6rem)] xl:rounded-xl xl:border xl:border-slate-200" aria-label="Chi tiết CV">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-xs font-semibold text-slate-500">CV #{cv.cv_id}{cv.code ? ` · ${cv.code}` : ""}{cv.block_keys.length ? ` · ${cv.block_keys.map(blockLabel).join(", ")}` : ""}</p>
        <h2 className="mt-0.5 break-words text-lg font-bold text-slate-950">{cv.name ?? "Chưa có tên"}</h2>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {cv.status1 ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{cv.status1}</span> : null}
          {cv.status2 ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-800">{cv.status2}</span> : null}
          {!cv.active ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Không còn trong khối đang bật</span> : null}
        </div>
      </div>
      <Link href={closeHref} scroll={false} aria-label="Đóng" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-5"/></Link>
    </div>

    <div className="mt-4 space-y-3">
      {field(<Briefcase className="size-4"/>, "Vị trí", cv.position)}
      {field(<Code2 className="size-4"/>, "Kỹ năng", [cv.skill, cv.skill_tech].filter(Boolean).join(" · ") || null)}
      {field(<Languages className="size-4"/>, "Ngoại ngữ", cv.languages)}
      {field(<MapPin className="size-4"/>, "Địa điểm", cv.location)}
      {field(<Wallet className="size-4"/>, "Lương", cv.salary)}
      {field(<UserRound className="size-4"/>, "Rec phụ trách", detail.recer)}
      {field(<Phone className="size-4"/>, "Điện thoại", cv.phone)}
      {field(<Mail className="size-4"/>, "Email", cv.email)}
      {links.length ? field(<Globe className="size-4"/>, "Liên kết", <ul className="space-y-0.5">{links.map((item) => <li key={item.key}><a href={item.url} target="_blank" rel="noreferrer noopener" className="break-all text-blue-700 hover:underline">{item.key}</a></li>)}</ul>) : null}
      {field(<History className="size-4"/>, "Trên Human", [cv.human_created_at ? `tạo ${day(cv.human_created_at)}` : "", cv.human_updated_at ? `cập nhật ${day(cv.human_updated_at)}` : "", cv.history_count > 1 ? `${cv.history_count} lần gửi` : ""].filter(Boolean).join(" · ") || null)}
    </div>

    <section className="mt-5">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><Building2 className="size-4"/>Đã gửi công ty ({(cv.applications ?? []).length || companies.length})</h3>
      {(cv.applications ?? []).length ? <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">{cv.applications.map((item, index) => <li key={item.history_id ?? index} className="flex flex-wrap items-baseline gap-x-2 px-2.5 py-1.5 text-sm">
        {item.partner_id ? <Link href={`/customers?id=${item.partner_id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:text-blue-700 hover:underline">{item.partner_name ?? `Khách #${item.partner_id}`}</Link> : <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{item.partner_name ?? "—"}</span>}
        {item.status2 ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">{item.status2}</span> : null}
        <span className="text-[11px] text-slate-500">{day(item.status2_at ?? item.updated_at)}</span>
      </li>)}</ul> : companies.length ? <ul className="mt-2 flex flex-wrap gap-1.5">{companies.map((company, index) => <li key={`${company}-${index}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{company}</li>)}</ul> : <p className="mt-1.5 text-xs text-slate-500">Chưa gửi công ty nào.</p>}
    </section>

    <section className="mt-5">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><FileUser className="size-4"/>Hồ sơ chi tiết</h3>
      {detailRows.length ? <dl className="mt-2 grid grid-cols-[minmax(0,130px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg bg-slate-50/70 p-2.5 text-xs">
        {detailRows.map(([path, value], index) => <div key={`${path}-${index}`} className="contents"><dt className="break-words font-medium text-slate-500" title={path}>{path}</dt>
          <dd className="whitespace-pre-line break-words text-slate-800">{/^https?:\/\//iu.test(value) ? <a href={value} target="_blank" rel="noreferrer noopener" className="break-all text-blue-700 hover:underline">{value}</a> : value}</dd></div>)}
      </dl> : <p className="mt-1.5 text-xs text-slate-500">{detail.detail?.error === "HUMAN_TOKEN_EXPIRED" ? "Token Human hết hạn, chưa lấy được hồ sơ." : detail.detail?.error ? "Chưa lấy được hồ sơ chi tiết từ Human." : "Chưa có hồ sơ chi tiết."}</p>}
      {detail.detail?.fetchedAt ? <p className="mt-1 text-[11px] text-slate-400">Hồ sơ lấy lúc {time(detail.detail.fetchedAt)}{detail.detail.error && detailRows.length ? " (lần lấy lại vừa rồi lỗi, đang hiện bản cũ)" : ""}</p> : null}
    </section>

    <section className="mt-5">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><MessagesSquare className="size-4"/>Hội thoại ở Suối Nguồn</h3>
      {detail.conversations.length ? <ul className="mt-2 space-y-1">{detail.conversations.map((item) => <li key={item.id}><Link href={`/inbox/all/${item.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><ChannelLogo channel={item.channel as "ZALO"} size={16}/><span className="min-w-0 flex-1 truncate">{item.name}</span><span className="shrink-0 text-xs text-slate-500">{item.account} · {time(item.at)}</span></Link></li>)}</ul>
        : <p className="mt-1.5 text-xs text-slate-500">Chưa thấy hội thoại nào khớp SĐT/email của UV (chỉ tính hội thoại bạn được xem).</p>}
    </section>

    {detail.sameCandidate.length ? <section className="mt-5">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><FileUser className="size-4"/>CV khác cùng SĐT/email</h3>
      <ul className="mt-2 space-y-1">{detail.sameCandidate.map((item) => <li key={item.cv_id}><Link href={`/cvs?id=${item.cv_id}`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><span className="font-medium">{item.name ?? `CV #${item.cv_id}`}</span> <span className="text-xs text-slate-500">{[item.position, item.status2, day(item.human_updated_at)].filter(Boolean).join(" · ")}</span></Link></li>)}</ul>
    </section> : null}

    <details className="mt-5 rounded-lg border border-slate-200">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-700">Tất cả trường từ Human ({Object.keys(data).length})</summary>
      <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-slate-100 px-3 py-2 text-xs">
        {Object.entries(data).map(([key, value]) => <div key={key} className="contents"><dt className="truncate font-mono text-slate-500" title={key}>{key}</dt><dd className="break-words text-slate-800">{showValue(key, value)}</dd></div>)}
      </dl>
    </details>
    <p className="mt-3 text-[11px] text-slate-400">Bản sao chỉ đọc · lấy lúc {time(cv.synced_at)} · sửa thông tin trên Human</p>
  </aside>;
}
