"use client";

// Bộ lọc cột của bảng AccountsHS (popover .fpop): chọn cột → giá trị (faceted) / dán danh sách / thứ tự ưu tiên / sắp xếp /
// khoảng ngày (preset + 2 ô ngày + thanh trượt có biểu đồ). Port của fltHtml/valsHtml/listHtml/rangeHtml + ACT.f* trong v7.py.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Cond, CondKey, SortSpec } from "../types";
import { condsOf, facet, fkeys, isDateKey, kMeta, setCond as setCond0, setConds } from "../core/model";
import { DP, EMP, fmtD, fold, nf, topSort } from "../core/text";
import { Ico } from "./icons";
import { I, S, emit, refreshView, savePref, useHs } from "./store";
import { MoreBtn, closePop, lim, openPop, useMore } from "./ui-kit";

/* ───────── trạng thái popover (FP) ───────── */
const FP: { k: CondKey | null; mode: "f" | "s"; vs: "n" | "az" | "za"; q: string; list: boolean; lq: string } = { k: null, mode: "f", vs: "n", q: "", list: false, lq: "" };
/** Omit phân phối trên union (Omit<Cond,"k"> của TS chỉ giữ khoá chung nên literal có `v` bị báo thừa) */
type DOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CondBody = DOmit<Cond, "k">;
const setCond = (k: CondKey, c: CondBody | null) => setCond0(S, k, c);
const tabKey = () => String(S.tab);
const sameK = (a: CondKey | null | undefined, b: CondKey | null | undefined) => a != null && b != null && String(a) === String(b);
const listLines = (t: string) => [...new Set(String(t || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean))];
const curCond = (k: CondKey | null) => (k == null ? undefined : condsOf(S).find((x) => sameK(x.k, k)));
/** đổi trạng thái popover lọc (FP: kho riêng ngoài React, vẽ lại bằng redraw) */
function fpSet(p: Partial<typeof FP>) { Object.assign(FP, p); }
function fpSync() { const c = curCond(FP.k); if (c?.op === "list") { FP.list = true; FP.lq = c.v.join("\n"); } else FP.lq = ""; }
function applyList() { if (FP.k == null) return; const l = listLines(FP.lq); setCond(FP.k, l.length ? { op: "list", v: l } : null); refreshView(); }
/** cột nào có thể là số (id trường) thì ép về số để S.sort/S.fl giữ đúng kiểu */
const asKey = (k: string | number): CondKey => (typeof k === "number" ? k : /^\d+$/.test(k) ? +k : (k as CondKey));

/** mở popover bộ lọc tại anchor; k = cột muốn xem ngay */
export function openFlt(anchor: HTMLElement, k?: CondKey | string | null) {
  if (k != null) FP.k = asKey(k);
  FP.q = ""; FP.list = false; fpSync();
  openPop(anchor, <FltPop />, "fpop");
}

