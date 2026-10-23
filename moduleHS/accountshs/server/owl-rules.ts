// Cú vọ — luật hiểu câu THUẦN (không I/O, không "server-only"): port của AI_deepSearch.py (so khớp mờ · Brain · tok · understand ·
// from_json · chữ ký mẫu đã học · chip · gợi ý) + phần "hiểu ý" của AI_engine.py (học kiểu trường · tab_vote · Hint · merge_hint).
// owl.ts nạp dữ liệu (Postgres), dựng Env rồi gọi các hàm ở đây; test chạy thẳng bằng node --test.
import { fold, str, isObj, asList, LINKOPS, sortsOf, type AccRow, type Id, type QDept, type QField, type QMeta, type QOwner, type QStatus, type QTab, type Ref, type Spec, type VirtKey, type Where } from "./owl-query.ts";

export type O = Record<string, unknown>;
export const jc = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
export const words = (s: string) => s.split(/\s+/).filter(Boolean);
export const isDig = (s: string) => /^\d+$/.test(s);
export const uniq = <X>(xs: Iterable<X>) => [...new Set(xs)];
export const resc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
/** Python truthiness (None, "", 0, [], {} = sai) */
export const tru = (v: unknown) => !(v === undefined || v === null || v === false || v === 0 || v === "" || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length));
export const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
/* regex kiểu Python: nhóm tên + vị trí nhóm (cờ d) — dựng bằng RegExp để không vướng target ES2017 của tsconfig */
export function* iter(src: string, s: string, fl = ""): Generator<RegExpExecArray> { const rx = new RegExp(src, "gd" + fl); for (let m = rx.exec(s); m; m = rx.exec(s)) { yield m; if (!m[0]) rx.lastIndex++; } }
export const search = (src: string, s: string, fl = "") => new RegExp(src, "d" + fl).exec(s);
export const ms = (m: RegExpExecArray, g?: string | number) => (g === undefined ? m.index : typeof g === "number" ? m.indices?.[g]?.[0] ?? -1 : m.indices?.groups?.[g]?.[0] ?? -1);
export const me = (m: RegExpExecArray, g?: string | number) => (g === undefined ? m.index + m[0].length : typeof g === "number" ? m.indices?.[g]?.[1] ?? -1 : m.indices?.groups?.[g]?.[1] ?? -1);
export const gp = (m: RegExpExecArray, g: string) => m.groups?.[g];
export const isUpper = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();
export function maxBy<X>(xs: X[], f: (x: X) => number): X { let b = xs[0], bv = f(b); for (const x of xs.slice(1)) { const v = f(x); if (v > bv) { b = x; bv = v; } } return b; }

/* ───────── so khớp mờ (không cần bảng từ khóa) ───────── */
/** difflib.SequenceMatcher(None, a, b).ratio() */
export function seqRatio(a: string, b: string): number {
  const la = a.length, lb = b.length; if (!la && !lb) return 1;
  const b2j = new Map<string, number[]>(); for (let j = 0; j < lb; j++) { const l = b2j.get(b[j]); if (l) l.push(j); else b2j.set(b[j], [j]); }
  const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let bi = alo, bj = blo, bs = 0, j2 = new Map<number, number>();
    for (let i = alo; i < ahi; i++) { const nj = new Map<number, number>(); for (const j of b2j.get(a[i]) ?? []) { if (j < blo) continue; if (j >= bhi) break; const k = (j2.get(j - 1) ?? 0) + 1; nj.set(j, k); if (k > bs) { bi = i - k + 1; bj = j - k + 1; bs = k; } } j2 = nj; }
    return [bi, bj, bs];
  };
  let M = 0; const q: Array<[number, number, number, number]> = [[0, la, 0, lb]];
  while (q.length) { const [alo, ahi, blo, bhi] = q.pop()!; const [i, j, k] = longest(alo, ahi, blo, bhi); if (k) { M += k; if (alo < i && blo < j) q.push([alo, i, blo, j]); if (i + k < ahi && j + k < bhi) q.push([i + k, ahi, j + k, bhi]); } }
  return (2 * M) / (la + lb);
}
/** viết tắt: cmt~comment, fb~facebook, tg~telegram, qc~quảng cáo (chữ cái đầu của từng từ) */
export function ab(t: string, l: string): boolean {
  const s = l.replace(/ /g, ""), lw = words(l);
  if (lw.length > 1 && lw.map((w) => w[0]).join("") === t) return true;
  if (l.includes(" ") && t.length > 3) return false;
  if (t.length < 2 || t.length + 2 > s.length || t[0] !== s[0] || [...t.slice(1)].filter((c) => "aeiouy".includes(c)).length > (t.length <= 3 ? 0 : 1)) return false;
  let p = 0; for (const c of t) { const k = s.indexOf(c, p); if (k < 0) return false; p = k + 1; } return true;
}
export const wm = (a: string, b: string) => a === b || ab(a, b) || ab(b, a) || (a.length >= 4 && b.length >= 4 && seqRatio(a, b) >= 0.84);
/** độ giống 0..1 giữa cụm người dùng gõ và tên thực thể; từ phổ biến trong DB có trọng số thấp */
export function sim(g: string, n: string, wt: (w: string) => number): number {
  if (g === n) return 1;
  const gw = words(g), nw = words(n);
  if (gw.length === 1 && ab(g, n)) return 0.88;
  const used = new Set<number>(), seq: number[] = []; let m = 0;
  for (const w of gw) { const j = nw.findIndex((x, k) => !used.has(k) && wm(w, x)); if (j >= 0) { used.add(j); seq.push(j); m += wt(nw[j]); } }
  const full = nw.reduce((s, x) => s + wt(x), 0);
  const r = used.size === gw.length ? 0.5 + (0.5 * m) / full : 0;
  return r && seq.some((x, k) => k && x < seq[k - 1]) ? r * 0.85 : r;
}

/* ───────── học dữ liệu: kiểu trường, giá trị hay gặp, trường nội dung (AI_engine.learn) ───────── */
export type Kind = "text" | "num" | "date" | "long" | "cat" | "id" | "secret";
export interface FProf { kind: Kind; fill?: number; avg?: number; dist?: number; iso?: number; top?: string[]; full?: boolean; min?: number; max?: number; med?: number; ex?: string[] }
export interface TabProf { n: number; f: Record<string, FProf>; content: Id | null }
export interface Prof { tabs: Record<string, TabProf> }
const NUMRE = /^\s*-?\d+([.,]\d+)?\s*$/, ISO = /^\d{4}-\d{2}-\d{2}/;
const vstr = (v: unknown) => (v === null || v === undefined || v === "" || Array.isArray(v) || isObj(v) ? null : String(v));
/** đo cấu trúc từng tab: lấy mẫu ≤ cap dòng (rải đều) để đoán kiểu; danh mục thì đếm đủ cả tab */
export function buildProf(fields: QField[], rows: AccRow[], cap = 4000): Prof {
  const byTab = new Map<Id, AccRow[]>(); for (const a of rows) (byTab.get(a.tab_id) ?? byTab.set(a.tab_id, []).get(a.tab_id)!).push(a);
  const tabs: Prof["tabs"] = {};
  for (const [tid, all] of byTab) {
    const n = all.length, step = n <= cap ? 1 : n / cap, smp: AccRow[] = [];
    for (let x = 0; x < n && smp.length < cap; x += step) smp.push(all[Math.floor(x)]);
    const P: Record<string, FProf> = {};
    for (const f of fields) {
      if (f.tab_id !== tid || ["link", "file", "lookup"].includes(f.type)) continue;
      const vs = smp.map((a) => vstr(a.data[String(f.id)])).filter((v): v is string => v !== null), m = vs.length;
      const p: FProf = { fill: Math.round((m / Math.max(1, smp.length)) * 1000) / 1000, kind: "text" };
      if (m) {
        const avg = vs.reduce((s, v) => s + v.length, 0) / m, dist = new Set(vs.map(fold)).size, nnum = vs.filter((v) => NUMRE.test(v)).length, niso = vs.filter((v) => ISO.test(v)).length;
        Object.assign(p, { avg: Math.round(avg * 10) / 10, dist: Math.round((dist / m) * 1000) / 1000, iso: Math.round((niso / m) * 1000) / 1000 });
        if (f.type === "secret") p.kind = "secret";
        else if (f.type === "number" || nnum >= m * 0.9) p.kind = "num";
        else if (f.type === "date" || niso >= m * 0.9) p.kind = "date";
        else if (avg >= 35 && dist / m > 0.3 && vs.filter((v) => (v.match(/ /g) ?? []).length >= 3).length >= m * 0.5) p.kind = "long";
        else if (dist <= 60 && (dist / m < 0.2 || m < 30)) p.kind = "cat";
        else if (dist / m > 0.9) p.kind = "id";
        if (p.kind === "cat") {
          const c = new Map<string, number>(); for (const a of all) { const v = vstr(a.data[String(f.id)]); if (v !== null) c.set(v, (c.get(v) ?? 0) + 1); }
          const top = [...c.entries()].sort((x, y) => y[1] - x[1]).slice(0, 81);
          p.top = top.slice(0, 80).map((x) => x[0]); p.full = top.length <= 80; if (!p.full) p.kind = "text";
        } else if (p.kind === "num") { const ns = vs.filter((v) => NUMRE.test(v)).map((v) => parseFloat(v.replace(",", "."))).sort((x, y) => x - y); if (ns.length) Object.assign(p, { min: ns[0], max: ns[ns.length - 1], med: ns[Math.floor(ns.length / 2)] }); }
        else if (["long", "text", "id"].includes(p.kind)) p.ex = vs.slice(0, 3).map((v) => v.slice(0, 60));
      } else if (f.type === "number" || f.type === "date") p.kind = f.type === "number" ? "num" : "date";
      if (f.type === "select") { const o = opts(f); Object.assign(p, { kind: "cat", top: uniq([...o, ...(p.top ?? [])]), full: p.full ?? !m }); }
      P[String(f.id)] = p;
    }
    const longs = Object.entries(P).filter(([, p]) => p.kind === "long").map(([fid, p]) => [p.avg ?? 0, +fid] as const).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    tabs[String(tid)] = { n, f: P, content: longs.length ? longs[longs.length - 1][1] : null };
  }
  return { tabs };
}
export const fprofOf = (P: Prof, fid: Id): Partial<FProf> => { for (const t of Object.values(P.tabs)) if (t.f[String(fid)]) return t.f[String(fid)]; return {}; };
export const contentField = (P: Prof, tab: Id): Id | null => P.tabs[String(tab)]?.content ?? null;
/** giá trị danh mục học được (trường văn bản ít giá trị lặp lại) → thêm vào từ vựng */
export function learnedValues(P: Prof): Array<[Id, Id, string]> {
  const out: Array<[Id, Id, string]> = [];
  for (const [tid, t] of Object.entries(P.tabs)) for (const [fid, p] of Object.entries(t.f)) if (p.kind === "cat" && p.top?.length && p.top.length <= 40) for (const v of p.top) if (v.length > 1 && v.length <= 40) out.push([+fid, +tid, v]);
  return out.slice(0, 600);
}
/** chỉ mục giá trị: fold(giá trị) → {field_id: số dòng} (thay FTS khi suy trường của giá trị dán vào) */
export function buildVidx(rows: AccRow[]): Map<string, Map<Id, number>> {
  const d = new Map<string, Map<Id, number>>();
  for (const a of rows) for (const [k, v0] of Object.entries(a.data)) { const v = vstr(v0); if (v === null || !isDig(k)) continue; const fv = fold(v); let x = d.get(fv); if (!x) d.set(fv, (x = new Map())); x.set(+k, (x.get(+k) ?? 0) + 1); }
  return d;
}

/* ───────── Brain: từ vựng đọc từ DB + trí nhớ ───────── */
export const VIRT: Record<VirtKey, string[]> = { status: ["tinh trang", "trang thai"], owner: ["owner", "nguoi quan ly"], note: ["ghi chu", "note"], device: ["thiet bi"], inlinks: ["lien ket"], created: ["ngay tao", "thoi gian tao"], updated: ["ngay cap nhat", "lan sua cuoi"] };
export const VLAB: Record<string, string> = { status: "Tình trạng", owner: "Owner", note: "Ghi chú", device: "Thiết bị", inlinks: "Liên kết", created: "Ngày tạo", updated: "Ngày cập nhật" };
const TYPEW: Record<string, string[]> = { secret: ["pass", "password", "mk"] };
const KIND: Record<string, string> = { tab: "tab", field: "trường", status: "tình trạng", opt: "giá trị", owner: "owner", dept: "bộ phận", virt: "trường" };
const TABSYN: Record<string, string[]> = { " bai dang ": ["bai viet", "post"], " sdt ": ["so dien thoai"], " so dien thoai ": ["sdt"] };
export const GBY: Record<string, string> = { owner: "owner", "nguoi quan ly": "owner", "tinh trang": "status", "trang thai": "status", status: "status", tab: "tab", "nen tang": "tab", "bo phan": "dept", dept: "dept", "ngay tao": "created", "thoi gian tao": "created", "ngay cap nhat": "updated" };
export const GBYV = new Set(Object.values(GBY));
export const opts = (f: QField) => (f.opts || "").split(",").map((x) => x.trim()).filter(Boolean);

export interface AskOpt { t: string; ref?: string; term?: string; q?: string }
export class Ask extends Error { options: AskOpt[]; soft: boolean; constructor(msg: string, options: AskOpt[] = [], soft = false) { super(msg); this.options = options; this.soft = soft; } }
export class Inapplicable extends Error {}

