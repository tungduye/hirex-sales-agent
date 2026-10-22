import "server-only";

import { Conflict, HsError, PAGE, T, bumpVer, chunks, getJsonSetting, isMissing, j, now, pages, run, sb, setSetting, toIds } from "./db";
import { checkDb, firstField, firstStatus, histInfo, histPrune } from "./accounts-data";
import { snapshot } from "./backup";
import type { Account, BulkBody, BulkLinkItem, BulkReport, BulkRow, Epoch, Field, HistInfo, Id, MetaTable } from "../types";

/* Các hàm ghi của v7.py (ROUTES) — giữ nguyên tên, tham số và kết quả trả về để client không đổi.
   Khác Python: không có LOCK toàn cục / transaction; mỗi thao tác là chuỗi lệnh PostgREST (đọc theo trang 1000 dòng = max_rows).
   Lỗi kiểm tra (ValueError của Python) → HTTP 500 {error}, Conflict → 409 như bản gốc. */

type Body = Record<string, unknown>;
type LinkRow = { src: Id; dst: Id; field_id: Id };
type Patch = Record<string, unknown>;
const num = (v: unknown): Id | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** Python `x or None` */
const idOr = (v: unknown): Id | null => num(v) || null;
const str = (v: unknown, d = "") => (v === null || v === undefined ? d : String(v));
const dataOf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bad = (m: string) => new HsError(m, 500);
const KINDS = ["phone", "pc", "boxphone"];
/** chạy fn cho từng phần tử, tối đa n lệnh song song */
async function pool<X>(xs: X[], fn: (x: X) => Promise<unknown>, n = 8) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) await fn(xs[i++]); }));
}
const idsWhere = async (t: "accounts" | "devices", col: string, val: Id) =>
  (await pages<{ id: Id }>((a, z) => sb().from(T[t]).select("id").eq(col, val).order("id").range(a, z))).map((r) => r.id);
const PCOLS = new Set(["data", "note", "status_id", "owner_id", "dept_id", "device_id", "updated"]);
/** DB chưa có hàm SQL → dùng đường dự phòng; 10 phút sau thử lại (chạy SQL xong không cần khởi động lại máy chủ). */
let noPatchAt = 0;
const noPatchFn = () => Date.now() - noPatchAt < 600_000;
/** ghi patch từng dòng: các dòng cùng một patch gộp thành 1 lệnh (≤ 500 id);
 *  patch lẻ (mỗi dòng một khác) gửi theo lô 500 qua ahs_patch_accounts, chưa có hàm thì upsert theo lô (upsertPatches). */
async function updateIds(ps: Map<Id, Patch>) {
  const g = new Map<string, Id[]>();
  for (const [i, p] of ps) { const k = j(p); (g.get(k) ?? g.set(k, []).get(k)!).push(i); }
  const one: Patch[] = [], jobs: Array<readonly [Patch, Id[]]> = [];
  for (const [k, ids] of g) {
    const p = JSON.parse(k) as Patch;
    if (ids.length === 1 && Object.keys(p).every((c) => PCOLS.has(c))) one.push({ ...p, id: ids[0] });
    else for (const ch of chunks(ids, 500)) jobs.push([p, ch]);
  }
  const left: Patch[] = [];
  for (const ch of chunks(one, 500)) {
    if (noPatchFn()) { left.push(...ch); continue; }
    try { await run(sb().rpc("ahs_patch_accounts", { p_rows: ch })); }
    catch (e) {
      if (!isMissing(e)) throw e;
      noPatchAt = Date.now(); left.push(...ch);
    }
  }
  await pool(jobs, ([p, ch]) => run(sb().from(T.accounts).update(p).in("id", ch)));
  if (left.length) await upsertPatches(left);
}
/** Chưa có hàm SQL ahs_patch_accounts: thay vì 1 lệnh / dòng (19.000 dòng = 19.000 lượt), đọc dòng hiện tại theo lô 500,
 *  gộp patch rồi ghi đè cả lô bằng 1 lệnh upsert (trigger lịch sử vẫn chạy như UPDATE). Dòng bị xoá trong lúc đó
 *  (có trong ahs_tomb sau lúc đọc) thì xoá lại → không bao giờ "hồi sinh" dòng đã xoá. */
async function upsertPatches(list: Patch[]) {
  const cols = "id,tab_id,dept_id,owner_id,status_id,device_id,note,data,created,updated";
  await pool(chunks(list, 500), async (ch) => {
    const ids = ch.map((p) => Number(p.id)), t0 = now();
    const cur = new Map((await run<Account[]>(sb().from(T.accounts).select(cols).in("id", ids))).map((r) => [r.id, r]));
    const rows = ch.filter((p) => cur.has(Number(p.id))).map((p) => ({ ...cur.get(Number(p.id))!, ...p }));
    if (!rows.length) return;
    await run(sb().from(T.accounts).upsert(rows, { onConflict: "id" }));
    const gone = (await run<{ id: Id }[]>(sb().from(T.tomb).select("id").in("id", rows.map((r) => r.id)).gte("ts", t0 - 1))).map((r) => r.id);
    if (gone.length) await run(sb().from(T.accounts).delete().in("id", gone));
  }, 4);
}

/* ───────── ghi hàng loạt nhanh: rows_set / mass_set ─────────
   Mỗi dòng một "bản vá": set = trường → giá trị, del = trường cần xoá trống, note / note_add (nối thêm), status_id, owner_id + dept_id, device_id.
   Luật như bản gốc: chỉ nhận trường thuộc đúng tab của dòng (không phải liên kết / file); trạng thái phải thuộc tab của dòng (khác tab thì giữ nguyên).
   · Có hàm SQL ahs_rows_merge: Postgres tự vá ngay trên dòng — không đọc dòng về, 1 lệnh / 2.500 dòng, 4 lệnh song song (19.633 dòng ≈ vài giây).
   · Chưa có hàm: đọc dòng theo lô 1.000 (6 lô song song), vá ở đây, ghi đè cả lô bằng 1 lệnh upsert; dòng bị xoá trong lúc đó không bao giờ "sống lại".
   Trigger lịch sử (ahs_acc_hist) giữ bản cũ của mọi dòng đổi trong cả 2 cách. updated = lúc ghi từng lô. */
