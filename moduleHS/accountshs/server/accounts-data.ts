import "server-only";

import { T, allOrdered, chunks, getJsonSetting, getSetting, isMissing, now, safeTs, orMissing, pages, run, sb, parseDevice, toIds } from "./db";
import type { Account, DbCheck, Delta, Device, Epoch, Field, HistChange, HistInfo, HistItem, HistLast, Id, Link, LogRow, Meta, Snapshot, Status, Tab, TabRows } from "../types";

/* ───────── meta ───────── */
export async function getMeta(): Promise<Meta> {
  const [tabs, fields, statuses, depts, owners, grp_icons, tab_keys, tab_pk, opt_colors, opt_icons, opt_mode] = await Promise.all([
    allOrdered<Omit<Tab, "fields" | "statuses">>("tabs"), allOrdered<Field>("fields"), allOrdered<Status>("statuses"),
    allOrdered<Meta["depts"][number]>("depts"), allOrdered<Meta["owners"][number]>("owners"),
    getJsonSetting<Record<string, string>>("grp_icons", {}), getJsonSetting<Record<string, Id[]>>("tab_keys", {}),
    getJsonSetting<Record<string, Id>>("tab_pk", {}), getJsonSetting<Record<string, Record<string, string>>>("opt_colors", {}),
    getJsonSetting<Record<string, Record<string, string>>>("opt_icons", {}), getJsonSetting<Record<string, string>>("opt_mode", {}),
  ]);
  const fs = new Map<Id, Field[]>(), ss = new Map<Id, Status[]>();
  for (const f of fields) (fs.get(f.tab_id) ?? fs.set(f.tab_id, []).get(f.tab_id)!).push(f);
  for (const s of statuses) (ss.get(s.tab_id) ?? ss.set(s.tab_id, []).get(s.tab_id)!).push(s);
  // khóa chính riêng: đưa lên đầu fields[] (mọi nơi coi fields[0] là tên dòng); cột trên bảng vẫn xếp theo pos
  const pkFirst = (tid: Id, fl: Field[]) => { const k = Number(tab_pk[String(tid)]), i = fl.findIndex((f) => f.id === k); return i > 0 ? [fl[i], ...fl.slice(0, i), ...fl.slice(i + 1)] : fl; };
  return { depts, owners, tabs: tabs.map((t) => ({ ...t, fields: pkFirst(t.id, fs.get(t.id) ?? []), statuses: ss.get(t.id) ?? [] })), grp_icons, tab_keys, tab_pk, opt_colors, opt_icons, opt_mode };
}

export async function getDevices(): Promise<Device[]> {
  return (await allOrdered<Parameters<typeof parseDevice>[0]>("devices")).map(parseDevice);
}

export async function firstField(tabId: Id): Promise<Id | null> {
  const pk = Number((await getJsonSetting<Record<string, Id>>("tab_pk", {}))[String(tabId)]);
  if (pk && (await run<{ id: Id } | null>(sb().from(T.fields).select("id").eq("id", pk).eq("tab_id", tabId).maybeSingle()))) return pk;
  const r = await run<{ id: Id } | null>(sb().from(T.fields).select("id").eq("tab_id", tabId).order("pos").order("id").limit(1).maybeSingle());
  return r?.id ?? null;
}
export async function firstStatus(tabId: Id): Promise<Id | null> {
  const r = await run<{ id: Id } | null>(sb().from(T.statuses).select("id").eq("tab_id", tabId).order("pos").order("id").limit(1).maybeSingle());
  return r?.id ?? null;
}

/** Id các tab "tải riêng" (lazy=1) mà trình duyệt CHƯA nạp (lz = danh sách tab đã nạp, cách nhau dấu phẩy). */
async function lazyExcl(lz = ""): Promise<Id[]> {
  if (lz === "*") return [];   // dòng thay đổi realtime (feed.ts): lấy mọi tab, trình duyệt tự lọc
  const have = new Set(toIds(lz.split(",")));
  const rows = await run<{ id: Id }[]>(sb().from(T.tabs).select("id").eq("lazy", 1));
  return rows.map((r) => r.id).filter((id) => !have.has(id));
}

