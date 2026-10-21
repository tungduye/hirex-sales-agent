import "server-only";

import { Conflict, HsError, T, chunks, getJsonSetting, isMissing, j, now, run, sb, setSetting, toIds } from "./db";
import { checkDb, firstField, firstStatus, histInfo, histPrune, ovTrend } from "./accounts-data";
import type { Account, BulkBody, BulkLinkItem, BulkReport, Epoch, Field, HistInfo, Id, MetaTable } from "../types";

/* Các hàm ghi của v7.py (ROUTES) — giữ nguyên tên, tham số và kết quả trả về để client không đổi.
   Khác Python: không có LOCK toàn cục / transaction; mỗi thao tác là chuỗi lệnh PostgREST. Thao tác lớn (bulk, delete) chạy tuần tự. */

type Body = Record<string, unknown>;
const num = (v: unknown): Id | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown, d = "") => (v === null || v === undefined ? d : String(v));
const dataOf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function exists(t: keyof typeof T, id: Id | null): Promise<boolean> {
  if (!id) return false;
  return Boolean(await run(sb().from(T[t]).select("id").eq("id", id).maybeSingle()));
}
async function nextPos(t: keyof typeof T, where?: { col: string; val: Id }): Promise<number> {
  let q = sb().from(T[t]).select("pos").order("pos", { ascending: false }).limit(1);
  if (where) q = q.eq(where.col, where.val);
  const r = await run<{ pos: number } | null>(q.maybeSingle());
  return (r?.pos ?? 0) + 1;
}
async function insertId(t: keyof typeof T, row: Record<string, unknown>): Promise<Id> {
  const r = await run<{ id: Id }>(sb().from(T[t]).insert(row).select("id").single());
  return r.id;
}
/** insert or ignore into links */
async function addLinks(rows: Array<{ src: Id; dst: Id; field_id: Id }>) {
  if (!rows.length) return;
  for (const ch of chunks(rows, 500)) await run(sb().from(T.links).upsert(ch, { onConflict: "src,dst,field_id", ignoreDuplicates: true }));
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
  if (!(await exists("tabs", tabId))) throw new HsError("Tab không tồn tại");
  const row = { tab_id: tabId, dept_id: num(b.dept_id), owner_id: num(b.owner_id), status_id: num(b.status_id), device_id: num(b.device_id), note: str(b.note), data: dataOf(b.data), updated: ts };
  let aid = num(b.id);
  if (aid) {
    const cur = await run<{ updated: Epoch; tab_id: Id } | null>(sb().from(T.accounts).select("updated,tab_id").eq("id", aid).maybeSingle());
    if (!cur) throw new HsError("Dòng này không còn tồn tại");
    if (b.ver && Math.abs(cur.updated - Number(b.ver)) > 0.001) throw new Conflict("Dữ liệu đã được thay đổi ở nơi khác - đã tải lại");
    await run(sb().from(T.accounts).update(row).eq("id", aid));
  } else aid = await insertId("accounts", { ...row, created: ts });
  if ("links" in b) {
    const fl = new Map((await run<{ id: Id; link_tab: Id | null }[]>(sb().from(T.fields).select("id,link_tab").eq("tab_id", tabId!))).map((f) => [f.id, f.link_tab]));
    await run(sb().from(T.links).delete().eq("src", aid));
    const want: Array<{ src: Id; dst: Id; field_id: Id }> = [];
    for (const [fid, ids] of Object.entries(dataOf(b.links))) {
      const lt = fl.get(Number(fid)); if (!lt) continue;
      const dsts = toIds(ids).filter((d) => d !== aid);
      if (!dsts.length) continue;
      const okTab = await run<{ id: Id }[]>(sb().from(T.accounts).select("id").in("id", dsts).eq("tab_id", lt));
      for (const r of okTab) want.push({ src: aid, dst: r.id, field_id: Number(fid) });
    }
    await addLinks(want);
  }
  return { id: aid };
}

export async function statusSet(b: Body) {
  const ts = now(), sid = num(b.status_id);
  if (sid && !(await exists("statuses", sid))) throw new HsError("Trạng thái không tồn tại");
  let ids = toIds(b.ids);
  if (sid) { const ok = await idsWithStatusTab(ids, sid); ids = ids.filter((i) => ok.has(i)); }
  for (const ch of chunks(ids, 500)) await run(sb().from(T.accounts).update({ status_id: sid, updated: ts }).in("id", ch));
  return { ok: 1 };
}