/* ───────── chip điều kiện dưới thanh công cụ (fchipsHtml) ───────── */
function condText(c: Cond): string {
  if (c.op === "range") return (c.v[0] ? fmtD(c.v[0]) : "…") + " → " + (c.v[1] ? fmtD(c.v[1]) : "…");
  if (c.op === "list") return "Danh sách " + c.v.length + " dòng";
  if (c.op === "in" || c.op === "nin") return c.v.slice(0, 2).map((x) => (x === EMP ? "∅" : x)).join(", ") + (c.v.length > 2 ? " +" + (c.v.length - 2) : "");
  if (c.op === "has") return "≈ " + c.v;
  return c.op === "empty" ? "∅" : "●";
}
/** bỏ sắp xếp của tab đang xem (only = chỉ bỏ khi thoả điều kiện) · đặt sắp xếp theo cột */
function sortDrop(only?: (s: SortSpec) => boolean) { const s2 = S.sort[tabKey()]; if (s2 && (!only || only(s2))) delete S.sort[tabKey()]; }
function sortSet(k: CondKey, d: 1 | -1) { S.sort[tabKey()] = { k, d }; }
export function FilterChips() {
  useHs();
  const cd = condsOf(S), so = S.sort[tabKey()];
  if (!cd.length && !(so && so.ord)) return null;
  const chip = (key: string, k: CondKey, txt: string, rm: (e: React.MouseEvent) => void) => {
    const m = kMeta(I, k);
    return <button key={key} className="chip on fc" onClick={(e) => openFlt(e.currentTarget, k)}><Ico n={m.i} sz={13} /><b>{m.l}</b><span>{txt}</span><span className="fx" onClick={rm}><Ico n="x" sz={12} /></span></button>;
  };
  return <div className="fchips">
    {cd.map((c, i) => chip("c" + i, c.k, condText(c), (e) => { e.stopPropagation(); setConds(S, condsOf(S).filter((_, j) => j !== i)); refreshView(); }))}
    {so && so.ord ? chip("so", so.k, so.ord.slice(0, 3).map((x) => (x === EMP ? "∅" : x)).join(" › ") + (so.ord.length > 3 ? " …" : ""), (e) => { e.stopPropagation(); sortDrop(); savePref(); emit(); }) : null}
    {cd.length > 1 ? <button className="chip" title="Bỏ tất cả bộ lọc" onClick={() => { setConds(S, []); sortDrop((s2) => !!s2.ord); refreshView(); }}><Ico n="x" sz={13} /></button> : null}
  </div>;
}