const parseJsonText = <R>(t: string | null | undefined): R => JSON.parse(t || "[]") as R;
const ACC_COLS = "id,tab_id,dept_id,owner_id,status_id,device_id,note,data,created,updated";
/** Dòng tài khoản: hàm SQL ahs_accounts_json (1 lượt, dựng JSON trong Postgres); chưa có migration → đọc theo trang. */
export async function loadAccounts(exclude: Id[], only: Id | null): Promise<Account[]> {
  try { return parseJsonText<Account[]>(await run<string>(sb().rpc("ahs_accounts_json", { p_exclude_tabs: exclude, p_only_tab: only }))); }
  catch (e) { if (!isMissing(e)) throw e; }
  return pages<Account>((a, b) => {
    let q = sb().from(T.accounts).select(ACC_COLS).order("id").range(a, b);
    if (only != null) q = q.eq("tab_id", only); else if (exclude.length) q = q.not("tab_id", "in", `(${exclude.join(",")})`);
    return q;
  });
}
/** Liên kết (bỏ liên kết chạm tab tải riêng chưa nạp): ahs_links_json; chưa có migration → đọc theo trang rồi lọc. */
export async function loadLinks(exclude: Id[], only: Id | null): Promise<Link[]> {
  try { return parseJsonText<Link[]>(await run<string>(sb().rpc("ahs_links_json", { p_exclude_tabs: exclude, p_only_tab: only }))); }
  catch (e) { if (!isMissing(e)) throw e; }
  const all = await pages<{ id: Id; src: Id; dst: Id; field_id: Id }>((a, b) => sb().from(T.links).select("id,src,dst,field_id").order("id").range(a, b));
  let keep = all;
  if (exclude.length || only != null) {
    const tabOf = new Map((await pages<{ id: Id; tab_id: Id }>((a, b) => sb().from(T.accounts).select("id,tab_id").order("id").range(a, b))).map((r) => [r.id, r.tab_id]));
    const ex = new Set(exclude);
    keep = all.filter((l) => !ex.has(tabOf.get(l.src) ?? -1) && !ex.has(tabOf.get(l.dst) ?? -1) && (only == null || tabOf.get(l.src) === only || tabOf.get(l.dst) === only));
  }
  return keep.map((l) => ({ id: l.id, src: l.src, dst: l.dst, f: l.field_id }));
}

/* ───────── dữ liệu ───────── */
/** Số dòng từng tab (để hiện "+N" cho tab tải riêng chưa nạp). */
async function tabCounts(tabs: Id[]): Promise<Map<Id, number>> {
  if (!tabs.length) return new Map();
  const cnt = await orMissing(run<{ tab_id: Id; n: number }[]>(sb().rpc("ahs_tab_counts", { p_tabs: tabs })),
    () => Promise.all(tabs.map(async (tab_id) => ({ tab_id, n: (await sb().from(T.accounts).select("id", { count: "exact", head: true }).eq("tab_id", tab_id)).count ?? 0 }))));
  return new Map(cnt.map((r) => [Number(r.tab_id), Number(r.n)]));
}

/** Bộ đệm dòng + liên kết của /api/data (như DCACHE/data_cached của v7): khoá = (tab bỏ qua, ahs_ver.n) — trigger tăng ver mỗi lần ghi accounts/links.
 *  Đọc ver TRƯỚC dữ liệu → bản giữ lại không bao giờ cũ hơn khoá. Meta/thiết bị luôn đọc mới (ghi meta không tăng ver). */
let dcache: { key: string; accounts: Account[]; links: Link[] } | null = null;

/** dòng + liên kết cho /api/data. Chưa có hàm SQL: liên kết lọc theo chính các dòng vừa đọc (không phải quét lại id + tab của mọi dòng,
 *  kể cả hàng chục nghìn dòng của tab tải riêng như loadLinks) — đọc dòng và liên kết song song. */
async function dataRows(ex: Id[]): Promise<{ accounts: Account[]; links: Link[] }> {
  try {
    const [accounts, lt] = await Promise.all([loadAccounts(ex, null), run<string>(sb().rpc("ahs_links_json", { p_exclude_tabs: ex, p_only_tab: null }))]);
    return { accounts, links: parseJsonText<Link[]>(lt) };
  } catch (e) { if (!isMissing(e)) throw e; }
  const [accounts, all] = await Promise.all([loadAccounts(ex, null),
    pages<{ id: Id; src: Id; dst: Id; field_id: Id }>((a, b) => sb().from(T.links).select("id,src,dst,field_id").order("id").range(a, b))]);
  const ids = new Set(accounts.map((a) => a.id));
  return { accounts, links: all.filter((l) => ids.has(l.src) && ids.has(l.dst)).map((l) => ({ id: l.id, src: l.src, dst: l.dst, f: l.field_id })) };
}

