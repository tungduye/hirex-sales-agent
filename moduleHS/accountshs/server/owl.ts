import "server-only";

import { createHash } from "node:crypto";
import { postOpenAIResponse, responseOutputText } from "@/lib/openai/responses";
import { HsError, T, chunks, getJsonSetting, log, now, orMissing, pages, run, sb, setSetting } from "./db";
import { dataVersion, firstStatus, getDevices, getMeta, loadAccounts, loadLinks } from "./accounts-data";
import { delAccountIds } from "./accounts-routes";
import { BUCKET, snapshot } from "./backup";
import * as Q from "./owl-query";
import * as R from "./owl-rules";
import * as H from "./owl-hint";
import type { Id } from "../types";

/* Cú vọ (trợ lý AI của AccountsHS) — port I/O của chatbot/AI_deepSearch.py (chat · xem trước/duyệt/áp dụng · phản hồi · tự học · sao lưu)
   + bộ máy dữ liệu của AI_engine.py. Luật hiểu câu ở owl-rules.ts (+ owl-hint.ts), bộ đánh giá truy vấn ở owl-query.ts (đều thuần).
   Mỗi câu: MẪU ĐÃ HỌC (ahs_ai_samples) → LUẬT (hint + understand + merge_hint) → OpenAI (Responses API, có kiểm chứng). */
type Body = Record<string, unknown>;
type Fn = (b: Body) => Promise<unknown>;
type Level = "view" | "edit" | "manage";
type O = R.O;
const MAXN = Q.MAXN, TTL = 900, MAXP = 500, TABLE = "ahs_ai_samples", AIDIR = "ai";
const sha = (s: string, n: number) => createHash("sha1").update(s).digest("hex").slice(0, n);
const isAsk = (e: unknown): e is R.Ask => e instanceof R.Ask;
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────── cấu hình (ahs_settings 'ai_cfg') — key OpenAI chỉ ở máy chủ (OPENAI_API_KEY), không lưu DB ───────── */
interface Fx { on: boolean; delay: number; after: number; info: boolean }
interface Cfg { on: boolean; model: string; timeout: number; retries: number; retry_delay: number; auto_ai: boolean; zero_retry: boolean; learn: boolean; learn_n: number; backup_keep: number; fx: Record<string, Fx> }
const MODEL0 = () => process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const CFG0 = (): Cfg => ({ on: true, model: "", timeout: 60, retries: 3, retry_delay: 2, auto_ai: true, zero_retry: true, learn: true, learn_n: 6, backup_keep: 5, fx: {} });
const LIM: Record<string, [number, number]> = { timeout: [10, 180], retries: [0, 10], retry_delay: [0, 30], backup_keep: [1, 100], learn_n: [1, 12] };
const FX0: Fx = { on: true, delay: 1.2, after: 1.5, info: true }, LIMFX: Record<string, [number, number]> = { delay: [0, 30], after: [0, 10] };
function cleanFx(d: unknown): Record<string, Fx> {
  const out: Record<string, Fx> = {};
  for (const [k, v] of Q.isObj(d) ? Object.entries(d).slice(0, 60) : []) if (Q.isObj(v)) {
    const o: Fx = { ...FX0, on: v.on !== false, info: v.info !== false };
    for (const [f, [lo, hi]] of Object.entries(LIMFX)) { const x = parseFloat(String(v[f] ?? FX0[f as "delay"])); if (Number.isFinite(x)) o[f as "delay"] = Math.round(Math.min(hi, Math.max(lo, x)) * 100) / 100; }
    out[String(k).slice(0, 120)] = o;
  }
  return out;
}
async function cfg(): Promise<Cfg> { const c = { ...CFG0(), ...(await getJsonSetting<Partial<Cfg>>("ai_cfg", {})) }; c.fx = cleanFx(c.fx); c.model = c.model || MODEL0(); return c; }
const hasAi = (c: Cfg) => !!process.env.OPENAI_API_KEY && !!c.model;

/* ───────── kho đã học: mẫu câu (bảng ahs_ai_samples) · từ đã dạy (ai_alias) · bài học (ai_training) ───────── */
interface PRow { id: string; sig: string; x: string | null; q: string | null; plan: O; hits: number | null; ts: number | null; auto: boolean | null; from_id: string | null }
const toPat = (r: PRow): R.Pattern => ({ id: r.id, sig: r.sig, plan: r.plan, hits: r.hits ?? 0, ts: r.ts ?? 0, ...(r.auto ? { auto: true } : {}), ...(r.from_id ? { from: r.from_id } : {}), ...(r.x ? { x: r.x } : {}), ...(r.q ? { q: r.q } : {}) });
const toRow = (p: R.Pattern) => ({ id: p.id, sig: p.sig, x: p.x ?? null, q: p.q ? p.q.slice(0, 200) : null, plan: p.plan, hits: p.hits || 0, ts: p.ts || now(), auto: !!p.auto, from_id: p.from ?? null });
let PC: { at: number; ps: R.Pattern[] } | null = null;
async function patterns(): Promise<R.Pattern[]> {
  if (PC && Date.now() - PC.at < 30_000) return PC.ps;
  const rows = await orMissing(pages<PRow>((a, b) => sb().from(TABLE).select("*").order("ts").order("id").range(a, b)), () => [] as PRow[]); // Supabase cắt 1000 dòng / lần → đọc theo trang
  PC = { at: Date.now(), ps: rows.map(toPat) }; return PC.ps;
}
async function patPut(ps: R.Pattern[]) { if (ps.length) { await backupLogic(1800); await run(sb().from(TABLE).upsert(ps.map(toRow), { onConflict: "id" })); } PC = null; await trimPatterns(); }
async function patDel(ids: string[]) { if (!ids.length) return; await backupLogic(1800); for (const ch of chunks(ids, 200)) await run(sb().from(TABLE).delete().in("id", ch)); PC = null; }
/** giữ tối đa MAXP mẫu: quá thì bỏ mẫu tự học cũ nhất trước, hết mới bỏ mẫu đã xác nhận cũ nhất */
async function trimPatterns() {
  const ps = await patterns(); if (ps.length <= MAXP) return;
  const auto = ps.filter((p) => p.auto), rest = ps.filter((p) => !p.auto), n = ps.length - MAXP;
  await patDel([...auto, ...rest].slice(0, n).map((p) => p.id));
}
const alias = () => getJsonSetting<Record<string, string>>("ai_alias", {});
async function learnAlias(term: string, ref: string) { const al = await alias(); al[Q.fold(term)] = ref; const ks = Object.keys(al); for (const k of ks.slice(0, Math.max(0, ks.length - 200))) delete al[k]; await setSetting("ai_alias", JSON.stringify(al)); }
const trLoad = async () => (await getJsonSetting<{ items?: R.TrainItem[] }>("ai_training", {})).items?.filter((x) => x && x.sig) ?? [];
async function trSave(items: R.TrainItem[]) {
  const op = items.filter((x) => x.status !== "fixed").slice(-200), fx = items.filter((x) => x.status === "fixed").slice(-100);
  await setSetting("ai_training", JSON.stringify({ version: 1, note: "open = câu trả lời bị 👎 (chưa có cách hiểu đúng) · fixed = đã có cách hiểu đúng do người dùng 👍", items: [...op, ...fx].sort((a, b) => (a.ts || 0) - (b.ts || 0)) }));
}
function cleanPatterns(ps: unknown): R.Pattern[] {
  return (Array.isArray(ps) ? ps : []).filter((p): p is O => Q.isObj(p) && typeof p.sig === "string" && Q.isObj(p.plan)).map((p) => ({
    id: String(p.id || sha(String(p.sig), 8)), sig: String(p.sig), plan: p.plan as O, hits: Math.trunc(Number(p.hits) || 0), ts: Number(p.ts) || now(),
    ...(p.auto ? { auto: true } : {}), ...(p.from ? { from: String(p.from) } : {}), ...(p.x ? { x: String(p.x).slice(0, 300) } : {}), ...(p.q ? { q: String(p.q).slice(0, 200) } : {}) }));
}