export async function deviceSet(b: Body) {
  const dv = num(b.device_id);
  if (dv && !(await exists("devices", dv))) throw new HsError("Thiết bị không tồn tại");
  for (const ch of chunks(toIds(b.ids), 500)) await run(sb().from(T.accounts).update({ device_id: dv, updated: now() }).in("id", ch));
  return { ok: 1 };
}

export async function deviceBulk(b: Body) {
  const ts = now(), pos = await nextPos("devices");
  const caps: Record<string, number> = {};
  for (const [k, v] of Object.entries(dataOf(b.caps))) if (Number(v) > 0) caps[String(k)] = Math.trunc(Number(v));
  const rows: Record<string, unknown>[] = [];
  for (const r of (Array.isArray(b.rows) ? b.rows : []) as Body[]) {
    const nm = str(r.name).trim(); if (!nm) continue;
    let kind = str(r.kind || b.kind || "phone"); if (!["phone", "pc", "boxphone"].includes(kind)) kind = "phone";
    rows.push({ dept_id: num(b.dept_id), owner_id: num(b.owner_id), name: nm, kind, serial: str(r.serial), caps: j(caps), note: "", pos: pos + rows.length, created: ts });
  }
  if (rows.length) await run(sb().from(T.devices).insert(rows));
  return { created: rows.length };
}

/** owner_id → owner + bộ phận của owner đó; chỉ dept_id → về bộ phận, bỏ owner. */
export async function ownerSet(b: Body) {
  const ts = now(), o = num(b.owner_id); let dp = num(b.dept_id);
  const dept = o ? await run<{ dept_id: Id } | null>(sb().from(T.owners).select("dept_id").eq("id", o).maybeSingle()) : null;
  if (dp && !(await exists("depts", dp))) dp = null;
  const patch = dept ? { owner_id: o, dept_id: dept.dept_id, updated: ts } : dp ? { owner_id: null, dept_id: dp, updated: ts } : { owner_id: null, updated: ts };
  for (const ch of chunks(toIds(b.ids), 500)) await run(sb().from(T.accounts).update(patch).in("id", ch));
  return { ok: 1 };
}