/** /api/data — giống get_data_fast(): bỏ dòng của tab tải riêng chưa nạp (kèm số dòng để hiện "+N"). */
export async function getData(lz = ""): Promise<Snapshot> {
  const ts = safeTs();
  const [ex, ver] = await Promise.all([lazyExcl(lz),
    run<{ n: number } | null>(sb().from(T.ver).select("n").eq("id", 1).maybeSingle()).then((r) => (r ? Number(r.n) : -1), () => -1)]);   // -1: không đệm
  const key = ver >= 0 ? `${ex.join(",")}|${ver}` : "";
  const hit = key && dcache?.key === key ? dcache : null;
  const [meta, devices, rows, cnt] = await Promise.all([
    getMeta(), getDevices(),
    hit ?? dataRows(ex).then((r) => ({ key, ...r })),
    tabCounts(ex),
  ]);
  if (key) dcache = rows;
  for (const t of meta.tabs) if (ex.includes(t.id)) t.lazy_n = cnt.get(t.id) ?? 0;
  return { meta, devices, accounts: rows.accounts, links: rows.links, ts };
}

/** /api/tab_rows — nạp riêng một tab "tải riêng" + liên kết với các dòng đã nạp (bỏ liên kết sang tab tải riêng khác chưa nạp). */
export async function getTabRows(tab: Id, skip = ""): Promise<TabRows> {
  const sk = toIds(skip.split(",")).filter((x) => x !== tab);
  const [accounts, links] = await Promise.all([loadAccounts([], tab), loadLinks(sk, tab)]);
  return { accounts, links };
}

/** /api/tab_chunk — nạp tab "tải riêng" từng phần (dòng mới nhất trước) để bảng hiện ngay phần đầu, phần sau nạp tiếp.
 *  before = id nhỏ nhất của phần trước (0 = phần đầu); trả kèm mọi liên kết chạm các dòng của phần này (trình duyệt tự bỏ
 *  liên kết sang tab chưa nạp — phần sau / tab sau sẽ trả lại liên kết đó). next = con trỏ phần sau, null = hết. */
export async function tabChunk(tab: Id, before: number, n: number) {
  const lim = Math.min(20000, Math.max(200, Math.trunc(n) || 5000));
  const accounts = await pages<Account>((a, b) => {
    const q = sb().from(T.accounts).select(ACC_COLS).eq("tab_id", tab).order("id", { ascending: false }).range(a, b);
    return before > 0 ? q.lt("id", before) : q;
  }, lim);
  const links: Link[] = [], seen = new Set<Id>(), groups = chunks(accounts.map((a) => a.id), 300);
  type L = { id: Id; src: Id; dst: Id; field_id: Id };
  const got: L[][] = [];
  for (const wave of chunks(groups, 6)) got.push(...await Promise.all(wave.map((ch) => {
    const list = `(${ch.join(",")})`;
    return pages<L>((a, b) => sb().from(T.links).select("id,src,dst,field_id").or(`src.in.${list},dst.in.${list}`).order("id").range(a, b));
  })));
  for (const ch of got) for (const l of ch) if (!seen.has(l.id)) { seen.add(l.id); links.push({ id: l.id, src: l.src, dst: l.dst, f: l.field_id }); }
  // phần đầu: kèm tổng số dòng của tab (trình duyệt hiện tiến độ "đã về / tổng")
  const total = before > 0 ? null : ((await sb().from(T.accounts).select("id", { count: "exact", head: true }).eq("tab_id", tab)).count ?? null);
  return { accounts, links, next: accounts.length === lim ? accounts[accounts.length - 1].id : null, total };
}