type MergeItem = { id: Id; set?: Record<string, string>; del?: string[]; note?: string; note_add?: string; status_id?: Id | null; owner_id?: Id | null; dept_id?: Id; device_id?: Id | null };
let noMergeAt = 0;
async function mergeWrite(items: MergeItem[]): Promise<number> {
  if (!items.length) return 0;
  if (Date.now() - noMergeAt > 600_000) {
    const parts = chunks(items, 2500);
    let n = 0, first = true;
    try {
      // lô đầu chạy 1 mình: DB chưa có hàm thì biết ngay, chưa ghi gì
      n += Number(await run(sb().rpc("ahs_rows_merge", { p_items: parts[0], p_ts: now() }))) || 0; first = false;
      await pool(parts.slice(1), async (ch) => { n += Number(await run(sb().rpc("ahs_rows_merge", { p_items: ch, p_ts: now() }))) || 0; }, 4);
      return n;
    } catch (e) { if (!first || !isMissing(e)) throw e; noMergeAt = Date.now(); }
  }
  return mergeFallback(items);
}
async function mergeFallback(items: MergeItem[]): Promise<number> {
  const [fs, sts] = await Promise.all([
    pages<{ id: Id; tab_id: Id; type: string }>((a, z) => sb().from(T.fields).select("id,tab_id,type").order("id").range(a, z)),
    pages<{ id: Id; tab_id: Id }>((a, z) => sb().from(T.statuses).select("id,tab_id").order("id").range(a, z)),
  ]);
  const fTab = new Map(fs.filter((f) => f.type !== "link" && f.type !== "file").map((f) => [String(f.id), f.tab_id])), stTab = new Map(sts.map((x) => [x.id, x.tab_id]));
  const cols = "id,tab_id,dept_id,owner_id,status_id,device_id,note,data,created,updated";
  let n = 0;
  await pool(chunks(items, PAGE), async (ch) => {
    const cur = new Map((await run<Account[]>(sb().from(T.accounts).select(cols).in("id", ch.map((x) => x.id)))).map((r) => [r.id, r]));
    const rows: Account[] = [];
    for (const it of ch) {
      const r = cur.get(it.id); if (!r) continue;
      const o = { ...r } as Account & Record<string, unknown>;
      if (it.set || it.del) {
        const d: Record<string, unknown> = { ...dataOf(r.data) };
        for (const [k, v] of Object.entries(it.set ?? {})) if (fTab.get(k) === r.tab_id) d[k] = v;
        for (const k of it.del ?? []) if (fTab.get(k) === r.tab_id) delete d[k];
        o.data = d as Account["data"];
      }
      if (it.note !== undefined) o.note = it.note;
      if (it.note_add !== undefined) o.note = (r.note ? r.note + "\n" : "") + it.note_add;
      if (it.status_id !== undefined && (it.status_id === null || stTab.get(it.status_id) === r.tab_id)) o.status_id = it.status_id;
      if (it.owner_id !== undefined) o.owner_id = it.owner_id;
      if (it.dept_id !== undefined) o.dept_id = it.dept_id;
      if (it.device_id !== undefined) o.device_id = it.device_id;
      rows.push(o);
    }
    if (!rows.length) return;
    const t0 = now();
    for (const r of rows) r.updated = t0;
    await run(sb().from(T.accounts).upsert(rows, { onConflict: "id" }));
    const gone = (await run<{ id: Id }[]>(sb().from(T.tomb).select("id").in("id", rows.map((r) => r.id)).gte("ts", t0 - 60))).map((r) => r.id);
    if (gone.length) await run(sb().from(T.accounts).delete().in("id", gone));
    n += rows.length - gone.length;
  }, 6);
  return n;
}

async function exists(t: keyof typeof T, id: Id | null): Promise<boolean> {
  if (!id) return false;
  return Boolean(await run(sb().from(T[t]).select("id").eq("id", id).maybeSingle()));
}
/** coalesce(max(pos),0)+1 */
async function nextPos(t: keyof typeof T, where?: { col: string; val: Id | null }): Promise<number> {
  let q = sb().from(T[t]).select("pos").not("pos", "is", null).order("pos", { ascending: false }).limit(1);
  if (where) q = q.eq(where.col, where.val ?? -1);
  const r = await run<{ pos: number } | null>(q.maybeSingle());
  return (r?.pos ?? 0) + 1;
}
async function insertId(t: keyof typeof T, row: Record<string, unknown>): Promise<Id> {
  const r = await run<{ id: Id }>(sb().from(T[t]).insert(row).select("id").single());
  return r.id;
}
/** insert or ignore into links → số liên kết thật sự thêm */
async function addLinks(rows: LinkRow[]): Promise<number> {
  let n = 0;
  for (const ch of chunks(rows, 500)) n += (await run<{ id: Id }[]>(sb().from(T.links).upsert(ch, { onConflict: "src,dst,field_id", ignoreDuplicates: true }).select("id"))).length;
  return n;
}
/** dòng thuộc tab có trạng thái sid (1 truy vấn / 900 dòng) */
async function idsWithStatusTab(ids: Id[], sid: Id): Promise<Set<Id>> {
  const st = await run<{ tab_id: Id } | null>(sb().from(T.statuses).select("tab_id").eq("id", sid).maybeSingle());
  const ok = new Set<Id>();
  if (!st) return ok;
  for (const ch of chunks(ids, 900)) for (const r of await run<{ id: Id }[]>(sb().from(T.accounts).select("id").eq("tab_id", st.tab_id).in("id", ch))) ok.add(r.id);
  return ok;
}

/* ───────── tài khoản ───────── */
export async function saveAccount(b: Body) {
  const ts = now();
  const tabId = num(b.tab_id);
  let aid = num(b.id);
  // kiểm tab + đọc dòng hiện tại + đọc trường liên kết: độc lập → 1 lượt mạng thay vì 3
  const [tabOk, cur0, fl0] = await Promise.all([
    exists("tabs", tabId),
    aid ? run<{ updated: Epoch; tab_id: Id } | null>(sb().from(T.accounts).select("updated,tab_id").eq("id", aid).maybeSingle()) : Promise.resolve(null),
    "links" in b ? run<{ id: Id; link_tab: Id | null }[]>(sb().from(T.fields).select("id,link_tab").eq("tab_id", tabId!)) : Promise.resolve([] as { id: Id; link_tab: Id | null }[]),
  ]);
  if (!tabOk) throw bad("Tab không tồn tại");
  const row = { tab_id: tabId, dept_id: num(b.dept_id), owner_id: num(b.owner_id), status_id: num(b.status_id), device_id: num(b.device_id), note: str(b.note), data: dataOf(b.data), updated: ts };
  if (aid) {
    const cur = cur0;
    if (!cur) throw bad("Dòng này không còn tồn tại");
    if (b.ver && Math.abs(Number(cur.updated) - Number(b.ver)) > 0.001) throw new Conflict("Dữ liệu đã được thay đổi ở nơi khác - đã tải lại");
    await run(sb().from(T.accounts).update(row).eq("id", aid));
  } else aid = await insertId("accounts", { ...row, created: ts });
  if ("links" in b) {
    const fl = new Map(fl0.map((f) => [f.id, f.link_tab]));
    await run(sb().from(T.links).delete().eq("src", aid));
    const want: LinkRow[] = [], seen = new Set<string>();
    for (const [fid, ids] of Object.entries(dataOf(b.links))) {
      const lt = fl.get(Number(fid)); if (!lt) continue;
      for (const ch of chunks(toIds(ids).filter((d) => d !== aid), PAGE)) {
        const ok = new Set((await run<{ id: Id }[]>(sb().from(T.accounts).select("id").in("id", ch).eq("tab_id", lt))).map((r) => r.id));
        for (const d of ch) if (ok.has(d) && !seen.has(`${fid},${d}`)) { seen.add(`${fid},${d}`); want.push({ src: aid, dst: d, field_id: Number(fid) }); }   // giữ thứ tự người dùng chọn
      }
    }
    await addLinks(want);
  }
  return { id: aid };
}