/** Cập nhật hàng loạt: trường, trạng thái, owner, ghi chú, thiết bị cho nhiều tài khoản. */
export async function massSet(b: Body) {
  const ts = now(), ids = toIds(b.ids);
  const rows = new Map<Id, Pick<Account, "id" | "data" | "note">>();
  for (const ch of chunks(ids, 1000)) for (const r of await run<Pick<Account, "id" | "data" | "note">[]>(sb().from(T.accounts).select("id,data,note").in("id", ch))) rows.set(r.id, r);
  const sid = num(b.status_id);
  const sok = sid ? await idsWithStatusTab(ids, sid) : new Set<Id>();
  const od = b.set_owner && num(b.owner_id) ? await run<{ dept_id: Id } | null>(sb().from(T.owners).select("dept_id").eq("id", num(b.owner_id)!).maybeSingle()) : null;
  let n = 0;
  for (const i of ids) {
    const r = rows.get(i); if (!r) continue;
    const d = { ...dataOf(r.data) };
    for (const [k, v] of Object.entries(dataOf(b.data))) { if (v === "" || v === null || v === undefined) delete d[String(k)]; else d[String(k)] = v; }
    let note = r.note || "";
    if (b.note !== null && b.note !== undefined) note = b.note_mode !== "append" ? str(b.note) : (note ? note + "\n" : "") + str(b.note);
    const patch: Record<string, unknown> = { data: d, note, updated: ts };
    if (b.set_device) patch.device_id = num(b.device_id);
    if (sid && sok.has(i)) patch.status_id = sid;
    if (b.set_owner) { patch.owner_id = num(b.owner_id); const nd = od ? od.dept_id : num(b.dept_id); if (nd) patch.dept_id = nd; }
    await run(sb().from(T.accounts).update(patch).eq("id", i));
    n++;
  }
  return { ok: n };
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
const BKC: { sid: string | null; t: number; idx: Map<string, Map<string, Id>>; chk: Map<string, Set<string>> } = { sid: null, t: 0, idx: new Map(), chk: new Map() };
const kk = (d: Record<string, string>, fs: string[]) => { const p = fs.map((f) => String(d[f] ?? "").trim().toLowerCase()); return p.some(Boolean) ? p.join("\x1f") : ""; };

/** Postgres: id (nhỏ nhất) của các khoá trong tab (hàm ahs_key_lookup). */
async function keyLookup(tab: Id, fids: string[], keys: Iterable<string>): Promise<Map<string, Id>> {
  const out = new Map<string, Id>();
  const ks = [...new Set([...keys].filter(Boolean))].sort();
  try {
    for (const ch of chunks(ks, 20000)) {
      const rows = await run<{ k: string; id: Id }[]>(sb().rpc("ahs_key_lookup", { p_tab: tab, p_fields: fids.map(Number), p_keys: ch }));
      for (const r of rows) out.set(r.k, r.id);
    }
    return out;
  } catch (e) { if (!isMissing(e)) throw e; }
  // chưa có migration: đọc dòng của tab theo trang, tính khoá giống hàm SQL (strip khoảng trắng + chữ thường, nối chr(31), id nhỏ nhất)
  const want = new Set(ks), ws = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;
  for (let from = 0; ; from += 1000) {
    const rows = await run<{ id: Id; data: Record<string, unknown> }[]>(sb().from(T.accounts).select("id,data").eq("tab_id", tab).order("id").range(from, from + 999));
    for (const r of rows) {
      const k = fids.map((f) => String(r.data?.[String(f)] ?? "").replace(ws, "").toLowerCase()).join("\x1f");
      if (want.has(k) && !out.has(k)) out.set(k, r.id);
    }
    if (rows.length < 1000) break;
  }
  return out;
}

/** Nhập / cập nhật hàng loạt có kiểm soát toàn vẹn. mode: skip · fill · update · add. dry=true: chỉ báo cáo, không ghi. */
export async function bulk2(b0: Body) {
  const b = b0 as unknown as BulkBody;
  const tab = Number(b.tab_id), dept = Number(b.dept_id), owner = num(b.owner_id), sid = num(b.status_id);
  const mode = b.mode || "skip", create = b.create !== false, dry = Boolean(b.dry);
  const keyf = String(b.key_field || (await firstField(tab)));
  const kfs = (b.key_fields || []).map(String).filter((x) => x.trim()).slice(0, 2);
  if (!kfs.length) kfs.push(keyf);
  const ts = now();
  const [fields, tabs, stats, owns, devs] = await Promise.all([
    run<Field[]>(sb().from(T.fields).select("id,tab_id,label,type,link_tab")),
    run<{ id: Id; name: string }[]>(sb().from(T.tabs).select("id,name")),
    run<{ id: Id; label: string }[]>(sb().from(T.statuses).select("id,label").eq("tab_id", tab)),
    run<{ id: Id; name: string }[]>(sb().from(T.owners).select("id,name").eq("dept_id", dept)),
    run<{ id: Id; name: string; serial: string }[]>(sb().from(T.devices).select("id,name,serial")),
  ]);
  const ftype = new Map(fields.map((f) => [String(f.id), f]));
  const tname = new Map(tabs.map((t) => [t.id, t.name]));
  const stat = new Map(stats.map((s) => [s.label.trim().toLowerCase(), s.id]));
  const own = new Map(owns.map((o) => [o.name.trim().toLowerCase(), o.id]));
  const dev = new Map<string, Id>();
  for (const d of devs) { dev.set(d.name.trim().toLowerCase(), d.id); if (d.serial) dev.set(d.serial.trim().toLowerCase(), d.id); }
  const ssid = !dry && b.sid ? String(b.sid) : null;
  if (!(ssid && BKC.sid === ssid && ts - BKC.t < 180)) { BKC.sid = ssid; BKC.idx = new Map(); BKC.chk = new Map(); }
  BKC.t = ts;
  const idxOf = (k: string) => BKC.idx.get(k) ?? BKC.idx.set(k, new Map()).get(k)!;
  const chkOf = (k: string) => BKC.chk.get(k) ?? BKC.chk.set(k, new Set()).get(k)!;
  const primC = new Map<Id, string>(), fsC = new Map<Id, Id | null>(), mtC = new Map<Id, boolean>();
  const rcache = new Map<Id, [Record<string, unknown>, string]>();
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
    if (!v) { const r = await run<{ data: Record<string, unknown>; note: string } | null>(sb().from(T.accounts).select("data,note").eq("id", aid).maybeSingle()); v = [dataOf(r?.data), r?.note ?? ""]; rcache.set(aid, v); }
    return v;
  };
  const write = async (aid: Id, patch: Record<string, unknown>) => { if (!dry) await run(sb().from(T.accounts).update(patch).eq("id", aid)); };
  const insertAcc = async (row: Record<string, unknown>): Promise<Id> => (dry ? -(++dryIds) : insertId("accounts", row));
  let dryIds = 0;
  /** điền/ghi đè các trường của 1 dòng đã có; true nếu có thay đổi. */
  const applyVals = async (aid: Id, tb: Id, vals: Record<string, string>, md: string, ln: number | null, key: string) => {
    if (!Object.keys(vals).length) return false;
    const row = await rowdata(aid), old = { ...row[0] };
    let chg = false;
    for (const [f0, v] of Object.entries(vals)) {
      const f = String(f0), cur = String(old[f] ?? "");
      if (cur === v) continue;
      if (cur === "") { old[f] = v; rep.filled++; chg = true; }
      else if (md === "update") { old[f] = v; rep.changed++; chg = true; noteConf(ln, tb, key, f, "changed"); }
      else { rep.kept++; noteConf(ln, tb, key, f, "kept"); }
    }
    if (chg) { row[0] = old; await write(aid, { data: old, updated: ts }); }
    return chg;
  };
  const resolve = async (t: Id, text: string, attrs: Record<string, string>, d: Id, o: Id | null, md: string, ln: number | null): Promise<Id | null> => {
    const key = text.trim(); if (!key) return null;
    const m = idxOf(`${t}:${await prim(t)}`), lk = key.toLowerCase();
    if (m.has(lk)) { const aid = m.get(lk)!; if (await applyVals(aid, t, attrs, md === "update" ? "update" : "fill", ln, key)) rep.l_updated++; return aid; }
    if (!create) { rep.l_missing++; return null; }
    const data: Record<string, unknown> = { [await prim(t)]: key };
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== "") data[String(k)] = v;
    if (!fsC.has(t)) fsC.set(t, await firstStatus(t));
    const nid = await insertAcc({ tab_id: t, dept_id: d, owner_id: o, status_id: fsC.get(t), note: "", data, created: ts, updated: ts });
    m.set(lk, nid); rep.l_created++; return nid;
  };
  // chỉ hỏi server đúng các khoá có trong file
  const mk = `${tab}:${kfs.join(",")}`;
  const m0 = idxOf(mk), chk0 = chkOf(mk), need = new Set<string>();
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const cleanData = (r: typeof rows[number]) => Object.fromEntries(Object.entries(dataOf(r.data)).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [String(k), String(v)]));
  for (const r of rows) { const k = kk(cleanData(r), kfs); if (k && !chk0.has(k)) need.add(k); }
  const got = await keyLookup(tab, kfs, need);
  for (const [k, v] of got) m0.set(k, v);
  for (const k of need) chk0.add(k);
  const want = new Map<Id, Set<string>>(), wa = new Set<Id>();
  for (const r of rows) for (const [fid, items] of Object.entries(r.links ?? {})) {
    const lt = linkTab(Number(fid)); if (!lt) continue;
    for (const it of items) {
      const k = String((typeof it === "object" && it ? it.k : it) ?? "").trim().toLowerCase();
      if (!k) continue;
      (want.get(lt) ?? want.set(lt, new Set()).get(lt)!).add(k);
      if (typeof it === "object" && it && it.a) wa.add(lt);
    }
  }
  let rids = new Set<Id>(mode === "fill" || mode === "update" ? got.values() : []);
  for (const [lt, ks] of want) {
    const ik = `${lt}:${await prim(lt)}`, m = idxOf(ik), ck = chkOf(ik), nd = [...ks].filter((k) => !ck.has(k));
    for (const [k, v] of await keyLookup(lt, [await prim(lt)], nd)) m.set(k, v);
    for (const k of nd) ck.add(k);
    if (wa.has(lt)) for (const k of ks) if (m.has(k)) rids.add(m.get(k)!);
  }
  rids = new Set([...rids].filter((i) => !rcache.has(i)));
  for (const ch of chunks([...rids].sort((a, b) => a - b), 3000)) for (const r of await run<{ id: Id; data: Record<string, unknown>; note: string }[]>(sb().from(T.accounts).select("id,data,note").in("id", ch))) rcache.set(r.id, [dataOf(r.data), r.note ?? ""]);
  const seen = new Set<string>();
  const lcur: Array<{ src: Id; dst: Id; field_id: Id }> = [];
  for (const r of rows) {
    const ln = r.ln ?? null, data = cleanData(r), key = kk(data, kfs);
    const rs = stat.get(str(r.status).trim().toLowerCase()) ?? sid;
    const ro = own.get(str(r.owner).trim().toLowerCase()) ?? owner;
    const note = r.note || "", rd = dev.get(str(r.device).trim().toLowerCase()) ?? null;
    const hit = Boolean(key && m0.has(key) && mode !== "add");
    if (!key && b.no_new) { noteBad(ln, "thiếu giá trị khóa — không biết dòng nào để cập nhật"); continue; }
    if (!key && !Object.keys(data).length && !r.links && !note) { noteBad(ln, "dòng trống"); continue; }
    if (key && seen.has(key) && (mode === "fill" || mode === "update")) rep.dup_in++;
    seen.add(key);
    if (!hit && b.no_new) { rep.skipped++; continue; }
    if (hit && mode === "skip") { rep.skipped++; continue; }
    const lks = new Map<number, Array<[string, Record<string, string>]>>();
    for (const [fid, items] of Object.entries(r.links ?? {})) {
      const lt = linkTab(Number(fid)); if (!lt) continue;
      const good: Array<[string, Record<string, string>]> = [];
      for (const it of items) {
        const k = String((typeof it === "object" && it ? it.k : it) ?? "").trim(); if (!k) continue;
        if ((await isMailTab(lt)) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k)) { noteBad(ln, `"${k.slice(0, 40)}" không phải email — bỏ liên kết này`); continue; }
        const a: Record<string, string> = {};
        for (const [x, y] of Object.entries((typeof it === "object" && it ? (it as BulkLinkItem).a : null) ?? {})) if (y !== null && y !== undefined && y !== "") a[String(x)] = String(y);
        good.push([k, a]);
      }
      lks.set(Number(fid), good);
    }
    let aid: Id;
    if (hit) {
      aid = m0.get(key)!;
      let chg = await applyVals(aid, tab, data, mode, ln, key.split("\x1f")[0]);
      const patch: Record<string, unknown> = {};
      if (rs && mode === "update") patch.status_id = rs;
      if (ro && mode === "update") patch.owner_id = ro;
      if (note) { const cur = (await rowdata(aid))[1] || ""; if ((mode === "update" && cur !== note) || (mode === "fill" && !cur)) patch.note = note; }
      if (Object.keys(patch).length) { await write(aid, { ...patch, updated: ts }); if ("note" in patch) (await rowdata(aid))[1] = note; chg = true; }
      if (rd) { await write(aid, { device_id: rd }); chg = true; }
      rep[chg ? "updated" : "same"]++;
    } else {
      aid = await insertAcc({ tab_id: tab, dept_id: dept, owner_id: ro, status_id: rs, note, data, created: ts, updated: ts });
      if (key) m0.set(key, aid);
      if (rd) await write(aid, { device_id: rd });
      rep.created++;
    }
    for (const [fid, good] of lks) {
      const lt = linkTab(fid)!;
      for (const [k, a] of good) { const dst = await resolve(lt, k, a, dept, ro, mode, ln); if (dst && dst !== aid) lcur.push({ src: aid, dst, field_id: fid }); }
    }
  }
  if (!dry) {
    const before = lcur.length ? (await sb().from(T.links).select("id", { count: "exact", head: true })).count ?? 0 : 0;
    await addLinks(lcur.filter((l) => l.src > 0 && l.dst > 0));
    const after = lcur.length ? (await sb().from(T.links).select("id", { count: "exact", head: true })).count ?? 0 : 0;
    rep.l_links += after - before;
  } else rep.l_links += lcur.length;
  if (dry || b.last) { BKC.sid = null; BKC.idx = new Map(); BKC.chk = new Map(); }
  return rep;
}