/* ───────── sao lưu Wayer → Storage hs-accountshs/ai/AI_wayer_YYYYMMDD_HHMMSS.json ───────── */
const BK_RE = /^AI_(?:wayer|logic)_\d{8}_\d{6}\.json$/;
const storage = () => sb().storage.from(BUCKET);
async function bnames(): Promise<string[]> { const { data, error } = await storage().list(AIDIR, { limit: 1000 }); if (error) return []; return ((data ?? []) as Array<{ name: string }>).map((x) => x.name).filter((n) => BK_RE.test(n)).sort().reverse(); }
const bts = (n: string) => { const m = /(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)/.exec(n); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5], +m[6]) / 1000 : 0; };
async function bread(name: string): Promise<O> { const { data, error } = await storage().download(`${AIDIR}/${name}`); if (error || !data) return {}; try { const o: unknown = JSON.parse(await data.text()); return Q.isObj(o) ? o : {}; } catch { return {}; } }
async function logicText(): Promise<string> { const [al, ps] = await Promise.all([alias(), patterns()]); return JSON.stringify({ version: 3, alias: al, patterns: ps }, null, 1); }
/** chép Wayer hiện có vào ai/ (bỏ qua nếu rỗng, trùng bản gần nhất, hoặc bản gần nhất mới hơn minAge giây); giữ backup_keep bản */
async function backupLogic(minAge = 0): Promise<string | null> {
  const txt = await logicText(), o = JSON.parse(txt) as O;
  if (!(Array.isArray(o.patterns) && o.patterns.length) && !Object.keys((o.alias as O) ?? {}).length) return null;
  const names = await bnames();
  if (names.length && minAge && now() - bts(names[0]) < minAge) return null;
  const st = new Date(Date.now() + 7 * 3600_000).toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15), name = `AI_wayer_${st}.json`;
  if (names.includes(name)) return name;
  if (names.length && JSON.stringify(await bread(names[0])) === JSON.stringify(o)) return names[0];
  const { error } = await storage().upload(`${AIDIR}/${name}`, Buffer.from(txt, "utf8"), { contentType: "application/json", upsert: true }); if (error) throw new HsError(error.message, 500);
  const keep = (await cfg()).backup_keep || 5, old = (await bnames()).slice(Math.max(1, keep === 20 ? 5 : keep));
  if (old.length) await storage().remove(old.map((n) => `${AIDIR}/${n}`));
  BKC = null; return name;
}
let BKC: { k: string; v: O[] } | null = null;
async function backups(n = 8): Promise<O[]> {
  const names = (await bnames()).slice(0, n), k = names.join("|"); if (BKC?.k === k) return BKC.v;
  const v = await Promise.all(names.map(async (name) => { const d = await bread(name); return { name, ts: bts(name), patterns: Array.isArray(d.patterns) ? d.patterns.length : 0, alias: Q.isObj(d.alias) ? Object.keys(d.alias).length : 0 }; }));
  BKC = { k, v }; return v;
}

/* ───────── dữ liệu: nạp toàn bộ dòng 1 lần / phiên bản (ahs_ver) — thay AI_index.db ───────── */
type LinkRow = { src: Id; dst: Id; field_id: Id };
interface DS { ver: number; meta: Q.QMeta; accs: Q.AccRow[]; links: LinkRow[]; A: Map<Id, Q.AccRow>; cx: Q.Cx; prof: R.Prof; vi: Map<string, Map<Id, number>> | null; ms: string }
let DSC: DS | null = null, DSP: Promise<DS> | null = null;
async function loadMeta(): Promise<Q.QMeta> {
  const [m, devices] = await Promise.all([getMeta(), getDevices()]);
  return { tabs: m.tabs.map((t) => ({ id: t.id, name: t.name, icon: t.icon })), fields: m.tabs.flatMap((t) => t.fields), sts: m.tabs.flatMap((t) => t.statuses), owners: m.owners, depts: m.depts, devices: devices.map((d) => ({ id: d.id, name: d.name })) };
}
async function data(): Promise<DS> {
  const [ver, meta] = await Promise.all([dataVersion(), loadMeta()]), ms = JSON.stringify(meta);
  if (DSC && DSC.ver === ver && DSC.ms === ms) return DSC;
  if (DSC && DSC.ver === ver) { DSC = build(meta, DSC.accs, DSC.links, ver, ms); return DSC; }
  return (DSP ??= (async () => {
    try {
      const [at, lt] = await Promise.all([loadAccounts([], null), loadLinks([], null)]);
      const accs = (at as unknown as Array<Q.AccRow & { note: string | null; data: Record<string, unknown> | null }>).map((a) => ({ ...a, note: a.note ?? "", data: a.data ?? {} }));
      const links = lt.map((l) => ({ src: l.src, dst: l.dst, field_id: l.f }));
      DSC = build(meta, accs, links, ver, ms); return DSC;
    } finally { DSP = null; }
  })());
}
function build(meta: Q.QMeta, accs: Q.AccRow[], links: LinkRow[], ver: number, ms: string): DS {
  const cx = Q.mkCx(meta); Q.cxAddLinks(cx, links); const A = new Map<Id, Q.AccRow>();
  for (const a of accs) { A.set(a.id, a); cx.atab.set(a.id, a.tab_id); }
  return { ver, meta, accs, A, cx, prof: R.buildProf(meta.fields, accs), vi: null, ms, links };
}
const profLike = (d: DS): Q.ProfLike => ({ contentField: (t) => R.contentField(d.prof, t), kindOf: (f) => R.fprofOf(d.prof, f).kind });
async function brain(d: DS, ctx: R.Ctx = {}): Promise<R.Brain> { return new R.Brain(d.meta, { prof: d.prof, vidx: () => (d.vi ??= R.buildVidx(d.accs)), alias: await alias() }, ctx); }
/** query(): phạm vi tab/bộ phận/owner(+cấp dưới)/ids → owl-query.evalSpec (lọc · sắp · nhóm · tổng · trùng) */
function query(d: DS, sp: Q.Spec, view = 12): Q.QueryResult {
  let rows = d.accs;
  if (sp.tab !== undefined && sp.tab !== null && sp.tab !== "all" && String(sp.tab) !== "") { const t = Number(sp.tab); rows = rows.filter((a) => a.tab_id === t); }
  if (sp.dept !== undefined && sp.dept !== null) { const dp = Number(sp.dept); rows = rows.filter((a) => a.dept_id === dp); }
  if (!(sp.owner === undefined || sp.owner === null || (Array.isArray(sp.owner) && !sp.owner.length))) {
    const ids = new Set<Id>(); for (const o of Q.asList(sp.owner)) { if (sp.sub !== false) Q.descendants(Number(o), d.meta.owners, ids); else ids.add(Number(o)); }
    rows = rows.filter((a) => a.owner_id !== null && ids.has(a.owner_id));
  }
  if (sp.ids !== undefined && sp.ids !== null) { const s = new Set(Q.asList(sp.ids).slice(0, MAXN).map(Number)); rows = rows.filter((a) => s.has(a.id)); }
  return Q.evalSpec(sp, rows, d.cx, d.A, view, profLike(d), d.accs);
}