export async function statusSet(b: Body) {
  const ts = now(), sid = num(b.status_id);
  if (sid && !(await exists("statuses", sid))) throw bad("Trạng thái không tồn tại");
  let ids = toIds(b.ids);
  if (sid) { const ok = await idsWithStatusTab(ids, sid); ids = ids.filter((i) => ok.has(i)); }
  await pool(chunks(ids, 1000), (ch) => run(sb().from(T.accounts).update({ status_id: sid, updated: ts }).in("id", ch)), 6);
  return { ok: 1 };
}

export async function deviceSet(b: Body) {
  const ts = now(), dv = num(b.device_id);
  if (dv && !(await exists("devices", dv))) throw bad("Thiết bị không tồn tại");
  await pool(chunks(toIds(b.ids), 1000), (ch) => run(sb().from(T.accounts).update({ device_id: dv, updated: ts }).in("id", ch)), 6);
  return { ok: 1 };
}

const capsOf = (v: unknown) => {
  const caps: Record<string, number> = {};
  for (const [k, x] of Object.entries(dataOf(v))) if (Math.trunc(Number(x)) > 0) caps[String(k)] = Math.trunc(Number(x));
  return j(caps);
};
export async function deviceBulk(b: Body) {
  const ts = now(), pos = await nextPos("devices");
  const rows: Record<string, unknown>[] = [];
  for (const r of (Array.isArray(b.rows) ? b.rows : []) as Body[]) {
    const nm = str(r.name).trim(); if (!nm) continue;
    let kind = str(r.kind || b.kind || "phone"); if (!KINDS.includes(kind)) kind = "phone";
    rows.push({ dept_id: num(b.dept_id), owner_id: num(b.owner_id), name: nm, kind, serial: str(r.serial || ""), caps: capsOf(b.caps), note: "", pos: pos + rows.length, created: ts });
  }
  for (const ch of chunks(rows, 500)) await run(sb().from(T.devices).insert(ch));
  if (rows.length) await bumpVer();
  return { created: rows.length };
}

/** owner_id → owner + bộ phận của owner đó; chỉ dept_id → về bộ phận, bỏ owner. */
export async function ownerSet(b: Body) {
  const ts = now(), o = num(b.owner_id); let dp = num(b.dept_id);
  const dept = o ? await run<{ dept_id: Id } | null>(sb().from(T.owners).select("dept_id").eq("id", o).maybeSingle()) : null;
  if (dp && !(await exists("depts", dp))) dp = null;
  const patch = dept ? { owner_id: o, dept_id: dept.dept_id, updated: ts } : dp ? { owner_id: null, dept_id: dp, updated: ts } : { owner_id: null, updated: ts };
  await pool(chunks(toIds(b.ids), 1000), (ch) => run(sb().from(T.accounts).update(patch).in("id", ch)), 6);
  return { ok: 1 };
}

/** Cập nhật hàng loạt: trường, trạng thái, owner, ghi chú, thiết bị cho nhiều tài khoản. */
export async function massSet(b: Body) {
  const ids = toIds(b.ids), sid = num(b.status_id), oid = num(b.owner_id);
  const base: Omit<MergeItem, "id"> = {};
  for (const [k, v] of Object.entries(dataOf(b.data))) {
    if (v === "" || v === null || v === undefined) (base.del ??= []).push(String(k)); else (base.set ??= {})[String(k)] = String(v);
  }
  if (b.note !== null && b.note !== undefined) { if (b.note_mode !== "append") base.note = str(b.note); else base.note_add = str(b.note); }
  if (b.set_device) base.device_id = num(b.device_id);
  if (sid) base.status_id = sid;                                                     // chỉ dòng có tab chứa trạng thái này
  if (b.set_owner) {
    base.owner_id = oid;
    const od = oid ? await run<{ dept_id: Id } | null>(sb().from(T.owners).select("dept_id").eq("id", oid).maybeSingle()) : null;
    const nd = od ? od.dept_id : num(b.dept_id); if (nd) base.dept_id = nd;          // owner thuộc bộ phận nào thì dòng chuyển sang bộ phận đó
  }
  return { ok: await mergeWrite(ids.map((id) => ({ id, ...base }))) };
}

export async function delAccountIds(raw: unknown) {
  const ids = toIds(raw), ts = now();
  for (const ch of chunks(ids, 500)) {
    const list = `(${ch.join(",")})`;
    await run(sb().from(T.links).delete().or(`src.in.${list},dst.in.${list}`));
    const rows = await run<{ id: Id; tab_id: Id; dept_id: Id; owner_id: Id | null }[]>(sb().from(T.accounts).select("id,tab_id,dept_id,owner_id").in("id", ch));
    if (rows.length) await run(sb().from(T.tomb).insert(rows.map((r) => ({ id: r.id, ts, tab_id: r.tab_id, dept_id: r.dept_id, owner_id: r.owner_id }))));
    await run(sb().from(T.accounts).delete().in("id", ch));
  }
}
export async function deleteAccounts(b: Body) { await delAccountIds(b.ids); return { ok: 1 }; }

export async function quick(b: Body) {
  const ts = now(), t = num(b.tab_id)!;
  const [p, s] = await Promise.all([firstField(t), firstStatus(t)]);
  const id = await insertId("accounts", { tab_id: t, dept_id: num(b.dept_id), owner_id: num(b.owner_id), status_id: s, note: "", data: { [String(p)]: str(b.text) }, created: ts, updated: ts });
  return { id };
}