interface EntBase { ref: string; tabs: Set<Id> | null; b: number; n: string[]; acc: string[] }
export type Ent = EntBase & ({ k: "tab"; o: QTab } | { k: "field"; o: QField } | { k: "opt"; o: [QField, string] } | { k: "status"; o: string } | { k: "owner"; o: QOwner } | { k: "dept"; o: QDept } | { k: "virt"; o: VirtKey });
export type EntK = Ent["k"];
export interface Hit { i: number; n: number; e: Ent; es: Ent[]; sc: number }
export interface Tk { r: string; n: string; qt: boolean; col: boolean; u: boolean; d: boolean }
export interface Env { prof: Prof; vidx: () => Map<string, Map<Id, number>>; alias: Record<string, string> }
export interface Ctx { selected?: Id[]; spec?: Spec | null; reply?: { spec?: Spec | null; msg?: string } | null; sub?: boolean; rejected?: string; learn?: { term: string; ref: string } | null }

export class Brain {
  tabs: QTab[]; fields: QField[]; sts: QStatus[]; owners: QOwner[]; depts: QDept[];
  T = new Map<Id, QTab>(); F = new Map<Id, QField>(); O = new Map<Id, QOwner>(); D = new Map<Id, QDept>();
  alias: Record<string, string>; prof: Prof; ents: Ent[]; names: Set<string>; valset: Set<string>; fwords: Set<string>; df = new Map<string, number>(); ltab = new Map<string, number>();
  env: Env; ctx: Ctx;
  constructor(m: QMeta, env: Env, ctx: Ctx = {}) {
    this.env = env; this.ctx = ctx;
    this.tabs = m.tabs; this.fields = m.fields; this.sts = m.sts; this.owners = m.owners; this.depts = m.depts;
    for (const x of m.tabs) this.T.set(x.id, x); for (const x of m.fields) this.F.set(x.id, x); for (const x of m.owners) this.O.set(x.id, x); for (const x of m.depts) this.D.set(x.id, x);
    this.alias = env.alias; this.prof = env.prof;
    for (const f of m.fields) this.ltab.set(fold(f.label), (this.ltab.get(fold(f.label)) ?? 0) + 1);   // số tab có trường cùng tên
    this.ents = this.mkEnts();
    this.names = new Set(this.ents.flatMap((e) => e.n));
    this.valset = new Set(this.ents.filter((e) => e.k === "status" || e.k === "opt").flatMap((e) => e.n).filter((n) => n.includes(" ")));
    this.fwords = new Set(this.fields.flatMap((f) => words(fold(f.label))));
  }
  fprof = (fid: Id) => fprofOf(this.prof, fid);
  private mkEnts(): Ent[] {
    const E: Ent[] = [];
    // acc: các chữ (có dấu) của TÊN THẬT — chỉ khi tên có dấu mới so dấu (tên gõ không dấu thì không bắt lỗi dấu)
    const add = (x: Omit<Ent, "n" | "acc">, names: string[], raw: string[] = names.slice(0, 1)) => { const rw = raw.flatMap((nm) => words(nm.toLowerCase().normalize("NFC"))); E.push({ ...x, n: uniq(names.map(fold).filter(Boolean)), acc: rw.some((w) => w !== fold(w)) ? uniq(rw) : [] } as Ent); };
    const tn = new Map(this.tabs.map((t) => [t.id, fold(t.name)] as const)), others = (id: Id) => [...tn].filter(([o]) => o !== id).map(([, v]) => v);
    for (const t of this.tabs) {
      const ws = words(tn.get(t.id)!), al: string[] = [];
      for (let a = 0; a < ws.length; a++) for (let b = a + 1; b <= ws.length; b++) {
        const ph = ws.slice(a, b).join(" ");
        if ((a === 0 && b === ws.length) || ph.length < 3 || STOPW.has(ph)) continue;
        if (b - a === 1 && others(t.id).some((o) => ` ${o} `.includes(` ${ph} `))) continue; // 1 chữ dùng chung nhiều tab ("hàng") → không đủ gọi tab
        if (others(t.id).some((o) => !o.includes(ph) && (ab(ph, o) || sim(ph, o, () => 1) >= 0.7))) continue;
        al.push(ph);
      }
      for (const [k, v] of Object.entries(TABSYN)) if (` ${tn.get(t.id)} `.includes(k)) al.push(...v);
      add({ k: "tab", ref: `tab:${t.id}`, o: t, tabs: new Set([t.id]), b: 0.06 + Math.min(0.009, 0.002 * Math.log10(1 + (this.prof.tabs[String(t.id)]?.n ?? 0))) }, [t.name, ...al]);
    }
    for (const f of this.fields) {
      add({ k: "field", ref: `field:${f.id}`, o: f, tabs: new Set([f.tab_id]), b: 0 }, [f.label, ...(TYPEW[f.type] ?? [])]);
      for (const v of opts(f)) add({ k: "opt", ref: `opt:${f.id}|${v}`, o: [f, v], tabs: new Set([f.tab_id]), b: 0.05 }, [v]);
    }
    const st = new Map<string, QStatus[]>(); for (const x of this.sts) (st.get(fold(x.label)) ?? st.set(fold(x.label), []).get(fold(x.label))!).push(x);
    for (const [k, xs] of st) add({ k: "status", ref: `status:${k}`, o: xs[0].label, tabs: new Set(xs.map((x) => x.tab_id)), b: 0.05 }, [xs[0].label]);
    for (const o of this.owners) add({ k: "owner", ref: `owner:${o.id}`, o, tabs: null, b: 0.04 }, [o.name, ...words(fold(o.name)).slice(-1)]);
    for (const d of this.depts) add({ k: "dept", ref: `dept:${d.id}`, o: d, tabs: null, b: 0.03 }, [d.name]);
    for (const [fid, tid, v] of learnedValues(this.prof)) { const f = this.F.get(fid); if (f && f.type !== "select") add({ k: "opt", ref: `opt:${fid}|${v}`, o: [f, v], tabs: new Set([tid]), b: 0.03 }, [v]); }
    for (const [k, v] of Object.entries(VIRT)) add({ k: "virt", ref: `virt:${k}`, o: k as VirtKey, tabs: null, b: 0 }, v);
    for (const [term, ref] of Object.entries(this.alias)) for (const e of E) if (e.ref === ref) e.n.push(term);
    for (const e of E) for (const n of e.n) for (const w of new Set(words(n))) this.df.set(w, (this.df.get(w) ?? 0) + 1);
    return E;
  }
  wt = (w: string) => ((this.df.get(w) ?? 0) <= 2 ? 1 : 0.25);
  pool(tab: Id | null, kinds: readonly EntK[]) { return this.ents.filter((e) => kinds.includes(e.k) && (tab === null || e.tabs === null || e.tabs.has(tab))); }
  label(e: Ent): string {
    switch (e.k) {
      case "owner": return `${e.o.name} (${this.D.get(e.o.dept_id)?.name ?? ""})`;
      case "tab": return e.o.name; case "status": return e.o; case "field": return `${e.o.label} · ${this.T.get(e.o.tab_id)?.name ?? ""}`;
      case "opt": return e.o[1]; case "dept": return e.o.name; default: return VLAB[e.o];
    }
  }
  /** gán từng cụm token (3/2/1 từ) cho thực thể giống nhất, không chồng lấn; đánh dấu token đã dùng */
  link(T: Tk[], tab: Id | null, kinds: readonly EntK[]): Hit[] {
    const pool = this.pool(tab, kinds), cand: Array<[number, number, number, number, Ent]> = [];
    for (const n of [3, 2, 1]) for (let i = 0; i + n <= T.length; i++) {
      const sl = T.slice(i, i + n), g = sl.map((x) => x.n).join(" ");
      if (g.length < 2 || sl.some((x) => x.u || x.d) || (n === 1 && stopTok(sl[0]))) continue;
      for (const e of pool) {
        const sc = Math.max(0, ...e.n.map((nm) => (e.k === "opt" && words(nm).length > n && !sl.every((x) => words(nm).includes(x.n)) ? 0 : sim(g, nm, this.wt)))); // giá trị dữ liệu chỉ khớp một phần → phải đúng chữ ("danh" ≠ "Kinh doanh")
        // từ đã dạy (ai_alias) thắng phép đoán mờ (vd "sống" ≠ "SG"); không nêu tab: giá trị của trường có ở nhiều tab được ưu tiên
        const bonus = (this.alias[g] === e.ref ? 0.2 : 0) + (tab === null && e.k === "opt" ? 0.01 * Math.min(9, this.ltab.get(fold(e.o[0].label)) ?? 1) : 0);
        if (sc >= (e.k === "opt" && words(e.n[0]).length > 2 ? 0.9 : 0.7) && !accentClash(sl, e)) cand.push([sc + 0.1 * n + e.b + bonus + (tab !== null && e.k !== "tab" && e.tabs?.has(tab) ? 0.1 : 0), sc, i, n, e]);
      }
    }
    cand.sort((x, y) => y[0] - x[0]);
    const out: Hit[] = [];
    for (const [, sc, i, n, e] of cand) {
      if (T.slice(i, i + n).some((x) => x.u)) continue;
      for (const x of T.slice(i, i + n)) x.u = true;
      let es = cand.filter((c) => c[2] === i && c[3] === n && c[1] === sc && c[4].k === "owner" && e.k === "owner").map((c) => c[4]); if (!es.length) es = [e];
      const al = this.alias[T.slice(i, i + n).map((t) => t.n).join(" ")]; const es2 = es.filter((x) => al === x.ref); if (es2.length) es = es2;
      out.push({ i, n, e, es, sc });
    }
    return out.sort((x, y) => x.i - y.i);
  }
  /** 1 tên (do model / bước trước đưa ra) → thực thể; không chắc thì hỏi lại kèm lựa chọn gần nhất */
  findMany(kinds: readonly EntK[], name: unknown, tab: Id | null = null, many = true): Ent[] {
    const g = fold(name), ref = this.alias[g];
    if (ref) { const hit = this.pool(tab, kinds).find((e) => e.ref === ref); if (hit) return [hit]; }
    const sc = this.pool(tab, kinds).map((e) => [Math.max(0, ...e.n.map((nm) => sim(g, nm, this.wt))), e] as const).sort((x, y) => y[0] - x[0]);
    const top = sc.filter(([c]) => c >= 0.7 && c === sc[0][0]).map(([, e]) => e);
    if (top.length && (many || top.length === 1)) return many ? top : [top[0]];
    const near = top.length ? top : sc.slice(0, 4).filter(([c]) => c >= 0.4).map(([, e]) => e);
    throw new Ask(`${top.length ? "Có nhiều" : "Không rõ"} ${KIND[kinds[0]]} "${str(name)}". Ý bạn là:`, near.slice(0, 5).map((e) => ({ t: this.label(e), ref: e.ref, term: str(name) })));
  }
  find(kinds: readonly EntK[], name: unknown, tab: Id | null = null): Ent { return this.findMany(kinds, name, tab, false)[0]; }
  /** giá trị người dùng dán nằm ở trường nào? → [trường, các giá trị khớp] | null (học từ dữ liệu) */
  infer(vals: string[], tab: Id | null): [QField, string[]] | null {
    const vi = this.env.vidx(), sc = new Map<Id, Array<[string, number]>>();
    for (const v of vals.slice(0, 60)) for (const [fid, c] of vi.get(fold(v)) ?? []) { const f = this.F.get(fid); if (f && (tab === null || f.tab_id === tab)) (sc.get(fid) ?? sc.set(fid, []).get(fid)!).push([v, c]); }
    if (!sc.size) return null;
    const fid = maxBy([...sc.keys()], (k) => sc.get(k)!.length * 1e9 + sc.get(k)!.reduce((s, x) => s + x[1], 0));
    return [this.F.get(fid)!, sc.get(fid)!.map((x) => x[0])];
  }
  exact(fid: Id, vals: string[]) { const vi = this.env.vidx(); return vals.slice(0, 60).every((v) => vi.get(fold(v))?.has(fid)); }
}
export const tabOf = (e: Ent) => (e.k === "tab" ? e.o.id : -1);
/** bẫy bỏ dấu: chữ gõ CÓ dấu mà tên thực thể chỉ có từ cùng gốc khác dấu (lương ≠ lượng, mỗi ≠ mới, chỉ ≠ chi) → không khớp */
function accentClash(sl: Tk[], e: Ent): boolean {
  for (const x of sl) { const lr = x.r.toLowerCase().normalize("NFC"); if (x.qt || lr === x.n || lr.includes(" ")) continue; const same = e.acc.filter((w) => fold(w) === x.n); if (same.length && !same.includes(lr)) return true; }
  return false;
}
/** từ đệm — trừ khi gõ có dấu khác hẳn từ đệm đó ("lương" không phải "lượng" của "số lượng") */
const ACC_STOP: Record<string, string[]> = { luong: ["lượng"], moi: ["mọi", "mỗi"], chi: ["chỉ"] };
const stopTok = (x: Tk) => STOPW.has(x.n) && !(ACC_STOP[x.n] && x.r.toLowerCase() !== x.n && !ACC_STOP[x.n].includes(x.r.toLowerCase()));

