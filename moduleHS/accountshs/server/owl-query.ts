// Cú vọ — bộ đánh giá truy vấn THUẦN (không I/O, không "server-only") trên các dòng đã nạp vào bộ nhớ.
// Port của AI_deepSearch.py: Cx · cond_ok · _comp/_ev/_okc · query() (lọc · sắp · nhóm · tổng · trùng) · plan_act,
// và phần "bộ máy dữ liệu lớn" của AI_engine.py (_view/_snip/snippet/_unit/_gvals). owl.ts lo việc thu hẹp tập dòng bằng
// Postgres (phạm vi tab/bộ phận/owner/ids + ahs_search_ids) rồi gọi evalSpec() ở đây để giữ ĐÚNG ý nghĩa kết quả như bản Python.
import { fold as fold0 } from "../core/text.ts";

export type Id = number;
export const fold = (s: unknown) => fold0(s).trim();
export const MAXN = 5000;

export interface AccRow { id: Id; tab_id: Id; dept_id: Id; owner_id: Id | null; status_id: Id | null; device_id: Id | null; note: string; data: Record<string, unknown>; created: number | null; updated: number | null }
export interface QTab { id: Id; name: string; icon: string }
export interface QField { id: Id; tab_id: Id; label: string; type: string; opts: string; link_tab: Id | null; pos: number }
export interface QStatus { id: Id; tab_id: Id; label: string; color: string }
export interface QOwner { id: Id; dept_id: Id; parent_id: Id | null; name: string }
export interface QDept { id: Id; name: string }
export interface QMeta { tabs: QTab[]; fields: QField[]; sts: QStatus[]; owners: QOwner[]; depts: QDept[]; devices?: Array<{ id: Id; name: string }> }

export const VIRTK = ["status", "owner", "device", "note", "inlinks", "created", "updated"] as const;
export type VirtKey = (typeof VIRTK)[number];
export const isVirt = (k: unknown): k is VirtKey => typeof k === "string" && (VIRTK as readonly string[]).includes(k);
export const LINKOPS = ["any_link", "all_link", "no_link"] as const;
export type Ref = Id | string;
export type Where = Record<string, unknown>;
export interface SortSpec { field?: Ref | null; dir?: "asc" | "desc"; by?: "tabs" | "count" }
export interface Spec {
  tab?: Id | "all" | null; dept?: Id | null; owner?: Id | Id[] | null; sub?: boolean; status?: string[]; q?: string; ids?: Id[]; limit?: number;
  sort?: SortSpec | SortSpec[]; where?: Where[]; dup?: { field: Ref; min?: number }; group?: { by: Ref; top?: number; min?: number; order?: "asc" | "desc"; unit?: "day" | "week" | "month" | "year" }; agg?: { fn: string; field: Ref };
  [k: string]: unknown;
}
export type Op =
  | { op: "delete" } | { op: "set_status"; value: string } | { op: "set_owner"; value: Id }
  | { op: "set_field"; field: Ref; value: string } | { op: "set_note"; value: string; mode?: "append" | "replace" };