/* ───────── xem trước (trước → sau) · duyệt từng dòng · áp dụng ───────── */
interface PItem { id: Id | null; acts: Q.Act[] }
const PENDING = new Map<string, { ts: number; items: Map<string, PItem>; desc: string }>();
function stash(items: Map<string, PItem>, desc: string) {
  const t = now(); for (const [k, v] of PENDING) if (t - v.ts > TTL) PENDING.delete(k);
  const tk = sha(`${t}|${items.size}|${Math.random()}`, 16); PENDING.set(tk, { ts: t, items, desc }); return tk;
}
interface Change { key: string; id: Id | null; label: string; edits: Array<{ k: string | Id; field: string; before: string; after: string }> }
const pvOut = (items: Map<string, PItem>, ch: Change[], desc: string, ids: Id[], destructive: boolean, matched: number) => ({ token: stash(items, desc), count: items.size, changes: ch.slice(0, MAXN), ids, destructive, matched });
function preview(d: DS, spec: Q.Spec, ops: O[]) {
  const r = query(d, spec, 1);
  if (r.count > MAXN) throw new Error(`Quá nhiều dòng (${r.count} > ${MAXN}) - hãy lọc hẹp hơn`);
  const items = new Map<string, PItem>(), ch: Change[] = [];
  for (const a of r.all) {
    const edits: Change["edits"] = [], acts: Q.Act[] = [];
    for (const op of ops) { const p = Q.planAct(op as unknown as Q.Op, a, d.cx); if (p && (p.before !== p.after || p.act[0] === "delete")) { edits.push({ k: p.k, field: p.field, before: p.before, after: p.after }); acts.push(p.act); } }
    if (acts.length) { items.set(String(a.id), { id: a.id, acts }); ch.push({ key: String(a.id), id: a.id, label: Q.cxLabel(d.cx, a), edits }); }
  }
  return pvOut(items, ch, `sửa ${items.size} dòng`, r.all.slice(0, MAXN).map((a) => a.id), [...items.values()].some((v) => v.acts.some((x) => x[0] === "delete")), r.count);
}
async function previewAdd(d: DS, spec: Q.Spec, rows: Array<Record<string, string>>) {
  const own = !Array.isArray(spec.owner) && spec.owner !== undefined && spec.owner !== null ? d.meta.owners.find((o) => o.id === Number(spec.owner)) : undefined;
  const dept = own ? own.dept_id : spec.dept ?? null, tab = d.meta.tabs.find((t) => t.id === Number(spec.tab));
  if (!tab) throw new Error("Không tìm thấy tab");
  const want = new Set(Q.asList(spec.status).map(Q.fold));
  const sid = d.meta.sts.find((s) => s.tab_id === tab.id && want.has(Q.fold(s.label)))?.id ?? (await firstStatus(tab.id));
  const items = new Map<string, PItem>(), ch: Change[] = [];
  rows.slice(0, MAXN).forEach((dt, i) => {
    items.set(`n${i}`, { id: null, acts: [["create", tab.id, dept === null ? null : Number(dept), own ? own.id : null, sid, dt]] });
    ch.push({ key: `n${i}`, id: null, label: Object.values(dt)[0] ?? "", edits: [{ k: "create", field: tab.name, before: "", after: Object.values(dt).join(" | ") }] });
  });
  return pvOut(items, ch, `thêm ${items.size} dòng vào ${tab.name}`, [], false, items.size);
}
async function pool<X>(xs: X[], n: number, fn: (x: X) => Promise<void>) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) await fn(xs[i++]); })); }
/** ghi các dòng đã duyệt: keys = [khóa…] | 'all'. Phần chưa duyệt vẫn chờ trong token */
async function apply(b: Body) {
  const p = PENDING.get(String(b.token));
  if (!p || now() - p.ts > TTL) throw new HsError("Phiên xác nhận đã hết hạn - hãy yêu cầu lại");
  const keys = b.keys === undefined || b.keys === null || b.keys === "all" ? [...p.items.keys()] : Q.asList(b.keys as string[]).map(String).filter((k) => p.items.has(k));
  if (!keys.length) return { applied: 0, left: p.items.size };
  await snapshot();
  const t = now(), dele: Id[] = [], grp = new Map<string, Id[]>(), per: Array<[Id, Q.Act]> = [], ins: O[] = [];
  let n = 0;
  for (const k of keys) {
    const it = p.items.get(k)!; p.items.delete(k);
    for (const a of it.acts) {
      const i = it.id!;
      if (a[0] === "delete") dele.push(i); else if (a[0] === "status" || a[0] === "owner") { const g = JSON.stringify(a); (grp.get(g) ?? grp.set(g, []).get(g)!).push(i); }
      else if (a[0] === "create") ins.push({ tab_id: a[1], dept_id: a[2], owner_id: a[3], status_id: a[4], note: "", data: a[5], created: t + n * 1e-6, updated: t });
      else per.push([i, a]);
    }
    n++;
  }
  const odept = new Map(((DSC?.meta.owners) ?? (await loadMeta()).owners).map((o) => [o.id, o.dept_id] as const));
  for (const [g, ids] of grp) {
    const a = JSON.parse(g) as Q.Act, patch: O = a[0] === "status" ? { status_id: a[1], updated: t } : { owner_id: a[1], dept_id: odept.get(a[1] as Id), updated: t };
    for (const ch of chunks(ids, 400)) await run(sb().from(T.accounts).update(patch).in("id", ch));
  }
  await pool(per, 8, async ([i, a]) => {
    if (a[0] === "note") await run(sb().from(T.accounts).update({ note: a[1], updated: t }).eq("id", i));
    else if (a[0] === "field") {
      const r = await run<{ data: Record<string, unknown> | null } | null>(sb().from(T.accounts).select("data").eq("id", i).maybeSingle());
      if (r) { const dt = { ...(r.data ?? {}) }; if (a[2] === "") delete dt[String(a[1])]; else dt[String(a[1])] = a[2]; await run(sb().from(T.accounts).update({ data: dt, updated: t }).eq("id", i)); }
    }
  });
  for (const ch of chunks(ins, 500)) await run(sb().from(T.accounts).insert(ch));
  if (dele.length) await delAccountIds(dele);
  const left = p.items.size; if (!left) PENDING.delete(String(b.token));
  await log("ai_apply", n, p.desc);
  return { applied: n, left };
}
/** bỏ qua các dòng không muốn sửa: keys = [khóa…] | 'all' */
async function drop(b: Body) {
  const p = PENDING.get(String(b.token));
  if (p) { for (const k of b.keys === undefined || b.keys === null || b.keys === "all" ? [...p.items.keys()] : Q.asList(b.keys as string[]).map(String)) p.items.delete(k); if (!p.items.size) PENDING.delete(String(b.token)); }
  return { left: p ? p.items.size : 0 };
}

/* ───────── trả lời: chip · gợi ý · thực thi ───────── */
/** 0 kết quả: thử bỏ từng điều kiện, cho biết điều kiện nào đang chặn và bỏ đi thì ra bao nhiêu dòng */
function relax(d: DS, sp: Q.Spec, chs: R.Chip[]) {
  const cand = chs.filter((c) => ["status", "where", "q", "owner", "dept"].includes(c.k));
  if (cand.length < 2 && !cand.some((c) => ["status", "q", "owner", "dept"].includes(c.k))) return [];
  const out: Array<{ k: string; i: number | null; t: string; n: number }> = [];
  for (const c of cand.slice(0, 8)) {
    const s2 = R.jc(sp);
    if (c.k === "where") { s2.where = (s2.where ?? []).filter((_, k) => k !== c.i); if (!s2.where.length) delete s2.where; } else delete s2[c.k];
    let n = 0; try { n = query(d, s2, 0).count; } catch { continue; }
    if (n) out.push({ k: c.k, i: c.i ?? null, t: c.t, n });
  }
  return out.sort((a, b) => b.n - a.n).slice(0, 3);
}
const tabsOf = (d: DS, ids: Id[]) => [...new Set(ids.slice(0, 20000).map((i) => d.A.get(i)?.tab_id).filter((x): x is Id => x !== undefined))].sort((a, b) => a - b);
async function execute(d: DS, pl: R.Plan, B: R.Brain): Promise<O> {
  let out = await execute0(d, pl, B); const sp = pl.spec ?? {};
  if ((out.kind === "search" || out.kind === "count") && !out.count && sp.q && ["where", "status", "owner", "tab"].some((k) => R.tru(sp[k])) && !pl._noq) {
    try { // 0 dòng vì chữ thừa ("lớp", "qua"…) → bỏ chữ đó, các điều kiện khác giữ nguyên
      const pl2 = R.jc(pl), q0 = String(pl2.spec!.q); delete pl2.spec!.q; pl2._noq = true;
      const o2 = await execute0(d, pl2, B);
      if (o2.count && (R.tru(sp.where) || R.tru(sp.status) || R.tru(sp.owner))) { pl.spec = pl2.spec; out = o2; out.ignored = [...((out.ignored as string[]) ?? []), q0]; out.msg = `${String(out.msg ?? "")} (bỏ qua chữ "${q0}")`; }
    } catch { /* giữ kết quả cũ */ }
  }
  const ids = [...((out.ids as Id[]) ?? []), ...(((out.preview as O | undefined)?.ids as Id[]) ?? [])];
  if (ids.length) out.tabs = tabsOf(d, ids);
  return out;
}
async function execute0(d: DS, pl: R.Plan, B: R.Brain): Promise<O> {
  const it = pl.it, sp = pl.spec ?? {}, out: O = { kind: it, spec: sp, chips: R.chips(sp, B, pl.ui ?? []), ignored: pl.rest ?? [] };
  if (it === "help") return { ...out, suggest: R.suggestions(B) };
  if (it === "say") return { ...out, msg: pl.msg };
  if (it === "search" || it === "count") {
    const r = query(d, sp, 12), noun = typeof sp.tab === "number" && B.T.has(sp.tab) ? B.T.get(sp.tab)!.name : "dòng";
    Object.assign(out, { count: r.count, rows: r.rows, stats: r.stats, ids: r.ids, msg: r.count ? `Có ${r.count} ${noun}` : `Không có ${noun} nào khớp` });
    if (r.agg && r.agg.v !== null && sp.agg) out.msg = `${R.AGGN[r.agg.fn] ?? r.agg.fn} ${R.fldName(sp.agg.field, B).toLowerCase()}: ${R.fmtn(r.agg.v)} · ${r.agg.n} ${noun}`;
    if (r.count) out.next = R.nexts(sp, B);
    const inl = Q.sortsOf(sp).find((x) => x.field === "inlinks");
    if (r.count && inl) out.msg = `Top ${r.count} ${noun} liên kết nhiều ${inl.by === "count" ? "dòng" : "nền tảng"} nhất`;
    if (r.count && sp.dup) out.msg = `Có ${r.count} ${noun} trùng lặp`;
    if (r.groups && r.count && sp.group) {
      const gl = R.groupLabel(sp.group.by, B);
      Object.assign(out, { kind: "group", gby: gl, groups: r.groups.map((g) => ({ t: g.k, n: g.n, c: g.c })), msg: `${r.count} ${noun} - ${r.groups.length} nhóm theo ${gl.toLowerCase()}` });
      if (sp.agg) out.msg = `${R.AGGN[sp.agg.fn] ?? ""} ${R.fldName(sp.agg.field, B).toLowerCase()} theo ${gl.toLowerCase()} - ${r.groups.length} nhóm`;
      out.ids = [...new Set([...r.ids, ...r.groups.flatMap((g) => g.ids)])].slice(0, MAXN);
    }
    if (!r.count) { out.relax = relax(d, sp, out.chips as R.Chip[]); out.suggest = R.suggestions(B).slice(0, 3); }
    return out;
  }
  if (it === "add") {
    const pv = await previewAdd(d, sp, pl.rows ?? []);
    (out.chips as R.Chip[]).push({ k: "rows", ic: "listplus", t: `${(pl.rows ?? []).length} dòng · ${(pl.cols ?? []).join(" | ")}` });
    return { ...out, kind: "change", preview: pv, add: true, data: pl.rows, msg: `Thêm ${pv.count} dòng` };
  }
  const pv = preview(d, sp, pl.ops ?? []), what = [...new Set(pv.changes.flatMap((c) => c.edits.map((e) => e.field)))].join(", ");
  return { ...out, kind: "change", ops: pl.ops, preview: pv, destructive: pv.destructive, msg: pv.count ? `${what} - ${pv.count} dòng` : "Không có dòng nào cần thay đổi (đã đúng sẵn hoặc không khớp)" };
}