/* ───────── cập nhật theo từng dòng (đối chiếu cũ/mới) ───────── */
export async function rowsSet(b: Body) {
  const ts = now(); let n = 0;
  for (const it of (Array.isArray(b.items) ? b.items : []) as Body[]) {
    const r = await run<Account | null>(sb().from(T.accounts).select("*").eq("id", num(it.id) ?? 0).maybeSingle());
    if (!r) continue;
    const d = { ...dataOf(r.data) };
    const valid = new Map((await run<{ id: Id; type: string }[]>(sb().from(T.fields).select("id,type").eq("tab_id", r.tab_id))).map((f) => [String(f.id), f.type]));
    for (const [k, v] of Object.entries(dataOf(it.data))) {
      const t = valid.get(String(k)); if (!t || t === "link" || t === "file") continue;
      if (v === null || v === undefined || v === "") delete d[String(k)]; else d[String(k)] = String(v);
    }
    const patch: Record<string, unknown> = { data: d, updated: ts };
    if ("note" in it) patch.note = str(it.note);
    if ("status_id" in it) {
      const sid = num(it.status_id);
      if (sid === null || (await run(sb().from(T.statuses).select("id").eq("id", sid).eq("tab_id", r.tab_id).maybeSingle()))) patch.status_id = sid;
    }
    if ("owner_id" in it) {
      const oid = num(it.owner_id);
      const o = oid ? await run<{ dept_id: Id } | null>(sb().from(T.owners).select("dept_id").eq("id", oid).maybeSingle()) : null;
      if (o) { patch.owner_id = oid; patch.dept_id = o.dept_id; } else if (oid === null) patch.owner_id = null;
    }
    if ("device_id" in it) { const dv = num(it.device_id); if (dv === null || (await exists("devices", dv))) patch.device_id = dv; }
    await run(sb().from(T.accounts).update(patch).eq("id", r.id));
    n++;
  }
  return { updated: n };
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
    if ("caps" in vals) { const caps: Record<string, number> = {}; for (const [k, v] of Object.entries(dataOf(vals.caps))) if (Number(v) > 0) caps[String(k)] = Math.trunc(Number(v)); vals.caps = j(caps); }
    if (vals.kind !== undefined && !["phone", "pc", "boxphone"].includes(String(vals.kind))) vals.kind = "phone";
    if ("name" in vals) { vals.name = str(vals.name).trim(); if (!vals.name) throw new HsError("Tên thiết bị trống"); }
  }
  const id = num(b.id);
  if (id) {
    if (kind === "owner" && vals.parent_id) {
      let p = vals.parent_id as Id | null; const seen = new Set<Id>();
      while (p && !seen.has(p)) {
        if (p === id) throw new HsError("Owner không thể là cấp trên của chính nó / cấp dưới của nó");
        seen.add(p);
        const r = await run<{ parent_id: Id | null } | null>(sb().from(T.owners).select("parent_id").eq("id", p).maybeSingle());
        p = r?.parent_id ?? null;
      }
    }
    if (Object.keys(vals).length) await run(sb().from(T[table]).update(vals).eq("id", id));
    if (kind === "field") {
      if ("type" in vals && vals.type !== "link") { await run(sb().from(T.links).delete().eq("field_id", id)); await run(sb().from(T.fields).update({ link_tab: null }).eq("id", id)); }
      if ("link_tab" in vals) {
        const okIds = await run<{ id: Id }[]>(sb().from(T.accounts).select("id").eq("tab_id", (vals.link_tab as Id | null) ?? -1));
        const keep = new Set(okIds.map((r) => r.id));
        const ls = await run<{ id: Id; dst: Id }[]>(sb().from(T.links).select("id,dst").eq("field_id", id));
        const bad = ls.filter((l) => !keep.has(l.dst)).map((l) => l.id);
        for (const ch of chunks(bad, 500)) await run(sb().from(T.links).delete().in("id", ch));
      }
    }
    return { id };
  }
  const where = kind === "field" || kind === "status" ? { col: "tab_id", val: num(b.tab_id)! } : kind === "owner" ? { col: "dept_id", val: num(b.dept_id)! } : undefined;
  vals.pos = await nextPos(table, where);
  if (kind === "device") vals.created = now();
  const nid = await insertId(table, vals);
  if (kind === "tab" && b._init) {
    await run(sb().from(T.fields).insert({ tab_id: nid, label: "Tên", type: "text", pos: 1 }));
    await run(sb().from(T.statuses).insert([{ tab_id: nid, label: "Live", color: "#10b981", pos: 1 }, { tab_id: nid, label: "Die", color: "#ef4444", pos: 2 }]));
  }
  return { id: nid };
}