/* ───────── câu → token → plan ───────── */
export const VERBS: Array<[string, string[]]> = [["note", ["bo sung ghi chu", "them ghi chu", "bo sung note", "them note", "bo sung"]], ["del", ["xoa", "go", "loai"]], ["add", ["them", "tao", "nhap"]], ["note", ["ghi chu", "note", "ghi"]],
  ["set", ["thay the", "thay", "cap nhat", "danh dau", "doi", "sua", "chinh", "chuyen", "gan", "giao", "dat", "update", "set"]]];
/** dạng có dấu của động từ lệnh — chữ gõ CÓ dấu phải đúng dấu ("nháp" không phải "nhập", "đạt" không phải "đặt") */
const VACC: Record<string, string[]> = { "bo sung ghi chu": ["bổ sung ghi chú"], "them ghi chu": ["thêm ghi chú"], "bo sung note": ["bổ sung note"], "them note": ["thêm note"], "bo sung": ["bổ sung"], xoa: ["xóa", "xoá"], go: ["gỡ"], loai: ["loại"],
  them: ["thêm"], tao: ["tạo"], nhap: ["nhập"], "ghi chu": ["ghi chú"], ghi: ["ghi"], "thay the": ["thay thế"], thay: ["thay"], "cap nhat": ["cập nhật"], "danh dau": ["đánh dấu"], doi: ["đổi"], sua: ["sửa"], chinh: ["chỉnh"], chuyen: ["chuyển"], gan: ["gán", "gắn"], giao: ["giao"], dat: ["đặt"] };
const verbAcc = (sl: Tk[], w: string) => { const acc = VACC[w]; if (!acc) return true; return sl.every((x, k) => { const lr = x.r.toLowerCase().normalize("NFC"); return lr === x.n || acc.some((a) => words(a)[k] === lr); }); };
const NEG = new Set(["khong", "ko", "tru", "ngoai", "chua"]);
const EMP: string[][] = [["chua", "co"], ["khong", "co"], ["thieu"], ["chua"], ["khong"]];
const HAS: string[][] = [["da", "co"], ["co"]];
const OPW: Array<[string[], string]> = [[["bat", "dau"], "starts"], [["bao", "gom"], "contains"], [["chua"], "contains"], [["la"], "eq"], [["bang"], "eq"], [["khac"], "ne"], [["trong"], "empty"]];
const CONN = new Set(["sang", "thanh", "bang", "cho", "voi", "la", "=", "->", "=>"]);
export const OPNAME: Record<string, string> = { eq: "là", in: "là", ne: "không phải", nin: "không phải", contains: "chứa", starts: "bắt đầu bằng", not_contains: "không chứa", empty: "trống", not_empty: "có dữ liệu",
  cnt_gt: "nhiều hơn", cnt_gte: "ít nhất", cnt_lt: "ít hơn", cnt_lte: "nhiều nhất", cnt_eq: "đúng", num_gt: ">", num_gte: "≥", num_lt: "<", num_lte: "≤", num_eq: "=", num_between: "trong khoảng", len_gt: "dài hơn", len_gte: "dài ít nhất", len_lt: "ngắn hơn",
  len_lte: "dài tối đa", len_eq: "dài đúng", before: "trước", after: "từ", within_days: "trong … ngày qua", older_days: "quá … ngày", any_link: "có liên kết tới", all_link: "mọi liên kết tới", no_link: "không liên kết tới" };
const CMP: Record<string, string> = { ">": "cnt_gt", ">=": "cnt_gte", "<": "cnt_lt", "<=": "cnt_lte", "=": "cnt_eq", "==": "cnt_eq", "≥": "cnt_gte", "≤": "cnt_lte" };
const CW: Array<[string[], string]> = [[["nhieu", "hon"], "cnt_gt"], [["lon", "hon"], "cnt_gt"], [["hon"], "cnt_gt"], [["tren"], "cnt_gt"], [["it", "nhat"], "cnt_gte"], [["toi", "thieu"], "cnt_gte"], [["it", "hon"], "cnt_lt"], [["duoi"], "cnt_lt"], [["toi", "da"], "cnt_lte"], [["nhieu", "nhat"], "cnt_lte"], [["dung"], "cnt_eq"]];
const CONNS = new Set(["+", "&", "va", "voi", "vua", "cung", "kem", "dong", "thoi", "roi"]);
export const STOPW = new Set(["cua", "nhung", "cac", "tat", "ca", "nay", "do", "kia", "the", "nao", "la", "thi", "o", "trong", "cho", "tai", "khoan", "tk", "acc", "account", "dang", "da", "duoc", "co", "mot", "may", "bi", "bao", "nhieu", "tong", "so", "luong", "dem", "nua", "luon", "cung", ...CONNS]);
const LENP: Array<[string[], string]> = [[["dai", "it", "nhat"], "len_gte"], [["dai", "toi", "thieu"], "len_gte"], [["dai", "toi", "da"], "len_lte"], [["dai", "hon"], "len_gt"], [["ngan", "hon"], "len_lt"], [["dai", "dung"], "len_eq"], [["dai", "bang"], "len_eq"]];
export const FILL = new Set(["toi", "muon", "lay", "ra", "danh", "sach", "xem", "tim", "hay", "giup", "can", "liet", "ke", "hien", "vua", "va", "deu", "ma", "nao", "nhe", "nha", "nhi", "di", "toan", "bo", "tai", "nguyen", "tat", "ca", "het", "owner"]);
const CLASSIF = new Set(["cai", "dong", "tk", "acc", "account", "con", "hang", "ban", "tai khoan"]);
const NOQ = new Set(["hon", "tren", "duoi", "nhat", "thieu", "da", "dung", "tu", "top", "it", "nhieu", ...Object.keys(CMP)]);
export const NOISE = new Set(["nhat", "bai", "dang", "nao", "khong", "ko", "nhi", "ha", "vay", "roi", "chua", "voi", "nhe", "nha", "oi", "giup", "minh", "ban", "co", "gi", "ai", "post", "tin", "dong", "cai", "hang", "list", "show", "cho", "xem", "tim", "kiem", "loc", "nhieu", "it", "hon", "top", "luot", "chi", "thoi", "nua", "them", "bot", "bo",
  "loai", "ngoai", "tru", "rieng", "lai", "het", "ca", "moi", "tung", "nhom", "theo", "so", "tong", "dem", "den", "tu", "nguoi", "ben", "phia", "qua", "bang", "dung", "lop", "hinh", "thuc", "hoac", "hay", "phai", "la", "o", "tai", "trong", "thuoc", "cua", "nhung", "cac", "duoc", "bi", "va", "ma"]);

export function tok(text: string, names: Set<string>): Tk[] {
  const out: Tk[] = [];
  for (const m of text.matchAll(/"[^"]*"|“[^”]*”|[^\s,;]+/g)) {
    let raw = m[0]; const qt = raw[0] === '"' || raw[0] === "“"; let parts: Array<[string, boolean]>;
    if (qt) parts = [[raw.replace(/^["“”]+|["“”]+$/g, ""), false]];
    else {
      raw = raw.replace(/^[()[\]{}!?]+|[()[\]{}!?]+$/g, "").replace(/\.+$/, "");
      const sp = new RegExp("^(\\p{L}{2,}):(.+)$", "u").exec(raw);
      parts = sp ? [[sp[1], true], [sp[2], false]] : [[raw.replace(/:+$/, ""), raw.endsWith(":")]];
    }
    for (const [r, col] of parts) { const n = fold(r); if (r) out.push({ r, n, qt, col, u: false, d: qt || (!names.has(n) && (/\d|@|_/.test(r) || (r.includes(".") && r.length > 3))) }); }
  }
  return out;
}
export const clone = (T: Tk[]) => T.map((t) => ({ ...t }));
const seqIs = (T: Tk[], i: number, p: readonly string[]) => i >= 0 && i + p.length <= T.length && p.every((w, k) => T[i + k].n === w);
const seqS = (T: Tk[], i: number, k: number) => T.slice(Math.max(0, i), i + k).map((x) => x.n).join(" ");
const free = (T: Tk[], i: number, k: number) => i >= 0 && i + k <= T.length && !T.slice(i, i + k).some((x) => x.u);
const eat = (T: Tk[], i: number, k: number) => { for (const x of T.slice(Math.max(0, i), i + k)) x.u = true; };

/** phép so sánh số lượng bắt đầu ở token j → [op, số, số token] */
function numAt(T: Tk[], j: number): [string, number, number] | null {
  if (j < 0 || j >= T.length || T[j].u) return null;
  const m = /^(>=|<=|==|=|>|<|≥|≤)(\d+)$/.exec(T[j].r.replace(/ /g, "")); if (m) return [CMP[m[1]], +m[2], 1];
  if (T[j].r in CMP && j + 1 < T.length && isDig(T[j + 1].n) && free(T, j, 2)) return [CMP[T[j].r], +T[j + 1].n, 2];
  for (const [pat, op] of CW) { const k = pat.length; if (free(T, j, k + 1) && seqIs(T, j, pat) && isDig(T[j + k].n)) return [op, +T[j + k].n, k + 1]; }
  if (T[j].n === "tu" && free(T, j, 4) && isDig(T[j + 1].n) && (seqIs(T, j + 2, ["tro", "len"]) || seqIs(T, j + 2, ["tro", "xuong"]))) return [T[j + 3].n === "len" ? "cnt_gte" : "cnt_lte", +T[j + 1].n, 4];
  if (isDig(T[j].n) && free(T, j, 3) && (seqIs(T, j + 1, ["tro", "len"]) || seqIs(T, j + 1, ["tro", "xuong"]))) return [T[j + 2].n === "len" ? "cnt_gte" : "cnt_lte", +T[j].n, 3];
  return null;
}
/** "pass dài hơn 10 ký tự" → [len_gt, 10, vị trí đầu, số token] */
function lenOp(T: Tk[], j: number): [string, number, number, number] | null {
  for (const a of [j, j + 1]) {
    if (a === j + 1 && !(j < T.length && ["co", "la"].includes(T[j].n) && !T[j].u)) break;
    for (const [pat, op] of LENP) { const k = pat.length; if (free(T, a, k + 1) && seqIs(T, a, pat) && isDig(T[a + k].n)) { let n = k + 1; if (free(T, a + n, 2) && seqIs(T, a + n, ["ky", "tu"])) n += 2; else if (free(T, a + n, 1) && ["ky", "chu"].includes(T[a + n].n)) n += 1; return [op, +T[a + k].n, j, n + (a - j)]; } }
  }
  return null;
}
/** từ j: thứ cần NHÓM THEO → khóa nhóm */
function groupTarget(T: Tk[], j: number, B: Brain, tab: Id | null): Ref | null {
  for (const n of [3, 2, 1]) if (free(T, j, n) && seqS(T, j, n) in GBY) { const key = GBY[seqS(T, j, n)]; eat(T, j, n); return key; }
  for (const h of B.link(clone(T.slice(j, j + 3)), tab, ["field"])) if (h.i === 0 && free(T, j, h.n) && h.e.k === "field") { eat(T, j, h.n); return tab !== null ? h.e.o.id : h.e.o.label; }
  return null;
}
function numNear(T: Tk[], i: number, j: number): [string, number, number, number] | null {
  for (const a of [j, j + 1]) {
    if (a === j + 1 && !(j < T.length && ["co", "la"].includes(T[j].n) && !T[j].u)) break;
    const r = numAt(T, a); if (r) return [r[0], r[1], a !== j ? j : a, r[2] + (a - j)];
  }
  for (const L of [1, 2, 3, 4]) { const r = numAt(T, i - L); if (r && r[2] === L) return [r[0], r[1], i - L, L]; }
  return null;
}
/** từ đệm ("tôi muốn lấy ra danh sách…") không mang điều kiện → bỏ qua */
function fillers(T: Tk[], B: Brain) {
  const ws = new Set([...B.names].flatMap(words));
  T.forEach((x, i) => { if (FILL.has(x.n) && !x.u && !x.d && !ws.has(x.n) && !(x.n === "danh" && i + 1 < T.length && T[i + 1].n === "dau")) x.u = true; });
}
function verb(T: Tk[], B: Brain): string | null {
  for (let i = 0; i < Math.min(4, T.length); i++) for (const [it, ws] of VERBS) for (const w of ws) {
    const k = words(w).length;
    if (!(free(T, i, k) && seqS(T, i, k) === w && verbAcc(T.slice(i, i + k), w) && !(i && ["bi", "duoc"].includes(T[i - 1].n)))) continue; // "bị xóa" là tình trạng, không phải lệnh
    const ph: string[] = []; for (let a = Math.max(0, i - 2); a <= i; a++) for (let b = i + k; b <= Math.min(T.length, i + k + 2); b++) if (b - a > k) ph.push(T.slice(a, b).map((x) => x.n).join(" "));
    if (ph.some((p) => B.valset.has(p))) continue; // "đang giao", "đã bán" là giá trị có trong dữ liệu
    if (i && it === "set" && !T.slice(i + k).some((x) => ["sang", "thanh", "cho", "la", "="].includes(x.n))) continue;
    if (i && (it === "add" || it === "del") && B.fwords.has(w)) continue;
    eat(T, i, k); return it;
  }
  return null;
}
const backPat = (T: Tk[], i: number, pats: string[][]) => pats.find((p) => free(T, i - p.length, p.length) && seqIs(T, i - p.length, p))?.length ?? 0;
/** "lấy ra 5 fb live" · "cập nhật 2 cái": số 1-3 chữ số đứng ngay trước tab / từ chỉ loại = số dòng cần lấy */
function quantity(T: Tk[]): number | null {
  for (let i = 0; i < T.length; i++) {
    const x = T[i]; if (x.u || !/^\d{1,3}$/.test(x.n) || +x.n < 1 || (i && NOQ.has(T[i - 1].n))) continue;
    const j = i + 1; let k = 0;
    if (j + 1 < T.length && T[j].n === "tai" && T[j + 1].n === "khoan" && !T[j].u) k = 2; else if (j < T.length && CLASSIF.has(T[j].n) && !T[j].u) k = 1;
    if (k || (j < T.length && T[j].u)) { x.u = true; for (const y of T.slice(j, j + k)) y.u = true; return +x.n; }
  }
  return null;
}
const datas = (T: Tk[], j: number) => { const out: number[] = []; while (j < T.length && T[j].d && !T[j].u) out.push(j++); return out; };
const fref = (f: QField, tab: Id | null): Ref => (tab !== null ? f.id : f.label);