/** Lùi 2 giây khi tính delta: dòng đang ghi dở đúng lúc tính (đã có updated nhưng chưa commit) không bao giờ bị sót; trùng thì trình duyệt gộp. */
const DELTA_OVERLAP = 2;
/** /api/delta — chỉ dòng đổi từ `since` + dòng đã xoá (tomb) + liên kết liên quan. */
export async function getDelta(since: number, lz = ""): Promise<Delta> {
  const ts = safeTs();
  const ex = await lazyExcl(lz);
  const [rows, meta, devices, tomb, gone] = await Promise.all([
    pages<Account>((a, b) => {
      const q = sb().from(T.accounts).select("*").gte("updated", since - DELTA_OVERLAP).order("id").range(a, b);
      return ex.length ? q.not("tab_id", "in", `(${ex.join(",")})`) : q;
    }, Infinity, 8),                                                                   // sửa hàng loạt nghìn dòng: 8 trang song song
    getMeta(), getDevices(),
    pages<{ id: Id }>((a, b) => sb().from(T.tomb).select("id").gte("ts", since - DELTA_OVERLAP).order("id").order("ts").range(a, b)),
    // dòng vừa đổi sang một tab "tải riêng" mà trình duyệt chưa nạp: báo như đã xoá khỏi trình duyệt
    // (không thì bản cũ vẫn nằm ở tab cũ; khi mở tab tải riêng đó, dòng sẽ về cùng tab)
    ex.length ? pages<{ id: Id }>((a, b) => sb().from(T.accounts).select("id").gte("updated", since - DELTA_OVERLAP).in("tab_id", ex).order("id").range(a, b)) : Promise.resolve([] as { id: Id }[]),
  ]);
  // đọc theo trang trong lúc có ghi: dòng có thể lặp (không bao giờ sót) → bỏ trùng
  const accounts = [...new Map(rows.map((r) => [r.id, r])).values()];
  const links: Link[] = [], seen = new Set<Id>();   // liên kết nối 2 dòng ở 2 lô khác nhau: v7 trả 2 lần, ở đây bỏ trùng
  for (const ch of await Promise.all(chunks(accounts.map((a) => a.id), 400).map((ch) => {
    const list = `(${ch.join(",")})`;
    return pages<{ id: Id; src: Id; dst: Id; field_id: Id }>((a, b) => sb().from(T.links).select("id,src,dst,field_id").or(`src.in.${list},dst.in.${list}`).order("id").range(a, b));
  }))) for (const l of ch) if (!seen.has(l.id)) { seen.add(l.id); links.push({ id: l.id, src: l.src, dst: l.dst, f: l.field_id }); }
  return { meta, devices, accounts, links, deleted: [...new Set([...tomb.map((r) => r.id), ...gone.map((r) => r.id)])], ts, delta: 1 };
}

/** Phiên bản dữ liệu (ahs_ver.n) — đổi khi bất kỳ máy nào ghi accounts/links. */
export async function dataVersion(): Promise<number> {
  const r = await run<{ n: number } | null>(sb().from(T.ver).select("n").eq("id", 1).maybeSingle());
  return Number(r?.n ?? 0);
}

/* ───────── lịch sử dòng (acc_hist) ───────── */
const HC: Array<[number, "data" | "status_id" | "owner_id" | "dept_id" | "note" | "device_id"]> = [[1, "data"], [2, "status_id"], [4, "owner_id"], [8, "dept_id"], [16, "note"], [32, "device_id"]];
type HistRow = { id: Id; acc_id: Id; ts: Epoch; k: string; m: number | null; data: string | null; status_id: Id | null; owner_id: Id | null; dept_id: Id | null; note: string | null; device_id: Id | null };
const HIST_DAYS = 180;
let lastPrune = 0;

