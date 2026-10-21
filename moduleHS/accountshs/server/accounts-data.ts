import "server-only";

import { T, allOrdered, chunks, getJsonSetting, getSetting, isMissing, now, orMissing, run, sb, parseDevice, toIds } from "./db";
import type { Account, DbCheck, Delta, Device, Epoch, Field, HistChange, HistInfo, HistItem, HistLast, Id, Link, LogRow, Meta, Snapshot, Status, Tab, TabRows } from "../types";

/* ───────── meta ───────── */
export async function getMeta(): Promise<Meta> {
  const [tabs, fields, statuses, depts, owners, grp_icons, tab_keys] = await Promise.all([
    allOrdered<Omit<Tab, "fields" | "statuses">>("tabs"), allOrdered<Field>("fields"), allOrdered<Status>("statuses"),
    allOrdered<Meta["depts"][number]>("depts"), allOrdered<Meta["owners"][number]>("owners"),
    getJsonSetting<Record<string, string>>("grp_icons", {}), getJsonSetting<Record<string, Id[]>>("tab_keys", {}),
  ]);
  const fs = new Map<Id, Field[]>(), ss = new Map<Id, Status[]>();
  for (const f of fields) (fs.get(f.tab_id) ?? fs.set(f.tab_id, []).get(f.tab_id)!).push(f);
  for (const s of statuses) (ss.get(s.tab_id) ?? ss.set(s.tab_id, []).get(s.tab_id)!).push(s);
  return { depts, owners, tabs: tabs.map((t) => ({ ...t, fields: fs.get(t.id) ?? [], statuses: ss.get(t.id) ?? [] })), grp_icons, tab_keys };
}

export async function getDevices(): Promise<Device[]> {
  return (await allOrdered<Parameters<typeof parseDevice>[0]>("devices")).map(parseDevice);
}

export async function firstField(tabId: Id): Promise<Id | null> {
  const r = await run<{ id: Id } | null>(sb().from(T.fields).select("id").eq("tab_id", tabId).order("pos").order("id").limit(1).maybeSingle());
  return r?.id ?? null;
}
export async function firstStatus(tabId: Id): Promise<Id | null> {
  const r = await run<{ id: Id } | null>(sb().from(T.statuses).select("id").eq("tab_id", tabId).order("pos").order("id").limit(1).maybeSingle());
  return r?.id ?? null;
}

/** Id các tab "tải riêng" (lazy=1) mà trình duyệt CHƯA nạp (lz = danh sách tab đã nạp, cách nhau dấu phẩy). */
async function lazyExcl(lz = ""): Promise<Id[]> {
  const have = new Set(toIds(lz.split(",")));
  const rows = await run<{ id: Id }[]>(sb().from(T.tabs).select("id").eq("lazy", 1));
  return rows.map((r) => r.id).filter((id) => !have.has(id));
}

const parseJsonText = <R>(t: string | null | undefined): R => JSON.parse(t || "[]") as R;
const PAGE = 1000;
/** đọc hết theo trang (PostgREST giới hạn số dòng mỗi lần) */
async function pages<R>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<R[]> {
  const out: R[] = [];
  for (let from = 0; ; from += PAGE) { const rows = await run<R[]>(q(from, from + PAGE - 1)); out.push(...rows); if (rows.length < PAGE) break; }
  return out;
}
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
/** /api/data — giống get_data_fast(): bỏ dòng của tab tải riêng chưa nạp (kèm số dòng để hiện "+N"). */
export async function getData(lz = ""): Promise<Snapshot> {
  const ts = now();
  const ex = await lazyExcl(lz);
  const [meta, devices, accounts, links] = await Promise.all([getMeta(), getDevices(), loadAccounts(ex, null), loadLinks(ex, null)]);
  if (ex.length) {
    const cnt = await orMissing(run<{ tab_id: Id; n: number }[]>(sb().rpc("ahs_tab_counts", { p_tabs: ex })),
      () => Promise.all(ex.map(async (tab_id) => ({ tab_id, n: (await sb().from(T.accounts).select("id", { count: "exact", head: true }).eq("tab_id", tab_id)).count ?? 0 }))));
    const m = new Map(cnt.map((r) => [r.tab_id, Number(r.n)]));
    for (const t of meta.tabs) if (ex.includes(t.id)) t.lazy_n = m.get(t.id) ?? 0;
  }
  return { meta, devices, accounts, links, ts };
}