/* ───────── nhập hàng loạt (bulk2) ───────── */
/** phiên nhập nhiều lượt (sid): chỉ mục khoá → id giữ giữa các lượt; chk = khoá đã hỏi DB */
const BKC: { sid: string | null; t: number; idx: Map<string, Map<string, Id>>; chk: Map<string, Set<string>> } = { sid: null, t: 0, idx: new Map(), chk: new Map() };
const bkReset = () => { BKC.sid = null; BKC.idx = new Map(); BKC.chk = new Map(); };
const kk = (d: Record<string, string>, fs: string[]) => { const p = fs.map((f) => String(d[f] ?? "").trim().toLowerCase()); return p.some(Boolean) ? p.join("\x1f") : ""; };

/** Postgres: id (nhỏ nhất) của các khoá trong tab (hàm ahs_key_lookup, ≤ 1000 khoá / lần vì max_rows). */
async function keyLookup(tab: Id, fids: string[], keys: Iterable<string>): Promise<Map<string, Id>> {
  const out = new Map<string, Id>();
  const ks = [...new Set([...keys].filter(Boolean))].sort();
  if (!ks.length) return out;
  try {
    await pool(chunks(ks, PAGE), async (ch) => {
      for (const r of await run<{ k: string; id: Id }[]>(sb().rpc("ahs_key_lookup", { p_tab: tab, p_fields: fids.map(Number), p_keys: ch }))) out.set(r.k, r.id);
    }, 4);
    return out;
  } catch (e) { if (!isMissing(e)) throw e; }
  // chưa có migration: đọc dòng của tab theo trang, tính khoá giống hàm SQL (strip khoảng trắng + chữ thường, nối chr(31), id nhỏ nhất)
  const want = new Set(ks), ws = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;
  for (const r of await pages<{ id: Id; data: Record<string, unknown> }>((a, z) => sb().from(T.accounts).select("id,data").eq("tab_id", tab).order("id").range(a, z))) {
    const k = fids.map((f) => String(r.data?.[String(f)] ?? "").replace(ws, "").toLowerCase()).join("\x1f");
    if (want.has(k) && !out.has(k)) out.set(k, r.id);
  }
  return out;
}

/** Nhập / cập nhật hàng loạt có kiểm soát toàn vẹn. mode: skip · fill · update · add. dry=true: chỉ báo cáo, không ghi.
 *  rows[].links[fid] = [text | {k, a: {field_id đích: giá trị}}]. Dòng mới mang id tạm (< 0) trong lúc duyệt; cuối cùng mới chèn
 *  theo lô (id tăng đúng thứ tự dòng như Python), dòng có sẵn gộp thay đổi rồi ghi 1 lần → dry và ghi thật đi cùng một đường. */