export const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
export const asList = <X>(v: X | X[] | null | undefined): X[] => (v === null || v === undefined || (v as unknown) === "" ? [] : Array.isArray(v) ? v : [v]);
export const sortsOf = (sp: Spec | null | undefined): SortSpec[] => asList(sp?.sort);
export const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/* ───────── Cx: bảng tra cứu cho 1 lần truy vấn ───────── */
export interface Cx {
  F: Map<Id, QField>; S: Map<Id, QStatus>; O: Map<Id, QOwner>; T: Map<Id, QTab>; dev: Map<Id, string>; D: Map<Id, string>; first: Map<Id, QField>;
  out: Map<Id, Map<Id, Id[]>>; inn: Map<Id, Set<Id>>; atab: Map<Id, Id>; lab: Map<Id, string>;
}
export function mkCx(m: QMeta): Cx {
  const cx: Cx = { F: new Map(), S: new Map(), O: new Map(), T: new Map(), dev: new Map(), D: new Map(), first: new Map(), out: new Map(), inn: new Map(), atab: new Map(), lab: new Map() };
  for (const f of m.fields) cx.F.set(f.id, f);
  for (const s of m.sts) cx.S.set(s.id, s);
  for (const o of m.owners) cx.O.set(o.id, o);
  for (const t of m.tabs) cx.T.set(t.id, t);
  for (const d of m.depts) cx.D.set(d.id, d.name);
  for (const d of m.devices ?? []) cx.dev.set(d.id, d.name);
  for (const f of m.fields) { const c = cx.first.get(f.tab_id); if (!c || f.pos < c.pos || (f.pos === c.pos && f.id < c.id)) cx.first.set(f.tab_id, f); }
  return cx;
}
/** nạp liên kết vào cx (src→{fid:[dst]} · dst→{src}) */
export function cxAddLinks(cx: Cx, links: Array<{ src: Id; dst: Id; field_id: Id }>) {
  for (const l of links) {
    let o = cx.out.get(l.src); if (!o) { o = new Map(); cx.out.set(l.src, o); }
    const arr = o.get(l.field_id); if (arr) { if (!arr.includes(l.dst)) arr.push(l.dst); } else o.set(l.field_id, [l.dst]);
    let i = cx.inn.get(l.dst); if (!i) { i = new Set(); cx.inn.set(l.dst, i); } i.add(l.src);
  }
}
export function cxLabel(cx: Cx, a: AccRow): string {
  let s = cx.lab.get(a.id);
  if (s === undefined) { const f = cx.first.get(a.tab_id); s = (f ? str(a.data[String(f.id)]) : "") || "#" + a.id; cx.lab.set(a.id, s); }
  return s;
}
/** các tài khoản (mọi tab) đang liên kết TỚI dòng này → {tên tab: số dòng} */
export function cxLk(cx: Cx, a: AccRow): Map<string, number> {
  const c = new Map<string, number>();
  for (const i of cx.inn.get(a.id) ?? []) { const t = cx.atab.get(i); const tb = t !== undefined ? cx.T.get(t) : undefined; if (tb) c.set(tb.name, (c.get(tb.name) ?? 0) + 1); }
  return c;
}
export function cxVals(cx: Cx, a: AccRow, k: Ref, A: Map<Id, AccRow>): string[] {
  if (k === "status") { const s = a.status_id !== null ? cx.S.get(a.status_id) : undefined; return s ? [s.label] : []; }
  if (k === "owner") { const o = a.owner_id !== null ? cx.O.get(a.owner_id) : undefined; return o ? [o.name] : []; }
  if (k === "device") { const d = a.device_id !== null ? cx.dev.get(a.device_id) : undefined; return d ? [d] : []; }
  if (k === "note") return a.note ? [a.note] : [];
  if (k === "created" || k === "updated") { const v = a[k]; return v ? [String(v)] : []; }
  if (k === "inlinks") return [...(cx.inn.get(a.id) ?? [])].map((i) => { const b = A.get(i); return b ? cxLabel(cx, b) : "#" + i; });
  const f = typeof k === "number" ? cx.F.get(k) : undefined;
  if (!f || f.tab_id !== a.tab_id) return [];
  if (f.type === "link") return (cx.out.get(a.id)?.get(f.id) ?? []).map((d) => { const b = A.get(d); return b ? cxLabel(cx, b) : "#" + d; });
  const v = a.data[String(f.id)];
  return v === null || v === undefined || v === "" ? [] : [Array.isArray(v) ? v.map((x) => (isObj(x) ? str(x.n) : str(x))).filter(Boolean).join(", ") : str(v)];
}