/** /api/tab_rows — nạp riêng một tab "tải riêng" + liên kết với các dòng đã nạp (bỏ liên kết sang tab tải riêng khác chưa nạp). */
export async function getTabRows(tab: Id, skip = ""): Promise<TabRows> {
  const sk = toIds(skip.split(",")).filter((x) => x !== tab);
  const [accounts, links] = await Promise.all([loadAccounts([], tab), loadLinks(sk, tab)]);
  return { accounts, links };
}

/** /api/delta — chỉ dòng đổi từ `since` + dòng đã xoá (tomb) + liên kết liên quan. */
export async function getDelta(since: number, lz = ""): Promise<Delta> {
  const ts = now();
  const ex = await lazyExcl(lz);
  let q = sb().from(T.accounts).select("*").gte("updated", since - 0.01);
  if (ex.length) q = q.not("tab_id", "in", `(${ex.join(",")})`);
  const [accounts, meta, devices, tomb] = await Promise.all([
    run<Account[]>(q), getMeta(), getDevices(),
    run<{ id: Id }[]>(sb().from(T.tomb).select("id").gte("ts", since - 0.01)),
  ]);
  const ids = accounts.map((a) => a.id);
  const links: Link[] = [];
  for (const ch of chunks(ids, 400)) {
    const list = `(${ch.join(",")})`;
    const rows = await run<{ id: Id; src: Id; dst: Id; field_id: Id }[]>(sb().from(T.links).select("id,src,dst,field_id").or(`src.in.${list},dst.in.${list}`));
    for (const l of rows) links.push({ id: l.id, src: l.src, dst: l.dst, f: l.field_id });
  }
  return { meta, devices, accounts, links, deleted: [...new Set(tomb.map((r) => r.id))], ts, delta: 1 };
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
const canon = (v: unknown) => JSON.stringify(v, v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as object).sort() : undefined);
function hdiff(col: string, a: unknown, b: unknown): HistChange[] {
  if (col !== "data") return [{ c: col, a, b }];
  const A = hjs(a), B = hjs(b), out: HistChange[] = [];
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort((x, y) => (/^\d+$/.test(x) ? +x : 0) - (/^\d+$/.test(y) ? +y : 0));
  for (const k of keys) if (canon(A[k]) !== canon(B[k])) out.push({ f: /^\d+$/.test(k) ? +k : k, a: A[k], b: B[k] });
  return out;
}

export async function histDays(): Promise<number> {
  const v = parseFloat(await getSetting("hist_days", String(HIST_DAYS)));
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
    if (e.k === "l+" || e.k === "l-") { const x = hjs(e.data); out.push({ ts: e.ts, k: e.k, f: x.f as Id, t: x.t as Id }); continue; }
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
  // dòng lịch sử mới nhất của từng acc: lấy theo lô rồi giữ id lớn nhất (không có "max(id) group by" trong PostgREST).
  const rows = await run<HistRow[]>(sb().from(T.acc_hist).select("*").in("acc_id", ids).order("id", { ascending: false }));
  const out: Record<Id, HistLast> = {};
  for (const e of rows) {
    if (out[e.acc_id]) continue;
    const r = cur.get(e.acc_id); if (!r) continue;
    if (e.k === "l+" || e.k === "l-") { const x = hjs(e.data); out[e.acc_id] = { ts: e.ts, k: e.k, f: x.f as Id, t: x.t as Id }; continue; }
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
  const rows = await run<LogRow[]>(sb().from(T.logs).select("*").or(`act.ilike.${esc(like)},detail.ilike.${esc(like)}`).order("id", { ascending: false }).limit(lim));
  return { rows };
}
/** giá trị trong bộ lọc PostgREST: bọc dấu nháy kép để dấu phẩy/ngoặc không phá cú pháp. */
const esc = (v: string) => `"${v.replace(/"/g, '\\"')}"`;

export const checkDb = () => orMissing(run<DbCheck>(sb().rpc("ahs_check_db")),
  (): DbCheck => ({ integrity: "chưa có migration 121", orphan_links: 0, cross_links: 0, bad_tab: 0, bad_status: 0, bad_owner: 0, bad_device: 0 }));
export const dbSize = () => orMissing(run<number>(sb().rpc("ahs_db_size")).then((n) => Number(n) || 0), () => 0);

/** ov_trend: dòng đã xoá trong khoảng (thống kê tăng/giảm của Tổng quan). */
export async function ovTrend(since?: number) {
  const s = Number(since) || now() - 31 * 86400;
  const del = await run<{ tab_id: Id; dept_id: Id; owner_id: Id | null; ts: Epoch }[]>(sb().from(T.tomb).select("tab_id,dept_id,owner_id,ts").gte("ts", s).not("tab_id", "is", null));
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
