// Mô hình phía client: trạng thái S, chỉ mục I, tìm kiếm cú pháp, lọc cột, sắp xếp — port từ phần JS của v7.py.
// Thuần logic (không DOM, không React) để kiểm thử được bằng node --test.
import type { Account, Cond, CondKey, Dept, Device, Field, Id, Link, Meta, Owner, SortSpec, Status, Tab } from "../types.ts";
import { COLL, DP, EMP, attStr, fold, hcls, rteText, tsDay, type Hue } from "./text.ts";

/* ───────── S: trạng thái giao diện ───────── */
export type TabKey = Id | "all" | "graph" | "report" | "device" | null;
export type FilterSpec = { tab: TabKey; set: Set<Id>; k: string };
export interface State {
  meta: Meta; accs: Account[]; links: Link[]; devices: Device[]; ts: number;
  /** tab "tải riêng" đã nạp */ lz: Set<Id>;
  dept: Id | "all"; owner: Id | null; sub: boolean; tab: TabKey;
  q: string; fl: Record<string, Cond[]>; st: Set<Id>; tf: Set<Id>; sel: Set<Id>; sort: Record<string, SortSpec>;
  page: number; size: number; reveal: boolean; rv: Set<string>; hid: Record<string, Id[]>; cw: Record<string, Record<string, number>>;
  focus: Id | null; view: Id[]; last: Id | null; exp: Record<string, unknown>; ex: Record<string, ExportFmt>; bp: Record<string, unknown>;
  ctx: Id | null; devf: Id | null; dk: Set<string>; idf: FilterSpec | null; ov: boolean;
  arw: { o: string; i: string; h: string; v2?: 1 }; tvs: unknown; scrollTo: Id | null; scrollTop: number | null; cho: boolean;
}
export interface ExportFmt { use: Array<Id | string>; sep?: string; header?: boolean }
export function initialState(): State {
  return {
    meta: { depts: [], owners: [], tabs: [], grp_icons: {}, tab_keys: {} }, accs: [], links: [], devices: [], ts: 0, lz: new Set(),
    dept: "all", owner: null, sub: true, tab: null, q: "", fl: {}, st: new Set(), tf: new Set(), sel: new Set(), sort: {},
    page: 1, size: 100, reveal: false, rv: new Set(), hid: {}, cw: {}, focus: null, view: [], last: null, exp: {}, ex: {}, bp: {},
    ctx: null, devf: null, dk: new Set(), idf: null, ov: false, arw: { o: "→", i: "←", h: "tri", v2: 1 }, tvs: null, scrollTo: null, scrollTop: null, cho: false,
  };
}
export const PREF_KEY = "accountshs.v2";
export function prefSnapshot(S: State) {
  return { dept: S.dept, owner: S.owner, sub: S.sub, tab: S.tab, q: S.q, st: [...S.st], tf: [...S.tf], sort: S.sort, hid: S.hid, cw: S.cw, size: S.size, reveal: S.reveal, exp: S.exp, ex: S.ex, bp: S.bp, fl: S.fl, arw: S.arw, tvs: S.tvs };
}
export function applyPref(S: State, p: Partial<ReturnType<typeof prefSnapshot>> & { gd?: number; gh?: Id[] }) {
  S.dept = p.dept ?? "all"; S.owner = p.owner ?? null; S.sub = p.sub ?? true; S.tab = p.tab ?? null; S.q = p.q || ""; S.st = new Set(p.st || []); S.tf = new Set(p.tf || []);
  S.sort = p.sort || {}; S.hid = p.hid || {}; S.cw = p.cw || {}; S.size = p.size || 100; S.reveal = !!p.reveal; S.exp = p.exp || {}; S.ex = p.ex || {}; S.bp = p.bp || {}; S.fl = p.fl || {};
  S.arw = { o: "→", i: "←", h: "tri", v2: 1, ...(p.arw || {}) }; if (S.arw.i === S.arw.o && !p.arw?.v2) S.arw.i = "←"; S.tvs = p.tvs ?? null;
}