/* ───────── OpenAI (Responses API) — chỉ dịch câu thành JSON; tên → id, lọc, xem trước, ghi DB đều do server làm ───────── */
class Down extends Error { retry: boolean; constructor(msg: string, retry = true) { super(msg); this.retry = retry; } }
type Msg = { role: "system" | "user" | "assistant"; content: string };
async function llmCall(c: Cfg, msgs: Msg[], wait = 0): Promise<[string, string]> {
  if (wait) await sleep(wait * 1000);
  const apiKey = process.env.OPENAI_API_KEY; if (!apiKey) throw new Down("Chưa cấu hình OPENAI_API_KEY trên máy chủ", false);
  const model = c.model || MODEL0(), reason = /^(o\d|gpt-5)/.test(model);
  let res: Response;
  try { res = await postOpenAIResponse({ apiKey, timeoutMs: (c.timeout || 60) * 1000, body: { model, input: msgs, text: { format: { type: "json_object" } }, ...(reason ? { max_output_tokens: 2500 } : { temperature: 0, max_output_tokens: 900 }) } }); }
  catch (e) { throw new Down(`Không kết nối được OpenAI (${msgOf(e).slice(0, 60)})`); }
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const more = Q.isObj(payload) && Q.isObj(payload.error) ? String(payload.error.message ?? "").slice(0, 90) : "";
    const m = ({ 401: "Key OpenAI không hợp lệ", 402: "Tài khoản OpenAI hết hạn mức", 403: "OpenAI từ chối truy cập (kiểm tra key / quyền)", 404: "Không tìm thấy model (404)", 429: "Đang bị giới hạn lượt (429)" } as Record<number, string>)[res.status] ?? `OpenAI lỗi ${res.status}`;
    throw new Down(m + (more && (res.status === 400 || res.status === 404) ? " - " + more : ""), ![400, 401, 402, 403, 404].includes(res.status));
  }
  const txt = responseOutputText(payload);
  if (!txt.trim()) throw new Down("Model trả về rỗng - thử lại");
  return [txt, Q.isObj(payload) && typeof payload.model === "string" ? payload.model : model];
}
const SYS = `Bạn là bộ não của app quản lý tài nguyên AccountsHS (Facebook, Email, SĐT, Page... liên kết nhau). Người dùng nói tiếng Việt.
Trả về DUY NHẤT một JSON (bỏ khóa không cần):
{"do":"search|count|set|delete|add|ask|say","say":"câu trả lời ngắn","tab":"tên tab","dept":"bộ phận","owner":["tên"],"status":["tình trạng"],
 "where":[ĐIỀU KIỆN,...],"q":"chữ tìm tự do","sort":{"field":"..","dir":"asc|desc"} hoặc [nhiều khóa],"limit":10,
 "dup":{"field":"tên trường","min":2},"group":{"by":"Owner|Tình trạng|Tab|Bộ phận|Ngày tạo|tên trường","top":5,"min":1,"order":"desc|asc"},
 "ids":"selected|previous","ops":[{"op":"set_status|set_owner|set_field|set_note|delete","field":"tên trường","value":"...","mode":"append"}],
 "rows":[["cột1","cột2"]],"ask":{"question":"...","options":["..."]}}
ĐIỀU KIỆN (các phần tử của where mặc định là VÀ với nhau) là một trong:
  {"field":"tên trường","op":"eq|ne|in|nin|contains|starts|not_contains|empty|not_empty","value":"..."}
  so số: op num_gt|num_gte|num_lt|num_lte|num_eq|num_between (value số, between: [thấp,cao]) · độ dài chữ: len_gt|len_gte|len_lt|len_lte|len_eq · số lượng liên kết: cnt_gt|cnt_gte|cnt_lt|cnt_lte|cnt_eq
  ngày (trường "Ngày tạo" / "Ngày cập nhật" hoặc trường chứa ngày): op within_days (value = số ngày gần đây) | older_days | before | after (value "YYYY-MM-DD")
  HOẶC: {"or":[ĐK,ĐK,...]} · VÀ lồng: {"and":[...]} · PHỦ ĐỊNH: {"not":ĐK}
  QUA LIÊN KẾT: {"field":"Email xác minh","op":"any_link|all_link|no_link","value":{"tab":"Email","status":["Die"],"where":[ĐK,...]}} -> điều kiện lên DÒNG Ở ĐẦU KIA (any_link: có ít nhất 1 dòng liên kết thỏa; all_link: mọi dòng liên kết đều thỏa; no_link: không dòng nào thỏa). Trường "Liên kết" = chiều ngược lại (ai đang liên kết tới dòng này).
dup: tìm GIÁ TRỊ TRÙNG ("uid bị trùng", "sđt dùng cho nhiều tài khoản") -> {"do":"search","tab":..,"dup":{"field":"UID"}}.
group: NHÓM + ĐẾM ("mỗi owner có bao nhiêu fb live", "owner nào nhiều tài nguyên nhất" -> group by Owner top 1) -> {"do":"search", ...bộ lọc..., "group":{"by":"Owner"}}; hỏi "bao nhiêu" nhưng chia theo X cũng dùng group.
sort số: cột toàn số tự xếp theo số (9 < 10). Có thể xếp nhiều khóa: "sort":[{"field":"Owner"},{"field":"Ngày tạo","dir":"desc"}].
QUY TẮC: chỉ dùng đúng tên có trong danh sách; KHÔNG có "tab đang xem": nếu câu không nêu tab thì suy ra từ tên trường / giá trị / danh mục;
giá trị nằm trong mục DỮ LIỆU cho biết nó thuộc trường nào; "các dòng đang chọn" -> ids=selected; câu nối tiếp ("chỉ live", "của Hải nữa") -> ids=previous
và chỉ ghi phần thay đổi; sửa/xóa/thêm -> do=set|delete|add (hệ thống sẽ cho người dùng duyệt); thiếu thông tin hoặc tên mơ hồ -> do=ask kèm options thật; $LIST_1 là danh sách người dùng dán.
cnt_*: so sánh SỐ LƯỢNG dữ liệu liên kết, value là số ("email xác minh >1" / "nhiều hơn 1 email" -> field Email xác minh, op cnt_gt, value 1).
"có X" / "đã có X" (X là trường, kể cả trường liên kết như Email xác minh) -> where {field:X, op:not_empty}; "chưa có X" -> op:empty; "vừa có A vừa có B" = hai điều kiện đồng thời.
CHỈ thêm status khi người dùng nói rõ (Live, Die, ...); không tự suy ra tình trạng, owner hay q từ các từ đệm như "tôi muốn lấy ra danh sách". Viết tắt: fb=Facebook, tg=Telegram, wa=WhatsApp.
Câu mới có nêu tab / điều kiện đầy đủ là câu ĐỘC LẬP: không dùng ids=previous. Khóa tab phải là TÊN tab (không phải số).
CHÚ Ý DẤU: "lương" (tiền công) khác "lượng" (số lượng); "trùng" (giá trị lặp) khác "trung bình"; "mới" (vừa, tình trạng Mới) khác "mỗi" (từng → group); "chỉ" (thôi, lọc tiếp) khác "chi" (chi phí).
VÍ DỤ: "fb có email xác minh + sđt xác minh" -> {"do":"search","tab":"Facebook","where":[{"field":"Email xác minh","op":"not_empty"},{"field":"SĐT xác minh","op":"not_empty"}]}
"fb có email xác minh >1" -> {"do":"search","tab":"Facebook","where":[{"field":"Email xác minh","op":"cnt_gt","value":1}]}
"fb có pass trống hoặc email trống" -> {"do":"search","tab":"Facebook","where":[{"or":[{"field":"Pass","op":"empty"},{"field":"Email","op":"empty"}]}]}
"mỗi owner có bao nhiêu fb live" -> {"do":"search","tab":"Facebook","status":["Live"],"group":{"by":"Owner"}}
"uid bị trùng ở fb" -> {"do":"search","tab":"Facebook","dup":{"field":"UID"}}
"fb có email đang die" -> {"do":"search","tab":"Facebook","where":[{"field":"Email xác minh","op":"any_link","value":{"status":["Die"]}}]}
"fb tạo trong 7 ngày qua" -> {"do":"search","tab":"Facebook","where":[{"field":"Ngày tạo","op":"within_days","value":7}]}
"pass dài hơn 10 ký tự" -> where {"field":"Pass","op":"len_gt","value":10}
"bao nhiêu fb die của Hải" -> {"do":"count","tab":"Facebook","status":["Die"],"owner":["Hải"]}
"lấy ra 5 fb live của Hải" -> {"do":"search","tab":"Facebook","status":["Live"],"owner":["Hải"],"limit":5}
"đổi pass 5 fb live của Hải thành abc" -> {"do":"set","tab":"Facebook","status":["Live"],"owner":["Hải"],"limit":5,"ops":[{"op":"set_field","field":"Pass","value":"abc"}]}
Trường ảo "Liên kết" = các tài khoản Ở TAB KHÁC đang liên kết TỚI dòng này (vd một Email được 5 Facebook + 3 WhatsApp dùng). Dùng nó để xếp hạng: "email nhiều liên kết / nhiều nền tảng nhất" -> sort {"field":"Liên kết","by":"tabs","dir":"desc"} (by=tabs: nhiều NỀN TẢNG khác nhau nhất, bằng nhau thì nhiều tài khoản hơn; by=count: nhiều TÀI KHOẢN nhất), luôn kèm limit (mặc định 5). Lọc ngưỡng: "email có ≥3 liên kết" -> where {field:"Liên kết",op:"cnt_gte",value:3}. Câu xếp hạng KHÔNG cần hỏi lại.
"email có nhiều liên kết với nhiều nền tảng nhất" -> {"do":"search","tab":"Email","sort":{"field":"Liên kết","by":"tabs","dir":"desc"},"limit":5}
"chuyển toàn bộ tài nguyên của Hải sang Cường" / "giao hết của Hải cho Cường" -> {"do":"set","owner":["Hải"],"sub":false,"ops":[{"op":"set_owner","value":"Cường"}]} (KHÔNG nêu tab = áp dụng cho mọi tab; owner lọc nằm ở khóa owner, owner nhận nằm trong ops).
KHÔNG BAO GIỜ viết SQL / biểu thức vào value; where.value chỉ là giá trị thật. Nếu tên owner trùng nhiều người, hệ thống sẽ tự hỏi - bạn cứ dùng đúng tên người dùng nói.
"ghi chú / bổ sung / thêm ghi chú X cho uid 123" -> ops set_note mode "append" (NỐI THÊM vào ghi chú cũ). "thay thế / đổi / sửa ghi chú thành X" -> ops set_note mode "replace" (GHI ĐÈ). Nội dung ghi chú chỉ gồm phần X, không kèm động từ (bổ sung, thêm...).
Số đứng ngay trước tab / "cái" / "dòng" ("lấy 5 fb", "2 cái", "10 dòng") là SỐ DÒNG cần lấy -> limit, KHÔNG phải chữ tìm q. "cái / mấy cái này / dòng đó" không nêu tab -> ids=previous.
Người dùng nói tự nhiên, thiếu chủ ngữ, viết tắt: hãy suy luận ý họ, đừng hỏi lại nếu suy ra được.
TÌM NỘI DUNG ("bài nói về X", "có chữ X", "liên quan X"): where {"field":"<trường NỘI DUNG của tab>","op":"contains","value":"X"}; nhiều cụm: or / and.
TỔNG / TRUNG BÌNH / LỚN NHẤT / NHỎ NHẤT của trường số: "agg":{"fn":"sum|avg|max|min","field":"<trường số>"}; kèm group để tính theo từng nhóm ("tổng lượt thích theo chủ đề").
NHÓM THEO THỜI GIAN: "group":{"by":"<trường ngày | Ngày tạo>","unit":"day|week|month|year"}.  XẾP HẠNG theo trường số ("nhiều like nhất"): sort {"field":..,"dir":"desc"} + limit.
Thời gian cụ thể (hôm nay, tháng 9, năm 2025, từ 1/9 đến 15/9): where op after (từ ngày, gồm) + before (đến trước ngày, không gồm), value "YYYY-MM-DD".`;
const LEARN_SYS = `Bạn là bộ phận TỰ HỌC của app quản lý tài nguyên AccountsHS. Người dùng vừa xác nhận ĐÚNG cách hiểu của một câu hỏi.
Hãy viết thêm các câu hỏi TƯƠNG TỰ kèm kế hoạch JSON đúng của từng câu, để lần sau hệ thống trả lời ngay mà không cần hỏi AI.
Trả về DUY NHẤT một JSON: {"variants":[{"cau":"câu hỏi tiếng Việt","plan":{"do":"search|count","tab":"tên tab","owner":["tên"],"status":["tình trạng"],
 "where":[{"field":"tên trường","op":"eq|ne|in|nin|contains|starts|empty|not_empty|cnt_gt|cnt_gte|cnt_lt|cnt_lte|cnt_eq","value":"..."}]}}]}
QUY TẮC:
- Mỗi biến thể đổi MỘT khía cạnh so với câu gốc: (a) CẤU TRÚC khác (thêm / bớt "hoặc", nhóm theo owner / tình trạng, tìm trùng, điều kiện qua liên kết, so số / ngày) - tab, tình trạng, owner chỉ là chỗ trống nên KHÔNG cần biến thể chỉ khác tab / tình trạng / owner,
  (b) cách nói khác cùng ý (viết tắt fb/tg/wa, không dấu, "danh sách" / "lấy ra" / "cho xem"), (c) hỏi đếm ("bao nhiêu") thay vì liệt kê hoặc ngược lại,
  (d) thêm / bớt điều kiện "có" / "chưa có" một trường liên kết.
- Chỉ dùng ĐÚNG tên tab, trường, tình trạng, owner có trong danh sách bên dưới; KHÔNG bịa. Mỗi mẫu sẽ được dùng lại cho tab / trường / tình trạng / owner KHÁC nên hãy giữ cấu trúc thật rõ. Câu gốc có tên owner thì biến thể giữ owner đó hoặc dùng owner khác có trong danh sách.
- Mỗi câu phải ĐỘC LẬP và đầy đủ (nêu rõ tab / điều kiện), không dùng "nữa", "trước đó", "các dòng đang chọn". Chỉ TÌM / ĐẾM - KHÔNG sửa, xóa, thêm.
- Plan viết cùng khuôn với "HỆ THỐNG ĐÃ HIỂU". Không trùng câu gốc, không trùng nhau. Không giải thích.`;