/* ───────── số · ngày ───────── */
export function toNum(x: unknown): number | null { const s = str(x).trim().replace(",", "."); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }
const DATE_RX: Array<[RegExp, (m: RegExpMatchArray) => [number, number, number]]> = [
  [/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/, (m) => [+m[1], +m[2], +m[3]]],
  [/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?: (\d{1,2}):(\d{2}))?$/, (m) => [+m[3], +m[2], +m[1]]],
  [/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, (m) => [2000 + +m[3], +m[2], +m[1]]],
  [/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (m) => [+m[1], +m[2], +m[3]]],
];
/** số giây (timestamp) hoặc chữ ngày (2026-10-11, 11/10/2026…) → giây | null  (giờ địa phương như time.mktime) */
export function toTs(x: unknown): number | null {
  const n = toNum(x); if (n !== null && n > 1e8) return n;
  const s = str(x).trim();
  for (const [rx, f] of DATE_RX) { const m = rx.exec(s); if (m) { const [y, mo, d] = f(m); if (mo < 1 || mo > 12 || d < 1 || d > 31) return null; const hh = m[4] ? +m[4] : 0, mm = m[5] ? +m[5] : 0; const t = new Date(y, mo - 1, d, hh, mm, 0).getTime() / 1000; return Number.isFinite(t) ? t : null; } }
  return null;
}
const P2 = (n: number) => String(n).padStart(2, "0");
export const ymd = (t: number) => { const d = new Date(t * 1000); return `${d.getFullYear()}-${P2(d.getMonth() + 1)}-${P2(d.getDate())}`; };
/** strftime theo đơn vị: day %Y-%m-%d · week %Y-W%W · month %Y-%m · year %Y */
export function unitOf(v: unknown, unit: string): string {
  const t = toTs(v); if (t === null) return str(v);
  const d = new Date(t * 1000);
  if (unit === "year") return String(d.getFullYear());
  if (unit === "month") return `${d.getFullYear()}-${P2(d.getMonth() + 1)}`;
  if (unit === "week") { const jan1 = new Date(d.getFullYear(), 0, 1); const doy = Math.floor((d.getTime() - jan1.getTime()) / 864e5); const wd = (d.getDay() + 6) % 7; return `${d.getFullYear()}-W${P2(Math.floor((doy + 7 - wd) / 7))}`; }
  return ymd(t);
}

/* ───────── điều kiện ───────── */
export function condOk(vs: string[], op: string, val: unknown): boolean {
  if (op === "empty" || op === "not_empty") return (vs.length === 0) === (op === "empty");
  if (op.startsWith("num_")) {
    const v = asList(val as unknown).map(toNum);
    if (!v.length || v.some((x) => x === null)) throw new Error(`Giá trị so sánh số không hợp lệ: ${JSON.stringify(val)}`);
    const ns = vs.map(toNum).filter((n): n is number => n !== null), w = v as number[];
    if (op === "num_between") { if (w.length !== 2) throw new Error("num_between cần đúng 2 giá trị [thấp, cao]"); const lo = Math.min(...w), hi = Math.max(...w); return ns.some((n) => n >= lo && n <= hi); }
    const f: Record<string, (n: number) => boolean> = { num_gt: (n) => n > w[0], num_gte: (n) => n >= w[0], num_lt: (n) => n < w[0], num_lte: (n) => n <= w[0], num_eq: (n) => n === w[0] };
    if (!f[op]) throw new Error("Toán tử không hỗ trợ: " + op);
    return ns.some(f[op]);
  }
  if (op.startsWith("len_")) {
    const v = toNum(val); if (v === null) throw new Error(`Độ dài phải là số: ${JSON.stringify(val)}`);
    const f: Record<string, (n: number) => boolean> = { len_gt: (n) => n > v, len_gte: (n) => n >= v, len_lt: (n) => n < v, len_lte: (n) => n <= v, len_eq: (n) => n === v };
    if (!f[op]) throw new Error("Toán tử không hỗ trợ: " + op);
    return vs.some((x) => f[op](String(x).length));
  }
  if (op === "before" || op === "after" || op === "within_days" || op === "older_days") {
    const ts = vs.map(toTs).filter((t): t is number => t !== null);
    if (op === "within_days" || op === "older_days") {
      const d = toNum(val); if (d === null) throw new Error(`Số ngày không hợp lệ: ${JSON.stringify(val)}`);
      const lim = Date.now() / 1000 - d * 86400;
      return op === "within_days" ? ts.some((t) => t >= lim) : ts.some((t) => t < lim);
    }
    const ref = toTs(val); if (ref === null) throw new Error(`Ngày không hợp lệ: ${JSON.stringify(val)}`);
    return op === "before" ? ts.some((t) => t < ref) : ts.some((t) => t >= ref);
  }
  const fv = vs.map(fold);
  const ts = Array.isArray(val) ? val.map(fold) : [fold(val)];
  if (op === "eq" || op === "in" || op === "ne" || op === "nin") { const hit = fv.some((x) => ts.includes(x)); return hit === (op === "eq" || op === "in"); }
  if (op === "contains" || op === "not_contains") return ts.some((x) => fv.some((v) => v.includes(x))) === (op === "contains");
  if (op === "starts") return ts.some((x) => fv.some((v) => v.startsWith(x)));
  throw new Error("Toán tử không hỗ trợ: " + op);
}