/* ───────── popover ───────── */
function FltPop() {
  useHs(); useMore();
  const [, tick] = useState(0); const redraw = () => tick((x) => x + 1);
  const inp = useRef<HTMLInputElement>(null), ta = useRef<HTMLTextAreaElement>(null);
  const keys = fkeys(S, I), cd = condsOf(S), so = S.sort[tabKey()];
  const k = keys.some((x) => sameK(x, FP.k)) ? FP.k : keys[0] ?? null;
  useLayoutEffect(() => { FP.k = k; }, [k]);
  useEffect(() => { const t = setTimeout(() => inp.current?.focus(), 30); return () => clearTimeout(t); }, []);
  if (k == null) return <div className="fp"><div className="ph pad"><Ico n="inbox" sz={20} /></div></div>;
  const lm = FP.list && FP.mode === "f", km = kMeta(I, k), cur = curCond(k), sd = so && sameK(so.k, k) && !so.ord ? so.d : 0;
  const setSort = (d: 1 | -1) => { const s2 = S.sort[tabKey()]; if (s2 && sameK(s2.k, k) && s2.d === d && !s2.ord) sortDrop(); else sortSet(k, d); savePref(); emit(); };
  const pickKey = (nk: CondKey) => { fpSet({ k: nk }); fpSet({ q: "" }); fpSync(); redraw(); };
  const toggleList = () => { fpSet({ list: !FP.list }); redraw(); if (FP.list) setTimeout(() => ta.current?.focus(), 0); };
  const clear = () => { setCond(k, null); sortDrop((s2) => sameK(s2.k, k)); refreshView(); };
  const close = () => { if (FP.list && FP.mode === "f") applyList(); closePop(); };
  const onQKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && FP.mode === "f") { e.preventDefault(); const v = e.currentTarget.value.trim(); setCond(k, v ? { op: "has", v } : null); refreshView(); }
    else if (e.key === "Escape") { e.stopPropagation(); closePop(); }
  };
  return <div className="fp">
    <div className="fkl">{keys.map((x) => { const m = kMeta(I, x), on = cd.some((c) => sameK(c.k, x)), sr = !!so && sameK(so.k, x);
      return <button key={String(x)} className={`fk ${sameK(x, k) ? "on" : ""}`} onClick={() => pickKey(x)}><Ico n={m.i} sz={14} /><span>{m.l}</span>{on ? <i className="dot" /> : null}{sr ? <Ico n="sortaz" sz={12} /> : null}</button>; })}</div>
    <div className="fr">
      <div className="frh"><b><Ico n={km.i} sz={15} /><span>{km.l}</span></b>
        <div className="seg"><button className={FP.mode === "f" ? "on" : ""} title="Lọc" onClick={() => { fpSet({ mode: "f" }); redraw(); }}><Ico n="filter" sz={14} /></button><button className={FP.mode === "s" ? "on" : ""} title="Thứ tự ưu tiên" onClick={() => { fpSet({ mode: "s" }); redraw(); }}><Ico n="list" sz={14} /></button></div>
        <button className={`btn icon sm ${sd === 1 ? "pri" : "outline"}`} title="A → Z" onClick={() => setSort(1)}><Ico n="up" sz={14} /></button>
        <button className={`btn icon sm ${sd === -1 ? "pri" : "outline"}`} title="Z → A" onClick={() => setSort(-1)}><Ico n="down" sz={14} /></button>
      </div>
      {FP.mode === "f" && isDateKey(S, I, k) ? <div className="fvl frg"><RangeBox k={k} /></div> : <>
        {FP.mode === "f" ? <div className="frs fsw"><button type="button" className={`sw ${FP.list ? "on" : ""}`} title="Dán nhiều giá trị, mỗi dòng 1 giá trị" aria-pressed={FP.list} onClick={toggleList} /><span>Lọc theo danh sách (mỗi dòng 1 giá trị)</span></div> : null}
        <div className={`frs ${lm ? "lm" : ""}`}>
          {lm ? <textarea ref={ta} className="in fl-ta" rows={6} spellCheck={false} placeholder={"id1\nid2\nid3"} value={FP.lq} onChange={(e) => { fpSet({ lq: e.target.value }); redraw(); }} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); applyList(); } }} />
            : <div className="psearch" style={{ flex: 1 }}><Ico n="search" sz={14} /><input ref={inp} className="in" placeholder={FP.mode === "f" ? "Enter = lọc theo chứa" : "Tìm giá trị"} value={FP.q} autoComplete="off" onChange={(e) => { fpSet({ q: e.target.value }); redraw(); }} onKeyDown={onQKey} /></div>}
          <div className="seg"><button className={FP.vs === "n" ? "on" : ""} title="Nhiều → ít" onClick={() => { fpSet({ vs: "n" }); redraw(); }}><Ico n="hash" sz={13} /></button><button className={FP.vs === "az" ? "on" : ""} title="A → Z" onClick={() => { fpSet({ vs: "az" }); redraw(); }}><Ico n="sortaz" sz={13} /></button></div>
        </div>
        {cur?.op === "has" ? <div className="frs"><span className="chip on fc"><Ico n="search" sz={12} /><span>{cur.v}</span></span></div> : null}
        <div className="fvl"><Vals k={k} redraw={redraw} /></div>
      </>}
      <div className="frf"><div className="grow" />
        <button className="btn sm ghost" title="Bỏ lọc cột này" onClick={clear}><Ico n="x" sz={14} /></button>
        <button className="btn sm pri" onClick={close}><Ico n="check" sz={14} /></button>
      </div>
    </div>
  </div>;
}