/** phần còn lại của câu → spec lọc + các trường chỉ được nhắc tới */
function readScope(B: Brain, T: Tk[], tab: Id | null): [Spec, Ent[]] {
  const sp: Spec = {}, wh: Where[] = [], ment: Ent[] = [];
  for (let i = 0; i < T.length - 1; i++) if (T[i].n === "top" && isDig(T[i + 1].n) && free(T, i, 2)) { sp.limit = +T[i + 1].n; eat(T, i, 2); }
  if (T.some((x) => x.n === "rieng")) sp.sub = false;
  const sortI = T.findIndex((x) => (x.n === "xep" || x.n === "sort") && !x.u);
  const own: Id[] = [], grp = new Map<string, [Ref, boolean, string[]]>(), st: string[] = [], nst: string[] = []; let lastw: [number, string] | null = null;
  for (const h of B.link(T, tab, ["field", "opt", "status", "owner", "dept", "virt"])) {
    const e = h.e, i = h.i, n = h.n; let j = i + n;
    if (sortI >= 0 && i > sortI && (e.k === "field" || e.k === "virt")) {
      const dr = T.slice(j, j + 2).filter((x) => ["giam", "desc", "tang", "asc"].includes(x.n));
      sp.sort = { field: e.k === "field" ? e.o.id : e.o, dir: dr.some((x) => x.n === "giam" || x.n === "desc") ? "desc" : "asc" };
      for (const x of [...dr, T[sortI], ...T.filter((y) => y.n === "theo")]) x.u = true;
      continue;
    }
    const nk = i > 0 && NEG.has(T[i - 1].n) && free(T, i - 1, 1) ? 1 : i > 1 && T[i - 1].n === "phai" && (T[i - 2].n === "khong" || T[i - 2].n === "ko") && free(T, i - 2, 2) ? 2 : 0, neg = nk > 0; // "không phải live"
    if (neg && (e.k === "opt" || e.k === "status" || e.k === "owner")) eat(T, i - nk, nk);
    if (e.k === "owner") { for (const x of h.es) if (x.k === "owner" && !own.includes(x.o.id)) own.push(x.o.id); }
    else if (e.k === "dept") sp.dept = e.o.id;
    else if (e.k === "status") (neg ? nst : st).push(e.o);
    else if (e.k === "opt") { const fr = fref(e.o[0], tab), key = JSON.stringify([fr, neg]); const g = grp.get(key) ?? grp.set(key, [fr, neg, []]).get(key)!; g[2].push(e.o[1]); }
    else if (e.k === "field" || e.k === "virt") {
      const f = e.k === "field" ? e.o : null, fr: Ref = f ? fref(f, tab) : (e.o as VirtKey);
      const kk = backPat(T, i, EMP);
      if (kk) { eat(T, i - kk, kk); wh.push({ field: fr, op: "empty" }); lastw = [j, "empty"]; continue; }
      const kh = backPat(T, i, HAS), ln = lenOp(T, j);
      if (ln) { eat(T, ln[2], ln[3]); wh.push({ field: fr, op: ln[0], value: ln[1] }); lastw = null; continue; }
      const nm = numNear(T, i, j);
      if (nm) { eat(T, nm[2], nm[3]); if (kh) eat(T, i - kh, kh); wh.push({ field: fr, op: nm[0], value: nm[1] }); lastw = null; continue; }
      let op: string | null = T[j - 1].col ? "eq" : null;
      for (const [pat, o] of OPW) if (!op && free(T, j, pat.length) && seqIs(T, j, pat)) { op = o; eat(T, j, pat.length); j += pat.length; }
      let vi = datas(T, j); if (!vi.length && op && ["contains", "starts", "eq", "ne"].includes(op) && free(T, j, 1)) vi = [j];
      const vals = vi.map((x) => T[x].r);
      if (op === "empty" && !vals.length) wh.push({ field: fr, op: "empty" });
      else if (vals.length) {
        eat(T, vi[0], vi.length);
        if (f && (op === null || op === "eq")) op = B.exact(f.id, vals) ? "in" : "contains";
        wh.push({ field: fr, op: op || "contains", value: op === "in" || op === "nin" || vals.length > 1 ? vals : vals[0] });
      } else if (kh) { eat(T, i - kh, kh); wh.push({ field: fr, op: "not_empty" }); lastw = [j, "not_empty"]; }
      else if (lastw && T.slice(lastw[0], i).every((x) => x.u || CONNS.has(x.n))) { eat(T, lastw[0], i - lastw[0]); wh.push({ field: fr, op: lastw[1] }); lastw = [j, lastw[1]]; }
      else ment.push(e);
    }
  }
  let rest = T.filter((x) => x.d && !x.u).map((x) => x.r);
  if (rest.length) {
    const r = B.infer(rest, tab);
    if (r) { const [f, hit] = r; wh.push({ field: fref(f, tab), op: "in", value: hit }); rest = rest.filter((x) => !hit.includes(x)); }
    for (const x of T) if (x.d && !rest.includes(x.r)) x.u = true;
  }
  if (own.length) sp.owner = own.length === 1 ? own[0] : own;
  if (st.length) sp.status = uniq(st);
  if (nst.length) wh.push({ field: "status", op: "nin", value: uniq(nst) });
  for (const [fr, ng, v] of grp.values()) wh.push({ field: fr, op: ng ? "nin" : "in", value: uniq(v) });
  if (wh.length) sp.where = wh;
  const left = T.filter((x) => !x.u).map((x) => x.r);
  if (rest.length) sp.q = rest.join(" ");
  else if (left.length && !(tru(sp.status) || wh.length || own.length || sp.dept || tab)) sp.q = left.join(" ");
  return [sp, ment];
}
/** câu nối tiếp: giữ phạm vi cũ, phần mới ghi đè / bổ sung */
export function merge(prev: Spec, nw: Spec): Spec {
  const out: Spec = { ...prev };
  if (nw.tab !== undefined && nw.tab !== null && nw.tab !== prev.tab) for (const k of ["status", "where", "sort", "ids", "q"]) delete out[k];
  for (const k of ["tab", "dept", "owner", "sub", "limit", "sort", "status", "ids", "group", "dup", "agg"]) if (tru(nw[k])) out[k] = nw[k];
  if ("owner" in nw && !("dept" in nw)) delete out.dept;
  let wh = [...(out.where ?? [])];
  const EQ = ["in", "nin", "eq"];
  for (const w of nw.where ?? []) wh = [...wh.filter((x) => !(x.field !== undefined && x.field !== null && x.field === w.field && EQ.includes(str(x.op)) && EQ.includes(str(w.op)))), w];
  if (wh.length) out.where = wh;
  if (nw.q) out.q = (str(out.q) + " " + nw.q).trim();
  return out;
}
type SetOp = O & { op: string };
/** V là giá trị mới (tình trạng / owner / giá trị chọn / chữ), L là phần còn lại có thể chứa tên trường cần đổi */
function asValue(B: Brain, V0: Tk[], L0: Tk[], tab: Id | null): SetOp | null {
  const V = clone(V0), hs = B.link(V, tab, ["status", "opt", "owner"]);
  if (hs.length === 1 && !V.some((x) => !x.u && x.d)) {
    const e = hs[0].e;
    if (e.k === "status") return { op: "set_status", value: e.o };
    if (e.k === "opt") return { op: "set_field", field: fref(e.o[0], tab), value: e.o[1] };
    if (hs[0].es.length > 1) throw new Ask(`Có ${hs[0].es.length} owner trùng tên, chọn người nào?`, hs[0].es.map((x) => ({ t: B.label(x), ref: x.ref, term: V[hs[0].i].r })));
    if (e.k === "owner") return { op: "set_owner", value: e.o.id };
  }
  const val = V.filter((x) => !x.u);
  if ((val.length && val.every((x) => x.d || x.qt)) || (val.length && !hs.length)) {
    const L = clone(L0);
    for (const h of B.link(L, tab, ["field", "virt"])) if (!(L[h.i + h.n - 1].col || datas(L, h.i + h.n).length)) {
      const text = val.map((x) => x.r).join(" ");
      return h.e.k === "virt" && h.e.o === "note" ? { op: "set_note", value: text } : h.e.k === "field" ? { op: "set_field", field: fref(h.e.o, tab), value: text } : null;
    }
  }
  return null;
}
/** "pass 123456789": tên trường + giá trị đứng liền sau */
function asField(B: Brain, L0: Tk[], tab: Id | null): SetOp | null {
  const L = clone(L0);
  for (const h of B.link(L, tab, ["field", "virt"])) { const vi = datas(L, h.i + h.n); if (vi.length && h.e.k === "field" && !L[h.i + h.n - 1].col) return { op: "set_field", field: fref(h.e.o, tab), value: vi.map((x) => L[x].r).join(" ") }; }
  return null;
}
/** "đổi X sang Y" · "chuyển X cho Y" · "cập nhật pass 123 cho uid: ..." → [token chọn dòng, phép sửa] */
function splitSet(B: Brain, T: Tk[], tab: Id | null): [Tk[], SetOp] | null {
  for (let c = 0; c < T.length; c++) {
    const t = T[c]; if (!(CONN.has(t.n) && c && !t.u)) continue;
    const L = T.slice(0, c), Rr = T.slice(c + 1);
    const tries: Array<() => [Tk[], SetOp | null]> = t.n === "cho" ? [() => [Rr, asField(B, L, tab)], () => [L, asValue(B, Rr, L, tab)], () => [Rr, asValue(B, L, Rr, tab)]] : [() => [L, asValue(B, Rr, L, tab)], () => [Rr, asField(B, L, tab)]];
    for (const fn of tries) { const [scope, op] = fn(); if (op) return [scope, op]; }
  }
  return null;
}
/** dữ liệu thêm hàng loạt: mỗi dòng một tài khoản, ngăn cột bằng | tab , ; — dòng đầu có thể là tên cột */
export function rowsOf(text: string, B: Brain, tab: Id): [Array<Record<string, string>>, string[]] {
  const rows: string[][] = [];
  for (let ln of text.split(/\r\n|\r|\n/)) { ln = ln.trim(); if (ln) { const sep = ["|", "\t", ";", ","].find((s) => ln.includes(s)); rows.push(sep ? ln.split(sep).map((c) => c.trim()) : [ln]); } }
  const fs = B.fields.filter((f) => f.tab_id === tab && f.type !== "link"), names = fs.map((f) => fold(f.label));
  const zip = (hd: Array<QField | undefined>, r: string[]) => { const o: Record<string, string> = {}; hd.forEach((h, k) => { if (h && r[k]) o[String(h.id)] = r[k]; }); return o; };
  if (rows.length && rows[0].every((c) => names.some((n) => wm(fold(c), n)))) { const hd = rows.shift()!.map((c) => fs.find((f) => wm(fold(c), fold(f.label)))); return [rows.map((r) => zip(hd, r)), hd.filter((h): h is QField => !!h).map((h) => h.label)]; }
  return [rows.map((r) => zip(fs, r)), fs.slice(0, Math.max(0, ...rows.map((r) => r.length), 1)).map((f) => f.label)];
}

export interface Plan { it: "help" | "say" | "search" | "count" | "set" | "del" | "add"; spec?: Spec; ops?: O[]; rows?: Array<Record<string, string>>; cols?: string[]; ctx?: boolean; rest?: string[]; unsure?: boolean; low?: boolean; msg?: string; ui?: string[]; teach?: { term: string; ref: string }; llm?: O; _noq?: boolean }