export function resolveRef(ref: unknown, cx: Cx): Ref[] {
  if (isVirt(ref)) return [ref];
  const fr = fold(ref);
  const ks = [...cx.F.values()].filter((f) => f.id === ref || fold(f.label) === fr).map((f) => f.id);
  if (!ks.length) throw new Error("Không tìm thấy trường: " + str(ref));
  return ks;
}
export interface SubCond { tab: Id | null; status: Set<string>; conds: Node[] }
export type Node = ["or" | "and", Node[]] | ["not", Node] | ["c", Ref[], string, unknown];
/** điều kiện (dict) → cây đã tra trường */
export function comp(w: unknown, cx: Cx, flags: Set<string>): Node {
  if (!isObj(w)) throw new Error("Điều kiện không hợp lệ");
  for (const g of ["or", "and"] as const) if (g in w) { const l = w[g]; if (!Array.isArray(l) || !l.length) throw new Error(`"${g}" cần một danh sách điều kiện`); return [g, l.map((x) => comp(x, cx, flags))]; }
  if ("not" in w) return ["not", comp(w.not, cx, flags)];
  const ks = resolveRef(w.field, cx), op = str(w.op || "contains");
  let v: unknown = w.value;
  if ((LINKOPS as readonly string[]).includes(op)) {
    flags.add("all");
    const sub = isObj(v) ? v : {};
    const st = asList(sub.status as string | string[] | undefined);
    const sc: SubCond = { tab: sub.tab !== null && sub.tab !== undefined && sub.tab !== "" ? Number(sub.tab) : null, status: new Set(st.map(fold)), conds: (Array.isArray(sub.where) ? sub.where : []).map((x) => comp(x, cx, flags)) };
    v = sc;
  }
  return ["c", ks, op, v];
}
function subOk(b: AccRow, sub: SubCond, cx: Cx, A: Map<Id, AccRow>): boolean {
  if (sub.tab !== null && b.tab_id !== sub.tab) return false;
  if (sub.status.size && !sub.status.has(fold((b.status_id !== null && cx.S.get(b.status_id)?.label) || ""))) return false;
  return sub.conds.every((n) => evalNode(n, b, cx, A));
}
function okc(a: AccRow, k: Ref, op: string, v: unknown, cx: Cx, A: Map<Id, AccRow>): boolean {
  if ((LINKOPS as readonly string[]).includes(op)) {
    let ids: Id[];
    if (k === "inlinks") ids = [...(cx.inn.get(a.id) ?? [])];
    else { const f = typeof k === "number" ? cx.F.get(k) : undefined; ids = f && f.type === "link" && f.tab_id === a.tab_id ? cx.out.get(a.id)?.get(f.id) ?? [] : []; }
    const ok = ids.filter((i) => A.has(i)).map((i) => subOk(A.get(i)!, v as SubCond, cx, A));
    return op === "any_link" ? ok.some(Boolean) : op === "all_link" ? ok.length > 0 && ok.every(Boolean) : !ok.some(Boolean);
  }
  const vs = cxVals(cx, a, k, A);
  if (!op.startsWith("cnt_")) return condOk(vs, op, v);
  let n = vs.length; const f = typeof k === "number" ? cx.F.get(k) : undefined;
  if (f && f.type !== "link" && vs.length) { const x = toNum(vs[0]); if (x !== null) n = x; }
  const w = Number(v);
  return ({ cnt_gt: n > w, cnt_gte: n >= w, cnt_lt: n < w, cnt_lte: n <= w, cnt_eq: n === w } as Record<string, boolean>)[op] ?? false;
}
export function evalNode(n: Node, a: AccRow, cx: Cx, A: Map<Id, AccRow>): boolean {
  if (n[0] === "or" || n[0] === "and") { const xs = n[1] as Node[]; return n[0] === "or" ? xs.some((x) => evalNode(x, a, cx, A)) : xs.every((x) => evalNode(x, a, cx, A)); }
  if (n[0] === "not") return !evalNode(n[1] as Node, a, cx, A);
  const [, ks, op, v] = n as ["c", Ref[], string, unknown];
  return ks.some((k) => okc(a, k, op, v, cx, A));
}
/** đệ quy: owner + toàn bộ cấp dưới */
export function descendants(oid: Id, owners: Iterable<QOwner>, acc = new Set<Id>()): Set<Id> {
  if (!acc.has(oid)) { acc.add(oid); for (const o of owners) if (o.parent_id === oid) descendants(o.id, owners, acc); }
  return acc;
}
/** các điều kiện lá (bỏ or/and/not) */
export function* leaves(w: unknown): Generator<Record<string, unknown>> {
  if (!isObj(w)) return;
  if ("or" in w || "and" in w) { for (const x of asList((w.or ?? w.and) as unknown[])) yield* leaves(x); }
  else if ("not" in w) yield* leaves(w.not);
  else yield w;
}