const hjs = (s: unknown): Record<string, unknown> => {
  try { const d = typeof s === "string" ? JSON.parse(s || "{}") : s; return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {}; } catch { return {}; }
};
/** json.dumps(sort_keys=True): sắp khoá ở mọi tầng; thiếu = null */
const canon = (v: unknown): string => !v || typeof v !== "object" ? (JSON.stringify(v) ?? "null")
  : Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",")}}`;
function hdiff(col: string, a: unknown, b: unknown): HistChange[] {
  if (col !== "data") return [{ c: col, a, b }];
  const A = hjs(a), B = hjs(b), out: HistChange[] = [];
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort((x, y) => (/^\d+$/.test(x) ? +x : 0) - (/^\d+$/.test(y) ? +y : 0));
  for (const k of keys) if (canon(A[k]) !== canon(B[k])) out.push({ f: /^\d+$/.test(k) ? +k : k, a: A[k] ?? null, b: B[k] ?? null });
  return out;
}

export async function histDays(): Promise<number> {
  const v = Number(await getSetting("hist_days", String(HIST_DAYS)));   // Python: int(float(v or 0)) — "" = 0 (giữ vĩnh viễn), sai = 180
  return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : HIST_DAYS;
}
export async function histPrune() {
  lastPrune = Date.now();
  const d = await histDays();
  if (d) await run(sb().from(T.acc_hist).delete().lt("ts", now() - d * 86400));
}
export async function histInfo(): Promise<HistInfo> {
  const [{ count }, oldest, days, keepdel] = await Promise.all([
    sb().from(T.acc_hist).select("id", { count: "exact", head: true }),
    run<{ ts: Epoch } | null>(sb().from(T.acc_hist).select("ts").order("ts").limit(1).maybeSingle()),
    histDays(), getSetting("hist_keepdel", "0"),
  ]);
  return { days, keepdel: keepdel === "1", n: count ?? 0, oldest: oldest?.ts ?? null };
}

/** Toàn bộ lịch sử 1 dòng, mới nhất trước + mốc tạo. */
export async function histGet(aid: Id, limit = 400): Promise<{ items: HistItem[]; more?: boolean }> {
  const cur = await run<Account | null>(sb().from(T.accounts).select("*").eq("id", aid).maybeSingle());
  if (!cur) return { items: [] };
  const st: Record<string, unknown> = {}; for (const [, c] of HC) st[c] = cur[c];
  const out: HistItem[] = [];
  const rows = await run<HistRow[]>(sb().from(T.acc_hist).select("*").eq("acc_id", aid).order("id", { ascending: false }).limit(limit));
  for (const e of rows) {
    if (e.k === "l+" || e.k === "l-") { const x = hjs(e.data); out.push({ ts: e.ts, k: e.k, f: (x.f ?? null) as Id | null, t: (x.t ?? null) as Id | null }); continue; }
    const ch: HistChange[] = [];
    for (const [bit, c] of HC) if ((e.m ?? 0) & bit) { ch.push(...hdiff(c, e[c], st[c])); st[c] = e[c]; }
    if (ch.length) out.push({ ts: e.ts, k: "u", ch });
  }
  out.push({ ts: cur.created, k: "new" });
  return { items: out, more: out.length > limit };
}

/** Thay đổi gần nhất của nhiều dòng (cột Cập nhật). */
export async function histLast(rawIds: unknown): Promise<Record<Id, HistLast>> {
  const ids = toIds(rawIds).slice(0, 400);
  if (Date.now() - lastPrune > 86_400_000) { try { await histPrune(); } catch { /* dọn lịch sử: không chặn đọc */ } }
  if (!ids.length) return {};
  const cur = new Map((await run<Account[]>(sb().from(T.accounts).select("id,data,status_id,owner_id,dept_id,note,device_id").in("id", ids))).map((r) => [r.id, r]));
  // dòng lịch sử mới nhất của từng acc: đọc theo trang (mới trước) rồi giữ id lớn nhất (không có "max(id) group by" trong PostgREST).
  const rows = await pages<HistRow>((a, b) => sb().from(T.acc_hist).select("*").in("acc_id", ids).order("id", { ascending: false }).range(a, b));
  const out: Record<Id, HistLast> = {};
  for (const e of rows) {
    if (out[e.acc_id]) continue;
    const r = cur.get(e.acc_id); if (!r) continue;
    if (e.k === "l+" || e.k === "l-") { const x = hjs(e.data); out[e.acc_id] = { ts: e.ts, k: e.k, f: (x.f ?? null) as Id | null, t: (x.t ?? null) as Id | null }; continue; }
    const ch: HistChange[] = [];
    for (const [bit, c] of HC) if ((e.m ?? 0) & bit) ch.push(...hdiff(c, e[c], r[c]));
    out[e.acc_id] = { ts: e.ts, k: "u", ch: ch.slice(0, 3), n: ch.length };
  }
  return out;
}

/* ───────── nhật ký · kiểm tra · thống kê ───────── */
export async function getLogs(qs: string, limit: number | string): Promise<{ rows: LogRow[] }> {
  const lim = Math.max(1, Math.min(parseInt(String(limit || 300), 10) || 300, 5000));
  const like = `%${qs || ""}%`;
  const rows = await pages<LogRow>((a, b) => sb().from(T.logs).select("*").or(`act.ilike.${esc(like)},detail.ilike.${esc(like)}`).order("id", { ascending: false }).range(a, b), lim);
  return { rows };
}
/** giá trị trong bộ lọc PostgREST: bọc dấu nháy kép (thoát \ và ") để dấu phẩy/ngoặc không phá cú pháp. */
const esc = (v: string) => `"${v.replace(/[\\"]/g, "\\$&")}"`;