/* ───────── danh sách giá trị (valsHtml) ───────── */
function valDot(k: CondKey, v: string) {
  let c: string | undefined;
  if (k === "dept") c = S.meta.depts.find((x) => x.name === v)?.color;
  else if (k === "status") c = (S.tab === "all" ? S.meta.tabs.flatMap((t) => t.statuses) : (typeof S.tab === "number" ? I.tab[S.tab]?.statuses : []) || []).find((x) => x.label === v)?.color;
  else if (k === "owner") c = S.meta.owners.find((x) => x.name === v)?.color;
  return c ? <i className="dot" style={{ background: c }} /> : null;
}
const Box = ({ on, part }: { on: boolean; part?: boolean }) => <span className={`chk ${on ? "on" : part ? "part" : ""}`}>{on ? <Ico n="check" sz={12} /> : part ? <b className="bar" /> : null}</span>;
function Vals({ k, redraw }: { k: CondKey; redraw: () => void }) {
  const m = facet(S, I, k), cd = curCond(k), sel = new Set(cd?.op === "in" ? cd.v : []);
  const isOn = (v: string) => (cd ? (cd.op === "in" ? sel.has(v) : cd.op === "nempty" ? v !== EMP : cd.op === "empty" ? v === EMP : false) : false);
  const so = S.sort[tabKey()], ord = (so && sameK(so.k, k) && so.ord) || [];
  if (FP.list && FP.mode === "f") return <ListInfo m={m} />;
  let ents = [...m.entries()]; const f = fold(FP.q);
  if (f) ents = ents.filter(([v]) => (v === EMP ? false : fold(v).includes(f)));
  ents = topSort(ents, FP.vs, 400);
  let head: React.ReactNode = null;
  if (FP.mode === "f" && !f) {
    const nv = m.size - (m.has(EMP) ? 1 : 0), nn = [...m.entries()].reduce((s, [v, c]) => (v === EMP ? s : s + c), 0);
    const all = !!cd && cd.op !== "empty" && (cd.op === "nempty" || (cd.op === "in" && nv > 0 && [...sel].filter((v) => v !== EMP).length >= nv));
    const part = !all && !!cd && !(cd.op === "empty" || (cd.op === "in" && sel.size === 1 && sel.has(EMP))), eo = isOn(EMP);
    head = <div className="fvh">
      <button className="fv fvall" title={all || part ? "Bỏ chọn" : "Chọn tất cả giá trị có dữ liệu"} onClick={() => fNempty(k, m)}><Box on={all} part={part} /><span className="t">Chọn tất cả</span><em>{nn}</em></button>
      {m.has(EMP) ? <button className="fv fvemp" title="Dòng chưa có dữ liệu ở cột này" onClick={() => fv(k, EMP)}><Box on={eo} /><span className="t">Trống</span><em>{m.get(EMP)}</em></button> : null}
    </div>;
    ents = ents.filter(([v]) => v !== EMP);
  }
  const tot = ents.length, show = ents.slice(0, lim("fv" + String(k), 400));
  return <>{head}
    {show.length ? show.map(([v, n]) => { const on = isOn(v), r = ord.indexOf(v);
      return <button key={v} className="fv" onClick={() => (FP.mode === "f" ? fv(k, v) : fo(k, v, redraw))}>
        {FP.mode === "f" ? <Box on={on} /> : <span className={`rk ${r < 0 ? "z" : ""}`}>{r < 0 ? "" : r + 1}</span>}{valDot(k, v)}<span className="t">{v === EMP ? "∅" : v}</span><em>{n}</em></button>; })
      : <div className="ph pad"><Ico n="inbox" sz={20} /></div>}
    {tot > show.length ? <MoreBtn k={"fv" + String(k)} n={tot - show.length} step={1000} label="giá trị nữa" /> : null}
  </>;
}
/** bật/tắt 1 giá trị (ACT.fv) */
function fv(k: CondKey, v: string) {
  const c = curCond(k); let s: Set<string>;
  if (c?.op === "in") s = new Set(c.v); else if (c?.op === "nempty") s = new Set([...facet(S, I, k).keys()].filter((x) => x !== EMP)); else if (c?.op === "empty") s = new Set([EMP]); else s = new Set();
  if (s.has(v)) s.delete(v); else s.add(v);
  setCond(k, s.size ? { op: "in", v: [...s] } : null); refreshView();
}
/** thứ tự ưu tiên (ACT.fo) */
function fo(k: CondKey, v: string, redraw: () => void) {
  let so = S.sort[tabKey()]; if (!so || !sameK(so.k, k) || !so.ord) so = { k, d: 1, ord: [] };
  const ord = so.ord!.includes(v) ? so.ord!.filter((x) => x !== v) : [...so.ord!, v];
  if (ord.length) S.sort[tabKey()] = { k, d: so.d, ord }; else delete S.sort[tabKey()];
  savePref(); emit(); redraw();
}
/** Chọn tất cả / bỏ chọn (ACT.fnempty) */
function fNempty(k: CondKey, m: Map<string, number>) {
  const c = curCond(k), vs = [...m.keys()].filter((v) => v !== EMP), sel = new Set(c?.op === "in" ? c.v : []);
  const all = !!c && (c.op === "nempty" || (c.op === "in" && vs.length > 0 && vs.every((v) => sel.has(v)))), eo = !!c && (c.op === "empty" || sel.has(EMP));
  setCond(k, all ? (eo ? { op: "empty" } : null) : eo ? { op: "in", v: [...vs, EMP] } : { op: "nempty" }); refreshView();
}
function ListInfo({ m }: { m: Map<string, number> }) {
  useMore();
  const lines = listLines(FP.lq), have = new Set([...m.keys()].filter((v) => v !== EMP).map((v) => fold(v).trim())), miss = lines.filter((x) => !have.has(fold(x).trim()));
  const n = lim("fm", 40);
  return <>
    <div className="fl-info"><span>{lines.length - miss.length}/{lines.length} dòng khớp</span><button className="btn sm pri" onClick={() => applyList()}>Áp dụng</button></div>
    {miss.length ? <div className="fl-miss"><em>Không có trong dữ liệu đang lọc</em>{miss.slice(0, n).map((x, i) => <span key={i}>{x}</span>)}{miss.length > n ? <MoreBtn k="fm" n={miss.length - n} step={500} label="nữa" /> : null}</div> : null}
  </>;
}