/* ───────── giá trị nhóm / tổng ───────── */
export function gvals(a: AccRow, by: Ref, cx: Cx, A: Map<Id, AccRow>): string[] {
  if (by === "owner") return [(a.owner_id !== null && cx.O.get(a.owner_id)?.name) || "Chưa có owner"];
  if (by === "status") return [(a.status_id !== null && cx.S.get(a.status_id)?.label) || "Chưa có"];
  if (by === "dept") return [cx.D.get(a.dept_id) || "Chưa có bộ phận"];
  if (by === "tab") return [cx.T.get(a.tab_id)?.name ?? String(a.tab_id)];
  if (by === "created" || by === "updated") { const v = a[by]; return v ? [ymd(v)] : ["(trống)"]; }
  const vs = resolveRef(by, cx).flatMap((k) => cxVals(cx, a, k, A));
  return vs.length ? vs : ["(trống)"];
}
const numOf = (a: AccRow, ks: Ref[], cx: Cx, A: Map<Id, AccRow>): number | null => { for (const k of ks) for (const x of cxVals(cx, a, k, A)) { const n = toNum(x); if (n !== null) return n; } return null; };
const roundN = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 100) / 100);

/* ───────── kết quả ───────── */
export interface ViewRow { id: Id; tab: string; icon: string; label: string; status?: string | null; color?: string | null; owner?: string | null; lk?: string }
export interface Group { k: string; n: number; c: string | null; ids: Id[] }
export interface QueryResult { count: number; ids: Id[]; rows: ViewRow[]; stats: Array<{ t: string; c: string; n: number }>; groups: Group[] | null; agg: { fn: string; v: number | null; n: number } | null; all: AccRow[]; truncated?: boolean }
export interface Snip { fid: Id | null; words: string[] }
export interface ProfLike { contentField: (tab: Id) => Id | null; kindOf: (fid: Id) => string | undefined }