/** câu + ngữ cảnh → plan {it, spec, ops, rows, …}; ném Ask nếu cần hỏi lại */
export function understand(text: string, ctx: Ctx, B: Brain): Plan {
  const prev = ctx.reply?.spec || ctx.spec || null, sel = [...(ctx.selected ?? [])]; let cdep = false;
  if (["?", "help", "huong dan", "giup"].includes(fold(text))) return { it: "help" };
  const dm = /^\s*(?:day|dạy|nho|nhớ)\s*:?\s*(.+?)\s*(?:=|->|=>)\s*(.+)$/i.exec(text);
  if (dm) { const e = B.find(["tab", "field", "status", "opt", "owner", "dept"], dm[2]); return { it: "say", msg: `Đã nhớ: "${dm[1]}" = ${B.label(e)}`, teach: { term: fold(dm[1]), ref: e.ref } }; }
  let head = text, body: string | null = null;
  const cut = [text.indexOf("\n"), text.indexOf(":")].filter((i) => i >= 0);
  let T = tok(text, B.names); let it = verb(T, B), win: [number, string] | null = null;
  for (let i = 0; i < T.length - 2; i++) {
    if (isDig(T[i].n) && ["ngay", "tuan", "thang"].includes(T[i + 1].n) && ["qua", "gan", "truoc", "vua"].includes(T[i + 2].n) && free(T, i, 3)) {
      win = [+T[i].n * ({ ngay: 1, tuan: 7, thang: 30 } as Record<string, number>)[T[i + 1].n], T.some((x) => ["cap", "sua", "update"].includes(x.n)) ? "updated" : "created"];
      eat(T, i, 3);
      for (const j of [i - 1, i + 3]) if (j >= 0 && j < T.length && ["trong", "day"].includes(T[j].n) && !T[j].u) T[j].u = true;
      if (it === "add" && !text.includes(":") && !text.includes("\n")) it = null;
      break;
    }
  }
  fillers(T, B);
  let useSel = false;
  T.forEach((x, i) => { if (["chon", "tick", "checked"].includes(x.n) && sel.length) { useSel = true; const pre = i && ["dang", "da", "duoc"].includes(T[i - 1].n); eat(T, pre ? Math.max(0, i - 1) : i, pre ? 2 : 1); } });
  if (useSel) for (const x of T) x.u = x.u || ["cac", "nhung", "dong", "hang", "nay"].includes(x.n);
  if (it === "add" && cut.length) { const c = Math.min(...cut); head = text.slice(0, c); body = text.slice(c + 1); T = tok(head, B.names); verb(T, B); fillers(T, B); }
  const ft = " " + T.map((x) => x.n).join(" ") + " ";
  const hits = B.link(T, null, ["tab", "field"]);
  for (const h of hits) if (h.e.k === "field") for (const x of T.slice(h.i, h.i + h.n)) x.u = false;
  let tabhit = hits.filter((h) => h.e.k === "tab");
  let tab: Id | null = tabhit.length ? tabOf(maxBy(tabhit, (h) => h.sc).e) : null;
  // không nêu tab mà nêu tên NHÓM tab ("tài khoản die" = mọi tab nhóm Tài khoản, không gồm Bài đăng / Dữ liệu Marketing) → không đoán tab theo giá trị
  const grps = uniq(B.tabs.map((t) => t.grp ?? "").filter(Boolean)).sort((a, b) => fold(b).length - fold(a).length);
  const grp = tabhit.length ? undefined : grps.find((x) => ft.includes(` ${fold(x)} `) || (fold(x).endsWith(" khoan") && / (tk|acc|account|nick) /.test(ft)));
  if (!grp) try {
    let tv = tabVote(text, B, tab, hits); if (tv === null) tv = tab;
    for (const h of tabhit.filter((h) => tabOf(h.e) !== tv && h.sc < 0.85)) { for (const x of T.slice(h.i, h.i + h.n)) x.u = false; tabhit = tabhit.filter((y) => y !== h); }
    if (tv !== tab) { for (const h of tabhit) for (const x of T.slice(h.i, h.i + h.n)) x.u = false; tabhit = tabhit.filter((h) => tabOf(h.e) === tv); tab = tv; }
  } catch { /* tab_vote lỗi: giữ tab theo tên */ }
  const lim = quantity(T);
  let gby: Ref | null = null, gtop: number | null = null, dupf = false;
  for (let i = 0; i < T.length; i++) {
    const x = T[i]; if (x.u) continue;
    if ((["moi", "tung"].includes(x.n) && !["mới", "mởi", "mời", "mơi"].includes(x.r.toLowerCase())) || (x.n === "theo" && i && ["nhom", "chia", "ke", "dem", "phan"].includes(T[i - 1].n))) {
      gby = groupTarget(T, i + 1, B, tab);
      if (gby !== null) { eat(T, i, 1); if (x.n === "theo") T[i - 1].u = true; break; }
    }
    if (x.n === "nao" && i) {
      for (const n of [2, 1]) if (i - n >= 0 && free(T, i - n, n) && seqS(T, i - n, n) in GBY) {
        gby = GBY[seqS(T, i - n, n)]; eat(T, i - n, n + 1);
        const nh = T.findIndex((y) => y.n === "nhat" && !y.u);
        if (nh >= 0) { gtop = 1; eat(T, nh, 1); for (let k = Math.max(0, nh - 1); k < nh; k++) if (["nhieu", "it"].includes(T[k].n)) T[k].u = true; }
        break;
      }
      if (gby !== null) break;
    }
  }
  T.forEach((x, i) => { // "uid bị trùng" — không phải "trung bình", "trung tâm"…
    if (x.n === "trung" && !x.u && ["trùng", "trung"].includes(x.r.toLowerCase()) && !(i + 1 < T.length && ["binh", "tam", "thu", "gian", "hoc", "quoc", "thanh"].includes(T[i + 1].n))) { dupf = true; eat(T, i, 1); if (i + 1 < T.length && T[i + 1].n === "lap" && !T[i + 1].u) T[i + 1].u = true; }
  });
  let ops: SetOp[] | null = null, scope: Tk[] = T;
  if (it === "set" || it === "note") {
    if (it === "note") {
      const c = T.findIndex((x, i) => ["cho", "vao", "o"].includes(x.n) && i > 0);
      if (c < 0) throw new Ask("Ghi chú cho dòng nào? Ví dụ: ghi chú cần xác minh cho Page die của Hải");
      ops = [{ op: "set_note", value: T.slice(0, c).filter((x) => !x.u).map((x) => x.r).join(" "), mode: "append" }]; scope = T.slice(c + 1);
    } else {
      const r = splitSet(B, T, tab);
      if (!r) throw new Ask('Đổi thành gì? Ví dụ: "đổi … sang Die", "chuyển … cho Hải", "cập nhật pass 123 cho uid: 111,222"', [], true);
      scope = r[0]; ops = [r[1]];
    }
  }
  const rs = readScope(B, scope, tab); let sp = rs[0]; const ment = rs[1];
  if (win) (sp.where ??= []).push({ field: win[1], op: "within_days", value: win[0] });
  if (gby !== null) sp.group = { by: gby, ...(gtop ? { top: gtop } : {}) };
  if (dupf) {
    const fe = ment.find((e) => e.k === "field"), first = tab !== null ? B.fields.find((f) => f.tab_id === tab && f.type !== "link") : undefined;
    if (fe && fe.k === "field") sp.dup = { field: tab !== null && fe.o.tab_id === tab ? fe.o.id : fe.o.label, min: 2 };
    else if (first) sp.dup = { field: first.id, min: 2 };
    else throw new Ask('Trùng ở trường nào? Ví dụ: "uid bị trùng", "sđt dùng cho nhiều tài khoản"', [], true);
  }
  if (ops && ops[0].op === "set_owner" && !blank(sp.owner)) sp.sub = false;
  if (!tabhit.length) { // không nêu tab: "page ..." ở tab Facebook = tab mà trường liên kết "Page" trỏ tới
    const lk = ment.map((e) => (e.k === "field" && e.o.type === "link" && e.o.link_tab ? e.o.link_tab : null)).find((x) => x) ?? null;
    const tabs = new Set<Id>();
    for (const w of sp.where ?? []) { const f = w.field; if (typeof f === "number" && B.F.has(f)) tabs.add(B.F.get(f)!.tab_id); else if (!(typeof f === "string" && f in VLAB)) for (const x of B.fields) if (fold(x.label) === fold(f)) tabs.add(x.tab_id); }
    tab = lk || (tabs.size === 1 ? [...tabs][0] : tab);
  }
  if (lim && !sp.limit) sp.limit = lim;
  if (tab !== null) sp.tab = tab;
  else if (grp) sp.grp = grp;
  const explicit = ["status", "where", "q", "owner", "dept", "group", "dup"].some((k) => !blank(sp[k]));
  const refine = !!prev && (!!ctx.reply || (it === null && !tabhit.length && !("owner" in sp || "dept" in sp) && T.length <= 8 && explicit));
  if (useSel) { sp.ids = sel; cdep = true; }
  else if (refine) { sp = merge(prev!, sp); cdep = true; }
  else if ((it === "set" || it === "del" || it === "note") && !explicit) {
    cdep = true;
    if (sel.length) sp.ids = sel; else if (prev) sp = merge(prev, sp);
    else throw new Ask('Áp dụng cho dòng nào? Tick chọn dòng trên bảng rồi nhắn lại, hoặc nêu rõ (vd: "… của Hải", "… die").');
  }
  if (it === "add") {
    if (tab === null) throw new Ask("Thêm vào tab nào?", B.tabs.slice(0, 6).map((t) => ({ t: t.name, q: text.replace("thêm", "thêm " + t.name) })));
    const own = sp.owner;
    if (Array.isArray(own)) throw new Ask(`Có ${own.length} owner trùng tên, thêm cho người nào?`, own.map((o) => { const e = B.ents.find((x) => x.ref === `owner:${o}`)!; return { t: B.label(e), ref: `owner:${o}`, term: T.find((x) => B.names.has(x.n) && words(fold(B.O.get(o)?.name)).includes(x.n))?.r ?? "owner" }; }));
    if ((own === undefined || own === null) && (sp.dept === undefined || sp.dept === null)) throw new Ask("Dòng mới thuộc owner nào?", B.owners.slice(0, 6).map((o) => ({ t: o.name, q: `${head.trim()} của ${o.name}:${body ?? ""}` })));
    const [data, cols] = rowsOf(body ?? "", B, tab);
    if (!data.length) throw new Ask("Chưa có dữ liệu. Dán mỗi dòng 1 bản ghi, ngăn cột bằng |  (cột: " + B.fields.filter((f) => f.tab_id === tab && f.type !== "link").map((f) => f.label).join(" | ") + ")");
    const s2: Spec = {}; for (const k of ["tab", "dept", "owner", "status"]) if (k in sp) s2[k] = sp[k];
    return { it: "add", spec: s2, rows: data, cols };
  }
  if (it === "del") return { it: "del", spec: sp, ops: [{ op: "delete" }], ctx: cdep };
  if (ops) return { it: "set", spec: sp, ops, ctx: cdep };
  const left = T.filter((x) => !x.u).map((x) => x.r);
  return { it: / (bao nhieu|dem|tong so|so luong) /.test(ft) ? "count" : "search", spec: sp, ctx: cdep, rest: left.slice(0, 4), unsure: left.some((w) => !STOPW.has(fold(w))), low: !["tab", "status", "where", "owner", "dept", "ids", "sort", "group", "dup"].some((k) => tru(sp[k])) };
}