/* ───────── phản hồi 👍/👎 (FB nhớ trong bộ nhớ, 200 câu gần nhất) ───────── */
interface FbItem { raw: O | null; x: string; pn: O | null; sum: O; sig: string; tp: O | null; src: string; text: string; pid: string | null; auto: boolean; pl: R.Plan | null; learned?: boolean }
const FB = new Map<string, FbItem>();
/** hỏi AI → plan đã kiểm chứng; lỗi / sai JSON / tên không có / 0 dòng → tự thử lại kèm lý do sai; hết lượt mà vẫn sai → Down */
async function llmPlan(b: Body, c: Cfg, B: R.Brain, d: DS): Promise<R.Plan> {
  const ctx = (b.ctx ?? {}) as R.Ctx, [text, lists] = R.extractLists(String(b.text));
  let u = `[NGỮ CẢNH]\nĐang tick: ${(ctx.selected ?? []).length} dòng\n`;
  u += `Công tắc "Gồm cấp dưới" trên bảng: ${ctx.sub !== false ? "BẬT" : "TẮT"}. Khi lọc theo owner mà người dùng không nói gì về cấp dưới thì theo công tắc này (TẮT -> "sub":false; BẬT -> không cần khóa sub). Người dùng nói rõ "không gồm cấp dưới" / "riêng" -> "sub":false; nói "gồm cấp dưới" -> "sub":true.\n`;
  const prev = ctx.reply?.spec || ctx.spec;
  if (ctx.reply) u += `[ĐANG TRẢ LỜI TIN NHẮN CỦA TRỢ LÝ]\n${String(ctx.reply.msg ?? "").slice(0, 300)}\n`;
  if (prev) u += `[ĐIỀU KIỆN TRƯỚC (JSON)]\n${JSON.stringify(prev).slice(0, 600)}\n`;
  const rej = ctx.rejected ? FB.get(ctx.rejected) : undefined;
  if (rej) u += `[KẾT QUẢ NGƯỜI DÙNG VỪA BÁC - ĐỪNG LẶP LẠI, hãy nghĩ lại cách hiểu khác]\n${JSON.stringify(rej.pn ?? rej.sum).slice(0, 500)}\n`;
  u += R.lessons(String(b.text), await trLoad());
  const hits = R.dataHits(B, String(b.text));
  u += (hits.length ? "[DỮ LIỆU]\n" + hits.join("\n") + "\n" : "") + "[CÂU]\n" + text;
  const msgs: Msg[] = [{ role: "system", content: SYS + "\n" + R.profileText(B) }];
  for (const h of (Array.isArray(b.hist) ? b.hist : []).slice(-4)) if (Q.isObj(h)) msgs.push({ role: "user", content: String(h.u ?? "").slice(0, 300) }, { role: "assistant", content: String(h.a ?? "").slice(0, 500) });
  msgs.push({ role: "user", content: u });
  const tries = 1 + Math.trunc(c.retries), delay = c.retry_delay, t0 = Date.now();
  let pl: R.Plan | null = null, spare: R.Plan | null = null, last = "Model không trả về kết quả hợp lệ", lask: R.Ask | null = null, zero = false, model = c.model, n = 0;
  const bad = (raw: string, why: string) => msgs.push({ role: "assistant", content: (raw || "").slice(0, 400) }, { role: "user", content: why + " Trả lại MỘT JSON hợp lệ theo mẫu, không giải thích." });
  for (n = 0; n < tries; n++) {
    let raw: string;
    try { [raw, model] = await llmCall(c, msgs, n ? Math.min(delay * n, 20) : 0); } catch (e) { if (!(e instanceof Down)) throw e; last = e.message; if (!e.retry) throw e; continue; }
    const obj = R.parseJson(raw);
    if (!obj) { last = "Model không trả về JSON hợp lệ"; bad(raw, "Câu trả lời không phải JSON."); continue; }
    let cand: R.Plan;
    try { cand = R.fromJson(obj, B, ctx, lists); }
    catch (e) {
      if (isAsk(e)) { if (String(obj.do).toLowerCase() === "ask" || e.message.startsWith("Có nhiều")) throw e; last = e.message; lask = e; bad(raw, `Sai: ${e.message}.  Chỉ dùng ĐÚNG tên có trong danh sách (tab, trường, tình trạng, owner); không chắc thì bỏ khóa đó.`); continue; }
      last = msgOf(e); bad(raw, `Sai: ${last}.`); continue;
    }
    if ((cand.it === "search" || cand.it === "count") && c.zero_retry && !zero) {
      let cnt = -1, why = ""; try { cnt = query(d, cand.spec ?? {}, 0).count; } catch (e) { why = msgOf(e); }
      if (cnt <= 0) { zero = true; if (cnt === 0) spare = cand; bad(raw, why || "Điều kiện này trả về 0 dòng - kiểm tra lại tab, tên trường và toán tử (có dữ liệu=not_empty, chưa có=empty, đếm số lượng=cnt_*), bỏ điều kiện thừa; nếu thật sự không có dòng nào thì giữ nguyên."); continue; }
    }
    pl = cand; break;
  }
  pl = pl ?? spare;
  if (!pl) { if (lask?.options.length) throw lask; throw new Down(`AI chưa trả lời đúng sau ${tries} lần thử (${last})`); }
  pl.llm = { model, asked: c.model, pn: "ChatGPT", ms: Date.now() - t0, tries: Math.min(n, tries - 1) + 1 };
  return pl;
}