/** đoạn nội dung quanh chữ đang tìm (hiện dưới tên dòng) */
export function snippet(a: AccRow, sn: Snip, cx: Cx, prof: ProfLike | null): string | null {
  const f = sn.fid !== null ? sn.fid : prof?.contentField(a.tab_id) ?? null;
  if (f === null || !(String(f) in a.data) || cx.first.get(a.tab_id)?.id === f) return null;
  const t = str(a.data[String(f)]); if (!t) return null;
  const ft = fold(t);
  const poss = sn.words.map((w) => (w ? ft.indexOf(w) : -1)).filter((p) => p >= 0);
  const pos = poss.length ? Math.min(...poss) : 0, st = Math.max(0, pos - 30);
  return (st ? "…" : "") + t.slice(st, st + 110).replace(/\n/g, " ") + (t.length > st + 110 ? "…" : "");
}
export function snipOf(sp: Spec, cx: Cx, prof: ProfLike | null): Snip | null {
  const ws: string[] = []; let fid: Id | null = null;
  for (const w of sp.where ?? []) for (const x of leaves(w)) {
    if (["contains", "starts", "in", "eq"].includes(str(x.op)) && !isVirt(x.field)) {
      const ks = [...cx.F.values()].filter((f) => f.id === x.field || fold(f.label) === fold(x.field)).map((f) => f.id);
      if (ks.length && prof?.kindOf(ks[0]) === "long") { fid = ks[0]; ws.push(...asList(x.value as unknown).map(fold)); }
    }
  }
  if (sp.q) ws.push(...fold(sp.q).split(" ").filter(Boolean));
  return ws.length ? { fid, words: ws } : null;
}
export function viewRows(rows: AccRow[], cx: Cx, A: Map<Id, AccRow>, sp: Spec | null, prof: ProfLike | null, extra?: (a: AccRow) => string): ViewRow[] {
  const sn = sp ? snipOf(sp, cx, prof) : null;
  const sf = sp ? sortsOf(sp).map((s) => s.field).filter((f): f is Id => typeof f === "number" && cx.F.has(f)) : [];
  return rows.map((a) => {
    const s = a.status_id !== null ? cx.S.get(a.status_id) : undefined;
    const r: ViewRow = { id: a.id, tab: cx.T.get(a.tab_id)?.name ?? "", icon: cx.T.get(a.tab_id)?.icon ?? "user", label: cxLabel(cx, a), status: s?.label ?? null, color: s?.color ?? null, owner: (a.owner_id !== null && cx.O.get(a.owner_id)?.name) || null };
    let t = sn ? snippet(a, sn, cx, prof) : null;
    if (sf.length && !t) { const v = a.data[String(sf[0])]; t = v !== null && v !== undefined && v !== "" ? `${cx.F.get(sf[0])!.label}: ${str(v)}` : null; }
    const ex = extra ? extra(a) : ""; if (ex) t = t ? t + " · " + ex : ex;
    if (t) r.lk = t;
    void A;
    return r;
  });
}

/** query(): lọc theo status/where/q/dup → sắp → nhóm/tổng → hạn chế limit.  rows = dòng đã nằm trong phạm vi tab/dept/owner/ids;
    A = mọi dòng cần tra (kể cả đầu kia liên kết); dupPool = dòng cùng tab để đếm trùng (mặc định = rows). */