export async function bulk2(b0: Body) {
  const b = b0 as unknown as BulkBody;
  const tab = Number(b.tab_id), dept = Number(b.dept_id), owner = num(b.owner_id), sid = num(b.status_id);
  const mode = b.mode || "skip", create = !("create" in b0) || Boolean(b0.create), dry = Boolean(b.dry);
  const keyf = String(b.key_field || (await firstField(tab)));
  const kfs = (Array.isArray(b.key_fields) ? b.key_fields : []).map(String).filter((x) => x.trim()).slice(0, 2);
  if (!kfs.length) kfs.push(keyf);
  const ts = now();
  const [fields, tabs, stats, owns, devs] = await Promise.all([
    pages<Pick<Field, "id" | "tab_id" | "label" | "type" | "link_tab">>((a, z) => sb().from(T.fields).select("id,tab_id,label,type,link_tab").order("id").range(a, z)),
    pages<{ id: Id; name: string }>((a, z) => sb().from(T.tabs).select("id,name").order("id").range(a, z)),
    run<{ id: Id; label: string }[]>(sb().from(T.statuses).select("id,label").eq("tab_id", tab).order("id")),
    pages<{ id: Id; name: string }>((a, z) => sb().from(T.owners).select("id,name").eq("dept_id", dept).order("id").range(a, z)),
    pages<{ id: Id; name: string; serial: string | null }>((a, z) => sb().from(T.devices).select("id,name,serial").order("id").range(a, z)),
  ]);
  const ftype = new Map(fields.map((f) => [String(f.id), f]));
  const tname = new Map(tabs.map((t) => [t.id, t.name]));
  const stat = new Map(stats.map((s) => [s.label.trim().toLowerCase(), s.id]));
  const own = new Map(owns.map((o) => [o.name.trim().toLowerCase(), o.id]));
  const dev = new Map<string, Id>();
  for (const d of devs) { dev.set(d.name.trim().toLowerCase(), d.id); if (d.serial) dev.set(d.serial.trim().toLowerCase(), d.id); }
  const ssid = !dry && b.sid ? String(b.sid) : null;
  if (!(ssid && BKC.sid === ssid && ts - BKC.t < 180)) { bkReset(); BKC.sid = ssid; }
  BKC.t = ts;
  const idxOf = (k: string) => BKC.idx.get(k) ?? BKC.idx.set(k, new Map()).get(k)!;
  const chkOf = (k: string) => BKC.chk.get(k) ?? BKC.chk.set(k, new Set()).get(k)!;
  const primC = new Map<Id, string>(), fsC = new Map<Id, Id | null>(), mtC = new Map<Id, boolean>();
  const rcache = new Map<Id, [Record<string, unknown>, string]>();                  // id → [data, note] (đọc theo lô, cập nhật khi ghi)
  const pend = new Map<Id, Patch>(), patches = new Map<Id, Patch>();
  let tmp = 0;
  const rep: BulkReport = { created: 0, updated: 0, skipped: 0, same: 0, invalid: 0, dup_in: 0, filled: 0, changed: 0, kept: 0, l_created: 0, l_updated: 0, l_links: 0, l_missing: 0, conflicts: [], bad: [], dry };
  const noteBad = (ln: number | null, why: string) => { rep.invalid++; if (rep.bad.length < 60) rep.bad.push({ ln, why }); };
  const noteConf = (ln: number | null, tb: Id, key: string, fid: string, kind: "changed" | "kept") => {
    if (rep.conflicts.length >= 60) return;
    const f = ftype.get(String(fid));
    rep.conflicts.push({ ln, tab: tname.get(tb) ?? "", key, f: f ? f.label : String(fid), kind, secret: Boolean(f && f.type === "secret") });
  };
  const prim = async (t: Id) => { if (!primC.has(t)) primC.set(t, String(await firstField(t))); return primC.get(t)!; };
  const linkTab = (fid: number) => ftype.get(String(fid))?.link_tab ?? null;
  const isMailTab = async (t: Id) => { if (!mtC.has(t)) { const f = ftype.get(await prim(t)); mtC.set(t, /mail/i.test((f?.label ?? "") + (tname.get(t) ?? ""))); } return mtC.get(t)!; };
  const rowdata = async (aid: Id) => {
    let v = rcache.get(aid);
    if (!v) { const r = await run<{ data: Record<string, unknown>; note: string | null } | null>(sb().from(T.accounts).select("data,note").eq("id", aid).maybeSingle()); v = [dataOf(r?.data), r?.note ?? ""]; rcache.set(aid, v); }
    return v;
  };
  /** dòng mới (id tạm): sửa thẳng bản sẽ chèn · dòng có sẵn: gộp patch */
  const write = (aid: Id, p: Patch) => { Object.assign(aid < 0 ? pend.get(aid)! : patches.get(aid) ?? patches.set(aid, {}).get(aid)!, p); };
  const insertAcc = (row: Patch): Id => { const id = -(++tmp); pend.set(id, { device_id: null, ...row }); rcache.set(id, [dataOf(row.data), str(row.note)]); return id; };
  /** điền/ghi đè các trường của 1 dòng đã có; true nếu có thay đổi. */
  const applyVals = async (aid: Id, tb: Id, vals: Record<string, string>, md: string, ln: number | null, key: string) => {
    if (!Object.keys(vals).length) return false;
    const row = await rowdata(aid), old = { ...row[0] };
    let chg = false;
    for (const [f, v] of Object.entries(vals)) {
      const cur = String(old[f] || "");
      if (cur === v) continue;
      if (cur === "") { old[f] = v; rep.filled++; chg = true; }
      else if (md === "update") { old[f] = v; rep.changed++; chg = true; noteConf(ln, tb, key, f, "changed"); }
      else { rep.kept++; noteConf(ln, tb, key, f, "kept"); }
    }
    if (chg) { row[0] = old; write(aid, { data: old, updated: ts }); }
    return chg;
  };
  const resolve = async (t: Id, text: string, attrs: Record<string, string>, d: Id, o: Id | null, ln: number | null): Promise<Id | null> => {
    const key = text.trim(); if (!key) return null;
    const p = await prim(t), m = idxOf(`${t}:${p}`), lk = key.toLowerCase(), hit = m.get(lk);
    if (hit !== undefined) { if (await applyVals(hit, t, attrs, mode === "update" ? "update" : "fill", ln, key)) rep.l_updated++; return hit; }
    if (!create) { rep.l_missing++; return null; }
    const data: Record<string, unknown> = { [p]: key };
    for (const [k, v] of Object.entries(attrs)) data[k] = v;
    if (!fsC.has(t)) fsC.set(t, await firstStatus(t));
    const nid = insertAcc({ tab_id: t, dept_id: d, owner_id: o, status_id: fsC.get(t) ?? null, note: "", data, created: ts, updated: ts });
    m.set(lk, nid); rep.l_created++; return nid;
  };
  const rows: BulkRow[] = Array.isArray(b.rows) ? b.rows.filter((r) => r && typeof r === "object") : [];
  const cleanData = (r: BulkRow) => Object.fromEntries(Object.entries(dataOf(r.data)).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [String(k), String(v)]));
  const linksOf = (r: BulkRow) => Object.entries(dataOf(r.links)).map(([fid, xs]) => [Number(fid), (Array.isArray(xs) ? xs : []) as Array<string | BulkLinkItem>] as const);
  const itKey = (it: string | BulkLinkItem) => String((typeof it === "object" && it ? it.k : it) || "").trim();
  const itAttrs = (it: string | BulkLinkItem): Record<string, string> => {
    const a: Record<string, string> = {};
    for (const [x, y] of Object.entries(dataOf(typeof it === "object" && it ? it.a : null))) if (y !== null && y !== undefined && y !== "") a[String(x)] = String(y);
    return a;
  };
  // chỉ hỏi server đúng các khoá có trong file (không kéo cả chỉ mục về)
  const mk = `${tab}:${kfs.join(",")}`;
  const m0 = idxOf(mk), chk0 = chkOf(mk), need = new Set<string>();
  for (const r of rows) { const k = kk(cleanData(r), kfs); if (k && !chk0.has(k)) need.add(k); }
  const got = await keyLookup(tab, kfs, need);
  for (const [k, v] of got) m0.set(k, v);
  for (const k of need) chk0.add(k);
  const want = new Map<Id, Set<string>>(), wa = new Set<Id>();
  for (const r of rows) for (const [fid, items] of linksOf(r)) {
    const lt = linkTab(fid); if (!lt) continue;
    for (const it of items) {
      const k = itKey(it).toLowerCase(); if (!k) continue;
      (want.get(lt) ?? want.set(lt, new Set()).get(lt)!).add(k);
      if (typeof it === "object" && it && Object.keys(dataOf(it.a)).length) wa.add(lt);
    }
  }
  const rids = new Set<Id>(mode === "fill" || mode === "update" ? got.values() : []);
  for (const [lt, ks] of want) {
    const p = await prim(lt), ik = `${lt}:${p}`, m = idxOf(ik), ck = chkOf(ik), nd = [...ks].filter((k) => !ck.has(k));
    for (const [k, v] of await keyLookup(lt, [p], nd)) m.set(k, v);
    for (const k of nd) ck.add(k);
    if (wa.has(lt)) for (const k of ks) { const v = m.get(k); if (v !== undefined) rids.add(v); }
  }
  const pre = [...rids].filter((i) => i > 0 && !rcache.has(i)).sort((x, y) => x - y);
  await pool(chunks(pre, PAGE), async (ch) => {
    for (const r of await run<{ id: Id; data: Record<string, unknown>; note: string | null }[]>(sb().from(T.accounts).select("id,data,note").in("id", ch))) rcache.set(r.id, [dataOf(r.data), r.note ?? ""]);
  }, 4);
  const seen = new Set<string>();
  const lcur: LinkRow[] = [];
  for (const r of rows) {
    const ln = r.ln ?? null, data = cleanData(r), key = kk(data, kfs);
    const rs = stat.get(str(r.status).trim().toLowerCase()) ?? sid;
    const ro = own.get(str(r.owner).trim().toLowerCase()) ?? owner;
    const note = r.note || "", rd = dev.get(str(r.device).trim().toLowerCase()) ?? null;
    const hit = Boolean(key && m0.has(key) && mode !== "add");
    if (!key && b.no_new) { noteBad(ln, "thiếu giá trị khóa — không biết dòng nào để cập nhật"); continue; }
    if (!key && !Object.keys(data).length && !Object.keys(dataOf(r.links)).length && !note) { noteBad(ln, "dòng trống"); continue; }
    if (key && seen.has(key) && (mode === "fill" || mode === "update")) rep.dup_in++;
    seen.add(key);
    if (!hit && b.no_new) { rep.skipped++; continue; }
    if (hit && mode === "skip") { rep.skipped++; continue; }
    // liên kết: kiểm tra trước (email sai định dạng → bỏ liên kết đó, vẫn nhập dòng chính)
    const lks = new Map<number, Array<[string, Record<string, string>]>>();
    for (const [fid, items] of linksOf(r)) {
      const lt = linkTab(fid); if (!lt) continue;
      const good: Array<[string, Record<string, string>]> = [];
      for (const it of items) {
        const k = itKey(it); if (!k) continue;
        if ((await isMailTab(lt)) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k)) { noteBad(ln, `"${k.slice(0, 40)}" không phải email — bỏ liên kết này`); continue; }
        good.push([k, itAttrs(it)]);
      }
      lks.set(fid, good);
    }
    let aid: Id;
    if (hit) {
      aid = m0.get(key)!;
      let chg = await applyVals(aid, tab, data, mode, ln, key.split("\x1f")[0]);
      const p: Patch = {};
      if (rs && mode === "update") p.status_id = rs;
      if (ro && mode === "update") p.owner_id = ro;
      if (note) { const cur = (await rowdata(aid))[1] || ""; if ((mode === "update" && cur !== note) || (mode === "fill" && !cur)) p.note = note; }
      if (Object.keys(p).length) { write(aid, { ...p, updated: ts }); if ("note" in p) (await rowdata(aid))[1] = note; chg = true; }
      if (rd) { write(aid, { device_id: rd, updated: ts }); chg = true; }   // Python không đổi updated ở đây → client (delta) không thấy; HireX có
      rep[chg ? "updated" : "same"]++;
    } else {
      aid = insertAcc({ tab_id: tab, dept_id: dept, owner_id: ro, status_id: rs, note, data, created: ts, updated: ts });
      if (key) m0.set(key, aid);
      if (rd) write(aid, { device_id: rd });
      rep.created++;
    }
    for (const [fid, good] of lks) for (const [k, a] of good) {
      const dst = await resolve(linkTab(fid)!, k, a, dept, ro, ln);
      if (dst && dst !== aid) lcur.push({ src: aid, dst, field_id: fid });
    }
  }
  const uniq = (ls: LinkRow[]) => [...new Map(ls.map((l) => [`${l.src},${l.dst},${l.field_id}`, l])).values()];
  if (dry) {
    // như insert or ignore: chỉ đếm liên kết chưa có
    const ls = uniq(lcur), old = ls.filter((l) => l.src > 0 && l.dst > 0), have = new Set<string>();
    for (const ch of chunks([...new Set(old.map((l) => l.src))], 200))
      for (const l of await pages<LinkRow>((a, z) => sb().from(T.links).select("src,dst,field_id").in("src", ch).order("id").range(a, z))) have.add(`${l.src},${l.dst},${l.field_id}`);
    rep.l_links += ls.length - old.filter((l) => have.has(`${l.src},${l.dst},${l.field_id}`)).length;
  } else {
    const real = new Map<Id, Id>(), ins = [...pend];
    for (const ch of chunks(ins, 500)) {
      const ids = (await run<{ id: Id }[]>(sb().from(T.accounts).insert(ch.map(([, r]) => r)).select("id"))).map((r) => r.id).sort((x, y) => x - y);
      if (ids.length !== ch.length) throw bad("Chèn dòng mới không đủ");
      ch.forEach(([t], i) => real.set(t, ids[i]));                                    // id cấp theo thứ tự dòng chèn
    }
    const fix = (i: Id) => (i < 0 ? real.get(i)! : i);
    await updateIds(patches);
    rep.l_links += await addLinks(uniq(lcur.map((l) => ({ src: fix(l.src), dst: fix(l.dst), field_id: l.field_id }))));
    for (const m of BKC.idx.values()) for (const [k, v] of m) if (v < 0) m.set(k, fix(v));   // lượt sau của phiên thấy id thật
  }
  if (dry || b.last) bkReset();
  return rep;
}