/** POST ai_chat {text, engine?: auto|rules|ai, ctx:{selected, spec, reply, learn, sub, rejected}, hist} | {spec, ops?, rows?, cols?} (chạy lại khi bỏ 1 chip) */
async function chat(b: Body): Promise<O> {
  const c = await cfg(), ctx = (Q.isObj(b.ctx) ? b.ctx : {}) as R.Ctx;
  if (!c.on) return { kind: "error", msg: "Cú vọ đang tắt - bật trong Cài đặt > Cú vọ" };
  try {
    if (ctx.learn?.term && ctx.learn.ref) await learnAlias(ctx.learn.term, ctx.learn.ref);
    const d = await data(), B = await brain(d, ctx);
    if (b.text === undefined || b.text === null) {
      const sp = (b.spec ?? {}) as Q.Spec;
      const pl: R.Plan = b.rows !== undefined && b.rows !== null ? { it: "add", spec: sp, rows: b.rows as Array<Record<string, string>>, cols: b.cols as string[] } : R.tru(b.ops) ? { it: "set", spec: sp, ops: b.ops as O[] } : { it: "search", spec: sp };
      if (pl.it === "set" && !["status", "where", "q", "owner", "dept", "ids"].some((k) => R.tru(sp[k]))) throw new Error("Đã bỏ hết điều kiện - hãy nhắn lại đối tượng cần đổi");
      return await execute(d, pl, B);
    }
    const text = String(b.text), mode = String(b.engine || (c.auto_ai ? "auto" : "rules")), ready = hasAi(c);
    const [sig, slots] = R.signature(text, B), [lsig, lslots] = R.signature(text, B, false);
    let pl: R.Plan | null = null, src: string | null = null, note: string | null = null, rules: R.Plan | null = null, pat: R.Pattern | null = null, aierr: string | null = null;
    if (mode === "auto") { // tầng 1: mẫu đã được xác nhận (chủ thể động); chữ ký kiểu cũ (owner + giá trị) vẫn dùng được mẫu bản trước
      let ps = await patterns();
      for (const [s, sl] of lsig !== sig ? [[sig, slots], [lsig, lslots]] as const : [[sig, slots]] as const) {
        const r = R.fromPattern(ps, s, sl, B, text);
        if (r && "drop" in r) { await patDel([r.drop.id]); ps = ps.filter((p) => p.id !== r.drop.id); }
        else if (r) { pl = r.pl; pat = r.p; await run(sb().from(TABLE).update({ hits: (r.p.hits || 0) + 1, ts: now() }).eq("id", r.p.id)); PC = null; break; }
      }
      src = pl ? "pattern" : null;
    }
    if (!pl && mode !== "ai") { // tầng 2: luật nội bộ
      try {
        const [t2, hx] = H.hint(text, B);
        rules = t2.trim() || !Object.keys(hx).length ? R.understand(t2, ctx, B) : { it: "search", spec: {}, rest: [] };
        if (rules.teach) { await learnAlias(rules.teach.term, rules.teach.ref); delete rules.teach; }
        if (["search", "count", "set", "del"].includes(rules.it)) rules = H.mergeHint(rules, hx, B, ctx, text);
      } catch (e) { if (!(isAsk(e) && mode === "auto" && e.soft && ready)) throw e; }
      if (rules && !(mode === "auto" && (rules.low || rules.unsure) && ready)) { pl = rules; src = "rules"; }
    }
    if (!pl) { // tầng 3: OpenAI
      if (!ready) throw new Error("Chưa cấu hình AI - máy chủ cần OPENAI_API_KEY / model trong Cài đặt > Cú vọ");
      try { pl = await llmPlan(b, c, B, d); src = "ai"; }
      catch (e) {
        if (!(e instanceof Down)) throw e;
        note = aierr = e.message;
        if (!rules) throw new Error(e.retry ? "Mình chưa hiểu câu này - bạn thử nói rõ hơn nhé." : e.message);
        pl = rules; src = "rules"; note = null; // AI lỗi / hết lượt → im lặng dùng luật
      }
    }
    const inj = R.toggleSub(pl, ctx, text);
    let out = await execute(d, pl, B);
    if (inj) delete pl.spec!.sub; // 'sub' chỉ do công tắc, không phải do câu nói → đừng lưu vào mẫu
    if ((out.kind === "search" || out.kind === "count") && !out.count && src === "rules" && mode === "auto" && ready && !pl.ctx) {
      try { // luật ra 0 dòng → để AI thử hiểu lại; AI ra kết quả thì dùng
        const pl2 = await llmPlan(b, c, B, d), inj2 = R.toggleSub(pl2, ctx, text), out2 = await execute(d, pl2, B);
        if (inj2) delete pl2.spec!.sub;
        if (out2.count) { pl = pl2; src = "ai"; out = out2; }
      } catch { /* giữ kết quả luật */ }
    }
    const lettered = /[a-z]/.test(sig.replace(/<o>|<v>/g, "")), learnable = ["search", "count", "set", "del"].includes(pl.it);
    const [tp, ok] = learnable && !pl.ctx && lettered ? R.templ(pl, slots) : [null, false];
    const fid = sha(`${Date.now()}${Math.random()}${sig}`, 10);
    let pn: O | null = null; try { pn = learnable ? R.planNames(pl, B) : null; } catch { pn = null; }
    const plain = (x: R.Plan) => { const y = R.jc(x) as R.Plan; delete y.llm; return y; };
    FB.set(fid, { raw: learnable && !pl.ctx && (src === "ai" || src === "rules") ? (plain(pl) as unknown as O) : null, x: Q.fold(text).trim(), pn, sum: { kind: out.kind, msg: out.msg, count: out.count, chips: ((out.chips as R.Chip[]) ?? []).map((x) => x.t) },
      sig, tp: ok ? tp : null, src: src ?? "rules", text, pid: pat?.id ?? null, auto: !!pat?.auto, pl: ok && (pl.it === "search" || pl.it === "count") ? plain(pl) : null });
    for (const k of [...FB.keys()].slice(0, Math.max(0, FB.size - 200))) FB.delete(k);
    Object.assign(out, { src, fid, cache: ok || learnable && !pl.ctx && (src === "ai" || src === "rules") || src === "pattern", note, aierr, llm: pl.llm ?? null, auto: !!pat?.auto });
    return out;
  } catch (e) {
    if (isAsk(e)) return { kind: "ask", msg: e.message, options: e.options, chips: [], spec: {} };
    if (e instanceof HsError && e.status >= 500) throw e;
    return { kind: "error", msg: msgOf(e) };
  }
}