/* ───────── I: chỉ mục ───────── */
export interface OwnerX extends Owner { path: Id[] }
export interface StatusX extends Status { h: Hue }
export interface AccountX extends Account { label: string }
export interface Index {
  acc: Record<Id, AccountX>; tab: Record<Id, Tab>; field: Record<Id, Field>; status: Record<Id, StatusX>;
  out: Record<Id, Record<Id, Id[]>>; inn: Record<Id, Array<{ src: Id; f: Id }>>; adj: Record<Id, Id[]>;
  own: Record<Id, OwnerX>; dpt: Record<Id, Dept>; kids: Record<Id, Id[]>; roots: Record<Id, Id[]>;
  ownN: Record<Id, number>; sub: Record<Id, number>; ownH: Record<Id, Partial<Record<Hue, number>>>; subH: Record<Id, Partial<Record<Hue, number>>>;
  deptN: Record<Id, number>; deptH: Record<Id, Partial<Record<Hue, number>>>; scO: Set<Id> | null;
  dev: Record<Id, Device>; devUse: Record<Id, Record<Id, number>>;
  /** phiên bản dữ liệu: tăng mỗi lần dựng lại chỉ mục */ ver: number;
}
export function emptyIndex(): Index {
  return { acc: {}, tab: {}, field: {}, status: {}, out: {}, inn: {}, adj: {}, own: {}, dpt: {}, kids: {}, roots: {}, ownN: {}, sub: {}, ownH: {}, subH: {}, deptN: {}, deptH: {}, scO: null, dev: {}, devUse: {}, ver: 0 };
}
const addH = (a: Partial<Record<Hue, number>>, b: Partial<Record<Hue, number>>) => { for (const k of ["g", "w", "b", "n"] as Hue[]) a[k] = (a[k] || 0) + (b[k] || 0); return a; };

/** index(): dựng lại toàn bộ chỉ mục từ S (gọi sau mỗi lần load). */
export function buildIndex(S: State, I: Index) {
  const ver = I.ver + 1;
  Object.assign(I, emptyIndex(), { ver });
  for (const t of S.meta.tabs) { I.tab[t.id] = t; for (const f of t.fields) I.field[f.id] = f; for (const s of t.statuses) I.status[s.id] = { ...s, h: hcls(s.color) }; }
  for (const o of S.meta.owners) I.own[o.id] = { ...o, path: [] };
  for (const d of S.meta.depts) I.dpt[d.id] = d;
  for (const o of S.meta.owners) { const p = o.parent_id != null ? I.own[o.parent_id] : null; if (p && p.dept_id === o.dept_id) (I.kids[p.id] ??= []).push(o.id); else (I.roots[o.dept_id] ??= []).push(o.id); }
  for (const o of S.meta.owners) { const p: Id[] = []; let c: OwnerX | undefined = I.own[o.id], g = 0; while (c && g++ < 30) { p.unshift(c.id); c = c.parent_id != null ? I.own[c.parent_id] : undefined; } I.own[o.id].path = p; }
  for (const a0 of S.accs) {
    const a = a0 as AccountX; I.acc[a.id] = a;
    const h = I.status[a.status_id ?? -1]?.h || "n";
    I.deptN[a.dept_id] = (I.deptN[a.dept_id] || 0) + 1; (I.deptH[a.dept_id] ??= {})[h] = ((I.deptH[a.dept_id] || {})[h] || 0) + 1;
    if (a.owner_id) { I.ownN[a.owner_id] = (I.ownN[a.owner_id] || 0) + 1; (I.ownH[a.owner_id] ??= {})[h] = ((I.ownH[a.owner_id] || {})[h] || 0) + 1; }
    const t = I.tab[a.tab_id], p = t && t.fields[0];
    a.label = (p && attStr(a.data[String(p.id)])) || "#" + a.id;
  }
  const calc = (id: Id): number => { if (I.sub[id] != null) return I.sub[id]; I.sub[id] = 0; I.subH[id] = addH({}, I.ownH[id] || {}); let n = I.ownN[id] || 0; for (const k of I.kids[id] || []) { n += calc(k); addH(I.subH[id], I.subH[k]); } return (I.sub[id] = n); };
  for (const o of S.meta.owners) calc(o.id);
  for (const l of S.links) { ((I.out[l.src] ??= {})[l.f] ??= []).push(l.dst); (I.inn[l.dst] ??= []).push({ src: l.src, f: l.f }); (I.adj[l.src] ??= []).push(l.dst); (I.adj[l.dst] ??= []).push(l.src); }
  for (const d of S.devices) I.dev[d.id] = d;
  for (const a of S.accs) if (a.device_id && I.dev[a.device_id]) { const u = (I.devUse[a.device_id] ??= {}); u[a.tab_id] = (u[a.tab_id] || 0) + 1; }
  HAY.clear(); VMEMO.k = "";
}
export function desc(I: Index, id: Id, acc = new Set<Id>()): Set<Id> { if (acc.has(id)) return acc; acc.add(id); for (const k of I.kids[id] || []) desc(I, k, acc); return acc; }
export function scopeCalc(S: State, I: Index) { I.scO = S.owner == null ? null : S.sub ? desc(I, S.owner) : new Set([S.owner]); }
export const inScope = (S: State, I: Index, a: Account) => (S.dept === "all" || a.dept_id === S.dept) && (!I.scO || (a.owner_id != null && I.scO.has(a.owner_id)));
export const deptOf = (S: State, id: Id | null) => S.meta.depts.find((d) => d.id === id) || { id: 0, name: "—", color: "#a1a1aa", pos: 0 };
/** cây owner của một bộ phận: [{o, d: độ sâu}] */
export function treeOrder(I: Index, d: Id): Array<{ o: OwnerX; d: number }> {
  const out: Array<{ o: OwnerX; d: number }> = [], seen = new Set<Id>();
  const walk = (id: Id, dp: number) => { if (seen.has(id)) return; seen.add(id); out.push({ o: I.own[id], d: dp }); for (const k of I.kids[id] || []) walk(k, dp + 1); };
  for (const r of I.roots[d] || []) walk(r, 0);
  return out;
}
export const isTbl = (S: State) => !["graph", "report", "device"].includes(String(S.tab)) && !(S.tab === "all" && S.ov);
export const stOf = (I: Index, a: Account) => (a.status_id != null ? I.status[a.status_id] : undefined);
export const visCols = (S: State, t: Tab) => t.fields.filter((f) => !(S.hid[String(t.id)] || []).includes(f.id));