export function evalSpec(sp: Spec, rows: AccRow[], cx: Cx, A: Map<Id, AccRow>, view = 12, prof: ProfLike | null = null, dupPool?: AccRow[]): QueryResult {
  let out = rows;
  if (sp.status?.length) { const want = new Set(asList(sp.status).map(fold)); out = out.filter((a) => want.has(fold((a.status_id !== null && cx.S.get(a.status_id)?.label) || ""))); }
  const flags = new Set<string>();
  const conds = (sp.where ?? []).map((w) => comp(w, cx, flags));
  const grp = sp.group, dup = sp.dup;
  if (grp && !["owner", "status", "dept", "tab", "created", "updated"].includes(String(grp.by))) resolveRef(grp.by, cx);
  const dks = dup ? resolveRef(dup.field, cx) : null;
  const dupn = new Map<Id, number>();
  if (dup && dks) {
    const mn = Math.max(2, Math.trunc(Number(dup.min) || 2)), cnt = new Map<string, number>();
    const vk = (b: AccRow) => new Set(dks.flatMap((k) => cxVals(cx, b, k, A)).filter((x) => x.trim()).map(fold));
    for (const b of dupPool ?? rows) if (sp.tab === null || sp.tab === undefined || sp.tab === "all" || b.tab_id === Number(sp.tab)) for (const v of vk(b)) cnt.set(v, (cnt.get(v) ?? 0) + 1);
    for (const a of out) { let n = 0; for (const v of vk(a)) n = Math.max(n, cnt.get(v) ?? 0); if (n >= mn) dupn.set(a.id, n); }
    out = out.filter((a) => dupn.has(a.id));
  }
  const qs = fold(sp.q ?? "").split(" ").filter(Boolean);
  const hay = (a: AccRow) => fold([cxLabel(cx, a), a.note || "", ...Object.values(a.data).map((v) => (Array.isArray(v) ? v.map((x) => (isObj(x) ? str(x.n) : str(x))).join(" ") : str(v)))].join(" "));
  out = out.filter((a) => conds.every((n) => evalNode(n, a, cx, A)) && (!qs.length || (() => { const h = hay(a); return qs.every((x) => h.includes(x)); })()));
  const sts = sortsOf(sp);
  if (sts.length) {
    for (const st of [...sts].reverse()) {
      const ref = st.field; if (ref === null || ref === undefined || ref === "") continue;
      if (ref === "inlinks") {
        const rank = (a: AccRow): [number, number] => { const c = cxLk(cx, a); const tot = [...c.values()].reduce((x, y) => x + y, 0); return st.by === "count" ? [tot, c.size] : [c.size, tot]; };
        const rk = new Map(out.map((a) => [a.id, rank(a)] as const));
        out = [...out].sort((x, y) => { const a = rk.get(x.id)!, b = rk.get(y.id)!; const d = (a[0] - b[0]) || (a[1] - b[1]); return st.dir === "asc" ? d : -d; });
        continue;
      }
      const ks = resolveRef(ref, cx);
      const sk = (a: AccRow): [number, number | string] | null => { const vs = ks.flatMap((k) => cxVals(cx, a, k, A)); if (!vs.length) return null; const n = vs.length === 1 ? toNum(vs[0]) : null; return n !== null ? [0, n] : [1, fold(vs.join(" "))]; };
      const full = out.map((a) => [sk(a), a] as const);
      const have = full.filter((x): x is readonly [[number, number | string], AccRow] => x[0] !== null).sort((x, y) => { const a = x[0], b = y[0]; const d = a[0] !== b[0] ? a[0] - b[0] : typeof a[1] === "number" && typeof b[1] === "number" ? a[1] - b[1] : String(a[1]) < String(b[1]) ? -1 : String(a[1]) > String(b[1]) ? 1 : 0; return st.dir === "desc" ? -d : d; });
      out = [...have.map((x) => x[1]), ...full.filter((x) => x[0] === null).map((x) => x[1])];
    }
  } else if (dupn.size && dks) out = [...out].sort((a, b) => (dupn.get(b.id)! - dupn.get(a.id)!) || fold(dks.flatMap((k) => cxVals(cx, a, k, A)).join(" ")).localeCompare(fold(dks.flatMap((k) => cxVals(cx, b, k, A)).join(" "))));
  else out = [...out].sort((a, b) => ((b.created ?? 0) - (a.created ?? 0)) || (b.id - a.id));
  let groups: Group[] | null = null, agg: QueryResult["agg"] = null;
  const ag = sp.agg, aks = ag ? resolveRef(ag.field, cx) : null, fn = ag?.fn || "sum";
  if (grp) {
    const bucket = new Map<string, Id[]>(), wsum = new Map<string, number>();
    for (const a of out) {
      let gv = gvals(a, grp.by, cx, A); if (grp.unit) gv = gv.map((x) => (x === "(trống)" ? x : unitOf(x, grp.unit!)));
      const w = aks ? numOf(a, aks, cx, A) : null;
      for (const g of new Set(gv)) { (bucket.get(g) ?? bucket.set(g, []).get(g)!).push(a.id); if (aks) wsum.set(g, (wsum.get(g) ?? 0) + (w ?? 0)); }
    }
    const col = new Map(grp.by === "status" ? [...cx.S.values()].map((x) => [x.label, x.color]) : []);
    const mn = Math.trunc(Number(grp.min) || 1), top = grp.top || sp.limit;
    const items = [...bucket.entries()].map(([g, ids]) => ({ g, ids, n: aks ? (fn === "avg" ? (wsum.get(g) ?? 0) / Math.max(1, ids.length) : wsum.get(g) ?? 0) : ids.length })).filter((x) => x.n >= mn);
    if (grp.unit || grp.by === "created" || grp.by === "updated") items.sort((a, b) => (grp.order === "asc" ? 1 : -1) * (a.g < b.g ? -1 : a.g > b.g ? 1 : 0));
    else items.sort((a, b) => (grp.order === "asc" ? a.n - b.n : b.n - a.n) || (a.g < b.g ? -1 : a.g > b.g ? 1 : 0));
    const lim = top ? items.slice(0, Math.max(1, Math.trunc(Number(top)))) : items;
    groups = lim.map((x) => ({ k: x.g, n: roundN(x.n), c: col.get(x.g) ?? null, ids: x.ids.slice(0, MAXN) }));
  } else if (sp.limit) out = out.slice(0, Math.max(1, Math.trunc(Number(sp.limit))));
  if (ag && aks && !grp) {
    const ns = out.map((a) => numOf(a, aks, cx, A)).filter((n): n is number => n !== null);
    const v = !ns.length ? null : fn === "sum" ? ns.reduce((a, b) => a + b, 0) : fn === "avg" ? ns.reduce((a, b) => a + b, 0) / ns.length : fn === "max" ? Math.max(...ns) : Math.min(...ns);
    agg = { fn, v, n: ns.length };
  }
  const stc = new Map<string, { t: string; c: string; n: number }>();
  for (const a of out) { const s = a.status_id !== null ? cx.S.get(a.status_id) : undefined; const k = (s?.label ?? "Chưa có") + "\u0001" + (s?.color ?? "#a1a1aa"); const e = stc.get(k); if (e) e.n++; else stc.set(k, { t: s?.label ?? "Chưa có", c: s?.color ?? "#a1a1aa", n: 1 }); }
  const inl = sts.some((s) => s.field === "inlinks");
  const note = (a: AccRow) => { const parts: string[] = []; if (inl) parts.push([...cxLk(cx, a).entries()].sort((x, y) => y[1] - x[1]).map(([t, n]) => `${n} ${t}`).join(" · ")); if (dupn.size) parts.push(`trùng ${dupn.get(a.id)} lần`); return parts.filter(Boolean).join(" · "); };
  return { count: out.length, ids: out.slice(0, MAXN).map((a) => a.id), rows: viewRows(out.slice(0, view), cx, A, sp, prof, inl || dupn.size ? note : undefined), stats: [...stc.values()].sort((a, b) => b.n - a.n), groups, agg, all: out };
}