/** người dùng xác nhận (ok) / bác bỏ cách hiểu: đúng → lưu mẫu (+ báo giao diện gọi ai_learn); sai → xoá mẫu + mẫu tự học sinh ra từ nó */
async function feedback(b: Body) {
  const f = FB.get(String(b.fid)); if (!f) return { saved: false };
  const ps = await patterns();
  if (b.ok) {
    if (f.pn) { const its = await trLoad(); let hit = false; for (const x of its) if (x.sig === f.sig && x.status !== "fixed") { Object.assign(x, { status: "fixed", right: f.pn, ts: now() }); hit = true; } if (hit) await trSave(its); }
    if (f.src === "pattern") {
      const p = ps.find((x) => x.id === f.pid || x.sig === f.sig);
      if (p?.auto) { await run(sb().from(TABLE).update({ auto: false, ts: now() }).eq("id", p.id)); PC = null; return { saved: true, promoted: true }; }
      return { saved: true };
    }
    let pid: string;
    if (f.tp) { pid = sha(f.sig, 8); await patDel(ps.filter((p) => p.sig === f.sig && !p.x && p.id !== pid).map((p) => p.id)); await patPut([{ id: pid, sig: f.sig, plan: f.tp, hits: 0, ts: now(), q: f.text.slice(0, 200) }]); }
    else if (f.raw && f.x) { pid = sha("x:" + f.x, 8); await patDel(ps.filter((p) => p.x === f.x && p.id !== pid).map((p) => p.id)); await patPut([{ id: pid, sig: "x:" + f.x, x: f.x, plan: f.raw, hits: 0, ts: now(), q: f.text.slice(0, 200) }]); }
    else return { saved: false };
    f.pid = pid;
    const c = await cfg();
    return { saved: true, learn: c.on && c.learn && hasAi(c) && !!f.pl && !f.learned };
  }
  if (f.text) { // gom vào bài học để dạy lại
    const its = await trLoad(), t = now(), cur = its.find((x) => x.sig === f.sig && x.status !== "fixed"), w = { src: f.src, plan: f.pn, result: f.sum };
    if (cur) { cur.n = (cur.n || 1) + 1; cur.ts = t; cur.wrong = [...(cur.wrong ?? []).slice(-3), w]; }
    else its.push({ id: sha(`${f.sig}${t}`, 8), text: f.text.slice(0, 200), sig: f.sig, status: "open", n: 1, ts: t, wrong: [w] });
    await trSave(its);
  }
  const gone = new Set(ps.filter((p) => p.sig === f.sig || p.id === f.pid).map((p) => p.id)), kids = ps.filter((p) => p.auto && p.from && gone.has(p.from)).map((p) => p.id);
  if (gone.size || kids.length) await patDel([...gone, ...kids]);
  return { saved: false, removed: gone.size + kids.length };
}
/** POST ai_learn {fid} — gọi NGẦM sau 👍: AI viết thêm câu tương tự → kiểm chứng (tên khớp, chạy được, chữ ký mới, khớp luật nếu chắc) → lưu mẫu 'auto' */
async function learnSimilar(b: Body) {
  const c = await cfg(), f = FB.get(String(b.fid));
  if (!(c.on && c.learn && hasAi(c) && f && f.pl && f.pid) || f.learned) return { added: 0 };
  f.learned = true;
  const n = Math.max(1, Math.min(12, Math.trunc(c.learn_n) || 6)); let d = await data(), B = await brain(d);
  const msgs: Msg[] = [{ role: "system", content: LEARN_SYS + "\n" + R.profileText(B) }, { role: "user", content: `CÂU GỐC: ${f.text}\nHỆ THỐNG ĐÃ HIỂU: ${JSON.stringify(R.planNames(f.pl, B))}\nHãy viết tối đa ${n} biến thể.` }];
  let obj: O | null = null, last = "";
  for (let k = 0; k < 1 + Math.trunc(c.retries); k++) {
    let raw: string;
    try { [raw] = await llmCall(c, msgs, k ? Math.min(c.retry_delay * k, 20) : 0); } catch (e) { if (!(e instanceof Down)) throw e; last = e.message; if (!e.retry) break; continue; }
    obj = R.parseJson(raw); if (obj && Array.isArray(obj.variants)) break;
    obj = null; last = "AI không trả JSON đúng khuôn";
    msgs.push({ role: "assistant", content: (raw || "").slice(0, 400) }, { role: "user", content: 'Sai khuôn. Trả lại MỘT JSON {"variants":[...]} hợp lệ, không giải thích.' });
  }
  if (!obj) { f.learned = false; return { added: 0, err: last }; }
  PC = null; const ps = await patterns();
  if (!ps.some((p) => p.id === f.pid)) return { added: 0, err: "Mẫu gốc đã bị bỏ" }; // trong lúc AI nghĩ, người dùng đã 👎 mẫu gốc
  d = await data(); B = await brain(d);
  const seen = new Set([...ps.map((p) => p.sig), f.sig]), add: R.Pattern[] = []; let skip = 0;
  for (const v of (obj.variants as unknown[]).slice(0, n * 2)) {
    if (add.length >= n) break;
    try {
      const vv = Q.isObj(v) ? v : {}, cau = String(vv.cau ?? "").trim(), plan = vv.plan;
      if (cau.length < 4 || cau.length > 160 || cau.includes("\n") || !Q.isObj(plan) || !["search", "count"].includes(String(plan.do || "search").toLowerCase())) throw new Error("câu / plan không hợp lệ");
      const cand = R.fromJson(plan, B, {}, {}), [sig, slots] = R.signature(cau, B), [tp, ok] = R.templ(cand, slots);
      if (!["search", "count"].includes(cand.it) || cand.ctx || R.junk(cand) || !ok || seen.has(sig) || !R.valid(cand, B) || !/[a-z]/.test(sig.replace(/<o>|<v>/g, ""))) throw new Error("không lưu được thành mẫu");
      query(d, cand.spec ?? {}, 0);
      if (!agrees(d, B, cau, cand)) throw new Error("lệch luật nội bộ");
      seen.add(sig); add.push({ id: sha(sig, 8), sig, plan: tp, hits: 0, ts: now(), auto: true, from: f.pid, q: cau });
    } catch { skip++; }
  }
  if (add.length) await patPut(add);
  return { added: add.length, skipped: skip, samples: add.map((x) => x.q).slice(0, 3) };
}
/** luật nội bộ nếu CHẮC CHẮN về câu này thì kết quả phải trùng kế hoạch AI; lệch → bỏ; luật chịu thua → nhận */
function agrees(d: DS, B: R.Brain, cau: string, cand: R.Plan): boolean {
  let r: R.Plan; try { const [t2, hx] = H.hint(cau, B); r = t2.trim() || !Object.keys(hx).length ? R.understand(t2, {}, B) : { it: "search", spec: {}, rest: [] }; if (r.it === "search" || r.it === "count") r = H.mergeHint(r, hx, B, {}, cau); } catch { return true; }
  if ((r.it !== "search" && r.it !== "count") || r.low || r.unsure) return true;
  try { const x = query(d, r.spec ?? {}, 0), y = query(d, cand.spec ?? {}, 0); return r.it === cand.it && x.count === y.count && x.ids.length === y.ids.length && x.ids.every((i) => y.ids.includes(i)); } catch { return false; }
}