export const checkDb = () => orMissing(run<DbCheck>(sb().rpc("ahs_check_db")),
  (): DbCheck => ({ integrity: "chưa chạy SQL hs_accountshs", orphan_links: 0, cross_links: 0, bad_tab: 0, bad_status: 0, bad_owner: 0, bad_device: 0 }));
export const dbSize = () => orMissing(run<number>(sb().rpc("ahs_db_size")).then((n) => Number(n) || 0), () => 0);

/** ov_lazy: Tổng quan đếm cả tab "tải riêng" chưa nạp về trình duyệt — số đếm gom theo tab/bộ phận/owner/tình trạng
 *  (n = tổng, nn = tạo mới trong [since, until)). Có hàm SQL thì gom trong Postgres; chưa có thì đọc theo trang. Đệm theo ahs_ver. */
type OvRow = [Id, Id, Id | null, Id | null, number, number];
const OVL = new Map<string, Promise<OvRow[]>>();
export async function ovLazy(tabs: Id[], since: number, until: number): Promise<{ rows: OvRow[] }> {
  if (!tabs.length) return { rows: [] };
  const k = [await dataVersion(), tabs.join(","), since, until].join("|");
  if (!OVL.has(k)) {
    if (OVL.size > 20) OVL.clear();
    OVL.set(k, (async (): Promise<OvRow[]> => {
      try {
        const r = await run<Array<{ t: Id; d: Id; o: Id | null; s: Id | null; n: number; nn: number }>>(sb().rpc("ahs_ov_counts", { p_tabs: tabs, p_since: since, p_until: until }));
        return r.map((x) => [Number(x.t), Number(x.d), x.o == null ? null : Number(x.o), x.s == null ? null : Number(x.s), Number(x.n), Number(x.nn)]);
      } catch (e) { if (!isMissing(e)) throw e; }
      const g = new Map<string, OvRow>();
      const rs = await pages<{ tab_id: Id; dept_id: Id; owner_id: Id | null; status_id: Id | null; created: number | null }>((a, b) =>
        sb().from(T.accounts).select("tab_id,dept_id,owner_id,status_id,created").in("tab_id", tabs).order("id").range(a, b));
      for (const r of rs) {
        const key = `${r.tab_id}|${r.dept_id}|${r.owner_id}|${r.status_id}`;
        const x = g.get(key) ?? g.set(key, [r.tab_id, r.dept_id, r.owner_id, r.status_id, 0, 0]).get(key)!;
        x[4]++; if (r.created != null && r.created >= since && r.created < until) x[5]++;
      }
      return [...g.values()];
    })().catch((e) => { OVL.delete(k); throw e; }));
  }
  return { rows: await OVL.get(k)! };
}

/** ov_trend: dòng đã xoá trong khoảng (thống kê tăng/giảm của Tổng quan). */
export async function ovTrend(since?: number) {
  const s = Number(since) || now() - 31 * 86400;
  const del = await pages<{ tab_id: Id; dept_id: Id; owner_id: Id | null; ts: Epoch }>((a, b) => sb().from(T.tomb).select("tab_id,dept_id,owner_id,ts").gte("ts", s).not("tab_id", "is", null).order("ts").order("id").range(a, b));
  return { ts: now(), del };
}

/** migrate() của v7.py: dọn lịch sử quá hạn + tomb > 400 ngày + cài mặc định. */
export async function maintain() {
  await histPrune();
  await run(sb().from(T.tomb).delete().lt("ts", now() - 400 * 86400));
  await run(sb().from(T.settings).upsert([{ k: "owner_color_neutral_v1", v: "1" }, { k: "tab_color_neutral_v1", v: "1" }], { onConflict: "k", ignoreDuplicates: true }));
}
/** Gọi maintain() 1 lần cho mỗi tiến trình (lười, lần đọc đầu tiên). Định kỳ: /api/hs/accountshs/internal/tick. */
let migrated: Promise<void> | null = null;
export function ensureMaintained() {
  return (migrated ??= maintain().catch((e) => { migrated = null; throw e; }));
}