/* ───────── tab theo bằng chứng trong câu · trường tiền (AI_engine.tab_vote / money) ───────── */
/** tab nào có nhiều bằng chứng trong câu nhất (tên tab nêu rõ vẫn ưu tiên, trừ khi tab khác có hơn hẳn) */
export function tabVote(text: string, B: Brain, tab: Id | null = null, hits: Hit[] = []): Id | null {
  const f = ` ${words(fold(text)).join(" ")} `, nm = new Map<Id, number>();
  for (const h of hits) if (h.e.k === "tab") { const i = h.e.o.id; nm.set(i, Math.max(nm.get(i) ?? 0, h.sc >= 0.85 ? h.sc : 0.3)); }
  const ev = new Map<Id, Set<string>>();
  const hit = (t: Id, ph0: unknown) => { const ph = words(fold(str(ph0))).join(" "); if (ph.length >= 3 && !STOPW.has(ph) && f.includes(` ${ph} `)) (ev.get(t) ?? ev.set(t, new Set()).get(t)!).add(ph); };
  for (const x of B.sts) hit(x.tab_id, x.label);
  for (const fl of B.fields) {
    if (fl.type === "file") continue;
    hit(fl.tab_id, fl.label);
    const lw = words(fold(fl.label)); for (let a = 0; a < lw.length; a++) for (let b = a + 2; b <= lw.length; b++) if (!(a === 0 && b === lw.length)) hit(fl.tab_id, lw.slice(a, b).join(" "));
    const fp = B.fprof(fl.id); if (fp.kind === "cat") for (const v of (fp.top ?? []).slice(0, 300)) hit(fl.tab_id, v);
  }
  const tn = new Map(B.tabs.map((t) => [t.id, ` ${fold(t.name)} `] as const)), sc = new Map<Id, number>();
  for (const t of new Set([...nm.keys(), ...ev.keys()])) { const e = [...(ev.get(t) ?? [])].filter((p) => !(nm.get(t) && (tn.get(t) ?? "").includes(` ${p} `))); sc.set(t, (nm.get(t) ?? 0) + e.length); }
  if (!sc.size) return tab;
  const best = Math.max(...sc.values()), top = [...sc].filter(([, v]) => v === best).map(([t]) => t);
  if (best < 0.85 && !ev.size) return null;
  if (top.length !== 1) return tab;
  const w = top[0];
  if (tab === null) return best >= 1 && (nm.get(w) || (ev.get(w)?.size ?? 0) >= 1) ? w : null;
  return w !== tab && best > (sc.get(tab) ?? 0) && ((nm.get(tab) ?? 0) < 0.85 || best >= (sc.get(tab) ?? 0) + 1) ? w : tab;
}
/** nhãn trường tiền (giá / tiền / phí / lương…) — so dạng có dấu: "Số lượng" KHÔNG phải "Lương" */
const isMoney = (label: string) => { const m = /\b(gia|tien|phi|luong|doanh thu|gia tri|thanh tien)\b/.exec(fold(label)); if (!m) return false; const lo = label.toLowerCase(); return !(m[1] === "luong" && lo !== fold(label) && !/lương/.test(lo)); };
/** trường tiền của tab: tên có giá / tiền / phí / lương…, không có thì trường số lớn nhất */
export function money(B: Brain, tab: Id): QField | null {
  const ns = B.fields.filter((f) => f.tab_id === tab && B.fprof(f.id).kind === "num" && !new RegExp(String.raw`sdt|dien thoai|phone|uid|\bid\b|\bma\b`).test(fold(f.label)));
  return ns.find((x) => isMoney(x.label)) ?? (ns.length ? maxBy(ns, (x) => B.fprof(x.id).max ?? 0) : null);
}
/* ───────── mẫu câu đã học: "chữ ký" câu → kế hoạch truy vấn nội bộ ───────── */
const NUMLIT = /^(?:>=|<=|==|=|>|<|≥|≤)?\d{1,3}$/;
export type Slot = { t: "o"; ids: Id[] } | { t: "t"; id: Id } | { t: "s"; label: string } | { t: "f"; label: string; refs: Ref[]; virt?: boolean } | { t: "v"; vals: string[] };
const SLOT: Record<string, string> = { o: "<o>", v: "<v>", t: "<t>", s: "<s>", f: "<f>" };
/** câu → [chữ ký, slots]: mọi "chủ thể" (<t> tab · <s> tình trạng · <f> trường · <o> owner · <v> giá trị dán) là chỗ trống động; dyn=false: kiểu cũ (owner + giá trị) */
export function signature(text: string, B: Brain, dyn = true): [string, Slot[]] {
  const T = tok(text, B.names), hit = new Map<number, Hit>();
  for (const h of B.link(clone(T), null, dyn ? ["owner", "tab", "status", "field", "virt"] : ["owner"])) {
    const ws = T.slice(h.i, h.i + h.n).map((x) => x.n); let ok = true;
    if (h.e.k !== "owner" && (h.sc < 0.85 || ws.some((w) => FILL.has(w) || STOPW.has(w) || isDig(w)))) ok = false;
    if (ok) hit.set(h.i, h);
  }
  const parts: string[] = [], slots: Slot[] = []; let i = 0;
  while (i < T.length) {
    const h = hit.get(i);
    if (h) {
      const e = h.e;
      if (e.k === "owner") slots.push({ t: "o", ids: h.es.map((x) => (x.k === "owner" ? x.o.id : 0)).sort((a, b) => a - b) });
      else if (e.k === "tab") slots.push({ t: "t", id: e.o.id });
      else if (e.k === "status") slots.push({ t: "s", label: e.o });
      else if (e.k === "field") slots.push({ t: "f", label: e.o.label, refs: B.fields.filter((x) => fold(x.label) === fold(e.o.label)).map((x) => x.id) });
      else if (e.k === "virt") slots.push({ t: "f", label: e.o, refs: [e.o], virt: true });
      else { parts.push(T[i].n); i++; continue; }
      parts.push(SLOT[slots[slots.length - 1].t]); i += h.n;
    } else if (T[i].d && !NUMLIT.test(T[i].n)) {
      let j = i; while (j < T.length && T[j].d && !NUMLIT.test(T[j].n)) j++;
      slots.push({ t: "v", vals: T.slice(i, j).map((x) => x.r) }); parts.push("<v>"); i = j;
    } else { parts.push(T[i].n); i++; }
  }
  return [parts.join(" "), slots];
}
/** đi qua toàn bộ plan; fn(key, value) trả về giá trị thay thế hoặc undefined (giữ nguyên, đi tiếp) */
function walk(x: unknown, key: string, fn: (k: string, v: unknown) => unknown): unknown {
  const r = fn(key, x); if (r !== undefined) return r;
  if (Array.isArray(x)) return x.map((i) => walk(i, key, fn));
  if (isObj(x)) { if (["$v", "$o", "$t", "$s", "$f"].some((k) => k in x)) return x; const o: O = {}; for (const [k, v] of Object.entries(x)) o[k] = walk(v, k, fn); return o; }
  return x;
}
const deq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function sval(x: unknown, vs: Array<[number, string[]]>): unknown {
  for (const [k, v] of vs) { if (deq(x, v)) return { $v: k, f: "list" }; if (typeof x === "string" && (x === v.join(" ") || x === v[0])) return { $v: k, f: x === v[0] && v.length === 1 ? "one" : "join" }; }
  return x;
}
function sown(v: unknown, osl: Array<[number, Id[]]>): unknown { const ids = (Array.isArray(v) ? [...v] : [v]).map(Number).sort((a, b) => a - b); const hit = osl.find(([, s]) => deq(s, ids)); return hit ? { $o: hit[0], f: Array.isArray(v) ? "list" : "one" } : v; }
/** plan → [mẫu có chỗ trống, đủ điều kiện lưu?] — chỉ lưu khi MỌI chỗ trống trong câu được dùng */
export function templ(pl0: Plan, slots: Slot[]): [O, boolean] {
  const pl = jc(pl0) as unknown as O; delete pl.llm;
  const S = <K extends Slot["t"]>(t: K) => slots.map((s, k) => [k, s] as const).filter((x): x is readonly [number, Extract<Slot, { t: K }>] => x[1].t === t);
  const vs = S("v").map(([k, s]) => [k, s.vals] as [number, string[]]), osl = S("o").map(([k, s]) => [k, s.ids] as [number, Id[]]), tsl = S("t"), ssl = S("s"), fsl = S("f");
  const sv = (i: unknown) => { const h = ssl.find(([, s]) => fold(s.label) === fold(i)); return h ? { $s: h[0] } : i; };
  const fn = (key: string, x: unknown): unknown => {
    if (isObj(x) && x.field === "status" && "value" in x) return { ...x, value: asList(x.value as unknown).map(sv) };
    if (key === "tab" && typeof x === "number") { const h = tsl.find(([, s]) => s.id === x); return h ? { $t: h[0] } : undefined; }
    if (key === "status" && Array.isArray(x)) return x.map(sv);
    if ((key === "field" || key === "by") && (typeof x === "number" || typeof x === "string")) { const h = fsl.find(([, s]) => s.refs.includes(x) || (typeof x === "string" && fold(x) === fold(s.label))); return h ? { $f: h[0] } : undefined; }
    return undefined;
  };
  if (tru(pl.spec)) pl.spec = walk(pl.spec, "spec", fn);
  const ops = ((pl.ops as O[] | undefined) ?? []).map((op0) => { const op = walk(op0, "op", fn) as O; if (op.op === "set_status") op.value = sv(op.value); return op; });
  if (ops.length) pl.ops = ops;
  const vfn = (key: string, x: unknown): unknown => {
    if (key === "value" && !isObj(x)) return typeof x !== "number" ? sval(x, vs) : undefined;
    if (key === "q") return sval(x, vs);
    if (key === "owner" && (typeof x === "number" || Array.isArray(x))) return sown(x, osl);
    return undefined;
  };
  pl.spec = walk(pl.spec ?? {}, "spec", vfn);
  for (const op of (pl.ops as O[] | undefined) ?? []) { if (op.op === "set_owner") op.value = sown(op.value, osl); else if (op.op !== "set_note" && op.op !== "set_status" && "value" in op) op.value = sval(op.value, vs); }
  const used = new Set([...JSON.stringify(pl).matchAll(/"\$[vowtsf]":(\d+)/g)].map((m) => +m[1]));
  return [pl, used.size === slots.length && slots.every((_, k) => used.has(k))];
}
export function fill(x: unknown, slots: Slot[]): unknown {
  if (Array.isArray(x)) return x.map((i) => fill(i, slots));
  if (!isObj(x)) return x;
  const at = (k: unknown) => { const s = slots[Number(k)]; if (!s) throw new Error("slot"); return s; };
  if ("$v" in x) { const s = at(x.$v); if (s.t !== "v") throw new Error("slot"); return x.f === "list" ? s.vals : x.f === "one" ? s.vals[0] : s.vals.join(" "); }
  if ("$o" in x) { const s = at(x.$o); if (s.t !== "o") throw new Error("slot"); if (x.f === "one" && s.ids.length > 1) throw new Error("owner trùng tên"); return x.f === "list" || s.ids.length > 1 ? s.ids : s.ids[0]; }
  if ("$t" in x) { const s = at(x.$t); if (s.t !== "t") throw new Error("slot"); return s.id; }
  if ("$s" in x) { const s = at(x.$s); if (s.t !== "s") throw new Error("slot"); return s.label; }
  if ("$f" in x) { const s = at(x.$f); if (s.t !== "f") throw new Error("slot"); return s.virt ? s.label : "lbl:" + s.label; }
  const o: O = {}; for (const [k, v] of Object.entries(x)) o[k] = fill(v, slots); return o;
}
/** sau khi điền chỗ trống: nhãn trường → id của ĐÚNG tab; kiểm tra tình trạng / trường có ở tab đó — không hợp → Inapplicable */
export function bind(pl0: O, B: Brain): Plan {
  const pl = { ...pl0 }, tab = isObj(pl.spec) ? (pl.spec.tab as Id | null | undefined) ?? null : null;
  const fn = (key: string, x: unknown): unknown => {
    if (!((key === "field" || key === "by") && typeof x === "string" && x.startsWith("lbl:"))) return undefined;
    const lab = x.slice(4);
    if (tab === null) { if (!B.fields.some((f) => fold(f.label) === fold(lab))) throw new Inapplicable("trường " + lab); return lab; }
    const f = B.fields.find((y) => y.tab_id === tab && fold(y.label) === fold(lab)); if (!f) throw new Inapplicable("tab này không có trường " + lab); return f.id;
  };
  if (tru(pl.spec)) pl.spec = walk(pl.spec, "spec", fn);
  if (tru(pl.ops)) pl.ops = (pl.ops as O[]).map((o) => walk(o, "op", fn));
  const sp = (pl.spec ?? {}) as Spec;
  for (const s of asList(sp.status)) if (!B.sts.some((x) => x.label && fold(x.label) === fold(s) && (tab === null || x.tab_id === tab))) throw new Inapplicable("tình trạng " + s);
  for (const op of (pl.ops as O[] | undefined) ?? []) if (op.op === "set_status" && !B.sts.some((x) => fold(x.label) === fold(op.value) && (tab === null || x.tab_id === tab))) throw new Inapplicable("tình trạng " + str(op.value));
  return pl as unknown as Plan;
}
function fieldsOf(sp: unknown): unknown[] { const out: unknown[] = []; walk(sp, "spec", (k, x) => { if ((k === "field" || k === "by") && (typeof x === "number" || typeof x === "string")) out.push(x); return undefined; }); return out; }
export function valid(pl: Plan, B: Brain): boolean {
  const sp = pl.spec ?? {}, ow = sp.owner;
  return (sp.tab === undefined || sp.tab === null || (typeof sp.tab === "number" && B.T.has(sp.tab))) && (ow === undefined || ow === null ? [] : asList(ow)).every((o) => B.O.has(Number(o))) && fieldsOf(sp).every((f) => typeof f === "string" || B.F.has(Number(f)));
}
/** hai chữ ký chỉ lệch lỗi gõ nhẹ ở TỪ DÀI (facebok~facebook); từ ngắn khác nhau (live/die) là khác nghĩa */
export function near(a: string, b: string) { const x = words(a), y = words(b); return x.length === y.length && x.every((u, k) => u === y[k] || (u.length >= 5 && y[k].length >= 5 && seqRatio(u, y[k]) >= 0.85)); }
/** kế hoạch có giá trị giữ chỗ ("...", rỗng) — do AI viết câu mẫu hỏng → không tin */
export function junk(plan: unknown): boolean {
  let bad = false;
  const w0 = (w: unknown) => { if (!isObj(w)) return; if ("and" in w || "or" in w) { for (const x of asList((w.and ?? w.or) as unknown[])) w0(x); } else if (w.op !== "empty" && w.op !== "not_empty") for (const x of asList(w.value as unknown)) if (typeof x === "string" && !x.replace(/^[ .…]+|[ .…]+$/g, "")) bad = true; };
  const sp = isObj(plan) && isObj(plan.spec) ? plan.spec : {}; for (const w of asList(sp.where as unknown[])) w0(w);
  return bad;
}
export interface Pattern { id: string; sig: string; plan: O; hits: number; ts: number; auto?: boolean; from?: string; x?: string; q?: string }
/** chọn mẫu: khớp NGUYÊN VĂN → cùng chữ ký → gần giống (lỗi gõ) → [plan, mẫu] | {drop} (mẫu hỏng cần xoá) | null */
export function fromPattern(ps0: Pattern[], sig: string, slots: Slot[], B: Brain, text = ""): { pl: Plan; p: Pattern } | { drop: Pattern } | null {
  const ps = ps0.filter((p) => !junk(p.plan)), x = fold(text).trim();
  let cand = ps.filter((p) => x && p.x === x); if (!cand.length) cand = ps.filter((p) => !p.x && p.sig === sig); if (!cand.length) cand = ps.filter((p) => !p.x && near(p.sig, sig)).slice(0, 1);
  if (!cand.length) return null;
  const p = cand[0];
  try { const pl = bind(fill(p.plan, slots) as O, B); if (!valid(pl, B)) throw new Error("mẫu cũ không còn khớp cấu trúc"); return { pl, p }; }
  catch (e) { return e instanceof Inapplicable ? null : { drop: p }; }
}