/* ───────── cập nhật theo từng dòng (đối chiếu cũ/mới) ───────── */
export async function rowsSet(b: Body) {
  const items = (Array.isArray(b.items) ? b.items : []).filter((x) => x && typeof x === "object") as Body[];
  const wantO = items.some((it) => "owner_id" in it), wantD = items.some((it) => "device_id" in it);
  const [owns, devs] = await Promise.all([
    wantO ? pages<{ id: Id; dept_id: Id }>((a, z) => sb().from(T.owners).select("id,dept_id").order("id").range(a, z)) : Promise.resolve([] as { id: Id; dept_id: Id }[]),
    wantD ? pages<{ id: Id }>((a, z) => sb().from(T.devices).select("id").order("id").range(a, z)) : Promise.resolve([] as { id: Id }[]),
  ]);
  const oDept = new Map(owns.map((o) => [o.id, o.dept_id])), devOk = new Set(devs.map((d) => d.id));
  const by = new Map<Id, MergeItem>();                                                // cùng id lặp lại: gộp, lần sau đè lần trước (như chạy tuần tự)
  for (const it of items) {
    const id = num(it.id); if (id === null) continue;
    const m = by.get(id) ?? { id };
    for (const [k0, v] of Object.entries(dataOf(it.data))) {
      const k = String(k0);
      if (v === null || v === undefined || v === "") { if (m.set) delete m.set[k]; (m.del ??= []).push(k); }
      else { (m.set ??= {})[k] = String(v); if (m.del) m.del = m.del.filter((x) => x !== k); }
    }
    if ("note" in it) m.note = it.note ? String(it.note) : "";
    if ("status_id" in it) m.status_id = idOr(it.status_id);
    if ("owner_id" in it) {
      const oid = idOr(it.owner_id), od = oid ? oDept.get(oid) : undefined;
      if (od !== undefined) { m.owner_id = oid; m.dept_id = od; } else if (oid === null) m.owner_id = null;
    }
    if ("device_id" in it) { const dv = idOr(it.device_id); if (dv === null || devOk.has(dv)) m.device_id = dv; }
    by.set(id, m);
  }
  return { updated: await mergeWrite([...by.values()]) };
}