/* ───────── liên kết giá trị (lookup) ───────── */
export function lookupCfg(f: Field) { try { const o = JSON.parse(f.opts || "{}"); return { via: +o.via || 0, take: +o.take || 0 }; } catch { return { via: 0, take: 0 }; } }
export function lookupVal(I: Index, a: Account, f: Field): string {
  const o = lookupCfg(f); if (!o.via || !o.take) return "";
  const dst = (I.out[a.id]?.[o.via] || [])[0]; if (dst == null) return "";
  const b = I.acc[dst]; if (!b) return "";
  const v = b.data[String(o.take)]; return v == null ? "" : attStr(v);
}
export const lookupSecret = (I: Index, f: Field) => I.field[lookupCfg(f).take]?.type === "secret";

/* ───────── tìm kiếm cú pháp ───────── */
const SPECIAL: Record<string, CondKey> = { status: "status", trangthai: "status", tt: "status", owner: "owner", chu: "owner", dept: "dept", bophan: "dept", bp: "dept", note: "note", ghichu: "note", device: "device", may: "device", tab: "tab", loai: "tab", label: "label" };
export interface QPart { neg: boolean; k: CondKey[] | null; t: string }
const QP = new Map<string, QPart[]>();
export function resolveKeys(S: State, name: string): CondKey[] {
  const n = fold(name).replace(/\s+/g, ""); if (SPECIAL[n]) return [SPECIAL[n]];
  const out: CondKey[] = [];
  for (const t of S.meta.tabs) for (const f of t.fields) { const l = fold(f.label).replace(/\s+/g, ""); if (l === n || l.startsWith(n)) out.push(f.id); }
  return out;
}
/** "uid:123 status:live -die "cụm từ"" → [{neg,k,t}] */
export function parseQ(S: State, s: string): QPart[] {
  const key = s + "\u0001" + S.meta.tabs.length;
  const c = QP.get(key); if (c) return c;
  const r: QPart[] = []; const re = /(-?)(?:([^\s:"]+):)?(?:"([^"]*)"|(\S+))/g; let m: RegExpExecArray | null;
  while ((m = re.exec(s || ""))) {
    let t = fold(m[3] ?? m[4]), ks: CondKey[] | null = null;
    if (m[2]) { ks = resolveKeys(S, m[2]); if (!ks.length) { ks = null; t = fold(m[2] + ":" + (m[3] ?? m[4])); } }
    if (t) r.push({ neg: !!m[1], k: ks, t });
  }
  if (QP.size > 60) QP.clear(); QP.set(key, r); return r;
}
/** giá trị (dạng chuỗi) của một cột cho 1 dòng */
export function colVals(S: State, I: Index, a: AccountX, k: CondKey): string[] {
  switch (k) {
    case "status": { const s = stOf(I, a); return s ? [s.label] : []; }
    case "dept": { const d = I.dpt[a.dept_id]; return d ? [d.name] : []; }
    case "owner": { const o = a.owner_id != null ? I.own[a.owner_id] : null; return o ? [o.name] : []; }
    case "device": { const d = a.device_id != null ? I.dev[a.device_id] : null; return d ? [d.name] : []; }
    case "tab": return [I.tab[a.tab_id]?.name || ""];
    case "label": return [a.label];
    case "note": return a.note ? [rteText(a.note)] : [];
    case "updated": return a.updated ? [tsDay(a.updated)] : [];
    case "created": return a.created ? [tsDay(a.created)] : [];
    case "links": return [String((I.inn[a.id] || []).length)];
    case "outl": return [String(outCount(I, a))];
    default: {
      const f = I.field[k as Id]; if (!f || f.tab_id !== a.tab_id) return [];
      if (f.type === "link") return (I.out[a.id]?.[f.id] || []).map((i) => I.acc[i]?.label).filter(Boolean) as string[];
      if (f.type === "lookup") { const v = lookupVal(I, a, f); return v ? [v] : []; }
      const v = a.data[String(f.id)];
      if (Array.isArray(v)) return v.map((x) => x && x.n).filter(Boolean) as string[];
      return v == null || v === "" ? [] : [String(v)];
    }
  }
}
const HAY = new Map<Id, string>();
/** "đống rơm" tìm toàn văn của 1 dòng (nhớ theo phiên bản chỉ mục) */
export function hay(S: State, I: Index, a: AccountX): string {
  let s = HAY.get(a.id); if (s !== undefined) return s;
  const o = a.owner_id != null ? I.own[a.owner_id] : null, dv = a.device_id != null ? I.dev[a.device_id] : null;
  s = fold(a.label + " " + rteText(a.note) + " " + (stOf(I, a)?.label || "") + " " + (o?.name || "") + " " + (dv ? dv.name + " " + dv.serial : "") + " " + Object.values(a.data).map(attStr).join(" "));
  for (const ids of Object.values(I.out[a.id] || {})) for (const i of ids) s += " " + fold(I.acc[i]?.label);
  HAY.set(a.id, s); return s;
}
export const outCount = (I: Index, a: Account) => Object.values(I.out[a.id] || {}).reduce((n, x) => n + x.length, 0);
export function matchQ(S: State, I: Index, a: AccountX, pq: QPart[]) {
  for (const p of pq) { const ok = p.k ? p.k.some((k) => colVals(S, I, a, k).some((v) => fold(v).includes(p.t))) : hay(S, I, a).includes(p.t); if (ok === p.neg) return false; }
  return true;
}
const CS = new WeakMap<Cond, Set<string>>();
export function matchCond(S: State, I: Index, a: AccountX, c: Cond): boolean {
  const vs = colVals(S, I, a, c.k);
  switch (c.op) {
    case "empty": return !vs.length;
    case "nempty": return vs.length > 0;
    case "has": { const t = fold(c.v); return vs.some((v) => fold(v).includes(t)); }
    case "list": { let s = CS.get(c); if (!s) { s = new Set(c.v.map((x) => fold(x).trim())); CS.set(c, s); } return vs.some((v) => s!.has(fold(v).trim())); }
    case "range": { const [lo, hi] = c.v; return vs.some((v) => { const d = DP.parse(v); return !!d && (!lo || d >= lo) && (!hi || d <= hi); }); }
    case "in": case "nin": { let s = CS.get(c); if (!s) { s = new Set(c.v); CS.set(c, s); } const hit = vs.length ? vs.some((v) => s!.has(v)) : s.has(EMP); return c.op === "in" ? hit : !hit; }
  }
  return true;
}
export const condsOf = (S: State): Cond[] => S.fl[String(S.tab)] || [];
export function setConds(S: State, list: Cond[]) { if (list.length) S.fl[String(S.tab)] = list; else delete S.fl[String(S.tab)]; }
export function setCond(S: State, k: CondKey, c: Omit<Cond, "k"> | null) { const l = condsOf(S).filter((x) => x.k !== k); if (c) l.push({ k, ...c } as Cond); setConds(S, l); }
export function fkeys(S: State, I: Index): CondKey[] {
  const t = typeof S.tab === "number" ? I.tab[S.tab] : null;
  return S.tab === "all" ? ["tab", "status", "dept", "owner", "device", "label", "updated"] : ["status", "dept", "owner", "device", ...(t ? visCols(S, t).map((f) => f.id) : []), "note", "updated"];
}
export function isDateKey(S: State, I: Index, k: CondKey) {
  if (k === "updated" || k === "created") return true;
  const f = I.field[k as Id]; if (!f) return false; if (f.type === "date") return true; if (f.type !== "text") return false;
  let n = 0, ok = 0;
  for (const a of S.accs) { if (a.tab_id !== f.tab_id) continue; const v = a.data[String(f.id)]; if (v == null || v === "") continue; n++; if (DP.parse(v)) ok++; if (n >= 200) break; }
  return n >= 3 && ok / n >= 0.9;
}

/* ───────── dòng theo phạm vi / tab / lọc / sắp xếp ───────── */
const ORD: { k: number; rows: AccountX[] } = { k: -1, rows: [] };
/** thứ tự mặc định (mới tạo trước), tính 1 lần cho mỗi phiên bản dữ liệu */
export function ordAll(S: State, I: Index) { if (ORD.k !== I.ver) { ORD.rows = (S.accs as AccountX[]).slice().sort((x, y) => ((y.created || 0) - (x.created || 0)) || (y.id - x.id)); ORD.k = I.ver; } return ORD.rows; }
const SCP: { k: string; rows: AccountX[] } = { k: "", rows: [] };
const scopeKey = (S: State, I: Index) => `${I.ver}|${S.dept}|${S.owner}|${S.sub}|${S.accs.length}`;
export function scoped(S: State, I: Index) { const k = scopeKey(S, I); if (SCP.k !== k) { SCP.rows = ordAll(S, I).filter((a) => inScope(S, I, a)); SCP.k = k; } return SCP.rows; }
const BRM: { k: string; rows: AccountX[] } = { k: "", rows: [] };
export function baseRows(S: State, I: Index): AccountX[] {
  const tb = S.tab, dv = S.devf, idf = S.idf && S.idf.tab === tb ? S.idf : null, k = scopeKey(S, I) + `|${tb}|${dv}|${idf ? idf.k : ""}`;
  if (BRM.k !== k) { BRM.rows = scoped(S, I).filter((a) => (tb === "all" || a.tab_id === tb) && (!idf || idf.set.has(a.id)) && (dv == null || (dv === -1 ? !a.device_id : a.device_id === dv))); BRM.k = k; }
  return BRM.rows;
}
export function scopeTotal(S: State, I: Index) { if (!isTbl(S) || S.tab === "all") return scoped(S, I).length; let n = 0; for (const a of scoped(S, I)) if (a.tab_id === S.tab) n++; return n; }
const VMEMO: { k: string; rows: AccountX[] | null } = { k: "", rows: null };
export function viewKey(S: State, I: Index) {
  const so = S.sort[String(S.tab)];
  return [I.ver, S.tab, S.dept, S.owner, S.sub, S.q, [...S.st], [...S.tf], S.devf, so ? so.k + ":" + so.d + ":" + (so.ord || []).join("\u0001") : "", JSON.stringify(S.fl[String(S.tab)] || []), S.accs.length, S.idf && S.idf.tab === S.tab ? S.idf.k : ""].join("|");
}
export function sortKeyOf(S: State, I: Index, a: AccountX, k: CondKey): string | number {
  switch (k) {
    case "status": return stOf(I, a)?.label || ""; case "updated": return a.updated; case "created": return a.created; case "note": return rteText(a.note);
    case "links": return (I.inn[a.id] || []).length; case "outl": return outCount(I, a); case "owner": return (a.owner_id != null && I.own[a.owner_id]?.name) || "";
    case "dept": return I.dpt[a.dept_id]?.name || ""; case "device": return (a.device_id != null && I.dev[a.device_id]?.name) || ""; case "label": return a.label; case "tab": return I.tab[a.tab_id]?.name || "";
    default: { const f = I.field[k as Id]; if (f?.type === "link") return (I.out[a.id]?.[f.id] || []).map((i) => I.acc[i]?.label).join(","); if (f?.type === "lookup") return lookupVal(I, a, f); return attStr(a.data[String(k)]); }
  }
}
/** getView(): dòng đang hiển thị (đã lọc + sắp) — nhớ kết quả theo chữ ký trạng thái */
export function getView(S: State, I: Index): AccountX[] {
  const mk = viewKey(S, I);
  if (VMEMO.k === mk && VMEMO.rows) return VMEMO.rows;
  let rows = baseRows(S, I);
  if (S.tab === "all") { if (S.tf.size) rows = rows.filter((a) => S.tf.has(a.tab_id)); } else if (S.st.size) rows = rows.filter((a) => a.status_id != null && S.st.has(a.status_id));
  const pq = parseQ(S, S.q), cd = condsOf(S);
  if (pq.length || cd.length) rows = rows.filter((a) => matchQ(S, I, a, pq) && cd.every((c) => matchCond(S, I, a, c)));
  const so = S.sort[String(S.tab)];
  if (so) {
    const ks = new Map(rows.map((a) => [a.id, sortKeyOf(S, I, a, so.k)]));
    const rk = so.ord ? new Map(rows.map((a) => { const vs = colVals(S, I, a, so.k); let r = so.ord!.length; for (const v of vs.length ? vs : [EMP]) { const i = so.ord!.indexOf(v); if (i >= 0 && i < r) r = i; } return [a.id, r]; })) : null;
    rows = [...rows].sort((x, y) => { if (rk) { const d = rk.get(x.id)! - rk.get(y.id)!; if (d) return d; } const a = ks.get(x.id)!, b = ks.get(y.id)!; return (typeof a === "number" && typeof b === "number" ? a - b : COLL.compare(String(a), String(b))) * so.d; });
  }
  VMEMO.k = mk; VMEMO.rows = rows; return rows;
}
/** đếm giá trị kiểu faceted: bỏ chính điều kiện của cột đang xem */
export function facet(S: State, I: Index, k: CondKey): Map<string, number> {
  const cd = condsOf(S).filter((c) => c.k !== k), pq = parseQ(S, S.q); let rows = baseRows(S, I);
  if (S.tab === "all") { if (S.tf.size) rows = rows.filter((a) => S.tf.has(a.tab_id)); } else if (S.st.size && k !== "status") rows = rows.filter((a) => a.status_id != null && S.st.has(a.status_id));
  const m = new Map<string, number>();
  for (const a of rows) {
    if (!matchQ(S, I, a, pq) || !cd.every((c) => matchCond(S, I, a, c))) continue;
    const vs = colVals(S, I, a, k);
    if (!vs.length) m.set(EMP, (m.get(EMP) || 0) + 1); else for (const v of new Set(vs)) m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}
export function barCnt(S: State, I: Index, rows: AccountX[], key: "tab_id" | "status_id") { const c: Record<string, number> = {}; for (const a of rows) { const v = a[key]; if (v != null) c[v] = (c[v] || 0) + 1; } return c; }

/* ───────── nhãn cột / xuất ───────── */
export const TYPES: Array<[string, string, string]> = [["text", "Văn bản", "type"], ["secret", "Mật khẩu", "lock"], ["number", "Số", "hash"], ["date", "Ngày", "calendar"], ["select", "Danh sách", "list"], ["link", "Liên kết", "link"], ["url", "Mở link", "external"], ["lookup", "Liên kết giá trị", "swap"], ["file", "Đính kèm", "file"]];
export const TYPEIC: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t[0], t[2]]));
export const TABICONS = ["facebook", "mail", "phone", "chat", "whatsapp", "send", "instagram", "youtube", "music", "globe", "briefcase", "shield", "key", "user", "users", "smartphone", "server", "at", "box", "link", "flag", "linkedin", "bubble"];
export function kMeta(I: Index, k: CondKey): { l: string; i: string } {
  const m: Record<string, [string, string]> = { status: ["Trạng thái", "tag"], dept: ["Bộ phận", "folder"], owner: ["Owner", "users"], device: ["Thiết bị", "smartphone"], tab: ["Loại", "layers"], label: ["Tên", "key"], note: ["Ghi chú", "note"], links: ["Liên kết đến", "lkin"], outl: ["Liên kết đi", "lkout"], updated: ["Cập nhật", "clock"], created: ["Tạo", "clock"] };
  const x = m[String(k)]; if (x) return { l: x[0], i: x[1] };
  const f = I.field[k as Id]; return f ? { l: f.label, i: f.type === "link" ? I.tab[f.link_tab ?? -1]?.icon || "link" : TYPEIC[f.type] } : { l: String(k), i: "type" };
}
export const tokLabel = (I: Index, tk: Id | string) => (typeof tk === "number" ? I.field[tk]?.label || String(tk) : ({ status: "Trạng thái", owner: "Owner", note: "Ghi chú", dept: "Bộ phận", device: "Thiết bị", tab: "Loại", label: "Tên" } as Record<string, string>)[tk] || tk);
export function cellText(S: State, I: Index, a: AccountX, tk: Id | string): string {
  if (typeof tk === "number") { const f = I.field[tk]; if (!f) return ""; return f.type === "link" ? (I.out[a.id]?.[tk] || []).map((x) => I.acc[x]?.label).join(",") : f.type === "lookup" ? lookupVal(I, a, f) : attStr(a.data[String(tk)]); }
  const fns: Record<string, () => string> = { status: () => stOf(I, a)?.label || "", owner: () => (a.owner_id != null && I.own[a.owner_id]?.name) || "", note: () => rteText(a.note || "").replace(/\n/g, " "), dept: () => deptOf(S, a.dept_id).name, device: () => (a.device_id != null && I.dev[a.device_id]?.name) || "", tab: () => I.tab[a.tab_id]?.name || "", label: () => a.label };
  return (fns[tk] || (() => ""))();
}
export const sortIds = (S: State, ids: Iterable<Id>) => { const m = new Map(S.view.map((id, i) => [id, i])); return [...ids].sort((a, b) => (m.get(a) ?? 1e9) - (m.get(b) ?? 1e9)); };
export function exportRows(S: State, I: Index, ids: Id[], fmt: ExportFmt): string[][] {
  const L: string[][] = []; if (fmt.header) L.push(fmt.use.map((t) => tokLabel(I, t)));
  for (const id of sortIds(S, ids)) { const a = I.acc[id]; if (a) L.push(fmt.use.map((t) => cellText(S, I, a, t))); }
  return L;
}
export function payload(I: Index, a: Account) {
  return { id: a.id, tab_id: a.tab_id, dept_id: a.dept_id, owner_id: a.owner_id, device_id: a.device_id, ver: a.updated, status_id: a.status_id, note: a.note, data: { ...a.data }, links: JSON.parse(JSON.stringify(I.out[a.id] || {})) as Record<string, Id[]> };
}
export function applyDelta(S: State, d: { accounts: Account[]; links: Link[]; deleted: Id[] }) {
  const del = new Set(d.deleted), touched = new Set([...d.accounts.map((a) => a.id), ...del]);
  if (del.size) S.accs = S.accs.filter((a) => !del.has(a.id));
  const pos = new Map(S.accs.map((a, i) => [a.id, i]));
  for (const a of d.accounts) { const i = pos.get(a.id); if (i === undefined) S.accs.push(a); else S.accs[i] = a; }
  S.links = S.links.filter((l) => !touched.has(l.src) && !touched.has(l.dst)).concat(d.links);
}
export const neighbors = (I: Index, id: Id) => [...new Set([...Object.values(I.out[id] || {}).flat(), ...(I.inn[id] || []).map((z) => z.src)])].filter((i) => I.acc[i]).slice(0, 14);