/* ───────── cấu hình · sao lưu · nhập/xuất ───────── */
async function cfgView(): Promise<O> {
  const c = await cfg(), [ps, al, tr, bk] = await Promise.all([patterns(), alias(), trLoad(), backups().catch(() => [])]);
  const key = !!process.env.OPENAI_API_KEY;
  return { ...c, provider: "openai", url: "", key_set: hasAi(c), keys_set: key ? { [`openai|${c.model}`]: true } : {}, keys_val: {}, models: { openai: c.model }, urls: {},
    providers: [{ id: "openai", name: "OpenAI (ChatGPT)", model: MODEL0(), models: [...new Set([MODEL0(), "gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-5-mini"])], hint: key ? "Key đặt ở máy chủ (OPENAI_API_KEY)" : "Máy chủ chưa có OPENAI_API_KEY", ph: key ? "Đã cấu hình bởi HireX (OPENAI_API_KEY)" : "Máy chủ HireX chưa có OPENAI_API_KEY", url: "", presets: [], local: false }],
    mem: al, patterns: [...ps].reverse().slice(0, 200).map((p) => ({ id: p.id, sig: p.sig, hits: p.hits, auto: !!p.auto, q: p.q ?? "" })), n_patterns: ps.length, n_auto: ps.filter((p) => p.auto).length,
    train: { open: tr.filter((x) => x.status !== "fixed").length, fixed: tr.filter((x) => x.status === "fixed").length, file: "ahs_settings: ai_training" }, backups: bk,
    files: { logic: TABLE, cfg: "ahs_settings: ai_cfg", dir: `${BUCKET}/${AIDIR}` } };
}
async function cfgSet(b: Body) {
  const c = await cfg();
  for (const k of ["on", "auto_ai", "zero_retry", "learn"] as const) if (k in b) c[k] = !!b[k];
  for (const [k, [lo, hi]] of Object.entries(LIM)) if (k in b) { const v = parseFloat(String(b[k])); if (Number.isFinite(v)) (c as unknown as Record<string, number>)[k] = k === "retry_delay" ? Math.min(hi, Math.max(lo, v)) : Math.trunc(Math.min(hi, Math.max(lo, v))); }
  if (Q.isObj(b.fx)) c.fx = cleanFx(b.fx);
  if ("model" in b) c.model = String(b.model ?? "").trim() || MODEL0();
  await setSetting("ai_cfg", JSON.stringify(c));
  if (b.forget) { const al = await alias(); delete al[String(b.forget)]; await setSetting("ai_alias", JSON.stringify(al)); }
  if (b.del_pattern) await patDel([String(b.del_pattern)]);
  if (b.clear_patterns) { await backupLogic(); await run(sb().from(TABLE).delete().neq("id", "")); PC = null; }
  return cfgView();
}
async function backupRoute(b: Body) {
  if (b.restore) {
    const name = String(b.restore); if (!BK_RE.test(name) || !(await bnames()).includes(name)) throw new HsError("Không tìm thấy bản sao lưu");
    const d = await bread(name); await backupLogic();
    await run(sb().from(TABLE).delete().neq("id", "")); PC = null;
    const ps = cleanPatterns(d.patterns); if (ps.length) await run(sb().from(TABLE).upsert(ps.map(toRow), { onConflict: "id" }));
    await setSetting("ai_alias", JSON.stringify(Object.fromEntries(Object.entries(Q.isObj(d.alias) ? d.alias : {}).map(([k, v]) => [k, String(v)]))));
    PC = null; return cfgView();
  }
  if (!(await backupLogic())) throw new HsError("Cú vọ chưa học mẫu nào để sao lưu");
  return cfgView();
}
async function logicExport() { const [al, ps] = await Promise.all([alias(), patterns()]); return { version: 3, app: "AccountsHS", exported: Math.trunc(now()), alias: al, patterns: ps }; }
async function logicImport(b: Body) {
  const d = b.data; if (!Q.isObj(d)) throw new HsError("File không đúng định dạng");
  const pats = cleanPatterns(d.patterns), al = Object.fromEntries(Object.entries(Q.isObj(d.alias) ? d.alias : {}).map(([k, v]) => [k, String(v)]));
  if (!pats.length && !Object.keys(al).length) throw new HsError("File không có mẫu hay từ đã học");
  await backupLogic();
  if (b.replace) { await run(sb().from(TABLE).delete().neq("id", "")); PC = null; await setSetting("ai_alias", JSON.stringify(al)); if (pats.length) await patPut(pats); }
  else { const have = new Set((await patterns()).map((p) => p.sig)); await patPut(pats.filter((p) => !have.has(p.sig))); await setSetting("ai_alias", JSON.stringify({ ...(await alias()), ...al })); }
  return { ...(await cfgView()), imported: pats.length + Object.keys(al).length };
}
async function test() {
  const c = await cfg(), t0 = Date.now(); if (!hasAi(c)) throw new HsError("Máy chủ chưa có OPENAI_API_KEY");
  try { const [, m] = await llmCall(c, [{ role: "user", content: 'Trả về đúng JSON {"ok":true}' }]); return { model: m, ms: Date.now() - t0 }; } catch (e) { throw new HsError(msgOf(e)); }
}
/** danh sách model gợi ý (OpenAI) — không gọi mạng */
async function listModels() { const c = await cfg(); return { models: [...new Set([c.model, MODEL0(), "gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-5-mini"].filter(Boolean))] }; }
/** POST ai_rows {ids, spec} → các dòng kế tiếp của kết quả ("+N dòng nữa") */
async function rowsRoute(b: Body) {
  const ids = Q.asList(b.ids as Id[]).map(Number).filter((x) => Number.isInteger(x)).slice(0, 500); if (!ids.length) return { rows: [] };
  const d = await data(), sp = (Q.isObj(b.spec) ? b.spec : {}) as Q.Spec, rows = ids.map((i) => d.A.get(i)).filter((a): a is Q.AccRow => !!a);
  return { rows: Q.viewRows(rows, d.cx, d.A, sp, profLike(d)) };
}
async function engineStatus() { const d = DSC; return { fts: "pg", pct: 100, full: true, learned: d ? Object.keys(d.prof.tabs).length : 0, cols: 0, err: "", rows: d?.accs.length ?? 0 }; }

export const routes: Record<string, [Level, Fn]> = {
  ai_chat: ["view", chat], ai_rows: ["view", rowsRoute], ai_feedback: ["view", feedback],
  ai_apply: ["edit", apply], ai_drop: ["edit", drop],
  ai_cfg_set: ["manage", cfgSet], ai_test: ["manage", test], ai_backup: ["manage", backupRoute], ai_logic_import: ["manage", logicImport], ai_learn: ["manage", learnSimilar], ai_models: ["manage", listModels],
};
export const gets: Record<string, (qs: URLSearchParams) => Promise<unknown>> = { ai_cfg: () => cfgView(), ai_logic: () => logicExport(), ai_wayer: () => logicExport(), ai_engine: () => engineStatus() };
export const noLog: string[] = Object.keys(routes);