/* ───────── meta: dept / owner / tab / field / status / device ───────── */
const COLS: Record<string, [MetaTable, string[]]> = {
  dept: ["depts", ["name", "color"]], owner: ["owners", ["dept_id", "parent_id", "name", "color"]], tab: ["tabs", ["name", "icon", "color", "grp", "lazy", "tint"]],
  field: ["fields", ["tab_id", "label", "type", "opts", "link_tab"]], status: ["statuses", ["tab_id", "label", "color"]],
  device: ["devices", ["dept_id", "owner_id", "name", "kind", "serial", "caps", "note"]],
};
export async function upsert(kind: keyof typeof COLS, b: Body) {
  const [table, cols] = COLS[kind];
  const vals: Record<string, unknown> = {};
  for (const c of cols) if (c in b) vals[c] = /_id$|_tab$|^lazy$|^tint$/.test(c) ? num(b[c]) : b[c];
  if (kind === "device") {
    if ("caps" in vals) vals.caps = capsOf(vals.caps);
    if (vals.kind !== undefined && vals.kind !== null && !KINDS.includes(String(vals.kind))) vals.kind = "phone";
    if ("name" in vals) { vals.name = str(vals.name).trim(); if (!vals.name) throw bad("Tên thiết bị trống"); }
  }
  const id = num(b.id);
  if (id) {
    if (kind === "owner" && vals.parent_id) {
      let p = vals.parent_id as Id | null; const seen = new Set<Id>();
      while (p && !seen.has(p)) {
        if (p === id) throw bad("Owner không thể là cấp trên của chính nó / cấp dưới của nó");
        seen.add(p);
        const r = await run<{ parent_id: Id | null } | null>(sb().from(T.owners).select("parent_id").eq("id", p).maybeSingle());
        p = r?.parent_id ?? null;
      }
    }
    if (Object.keys(vals).length) await run(sb().from(T[table]).update(vals).eq("id", id));
    if (kind === "field") {
      if ("type" in vals && vals.type !== "link") { await run(sb().from(T.links).delete().eq("field_id", id)); await run(sb().from(T.fields).update({ link_tab: null }).eq("id", id)); }
      if ("link_tab" in vals) {   // bỏ liên kết trỏ sang dòng không thuộc tab liên kết mới
        const lt = (vals.link_tab as Id | null) ?? -1;
        const ls = await pages<{ id: Id; dst: Id }>((a, z) => sb().from(T.links).select("id,dst").eq("field_id", id).order("id").range(a, z));
        const keep = new Set<Id>();
        for (const ch of chunks([...new Set(ls.map((l) => l.dst))], PAGE)) for (const r of await run<{ id: Id }[]>(sb().from(T.accounts).select("id").eq("tab_id", lt).in("id", ch))) keep.add(r.id);
        for (const ch of chunks(ls.filter((l) => !keep.has(l.dst)).map((l) => l.id), 500)) await run(sb().from(T.links).delete().in("id", ch));
      }
    }
    await bumpVer();
    return { id };
  }
  const where = kind === "field" || kind === "status" ? { col: "tab_id", val: num(b.tab_id) } : kind === "owner" ? { col: "dept_id", val: num(b.dept_id) } : undefined;
  vals.pos = await nextPos(table, where);
  if (kind === "device") vals.created = now();
  const nid = await insertId(table, vals);
  if (kind === "tab" && b._init) {
    await run(sb().from(T.fields).insert({ tab_id: nid, label: "Tên", type: "text", pos: 1 }));
    await run(sb().from(T.statuses).insert([{ tab_id: nid, label: "Live", color: "#10b981", pos: 1 }, { tab_id: nid, label: "Die", color: "#ef4444", pos: 2 }]));
  }
  await bumpVer();
  return { id: nid };
}

export async function del(b: Body) {
  const t = String(b.table), i = num(b.id) ?? 0;
  if (t === "depts") {
    await delAccountIds(await idsWhere("accounts", "dept_id", i));
    const devs = await idsWhere("devices", "dept_id", i);
    for (const ch of chunks(devs, 500)) await run(sb().from(T.accounts).update({ device_id: null }).in("device_id", ch));
    await run(sb().from(T.devices).delete().eq("dept_id", i));
    await run(sb().from(T.owners).delete().eq("dept_id", i));
    await run(sb().from(T.depts).delete().eq("id", i));
  } else if (t === "owners") {
    const o = await run<{ parent_id: Id | null } | null>(sb().from(T.owners).select("parent_id").eq("id", i).maybeSingle());
    const par = o?.parent_id ?? null;
    await run(sb().from(T.accounts).update({ owner_id: par }).eq("owner_id", i));
    await run(sb().from(T.owners).update({ parent_id: par }).eq("parent_id", i));
    await run(sb().from(T.devices).update({ owner_id: par }).eq("owner_id", i));
    await run(sb().from(T.owners).delete().eq("id", i));
  } else if (t === "tabs") {
    await delAccountIds(await idsWhere("accounts", "tab_id", i));
    const fids = (await run<{ id: Id }[]>(sb().from(T.fields).select("id").or(`tab_id.eq.${i},link_tab.eq.${i}`))).map((r) => r.id);
    if (fids.length) await run(sb().from(T.links).delete().in("field_id", fids));
    await run(sb().from(T.fields).update({ link_tab: null }).eq("link_tab", i));
    await run(sb().from(T.fields).delete().eq("tab_id", i));
    await run(sb().from(T.statuses).delete().eq("tab_id", i));
    await run(sb().from(T.tabs).delete().eq("id", i));
  } else if (t === "fields") {
    await run(sb().from(T.links).delete().eq("field_id", i));
    await run(sb().from(T.fields).delete().eq("id", i));
  } else if (t === "devices") {
    await run(sb().from(T.accounts).update({ device_id: null }).eq("device_id", i));
    await run(sb().from(T.devices).delete().eq("id", i));
  } else if (t === "statuses") {
    await run(sb().from(T.accounts).update({ status_id: null }).eq("status_id", i));
    await run(sb().from(T.statuses).delete().eq("id", i));
  } else return { ok: 1 };   // Python: bảng lạ → bỏ qua
  await bumpVer();
  return { ok: 1 };
}

export async function reorder(b: Body) {
  const t = String(b.table) as MetaTable;
  if (!["depts", "owners", "tabs", "fields", "statuses", "devices"].includes(t)) throw bad("bad table");
  await pool(toIds(b.ids).map((id, k) => [id, k + 1] as const), ([id, pos]) => run(sb().from(T[t]).update({ pos }).eq("id", id)));
  await bumpVer();
  return { ok: 1 };
}