export async function del(b: Body) {
  const t = String(b.table), i = num(b.id)!;
  const idsOf = async (q: Promise<{ id: Id }[]>) => (await q).map((r) => r.id);
  if (t === "depts") {
    await delAccountIds(await idsOf(run<{ id: Id }[]>(sb().from(T.accounts).select("id").eq("dept_id", i))));
    const devs = await idsOf(run<{ id: Id }[]>(sb().from(T.devices).select("id").eq("dept_id", i)));
    if (devs.length) await run(sb().from(T.accounts).update({ device_id: null }).in("device_id", devs));
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
    await delAccountIds(await idsOf(run<{ id: Id }[]>(sb().from(T.accounts).select("id").eq("tab_id", i))));
    const fids = [...await idsOf(run<{ id: Id }[]>(sb().from(T.fields).select("id").eq("tab_id", i))), ...await idsOf(run<{ id: Id }[]>(sb().from(T.fields).select("id").eq("link_tab", i)))];
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
  } else throw new HsError("bad table");
  return { ok: 1 };
}

export async function reorder(b: Body) {
  const t = String(b.table) as MetaTable;
  if (!["depts", "owners", "tabs", "fields", "statuses", "devices"].includes(t)) throw new HsError("bad table");
  const ids = toIds(b.ids);
  for (let pos = 1; pos <= ids.length; pos++) await run(sb().from(T[t]).update({ pos }).eq("id", ids[pos - 1]));
  return { ok: 1 };
}