/* ───────── xem trước sửa / xóa ───────── */
export type Act = ["delete"] | ["status", Id] | ["owner", Id] | ["note", string] | ["field", Id, string] | ["create", Id, Id | null, Id | null, Id | null, Record<string, string>];
export interface PlanAct { k: string | Id; field: string; before: string; after: string; act: Act }
/** → (khóa cột, nhãn, trước, sau, hành động) hoặc null nếu không áp dụng được cho dòng này */
export function planAct(op: Op, a: AccRow, cx: Cx): PlanAct | null {
  if (op.op === "delete") return { k: "delete", field: "Xóa dòng", before: "còn", after: "xóa", act: ["delete"] };
  if (op.op === "set_status") { const s = [...cx.S.values()].find((x) => x.tab_id === a.tab_id && fold(x.label) === fold(op.value)); return s ? { k: "status", field: "Tình trạng", before: (a.status_id !== null && cx.S.get(a.status_id)?.label) || "", after: s.label, act: ["status", s.id] } : null; }
  if (op.op === "set_owner") { const o = cx.O.get(op.value); return o ? { k: "owner", field: "Owner", before: (a.owner_id !== null && cx.O.get(a.owner_id)?.name) || "", after: o.name, act: ["owner", o.id] } : null; }
  if (op.op === "set_note") { const old = a.note || "", v = str(op.value); const nw = op.mode === "append" ? (old ? old + "\n" : "") + v : v; return { k: "note", field: "Ghi chú", before: old, after: nw, act: ["note", nw] }; }
  const f = (typeof op.field === "number" ? cx.F.get(op.field) : undefined) ?? [...cx.F.values()].find((x) => x.tab_id === a.tab_id && fold(x.label) === fold(op.field));
  if (op.op === "set_field" && f && f.tab_id === a.tab_id && f.type !== "link") return { k: f.id, field: f.label, before: str(a.data[String(f.id)]), after: str(op.value), act: ["field", f.id, str(op.value)] };
  return null;
}