/* ───────── cài đặt lặt vặt ───────── */
export async function tabKeys(b: Body) {
  const tid = Math.trunc(Number(b.tab_id) || 0);
  if (!(await exists("tabs", tid))) throw bad("Tab không tồn tại");
  const ok = new Set((await run<{ id: Id }[]>(sb().from(T.fields).select("id").eq("tab_id", tid))).map((r) => r.id));
  const ks: Id[] = [];
  for (const x of toIds((Array.isArray(b.keys) ? b.keys : []).slice(0, 2))) if (ok.has(x) && !ks.includes(x)) ks.push(x);
  const tk = await getJsonSetting<Record<string, Id[]>>("tab_keys", {});
  if (ks.length) tk[String(tid)] = ks; else delete tk[String(tid)];
  await setSetting("tab_keys", JSON.stringify(tk));
  await bumpVer();
  return { ok: 1 };
}
/** khóa chính của tab = trường bất kỳ (field_id rỗng → về trường đầu tiên) */
export async function tabPk(b: Body) {
  const tid = Math.trunc(Number(b.tab_id) || 0), fid = num(b.field_id);
  if (!(await exists("tabs", tid))) throw bad("Tab không tồn tại");
  if (fid && !(await run<{ id: Id } | null>(sb().from(T.fields).select("id").eq("id", fid).eq("tab_id", tid).maybeSingle()))) throw bad("Trường không thuộc tab này");
  const pk = await getJsonSetting<Record<string, Id>>("tab_pk", {});
  if (fid) pk[String(tid)] = fid; else delete pk[String(tid)];
  await setSetting("tab_pk", JSON.stringify(pk));
  await bumpVer();
  return { ok: 1 };
}
/** kiểu hiện giá trị của 1 trường Danh sách (chỉ ghi phần được gửi):
 *  colors = {giá trị: "#rrggbb"} · icons = {giá trị: tên icon} · mode = "text" | "both" | "icon". Rỗng → về mặc định. */
export async function optColors(b: Body) {
  const fid = num(b.field_id);
  if (!fid || !(await exists("fields", fid))) throw bad("Trường không tồn tại");
  const put = async (key: string, raw: unknown, ok: (v: string) => boolean) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(dataOf(raw))) { const c = str(v).trim(); if (String(k).trim() && ok(c)) out[String(k).trim().slice(0, 200)] = c; }
    const all = await getJsonSetting<Record<string, Record<string, string>>>(key, {});
    if (Object.keys(out).length) all[String(fid)] = out; else delete all[String(fid)];
    await setSetting(key, JSON.stringify(all));
  };
  if ("colors" in b) await put("opt_colors", b.colors, (c) => /^#[0-9a-fA-F]{6}$/.test(c));
  if ("icons" in b) await put("opt_icons", b.icons, (c) => /^[a-z0-9_]{1,30}$/.test(c));
  if ("mode" in b) {
    const m = str(b.mode), all = await getJsonSetting<Record<string, string>>("opt_mode", {});
    if (["text", "both", "icon"].includes(m)) all[String(fid)] = m; else delete all[String(fid)];
    await setSetting("opt_mode", JSON.stringify(all));
  }
  await bumpVer();
  return { ok: 1 };
}
export async function grpIcon(b: Body) {
  const g = str(b.g).trim(); if (!g) throw bad("Chưa có tên nhóm");
  const ic = str(b.icon).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
  const gi = await getJsonSetting<Record<string, string>>("grp_icons", {});
  if (ic) gi[g] = ic; else delete gi[g];
  await setSetting("grp_icons", JSON.stringify(gi));
  await bumpVer();
  return { ok: 1 };
}
export async function histCfg(b: Body): Promise<HistInfo> {
  if ("days" in b) await setSetting("hist_days", Math.max(0, Math.trunc(Number(b.days) || 0)));
  if ("keepdel" in b) await setSetting("hist_keepdel", b.keepdel ? "1" : "0");
  if (b.clear) await run(sb().from(T.acc_hist).delete().gte("id", 0));
  await histPrune();
  return histInfo();
}
export async function logClear() { await run(sb().from(T.logs).delete().gte("id", 0)); return { ok: true }; }
/** sửa lỗi dữ liệu: luôn chụp bản an toàn trước (snapshot(True) của Python) */
export async function repair() { await snapshot(true); return run(sb().rpc("ahs_repair", { p_now: now() })); }
export { checkDb };

/* ───────── nhãn dòng (nhật ký) ───────── */
export async function accLabel(i: Id): Promise<string> {
  const r = await run<{ tab_id: Id; data: Record<string, unknown> } | null>(sb().from(T.accounts).select("tab_id,data").eq("id", i).maybeSingle());
  if (!r) return `#${i}`;
  const f = await firstField(r.tab_id);
  const v = f ? dataOf(r.data)[String(f)] : "";
  return (v !== undefined && v !== null && String(v)) || `#${i}`;
}
export async function auditDetail(name: string, b: Body): Promise<string> {
  if (Array.isArray(b.items) && b.items.length) return `${b.items.length} dòng`;
  const ids = toIds(b.ids);
  if (ids.length) return (await Promise.all(ids.slice(0, 3).map(accLabel))).join(", ") + (ids.length > 3 ? " …" : "");
  if (name === "account") {
    if (b.id) return accLabel(num(b.id)!);
    const f = await firstField(num(b.tab_id) ?? 0);
    return str(dataOf(b.data)[String(f)]);
  }
  if (["dept", "owner", "tab", "field", "status", "device"].includes(name)) return str(b.name || b.label || `#${b.id ?? ""}`);
  if (name === "delete") return `${str(b.table, "None")} #${str(b.id, "None")}`;
  if (name === "bulk") return `${Array.isArray(b.rows) ? b.rows.length : 0} dòng`;
  if (name === "device_bulk") return `${Array.isArray(b.rows) ? b.rows.length : 0} máy`;
  return str(b.name);
}
export function needsSnap(name: string, b: Body): boolean {
  const n = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  if (name === "delete_accounts") return n(b.ids) >= 20;
  if (name === "delete") return ["depts", "tabs", "fields", "statuses", "owners"].includes(String(b.table));
  // Sửa / nhập: trigger ahs_acc_hist đã giữ bản cũ của TỪNG dòng bị đổi (khôi phục được từ Lịch sử dòng) → không bắt người dùng
  // chờ chụp toàn DB (~30 giây) trước mỗi lần sửa ≥ 20 dòng. Xoá vẫn chụp (xoá dòng thì lịch sử của dòng cũng mất theo).
  if (name === "bulk" || name === "mass_set" || name === "rows_set") return false;
  return false;
}