/* ───────── cài đặt lặt vặt ───────── */
export async function tabKeys(b: Body) {
  const tid = num(b.tab_id) ?? 0;
  if (!(await exists("tabs", tid))) throw new HsError("Tab không tồn tại");
  const ok = new Set((await run<{ id: Id }[]>(sb().from(T.fields).select("id").eq("tab_id", tid))).map((r) => r.id));
  const ks: Id[] = [];
  for (const x of toIds(b.keys).slice(0, 2)) if (ok.has(x) && !ks.includes(x)) ks.push(x);
  const tk = await getJsonSetting<Record<string, Id[]>>("tab_keys", {});
  if (ks.length) tk[String(tid)] = ks; else delete tk[String(tid)];
  await setSetting("tab_keys", JSON.stringify(tk));
  return { ok: 1 };
}
export async function grpIcon(b: Body) {
  const g = str(b.g).trim(); if (!g) throw new HsError("Chưa có tên nhóm");
  const ic = str(b.icon).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
  const gi = await getJsonSetting<Record<string, string>>("grp_icons", {});
  if (ic) gi[g] = ic; else delete gi[g];
  await setSetting("grp_icons", JSON.stringify(gi));
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
export async function repair() { return run(sb().rpc("ahs_repair", { p_now: now() })); }
export { checkDb, ovTrend };

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
    const f = await firstField(num(b.tab_id)!);
    return str(dataOf(b.data)[String(f)]);
  }
  if (["dept", "owner", "tab", "field", "status", "device"].includes(name)) return str(b.name || b.label || `#${b.id ?? ""}`);
  if (name === "delete") return `${b.table} #${b.id}`;
  if (name === "bulk") return `${Array.isArray(b.rows) ? b.rows.length : 0} dòng`;
  if (name === "device_bulk") return `${Array.isArray(b.rows) ? b.rows.length : 0} máy`;
  return str(b.name);
}
export function needsSnap(name: string, b: Body): boolean {
  const n = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  if (name === "delete_accounts") return n(b.ids) >= 20;
  if (name === "delete") return ["depts", "tabs", "fields", "statuses", "owners"].includes(String(b.table));
  if (name === "bulk") return ((b.mode === "update" || b.mode === "fill") && n(b.rows) >= 20) || n(b.rows) >= 2000;
  if (name === "mass_set") return n(b.ids) >= 20;
  if (name === "rows_set") return n(b.items) >= 20;
  return false;
}