/* ───────── JSON của AI → plan đã kiểm chứng (tên → id; tên sai/mơ hồ → Ask) ───────── */
export const groupKey = (name: unknown) => GBY[fold(name)] ?? null;
const vref = (e: Ent, tab: Id | null): Ref => (e.k === "virt" ? e.o : e.k === "field" ? fref(e.o, tab) : e.ref);
export function whereJson(wl: unknown, B: Brain, tab: Id | null, lists: Record<string, string[]>): Where[] {
  const out: Where[] = [];
  for (const w of Array.isArray(wl) ? wl : isObj(wl) ? [wl] : []) {
    if (!isObj(w)) throw new Error("where phải là danh sách điều kiện");
    if ("or" in w || "and" in w) { const g = "or" in w ? "or" : "and"; out.push({ [g]: whereJson(w[g], B, tab, lists) }); continue; }
    if ("not" in w) { out.push({ not: whereJson(w.not, B, tab, lists)[0] ?? {} }); continue; }
    const e = B.find(["field", "virt"], w.field ?? "", tab), fr = vref(e, tab);
    let op = str(w.op || "contains").toLowerCase(), v: unknown = w.value;
    if ((LINKOPS as readonly string[]).includes(op)) {
      const sub = isObj(v) ? v : {};
      const st = sub.tab ? tabOf(B.find(["tab"], sub.tab)) : null, lt = st ?? (e.k === "field" && e.o.type === "link" ? e.o.link_tab : null);
      v = { ...(lt ? { tab: lt } : {}), ...(sub.status ? { status: asList(sub.status as unknown).map((x) => { const s = B.find(["status"], x, lt); return s.k === "status" ? s.o : str(x); }) } : {}), ...(sub.where ? { where: whereJson(sub.where, B, lt, lists) } : {}) };
      out.push({ field: fr, op, value: v }); continue;
    }
    if (typeof v === "string" && v in lists) v = lists[v];
    if (typeof v === "string" && /\bselect\b.*\bfrom\b|\bwhere\b.*=/i.test(v)) throw new Error('where.value phải là giá trị thật, không được là câu SQL; muốn lọc theo owner thì dùng khóa "owner"');
    if (Array.isArray(v) && (op === "eq" || op === "contains")) op = "in";
    if (e.k === "field" && e.o.type === "select" && ["eq", "in", "ne", "nin"].includes(op) && tru(v)) { const os = opts(e.o); v = asList(v as unknown).map((y) => os.find((x) => wm(fold(y), fold(x))) ?? y); }
    out.push({ field: fr, op, ...(v !== null && v !== undefined && v !== "" && op !== "empty" && op !== "not_empty" ? { value: v } : {}) });
  }
  return out;
}
export function fromJson(o: O, B: Brain, ctx: Ctx, lists: Record<string, string[]>): Plan {
  const L = (v: unknown): unknown[] => (v === null || v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v]);
  const act = str(o.do || "search").toLowerCase();
  if (act === "say") return { it: "say", msg: str(o.say) || "…" };
  if (act === "ask") { const a = isObj(o.ask) ? o.ask : {}; throw new Ask(str(a.question || o.say) || "Bạn muốn làm gì cụ thể hơn?", L(a.options).map((x) => ({ t: str(x), q: str(x) }))); }
  let sp: Spec = {};
  const tab = o.tab ? tabOf(B.find(["tab"], o.tab)) : null; if (tab !== null) sp.tab = tab;
  if (o.dept) { const d = B.find(["dept"], o.dept); if (d.k === "dept") sp.dept = d.o.id; }
  if (o.sub === true) sp.sub = true;
  if (o.sub === false || (L(o.ops).some((p) => isObj(p) && p.op === "set_owner") && !("sub" in o))) sp.sub = false;
  const own = L(o.owner).flatMap((n) => B.findMany(["owner"], n).map((x) => (x.k === "owner" ? x.o.id : 0)));
  if (own.length) sp.owner = own.length === 1 ? own[0] : own;
  if (tru(o.status)) sp.status = uniq(L(o.status).map((x) => { const e = B.find(["status"], x, tab); return e.k === "status" ? e.o : str(x); }));
  const wh = whereJson(o.where, B, tab, lists); if (wh.length) sp.where = wh;
  if (o.q) sp.q = str(o.q); if (o.limit) sp.limit = Number(o.limit);
  const sl: O[] = [];
  for (const x of L(o.sort)) if (isObj(x) && x.field) { const e = B.find(["field", "virt"], x.field, tab); sl.push({ field: vref(e, tab), dir: x.dir === "desc" ? "desc" : "asc", ...(e.k === "virt" && e.o === "inlinks" ? { by: x.by === "count" ? "count" : "tabs" } : {}) }); }
  if (sl.length) sp.sort = (sl.length === 1 ? sl[0] : sl) as Spec["sort"];
  if (isObj(o.dup)) { const e = B.find(["field", "virt"], o.dup.field ?? "", tab); sp.dup = { field: vref(e, tab), min: Math.max(2, Math.trunc(Number(o.dup.min) || 2)) }; }
  if (isObj(o.group) && o.group.by) {
    const g = o.group; let by: Ref | null = groupKey(g.by); if (by === null) by = vref(B.find(["field", "virt"], g.by, tab), tab);
    sp.group = { by, ...(g.top ? { top: Math.trunc(Number(g.top)) } : {}), ...(g.min ? { min: Math.trunc(Number(g.min)) } : {}), ...(g.order === "asc" ? { order: "asc" } : {}), ...(["day", "week", "month", "year"].includes(str(g.unit)) ? { unit: g.unit as "day" } : {}) } as Spec["group"];
  }
  if (isObj(o.agg) && o.agg.field) { const e = B.find(["field"], o.agg.field, tab); sp.agg = { fn: ["sum", "avg", "max", "min"].includes(str(o.agg.fn)) ? str(o.agg.fn) : "sum", field: vref(e, tab) }; }
  const prev = ctx.reply?.spec || ctx.spec || null;
  if (o.ids === "selected" && ctx.selected?.length) sp.ids = [...ctx.selected]; else if (o.ids === "previous" && prev) sp = merge(prev, sp);
  const cdep = o.ids === "selected" || o.ids === "previous", ops: O[] = [];
  for (const p0 of L(o.ops)) {
    const p = isObj(p0) ? p0 : {}, k = p.op;
    if (k === "delete") ops.push({ op: "delete" });
    else if (k === "set_status") { const e = B.find(["status"], p.value ?? "", tab); ops.push({ op: "set_status", value: e.k === "status" ? e.o : str(p.value) }); }
    else if (k === "set_owner") { const e = B.find(["owner"], p.value ?? ""); ops.push({ op: "set_owner", value: e.k === "owner" ? e.o.id : 0 }); }
    else if (k === "set_field") { const e = B.find(["field"], p.field ?? "", tab); ops.push({ op: "set_field", field: e.k === "field" ? e.o.id : 0, value: str(typeof p.value === "string" && p.value in lists ? lists[p.value].join(", ") : p.value ?? "") }); }
    else if (k === "set_note") ops.push({ op: "set_note", value: str(p.value ?? ""), mode: p.mode === "append" ? "append" : "replace" });
    else throw new Ask(`Hành động "${str(k)}" chưa hỗ trợ`);
  }
  if (tru(o.rows)) {
    if (tab === null || ((sp.owner === undefined || sp.owner === null) && (sp.dept === undefined || sp.dept === null))) throw new Ask("Dòng mới thuộc tab và owner nào?");
    const [data, cols] = rowsOf(L(o.rows).map((r) => (Array.isArray(r) ? r.map(str) : [str(r)]).join("|")).join("\n"), B, tab);
    const s2: Spec = {}; for (const k of ["tab", "dept", "owner", "status"]) if (k in sp) s2[k] = sp[k];
    return { it: "add", spec: s2, rows: data, cols };
  }
  if (ops.length || ["set", "delete", "change"].includes(act)) {
    if (!ops.length) throw new Ask("Bạn muốn đổi thành gì? (tình trạng, owner, một trường, ghi chú hay xóa)");
    if (!["status", "where", "q", "owner", "dept", "ids"].some((k) => !blank(sp[k]))) throw new Ask("Áp dụng cho dòng nào? Tick chọn trên bảng hoặc nêu rõ điều kiện.");
    return { it: ops.every((x) => x.op === "delete") ? "del" : "set", spec: sp, ops, ctx: cdep };
  }
  return { it: act === "count" ? "count" : "search", spec: sp, ctx: cdep };
}