/* ───────── lọc cột ngày theo khoảng (rangeHtml + DP.slider rút gọn) ───────── */
function rgPresets(lo: string, hi: string): Array<[string, string, string]> {
  const t = DP.today(), tn = DP.num(t), d = new Date(), y = d.getFullYear(), mo = d.getMonth(), q = Math.floor(mo / 3) * 3;
  const P2 = (n: number) => String(n).padStart(2, "0"), last = (Y: number, M: number) => new Date(Y, M + 1, 0).getDate(), pm = mo ? mo - 1 : 11, py = mo ? y : y - 1;
  return [["Hôm nay", t, t], ["7 ngày", DP.day(tn - 6), t], ["30 ngày", DP.day(tn - 29), t], ["Tháng này", `${y}-${P2(mo + 1)}-01`, t], ["Tháng trước", `${py}-${P2(pm + 1)}-01`, `${py}-${P2(pm + 1)}-${last(py, pm)}`], ["Quý này", `${y}-${P2(q + 1)}-01`, t], ["Năm nay", `${y}-01-01`, t], ["Toàn bộ", lo, hi]];
}
function RangeBox({ k }: { k: CondKey }) {
  const m = facet(S, I, k), days = new Map<string, number>(); let emp = 0;
  for (const [v, n] of m) { if (v === EMP) { emp += n; continue; } const d = DP.parse(v); if (d) days.set(d, (days.get(d) || 0) + n); }
  const ks = [...days.keys()].sort(), lo = ks[0], hi = ks[ks.length - 1];
  const cur = condsOf(S).find((c) => sameK(c.k, k) && c.op === "range");
  const init = (): [string, string] => { let a = (cur?.op === "range" && cur.v[0]) || lo, b = (cur?.op === "range" && cur.v[1]) || hi; if (a < lo) a = lo; if (b > hi) b = hi; if (a > b) a = b; return [a, b]; };
  const [ab, setAB] = useState<[string, string]>(() => (ks.length ? init() : ["", ""]));
  const clamp = (v: string) => (!v || v < lo ? lo : v > hi ? hi : v);
  const a = clamp(ab[0]), b = clamp(ab[1]) < a ? a : clamp(ab[1]);
  const tm = useRef(0);
  const apply = (A: string, B: string, now?: boolean) => {
    clearTimeout(tm.current);
    const go = () => { setCond(k, A <= lo && B >= hi ? null : { op: "range", v: [A, B] }); refreshView(); };
    if (now) go(); else tm.current = window.setTimeout(go, 120);
  };
  useEffect(() => () => clearTimeout(tm.current), []);
  if (!ks.length) return <div className="empty-s"><Ico n="calendar" sz={18} /><span>Chưa có dữ liệu ngày</span></div>;
  const set = (A: string, B: string, now?: boolean) => { if (A > B) [A, B] = [B, A]; setAB([A, B]); apply(A, B, now); };
  const cnt = (() => { let n = 0; days.forEach((c, d) => { if (d >= a && d <= b) n += c; }); return n; })();
  const D = DP.num(hi) - DP.num(lo) + 1, full = a <= lo && b >= hi;
  const pres = rgPresets(lo, hi).map(([l, x, y]) => [l, x < lo ? lo : x, y > hi ? hi : y] as [string, string, string]);
  const hit = full ? pres.length - 1 : pres.findIndex((p) => p[1] === a && p[2] === b);
  const isEmpty = condsOf(S).some((c) => sameK(c.k, k) && c.op === "empty");
  return <div className="drg">
    <div className="rg-pre" role="group" aria-label="Khoảng nhanh">
      {pres.map(([l, x, y], i) => <button key={l} className={`chip ${i === hit ? "on" : ""}`} disabled={x > y} onClick={() => set(x, y, true)}>{l}</button>)}
      {emp ? <button className={`chip ${isEmpty ? "on" : ""}`} title="Chỉ dòng chưa có ngày · bấm lại để bỏ" onClick={() => { setCond(k, isEmpty ? null : { op: "empty" }); refreshView(); }}>Trống <em>{emp}</em></button> : null}
    </div>
    {D === 1 ? <div className="rg-one"><Ico n="calendar" sz={14} /><span>Toàn bộ dữ liệu nằm trong ngày {DP.fmt(lo)}</span></div>
      : <div className="rg-box"><DateSlider lo={lo} hi={hi} a={a} b={b} days={days} onInput={(A, B) => set(A, B)} onChange={(A, B) => set(A, B, true)} /></div>}
    <div className="rg-in">
      <label className="rg-f"><span>Từ</span><input type="date" className="in" min={lo} max={hi} value={a} onChange={(e) => { const v = e.target.value; if (v) set(v < lo ? lo : v, b, true); }} /></label>
      <span className="rg-ar"><Ico n="chevr" sz={14} /></span>
      <label className="rg-f"><span>Đến</span><input type="date" className="in" min={lo} max={hi} value={b} onChange={(e) => { const v = e.target.value; if (v) set(a, v > hi ? hi : v, true); }} /></label>
    </div>
    <div className="rg-info"><b>{nf(cnt)}</b><span>dòng trong khoảng</span>{emp ? <span className="mut">· {nf(emp)} dòng trống không tính</span> : null}</div>
  </div>;
}
/** thanh trượt khoảng ngày rút gọn: biểu đồ cột theo ngày, 2 nút kéo, bấm cột = chọn cột, bấm thanh = dời nút gần nhất */
function DateSlider({ lo, hi, a, b, days, onInput, onChange }: { lo: string; hi: string; a: string; b: string; days: Map<string, number>; onInput: (a: string, b: string) => void; onChange: (a: string, b: string) => void }) {
  const N = DP.num(hi) - DP.num(lo) + 1, n0 = DP.num(lo), ia = Math.max(0, DP.num(a) - n0), ib = Math.min(N - 1, DP.num(b) - n0);
  const nb = Math.max(1, Math.min(48, N)), bs = N / nb, bk: number[] = Array(nb).fill(0);
  days.forEach((n, d) => { const i = DP.num(d) - n0; if (i >= 0 && i < N) bk[Math.min(nb - 1, Math.floor(i / bs))] += n; });
  const mx = Math.max(...bk, 1), pct = (i: number) => (N > 1 ? (i / (N - 1)) * 100 : 50);
  const root = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null), hist = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<"a" | "b" | null>(null);
  const day = (i: number) => DP.day(n0 + Math.max(0, Math.min(N - 1, i)));
  const idx = (e: { clientX: number }, el: HTMLElement | null, pad = 0) => { if (!el) return 0; const r = el.getBoundingClientRect(); const x = Math.min(1, Math.max(0, (e.clientX - r.left - pad) / (r.width - 2 * pad))); return Math.round(x * (N - 1)); };
  const startDrag = (e: React.PointerEvent, which: "a" | "b") => {
    e.preventDefault(); setDrag(which); let A = ia, B = ib;
    const mv = (ev: PointerEvent) => { const i = idx(ev, track.current); if (which === "a") A = Math.min(i, B); else B = Math.max(i, A); onInput(day(A), day(B)); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); setDrag(null); onChange(day(A), day(B)); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  const onTrack = (e: React.PointerEvent) => { if (e.target !== track.current) return; const i = idx(e, track.current); if (Math.abs(i - ia) <= Math.abs(i - ib)) onChange(day(Math.min(i, ib)), b); else onChange(a, day(Math.max(i, ia))); };
  const onBar = (i: number) => { const s = Math.floor(i * bs), e = Math.min(N - 1, Math.ceil((i + 1) * bs) - 1); onChange(day(s), day(e)); };
  const key = (e: React.KeyboardEvent, which: "a" | "b") => {
    const st = e.shiftKey ? 7 : 1, map: Record<string, number> = { ArrowLeft: -st, ArrowDown: -st, ArrowRight: st, ArrowUp: st, PageDown: -30, PageUp: 30 };
    let v = which === "a" ? ia : ib; if (e.key in map) v += map[e.key]; else if (e.key === "Home") v = which === "a" ? 0 : ia; else if (e.key === "End") v = which === "a" ? ib : N - 1; else return; e.preventDefault();
    if (which === "a") onChange(day(Math.max(0, Math.min(v, ib))), b); else onChange(a, day(Math.min(N - 1, Math.max(v, ia))));
  };
  const tipI = drag === "b" ? ib : ia;
  return <div ref={root} className={`dps ${drag ? "drag" : ""}`}>
    <div ref={hist} className="dps-h">{bk.map((n, i) => { const s = Math.floor(i * bs), e = Math.ceil((i + 1) * bs) - 1;
      return <i key={i} className={e >= ia && s <= ib ? "dp-on" : ""} style={{ height: (n ? Math.max(8, (n / mx) * 100) : 3) + "%" }} title={`${DP.fmt(day(Math.floor(i * bs)))}${bs > 1.5 ? " – " + DP.fmt(day(Math.min(N - 1, Math.ceil((i + 1) * bs) - 1))) : ""}: ${n} dòng`} onClick={() => onBar(i)} />; })}</div>
    <div ref={track} className="dps-t" onPointerDown={onTrack}>
      <div className="dps-f" style={{ left: pct(ia) + "%", width: pct(ib) - pct(ia) + "%" }} />
      <button type="button" className="dps-k" role="slider" aria-label="Từ ngày" aria-valuetext={DP.fmt(a)} style={{ left: pct(ia) + "%", zIndex: ia >= N - 1 ? 3 : 1 }} onPointerDown={(e) => startDrag(e, "a")} onKeyDown={(e) => key(e, "a")} />
      <button type="button" className="dps-k" role="slider" aria-label="Đến ngày" aria-valuetext={DP.fmt(b)} style={{ left: pct(ib) + "%", zIndex: 2 }} onPointerDown={(e) => startDrag(e, "b")} onKeyDown={(e) => key(e, "b")} />
    </div>
    <div className="dps-e"><span>{DP.fmt(lo)}</span><span>{DP.fmt(hi)}</span></div>
    <div className="dps-tip" style={{ left: `calc(8px + (100% - 16px) * ${pct(tipI) / 100})` }}>{DP.fmt(day(tipI))}</div>
  </div>;
}