/* ───────── trả lời: chip "tôi hiểu như sau" · gợi ý · mô tả cho AI ───────── */
export const fldName = (f: unknown, B: Brain) => (typeof f === "string" && VLAB[f]) || (typeof f === "number" && B.F.has(f) ? B.F.get(f)!.label : str(f));
export const groupLabel = (by: unknown, B: Brain) => ({ owner: "Owner", status: "Tình trạng", dept: "Bộ phận", tab: "Tab", created: "Ngày tạo", updated: "Ngày cập nhật" } as Record<string, string>)[str(by)] || (typeof by === "number" && B.F.has(by) ? B.F.get(by)!.label : str(by));
export const AGGN: Record<string, string> = { sum: "Tổng", avg: "Trung bình", max: "Lớn nhất", min: "Nhỏ nhất" };
const UNITN: Record<string, string> = { day: " (ngày)", week: " (tuần)", month: " (tháng)", year: " (năm)" };
export function fmtn(v: number) { const s = Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2); const [a, b] = s.split("."); const neg = a.startsWith("-"); return (neg ? "-" : "") + a.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (b ? "," + b : ""); }
export const negCond = (w: Where) => ("not" in w ? true : "or" in w || "and" in w ? false : ["nin", "ne", "not_contains", "empty", "no_link"].includes(str(w.op)));
const vtxt = (v: unknown) => (Array.isArray(v) ? (v.length <= 3 ? v.map(str).join(" / ") : `${v.length} giá trị`) : str(v));
/** điều kiện (kể cả hoặc / và / không / liên kết) → câu ngắn hiện trên chip */
export function condTxt(w: Where, B: Brain): string {
  for (const [g, jn] of [["or", " hoặc "], ["and", " và "]] as const) if (g in w) return asList(w[g] as Where[]).map((x) => condTxt(x, B)).join(jn);
  if ("not" in w) return `Không (${condTxt(w.not as Where, B)})`;
  const lab = fldName(w.field, B), v = w.value, op = str(w.op || "contains");
  if ((LINKOPS as readonly string[]).includes(op)) { const sub = isObj(v) ? v : {}; const what = [typeof sub.tab === "number" && B.T.has(sub.tab) ? B.T.get(sub.tab)!.name : "", asList(sub.status as string[] | undefined).join(" / "), ...asList(sub.where as Where[] | undefined).map((x) => condTxt(x, B))].filter(Boolean).join(" "); return `${lab} ${OPNAME[op]} ${what || "dòng bất kỳ"}`; }
  if (op === "not_empty") return "Có " + lab;
  if (op === "empty") return "Chưa có " + lab;
  if ((op === "in" || op === "eq") && v !== null && v !== undefined && v !== "") return lab + ": " + vtxt(v);
  if (op === "within_days" || op === "older_days") return `${lab} ${op === "within_days" ? `trong ${str(v)} ngày qua` : `quá ${str(v)} ngày`}`;
  return `${lab}: ${OPNAME[op] ?? op}${v !== null && v !== undefined && v !== "" ? " " + vtxt(v) : ""}`;
}
export interface Chip { k: string; ic: string; t: string; ui?: boolean; neg?: boolean; i?: number; dots?: Array<string | null> }
export function chips(sp: Spec, B: Brain, ui: string[] = []): Chip[] {
  const ch: Chip[] = [];
  if (typeof sp.tab === "number" && B.T.has(sp.tab)) ch.push({ k: "tab", ic: B.T.get(sp.tab)!.icon, t: B.T.get(sp.tab)!.name, ui: ui.includes("tab") });
  else if (sp.grp) ch.push({ k: "grp", ic: "layers", t: `Nhóm ${str(sp.grp)}`, ui: ui.includes("grp") });
  if (typeof sp.dept === "number" && B.D.has(sp.dept)) ch.push({ k: "dept", ic: "layers", t: B.D.get(sp.dept)!.name, ui: ui.includes("dept") });
  if (sp.owner !== undefined && sp.owner !== null) { const nm = asList(sp.owner).map((i) => B.O.get(Number(i))?.name).filter((x): x is string => !!x); ch.push({ k: "owner", ic: "users", t: nm.slice(0, 3).join(" · ") + (nm.length > 3 ? " …" : ""), ui: ui.includes("owner") }); }
  if (tru(sp.status)) { const cols = new Map(B.sts.map((x) => [fold(x.label), x.color] as const)), st = asList(sp.status); ch.push({ k: "status", ic: "tag", t: st.join(" · "), dots: st.map((x) => cols.get(fold(x)) ?? null).slice(0, 4) }); }
  (sp.where ?? []).forEach((w, i) => ch.push({ k: "where", i, ic: "filter", neg: negCond(w), t: condTxt(w, B) }));
  if (sp.q) ch.push({ k: "q", ic: "search", t: str(sp.q) });
  if (sp.dup) ch.push({ k: "dup", ic: "copy", t: `Trùng ${fldName(sp.dup.field, B)} (≥${Math.trunc(Number(sp.dup.min) || 2)})` });
  if (sp.group) { const g = sp.group; ch.push({ k: "group", ic: "layers", t: `Nhóm theo ${groupLabel(g.by, B)}${UNITN[str(g.unit)] ?? ""}${g.top ? ` · top ${g.top}` : ""}` }); }
  if (sp.agg) ch.push({ k: "agg", ic: "hash", t: `${AGGN[sp.agg.fn] ?? ""} ${fldName(sp.agg.field, B)}` });
  for (const st of sortsOf(sp)) ch.push({ k: "sort", ic: st.dir === "desc" ? "down" : "up", t: st.field === "inlinks" ? (st.by !== "count" ? "Xếp theo số nền tảng liên kết" : "Xếp theo số dòng liên kết") : "Xếp theo " + fldName(st.field, B) });
  if (sp.limit) ch.push({ k: "limit", ic: "list", t: `Tối đa ${sp.limit} dòng` });
  if (sp.sub === false) ch.push({ k: "sub", ic: "users", t: "Không gồm cấp dưới" });
  if (sp.ids?.length) ch.push({ k: "ids", ic: "check", t: `${sp.ids.length} dòng` });
  return ch;
}
function whereNames(wl: Where[], B: Brain): O[] {
  return wl.map((w) => {
    if ("or" in w || "and" in w) { const g = "or" in w ? "or" : "and"; return { [g]: whereNames(asList(w[g] as Where[]), B) }; }
    if ("not" in w) return { not: whereNames([w.not as Where], B)[0] ?? {} };
    const e: O = { field: fldName(w.field, B), op: w.op ?? "contains" }; let v = w.value;
    if ((LINKOPS as readonly string[]).includes(str(w.op)) && isObj(v)) v = { ...(typeof v.tab === "number" && B.T.has(v.tab) ? { tab: B.T.get(v.tab)!.name } : {}), ...(tru(v.status) ? { status: v.status } : {}), ...(tru(v.where) ? { where: whereNames(v.where as Where[], B) } : {}) };
    if (v !== undefined && v !== null) e.value = v;
    return e;
  });
}
/** plan nội bộ (id) → JSON theo TÊN (để AI thấy câu gốc đã được hiểu thế nào) */
export function planNames(pl: Plan, B: Brain): O {
  const sp = pl.spec ?? {}, o: O = { do: pl.it };
  if (typeof sp.tab === "number" && B.T.has(sp.tab)) o.tab = B.T.get(sp.tab)!.name;
  if (typeof sp.dept === "number" && B.D.has(sp.dept)) o.dept = B.D.get(sp.dept)!.name;
  if (sp.owner !== undefined && sp.owner !== null) o.owner = asList(sp.owner).map((i) => B.O.get(Number(i))?.name).filter(Boolean);
  if (tru(sp.status)) o.status = asList(sp.status);
  if (sp.where?.length) o.where = whereNames(sp.where, B);
  if (sp.dup) o.dup = { field: fldName(sp.dup.field, B), min: sp.dup.min ?? 2 };
  if (sp.group) o.group = { ...sp.group, by: groupLabel(sp.group.by, B) };
  if (sp.sort) o.sort = sortsOf(sp).map((x) => ({ ...x, field: fldName(x.field, B) }));
  for (const k of ["q", "limit"]) if (tru(sp[k])) o[k] = sp[k];
  const ops = (pl.ops ?? []).map((x) => { const e: O = { op: x.op }; if (x.op === "set_owner" && B.O.has(Number(x.value))) e.value = B.O.get(Number(x.value))!.name; else if (x.op === "set_field") Object.assign(e, { field: typeof x.field === "number" && B.F.has(x.field) ? B.F.get(x.field)!.label : str(x.field), value: x.value }); else if ("value" in x) e.value = x.value; return e; });
  if (ops.length) o.ops = ops;
  return o;
}
/** mô tả cấu trúc cho AI: tab · trường · tình trạng · cây owner + kiểu & giá trị thật học được */
export function profileText(B: Brain): string {
  const L = B.tabs.map((t) => {
    const fs = B.fields.filter((f) => f.tab_id === t.id).map((f) => (f.type === "link" ? `${f.label} (liên kết tới ${B.T.get(f.link_tab ?? -1)?.name ?? "?"})` : f.type === "select" ? `${f.label} (chọn: ${opts(f).join(", ")})` : `${f.label} (${f.type})`));
    return `- ${t.name} [${B.prof.tabs[String(t.id)]?.n ?? 0} dòng] trường: ${fs.join("; ")} | tình trạng: ${B.sts.filter((s) => s.tab_id === t.id).map((s) => s.label).join(", ")}`;
  });
  const tree = (d: Id, p: Id | null = null, k = 0): string => B.owners.filter((o) => o.dept_id === d && o.parent_id === p).map((o) => `${"  ".repeat(k)}${o.name}; ` + tree(d, o.id, k + 1)).join("");
  const X: string[] = [];
  for (const t of B.tabs) {
    const p = B.prof.tabs[String(t.id)]; if (!p) continue;
    const xs: string[] = [];
    for (const f of B.fields) {
      const fp = p.f[String(f.id)]; if (f.tab_id !== t.id || !fp) continue;
      let d = ({ num: fp.min !== undefined ? `số ${fp.min}..${fp.max}` : "số", date: "ngày", long: "NỘI DUNG dài (tìm chữ: op contains)", id: "mã duy nhất", secret: "bí mật", text: "chữ" } as Record<string, string>)[fp.kind] ?? "";
      if (fp.kind === "cat") d = "danh mục: " + (fp.top ?? []).slice(0, 12).join(", "); else if (fp.ex?.length && (fp.kind === "text" || fp.kind === "id")) d += ` vd "${fp.ex[0].slice(0, 30)}"`;
      xs.push(`${f.label}=${d}`);
    }
    if (xs.length) X.push(`- ${t.name}: ${xs.join("; ")}`);
  }
  return "TRƯỜNG ẢO (dùng được ở mọi tab): Tình trạng, Owner, Ghi chú, Thiết bị, Liên kết, Ngày tạo, Ngày cập nhật\nCÁC TAB:\n" + L.join("\n") + "\nBỘ PHẬN > OWNER:\n" + B.depts.map((d) => `${d.name}: ${tree(d.id)}`).join("\n") + (X.length ? "\nDỮ LIỆU HỌC ĐƯỢC (kiểu & giá trị thật):\n" + X.join("\n") : "");
}
/** giá trị người dùng nhắc tới nằm ở tab/trường nào */
export function dataHits(B: Brain, text: string): string[] {
  const out: string[] = []; for (const t of tok(text, B.names)) { const r = t.d ? B.infer([t.r], null) : null; if (r) out.push(`"${t.r}" nằm ở tab ${B.T.get(r[0].tab_id)?.name ?? "?"}, trường "${r[0].label}"`); }
  return out.slice(0, 6);
}
export function extractLists(text: string): [string, Record<string, string[]>] {
  const IT = String.raw`\b\d{5,}\b|[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+\.[\p{L}\p{N}_.]+`;
  const items = text.match(new RegExp(IT, "gu")) ?? []; if (items.length < 4) return [text, {}];
  return [text.replace(new RegExp(`(${IT})([\\s,;]+(?=\\b\\d{5,}\\b|[\\p{L}\\p{N}_.+-]+@))*`, "u"), "$$LIST_1 ").trim(), { $LIST_1: uniq(items) }];
}
export function parseJson(raw: string): O | null {
  const t = (raw || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```json/g, "").replace(/```/g, ""), m = /\{[\s\S]*\}/.exec(t);
  try { const o: unknown = m ? JSON.parse(m[0]) : null; return isObj(o) ? o : null; } catch { return null; }
}
export interface TrainItem { id: string; text: string; sig: string; status: "open" | "fixed"; n: number; ts: number; wrong?: Array<{ src?: string | null; plan?: unknown; result?: unknown }>; right?: unknown }
/** bài học liên quan tới câu đang hỏi: cách hiểu ĐÚNG đã xác nhận + cách hiểu SAI đã bị bác */
export function lessons(text: string, items: TrainItem[]): string {
  const ws = new Set(words(fold(text)).filter((w) => w.length > 1 && !isDig(w))); if (!ws.size) return "";
  const sc = (x: TrainItem) => { const v = new Set(words(fold(x.text)).filter((w) => w.length > 1 && !isDig(w))); const inter = [...ws].filter((w) => v.has(w)).length; return inter / Math.max(1, new Set([...ws, ...v]).size); };
  const its = items.map((x) => [sc(x), x] as const).sort((a, b) => b[0] - a[0]);
  const good = its.filter(([c, x]) => c >= 0.5 && x.status === "fixed").slice(0, 3).map((x) => x[1]), bad = its.filter(([c, x]) => c >= 0.5 && x.status !== "fixed").slice(0, 2).map((x) => x[1]);
  let out = "";
  if (good.length) out += "[BÀI HỌC ĐÃ ĐƯỢC NGƯỜI DÙNG XÁC NHẬN ĐÚNG]\n" + good.map((x) => `"${x.text}" -> ${JSON.stringify(x.right).slice(0, 300)}`).join("\n") + "\n";
  if (bad.length) out += "[CÁCH HIỂU SAI ĐÃ BỊ BÁC - ĐỪNG LẶP LẠI]\n" + bad.map((x) => `"${x.text}" -> ${JSON.stringify((x.wrong ?? [{}]).slice(-1)[0]?.plan ?? null).slice(0, 300)}`).join("\n") + "\n";
  return out;
}
/** công tắc "Gồm cấp dưới" TẮT mà câu không nói gì về cấp dưới → lọc owner KHÔNG gồm cấp dưới; true nếu vừa chèn */
export function toggleSub(pl: Plan, ctx: Ctx, text: string): boolean {
  const sp = pl.spec; if (ctx.sub !== false || !sp || "sub" in sp || blank(sp.owner)) return false;
  const f = fold(text); if (/(bao gom|gom|kem|ca) cap duoi/.test(f) && !/(khong|ko|k) (bao )?(gom|kem) cap duoi/.test(f)) return false;
  sp.sub = false; return true;
}
/** câu gợi ý học từ dữ liệu + câu dựng từ tab đầu */
export function suggestions(B: Brain): string[] {
  const out: string[] = [];
  for (const t of [...B.tabs].sort((a, b) => (B.prof.tabs[String(b.id)]?.n ?? 0) - (B.prof.tabs[String(a.id)]?.n ?? 0))) {
    const p = B.prof.tabs[String(t.id)]; if (!p) continue;
    const fs = new Map(B.fields.filter((f) => f.tab_id === t.id).map((f) => [f.id, f] as const)), kind = (k: string) => Object.entries(p.f).filter(([i, x]) => x.kind === k && fs.has(+i)).map(([i]) => fs.get(+i)!);
    const nums = kind("num"), cats = kind("cat"), dates = kind("date");
    if (p.content !== null && fs.has(p.content)) { const ex = cats.map((c) => (B.fprof(c.id).top ?? [])[0]).find(Boolean); out.push(`${t.name} nói về ${(ex || "khuyến mãi").toLowerCase()}`); }
    if (nums.length) out.push(`Top 10 ${t.name} nhiều ${nums[0].label.toLowerCase()} nhất`);
    if (nums.length && cats.length) out.push(`Tổng ${nums[0].label.toLowerCase()} theo ${cats[0].label.toLowerCase()}`); else if (cats.length) out.push(`Đếm ${t.name} theo ${cats[0].label.toLowerCase()}`);
    if (dates.length) out.push(`${t.name} tháng này`);
    if (out.length >= 4) break;
  }
  const tb = B.tabs[0], s0: string[] = [];
  if (tb) {
    const sts = B.sts.filter((s) => s.tab_id === tb.id).map((s) => s.label), lk = B.fields.find((f) => f.tab_id === tb.id && f.type === "link"), sec = B.fields.find((f) => f.tab_id === tb.id && f.type === "secret");
    if (sts.length) s0.push(`Bao nhiêu ${tb.name} ${sts[0]}`); if (lk) s0.push(`${tb.name} chưa có ${lk.label}`); if (sts.length > 1) s0.push(`Đổi ${tb.name} ${sts[0]} sang ${sts[1]}`); if (sec) s0.push(`Cập nhật chung ${sec.label.toLowerCase()} 123456 cho uid: 111, 222`);
  }
  return uniq([...out.slice(0, 4), ...s0]).slice(0, 5);
}
/** gợi ý hỏi tiếp ngay dưới kết quả (bấm là lọc tiếp trên kết quả đó) */
export function nexts(sp: Spec, B: Brain): string[] {
  const t = sp.tab, p = typeof t === "number" ? B.prof.tabs[String(t)] : undefined; if (typeof t !== "number" || !p) return [];
  const fs = new Map(B.fields.filter((f) => f.tab_id === t).map((f) => [f.id, f] as const)), g = sp.group?.by;
  const kind = (k: string) => Object.entries(p.f).filter(([i, x]) => x.kind === k && fs.has(+i) && +i !== g).map(([i]) => fs.get(+i)!);
  const cats = kind("cat"), nums = kind("num"), out: string[] = [];
  if (!sp.group) { if (cats.length) out.push(`theo ${cats[0].label.toLowerCase()}`); out.push("theo tháng"); if (nums.length && !sp.sort) out.push(`nhiều ${nums[0].label.toLowerCase()} nhất`); }
  else if (cats.length && !sp.agg) out.push(`theo ${cats[0].label.toLowerCase()}`);
  return out.slice(0, 3);
}
