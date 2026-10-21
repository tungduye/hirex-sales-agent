"use client";

// Sơ đồ liên kết (SVG, mô phỏng lực): tab "Sơ đồ liên kết" (GraphView global, state = GS) và hộp sơ đồ toàn màn (#gov, openGraph).
// Port của graphData/openGraph/edgeGeom/mountGraph (5335-5458) trong v7.py. React dựng cấu trúc node/cạnh; vị trí, làm nổi,
// hiệu ứng "thiên hà" được cập nhật trực tiếp qua ref (như bản gốc) để mô phỏng 60fps không phải vẽ lại cả cây.
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Id } from "../types";
import { inScope, stOf } from "../core/model";
import { GREY, TAB_NEUTRAL } from "../core/text";
import { IC, Ico } from "./icons";
import { I, NAV, S, jump, mut, savePref, useHs } from "./store";
import { closePop, openPop, showMenu, type MenuItem } from "./ui-kit";
import { ArwMarker } from "./settings";
import { LChip, closeOverlay, openDetail, openOverlay, relOf, type Rel } from "./detail";
import { scopeInfo } from "./reports";

export interface GState { roots: Id[] | null; depth: number; hide: Set<Id> }
interface GNode { id: Id; lv: number; root: boolean; x: number; y: number; vx: number; vy: number; pin?: boolean; fixed?: boolean; el?: SVGGElement | null; fx?: number; fy?: number; tw?: number }
interface GEdge { s: GNode; t: GNode; f: Id; rel: Rel; unk: boolean; lbl: string; n: number; i: number; g?: SVGGElement | null; el?: SVGPathElement | null; hit?: SVGPathElement | null; lb?: SVGTextElement | null }
interface GData { key: string; nodes: GNode[]; edges: GEdge[]; counts: Record<string, number> }

const RING = 135, INTRO_MIN = 6;
/** hiệu ứng sơ đồ: chỉ phát 1 lần, khi người dùng bấm tab "Sơ đồ liên kết" (không phát lúc tải trang) */
let G_INTRO = false, G_DONE = false;
/** bật cờ hiệu ứng khi vào tab sơ đồ bằng điều hướng (không phải lúc tải trang) */
function introArm(global: boolean) { if (global && !G_DONE && NAV.h.length > 1) G_INTRO = true; }
/** lấy lượt phát hiệu ứng (chỉ 1 lần) */
function introTake(global: boolean, n: number) { const intro = G_INTRO && !G_DONE && global && n >= INTRO_MIN; if (intro) G_DONE = true; return intro; }
/** sửa trạng thái sơ đồ (GS / st của hộp #gov) — đối tượng có thể đổi do nơi gọi sở hữu, chỉ gọi trong handler */
function gsSet(st: GState, p: Partial<GState>) { Object.assign(st, p); }
/** ref callback ghi phần tử SVG vào node/cạnh của mô phỏng (Sim vẽ trực tiếp lên DOM, không qua React) */
function elRef<T extends object, K extends keyof T>(o: T, k: K) { return (el: T[K]) => { o[k] = el; }; }
/** vị trí node của sơ đồ toàn bộ (không có dòng trung tâm) — giữ chỗ cũ khi vẽ lại */
const POS: Record<Id, { x: number; y: number }> = {};

/* ───────── dữ liệu: BFS theo I.adj tới st.depth · ẩn tab st.hide · tối đa 400 node ───────── */
function graphData(st: GState, key: string): GData {
  const adj = I.adj, lv = new Map<Id, number>();
  if (st.roots) {
    let fr = st.roots.filter((i) => I.acc[i]); for (const i of fr) lv.set(i, 0);
    for (let d = 1; d <= st.depth && fr.length; d++) { const nx: Id[] = []; for (const i of fr) for (const j of adj[i] || []) if (!lv.has(j) && I.acc[j]) { lv.set(j, d); nx.push(j); } fr = nx; }
  } else for (const a of S.accs) if (inScope(S, I, a) && adj[a.id]) lv.set(a.id, 1);
  const counts: Record<string, number> = {};
  lv.forEach((_, id) => { const t = I.acc[id].tab_id; counts[t] = (counts[t] || 0) + 1; });
  const isRoot = (id: Id) => !!st.roots && st.roots.includes(id);
  let ids = [...lv.keys()].filter((id) => !st.hide.has(I.acc[id].tab_id) || isRoot(id)); if (ids.length > 400) ids = ids.slice(0, 400);
  const set = new Set(ids), nodes: GNode[] = ids.map((id) => ({ id, lv: lv.get(id) || 0, root: isRoot(id), x: 0, y: 0, vx: 0, vy: 0 }));
  const by = new Map(nodes.map((n) => [n.id, n]));
  // mỗi bản ghi link = 1 cạnh CÓ HƯỚNG nguồn → đích, mang vai trò (trường) của nó; không gộp, không đảo chiều
  const edges: GEdge[] = S.links.filter((l) => l.src !== l.dst && set.has(l.src) && set.has(l.dst)).map((l) => { const rel = relOf(l.f); return { s: by.get(l.src)!, t: by.get(l.dst)!, f: l.f, rel, unk: rel.unk, lbl: rel.fwd, n: 1, i: 0 }; });
  const g: Record<string, GEdge[]> = {};
  for (const e of edges) { const k = Math.min(e.s.id, e.t.id) + ":" + Math.max(e.s.id, e.t.id); (g[k] ??= []).push(e); }
  for (const a of Object.values(g)) a.forEach((e, i) => { e.n = a.length; e.i = i; });
  // vị trí ban đầu
  const byLv: Record<number, GNode[]> = {}; for (const n of nodes) (byLv[n.lv] ??= []).push(n);
  for (const n of nodes) {
    const p = !st.roots && POS[n.id];
    if (p) { n.x = p.x; n.y = p.y; }
    else if (st.roots) {
      if (n.root) { n.x = Math.random() * 20 - 10; n.y = Math.random() * 20 - 10; }
      else { const grp = byLv[n.lv].sort((a, b) => I.acc[a.id].tab_id - I.acc[b.id].tab_id), i = grp.indexOf(n), ang = 6.283 * i / grp.length + n.lv * 0.45; n.x = Math.cos(ang) * n.lv * 110; n.y = Math.sin(ang) * n.lv * 110; }
    } else if (n.root) { n.x = Math.random() * 60 - 30; n.y = Math.random() * 60 - 30; }
    else { const a = Math.random() * 6.283, r = (n.lv || 0) * 110 + Math.random() * 40 + Math.sqrt(nodes.length) * 28; n.x = Math.cos(a) * r; n.y = Math.sin(a) * r; }
    n.vx = n.vy = 0;
  }
  return { key, nodes, edges, counts };
}
/** hình học cạnh: thẳng, hoặc cong khi cùng cặp dòng có nhiều vai trò; đầu mũi tên dừng ngoài vòng node */
function edgeGeom(e: GEdge) {
  const s = e.s, t = e.t, dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, lo = s.id < t.id ? 1 : -1;
  const off = e.n > 1 ? (e.i - (e.n - 1) / 2) * 38 : 0, mx = (s.x + t.x) / 2 - uy * lo * off * 2, my = (s.y + t.y) / 2 + ux * lo * off * 2;
  const rs = (s.root ? 26 : 18) + 3, rt = (t.root ? 26 : 18) + 7, a = Math.hypot(mx - s.x, my - s.y) || 1, b = Math.hypot(t.x - mx, t.y - my) || 1;
  const x1 = s.x + (mx - s.x) / a * rs, y1 = s.y + (my - s.y) / a * rs, x2 = t.x - (t.x - mx) / b * rt, y2 = t.y - (t.y - my) / b * rt;
  return { d: `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`, lx: 0.25 * x1 + 0.5 * mx + 0.25 * x2, ly: 0.25 * y1 + 0.5 * my + 0.25 * y2 };
}

/* ───────── mô phỏng (một đối tượng / sơ đồ) ───────── */
class Sim {
  nodes: GNode[] = []; edges: GEdge[] = []; alpha = 1; raf = 0; anim = 0; gT = 0; vw = 800; vh = 600; view = { x: 400, y: 300, k: 1 };
  rooted = false; playing = false; introG: SVGGElement | null = null; mk = "";
  svg: SVGSVGElement | null = null; vp: SVGGElement | null = null; wrap: HTMLDivElement | null = null;
  constructor(public st: GState) {}
  bind(st: GState, mk: string, svg: SVGSVGElement | null, vp: SVGGElement | null, wrap: HTMLDivElement | null) { this.st = st; this.mk = mk; this.svg = svg; this.vp = vp; this.wrap = wrap; }
  size() { const r = this.svg?.getBoundingClientRect(); if (r) { this.vw = r.width; this.vh = r.height; } }
  apply() { this.vp?.setAttribute("transform", `translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`); }
  toWorld(e: { clientX: number; clientY: number }) { const r = this.svg!.getBoundingClientRect(); return { x: (e.clientX - r.left - this.view.x) / this.view.k, y: (e.clientY - r.top - this.view.y) / this.view.k }; }
  paint() {
    for (const n of this.nodes) { n.el?.setAttribute("transform", `translate(${n.x} ${n.y})`); if (!this.st.roots) POS[n.id] = { x: n.x, y: n.y }; }
    for (const e of this.edges) { const g = edgeGeom(e); e.el?.setAttribute("d", g.d); e.hit?.setAttribute("d", g.d); if (e.lb) { e.lb.setAttribute("x", String(g.lx)); e.lb.setAttribute("y", String(g.ly - 5)); } }
  }
  tick() {
    const N = this.nodes, n = N.length, al = this.alpha;
    for (let i = 0; i < n; i++) { const a = N[i]; for (let j = i + 1; j < n; j++) { const b = N[j]; let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy; if (d2 > 160000) continue; if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; } const d = Math.sqrt(d2), f = 60000 / (d2 + 400) * al, fx = f * dx / d, fy = f * dy / d; a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy; } }
    for (const e of this.edges) { const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - (this.rooted ? RING * 0.8 : 120)) * 0.03 * al, fx = f * dx / d, fy = f * dy / d; e.s.vx += fx; e.s.vy += fy; e.t.vx -= fx; e.t.vy -= fy; }
    for (const m of N) { m.vx -= m.x * 0.008 * al; m.vy -= m.y * 0.008 * al; m.vx *= 0.8; m.vy *= 0.8; if (!m.pin) { m.x += m.vx; m.y += m.vy; } }
    this.alpha *= 0.99;
  }
  loop() {
    if (this.raf) return;
    const step = () => { if (!this.svg?.isConnected) { this.raf = 0; return; } for (let k = 0; k < 2; k++) if (this.alpha > 0.02) this.tick(); this.paint(); this.raf = this.alpha > 0.02 ? requestAnimationFrame(step) : 0; };
    this.raf = requestAnimationFrame(step);
  }
  focusView() {
    this.size(); const N = this.nodes; if (!N.length) return; const rs = N.filter((n) => n.root), vw = this.vw, vh = this.vh, v = this.view;
    if (!rs.length) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const n of N) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
      v.k = Math.min(vw / (x1 - x0 + 160), vh / (y1 - y0 + 160), 1.5); v.x = vw / 2 - (x0 + x1) / 2 * v.k; v.y = vh / 2 - (y0 + y1) / 2 * v.k; this.apply(); return;
    }
    const cx = rs.reduce((s, n) => s + n.x, 0) / rs.length, cy = rs.reduce((s, n) => s + n.y, 0) / rs.length; let mx = 0, my = 0;
    for (const n of N) { mx = Math.max(mx, Math.abs(n.x - cx)); my = Math.max(my, Math.abs(n.y - cy)); }
    const k = Math.min(1.4, Math.max(0.2, Math.min((vw / 2 - 70) / (mx + 30), (vh / 2 - 60) / (my + 30)))); v.k = k; v.x = vw / 2 - cx * k; v.y = vh / 2 - cy * k; this.apply();
  }
  glow() {
    clearTimeout(this.gT); for (const n of this.nodes) n.el?.classList.remove("glow");
    const rs = this.nodes.filter((n) => n.root && n.el); if (!rs.length) return;
    for (const n of rs) n.el!.classList.add("glow");
    this.gT = window.setTimeout(() => { for (const n of this.nodes) n.el?.classList.remove("glow"); }, 3000);
  }
  /* làm nổi đúng nguồn, đích, vai trò; phần không liên quan mờ nhẹ */
  reset() {
    for (const m of this.nodes) m.el?.classList.remove("dim");
    for (const e of this.edges) { e.g?.classList.remove("dim", "on"); e.el?.setAttribute("marker-end", `url(#${this.mk}ga)`); e.lb?.classList.remove("show", "on"); }
  }
  hl(n: GNode | null) {
    this.reset(); if (!n) return;
    const nb = new Set([n.id]); for (const e of this.edges) if (e.s === n || e.t === n) { nb.add(e.s.id); nb.add(e.t.id); }
    for (const m of this.nodes) m.el?.classList.toggle("dim", !nb.has(m.id));
    for (const e of this.edges) { const on = e.s === n || e.t === n; e.g?.classList.toggle("dim", !on); if (on) { e.g?.classList.add("on"); e.el?.setAttribute("marker-end", `url(#${this.mk}gaon)`); e.lb?.classList.add("show"); } }
  }
  hlEdge(e: GEdge | null) {
    this.reset(); if (!e) return;
    for (const m of this.nodes) m.el?.classList.toggle("dim", m !== e.s && m !== e.t);
    for (const x of this.edges) { const on = x === e; x.g?.classList.toggle("dim", !on); if (on) { x.g?.classList.add("on"); x.el?.setAttribute("marker-end", `url(#${this.mk}gaon)`); x.lb?.classList.add("show", "on"); } }
  }
  stop() {
    cancelAnimationFrame(this.raf); this.raf = 0; cancelAnimationFrame(this.anim); this.anim = 0; clearTimeout(this.gT);
    if (this.playing) for (const n of this.nodes) if (n.el) n.el.style.opacity = "";
    this.playing = false; this.introG?.remove(); this.introG = null; this.wrap?.classList.remove("intro");
  }
  start(nodes: GNode[], edges: GEdge[], intro: boolean) {
    this.stop(); this.nodes = nodes; this.edges = edges; this.rooted = false;
    this.size(); this.alpha = 1; const pre = nodes.length > 200 ? 40 : 220; for (let i = 0; i < pre; i++) this.tick();
    this.paint(); this.focusView();
    if (intro) this.playIntro(); else { this.loop(); this.glow(); }
  }
  /* hiệu ứng: toàn bộ node xoáy về tâm như thiên hà → dồn lại → bung ra đúng vị trí mạng lưới */
  playIntro() {
    const svg = this.svg, vp = this.vp, wrap = this.wrap, N = this.nodes;
    if (this.playing || !N.length || !svg?.isConnected || !vp || !wrap) return;
    this.playing = true; this.alpha = 0;
    const NS = "http://www.w3.org/2000/svg", GA = 1700, HO = 350, BU = 1300, TOT = GA + HO + BU, PI = Math.PI;
    N.forEach((n, i) => { n.fx = n.x; n.fy = n.y; n.tw = 3 + ((i * 7919) % 97) / 97 * 5; });
    const cx = N.reduce((s, n) => s + n.x, 0) / N.length, cy = N.reduce((s, n) => s + n.y, 0) / N.length; let R = 80; for (const n of N) R = Math.max(R, Math.hypot(n.x - cx, n.y - cy));
    const mk = <K extends keyof SVGElementTagNameMap>(t: K, at: Record<string, string | number>) => { const e = document.createElementNS(NS, t); for (const k in at) e.setAttribute(k, String(at[k])); return e; };
    const g = mk("g", { class: "gintro", "pointer-events": "none" }), core = mk("circle", { fill: `url(#${this.mk}ggl)`, cx, cy, r: 1 }), ring = mk("circle", { fill: "none", stroke: "#0ea5e9", "stroke-width": 2, cx, cy, r: 1, opacity: 0 });
    const dust = Array.from({ length: 90 }, (_, i) => { const f = ((i * 37) % 90) / 90; return { el: mk("circle", { r: 1.7, fill: i % 3 ? "#38bdf8" : "#94a3b8" }), r0: R * (0.12 + 0.95 * f), a0: (i % 2) * PI + f * 5 }; });
    g.append(core); for (const d of dust) g.append(d.el); g.append(ring); vp.insertBefore(g, vp.firstChild); this.introG = g; wrap.classList.add("intro");
    const sm = (v: number) => { v = Math.min(1, Math.max(0, v)); return v * v * (3 - 2 * v); }, t0 = performance.now();
    const step = (now: number) => {
      const T = Math.min(TOT, now - t0); let k: number, th: number, sc: number, op: number, ug = 0, ub = 0;
      if (T < GA) { ug = T / GA; k = 1 - Math.pow(ug, 2.2); } else if (T < GA + HO) { ug = 1; k = 0; } else { ub = (T - GA - HO) / BU; const q = ub - 1; k = 1 + 2.25 * q * q * q + 1.25 * q * q; }
      for (const n of N) {
        if (T < GA) { th = (n.tw || 0) * Math.pow(ug, 2.4); sc = 0.45 + 0.55 * k; op = 0.35 + 0.65 * k; }
        else if (T < GA + HO) { th = 0; sc = 0.3; op = 0; }
        else { th = -(n.tw || 0) * 0.5 * (1 - ub) * (1 - ub); sc = 0.5 + 0.5 * sm(ub); op = Math.min(1, ub * 5); }
        const dx = (n.fx || 0) - cx, dy = (n.fy || 0) - cy, c = Math.cos(th), s = Math.sin(th), x = cx + (dx * c - dy * s) * k, y = cy + (dx * s + dy * c) * k;
        if (n.el) { n.el.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ") scale(" + sc.toFixed(3) + ")"); n.el.style.opacity = op.toFixed(2); }
      }
      for (const d of dust) {
        let r: number, a: number, o: number;
        if (T < GA) { r = d.r0 * k; a = d.a0 + Math.pow(ug, 1.8) * 8; o = 0.55; } else if (T < GA + HO) { r = 0; a = d.a0 + 8; o = 0; } else { r = d.r0 * k; a = d.a0 + 8 - ub * 3; o = Math.max(0, 0.55 - ub * 1.4); }
        d.el.setAttribute("cx", (cx + Math.cos(a) * r).toFixed(1)); d.el.setAttribute("cy", (cy + Math.sin(a) * r * 0.62).toFixed(1)); d.el.setAttribute("opacity", o.toFixed(2));
      }
      const gr = T < GA ? R * (0.06 + 0.22 * sm(ug)) : T < GA + HO ? R * (0.28 + 0.12 * Math.sin((T - GA) / HO * PI)) : R * 0.4 * (1 - sm(ub / 0.45));
      core.setAttribute("r", Math.max(1, gr).toFixed(1)); core.setAttribute("opacity", T < GA + HO ? "1" : Math.max(0, 1 - ub * 2.2).toFixed(2));
      if (ub > 0) { ring.setAttribute("r", (R * 1.35 * ub + 4).toFixed(1)); ring.setAttribute("opacity", (0.5 * (1 - ub)).toFixed(2)); }
      if (ub > 0.4) wrap.classList.remove("intro");
      if (T < TOT) { this.anim = requestAnimationFrame(step); return; }
      g.remove(); this.introG = null;
      for (const n of N) { n.x = n.fx || 0; n.y = n.fy || 0; n.vx = n.vy = 0; if (n.el) n.el.style.opacity = ""; }
      this.paint(); wrap.classList.remove("intro"); this.playing = false; this.glow();
    };
    this.anim = requestAnimationFrame(step);
  }
}

/* ───────── menu trạng thái (statusItemsMulti) ───────── */
function statusItems(ids: Id[]): MenuItem[] {
  const g: Record<string, Id[]> = {}; for (const i of ids) { const a = I.acc[i]; if (a) (g[a.tab_id] ??= []).push(i); }
  const tabs = Object.keys(g), out: MenuItem[] = [];
  for (const tid of tabs) {
    const t = I.tab[+tid], xs = g[tid]; if (!t) continue;
    if (tabs.length > 1) out.push({ head: t.name });
    for (const s of t.statuses) out.push({ dot: s.color, label: s.label, check: xs.length > 0 && xs.every((i) => I.acc[i]?.status_id === s.id), fn: () => { void mut("status_set", { ids: xs, status_id: s.id }); } });
  }
  return out;
}
const tabTint = (c?: string) => { const v = (c || "").toLowerCase(); return v && v !== TAB_NEUTRAL && v !== "#52525b" ? ({ "--c": v } as CSSProperties) : undefined; };

/* ───────── popup "Loại" (pickPop/typePick): ẩn/hiện tab trên sơ đồ ───────── */
function TypePick({ counts, st, onChange }: { counts: Record<string, number>; st: GState; onChange: () => void }) {
  const [, tick] = useState(0);
  const L = Object.keys(counts).map(Number), G = new Set(L.filter((x) => !st.hide.has(x))), k = L.filter((x) => G.has(x)).length, all = k === L.length;
  const set = (N: Set<Id>) => { st.hide.clear(); for (const x of L) if (!N.has(x)) st.hide.add(x); tick((v) => v + 1); onChange(); };
  const toggle = (pk: Id | "*") => { let N: Set<Id>; if (pk === "*") N = new Set(G.size === L.length ? [] : L); else { N = new Set(G); if (N.has(pk)) N.delete(pk); else N.add(pk); } set(N); };
  const box = (on: boolean, part: boolean) => <span className={`chk ${on ? "on" : part ? "part" : ""}`}>{on ? <Ico n="check" sz={12} /> : part ? <b className="bar" /> : null}</span>;
  return <>
    <div className="tpk-h"><span>Tab</span><em>{k}/{L.length}</em></div>
    <button className={`colrow tpk-all ${all ? "" : "off"}`} role="menuitemcheckbox" aria-checked={all} onClick={(e) => { e.stopPropagation(); toggle("*"); }}>{box(all, k > 0)}<span className="t">Tất cả loại</span><em className="r">{L.reduce((t, x) => t + (counts[x] || 0), 0)}</em></button>
    <div className="sep" />
    <div className="tpk-l">{L.map((id) => { const t = I.tab[id], on = G.has(id);
      return <button key={id} className={`colrow ${on ? "" : "off"}`} role="menuitemcheckbox" aria-checked={on} onClick={(e) => { e.stopPropagation(); toggle(id); }}>
        {box(on, false)}<span className="tpk-ic" style={tabTint(t?.color)}><Ico n={t?.icon || "layers"} sz={15} /></span><span className="t">{t?.name || "#" + id}</span><em className="r">{counts[id] || 0}</em></button>; })}</div>
  </>;
}

/* ───────── GraphView ───────── */
/** GraphView({global, state}): sơ đồ liên kết. global = tab "Sơ đồ liên kết" (state = GS); overlay = trong hộp #gov (openGraph). */
export function GraphView({ global = false, state, overlay = false, onClose }: { global?: boolean; state: GState; overlay?: boolean; onClose?: () => void }) {
  useHs();
  const st = state;
  const [bv, setBv] = useState(0);
  const rebuild = () => setBv((v) => v + 1);
  const mk = "g" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [sim] = useState(() => new Sim(st));
  const wrapRef = useRef<HTMLDivElement>(null), svgRef = useRef<SVGSVGElement>(null), vpRef = useRef<SVGGElement>(null);
  const tpWas = useRef(false); const [tpOn, setTpOn] = useState(false);
  const key = `${bv}|${I.ver}|${S.dept}|${S.owner}|${S.sub}`;
  const data = useMemo(() => graphData(st, key), [st, key]);

  useLayoutEffect(() => { introArm(global); }, [global]);
  useLayoutEffect(() => {
    sim.bind(st, mk, svgRef.current, vpRef.current, wrapRef.current);
    const intro = introTake(global, data.nodes.length);
    sim.start(data.nodes, data.edges, intro);
    return () => sim.stop();
  }, [data, sim, global, st, mk]);
  // cuộn chuột = phóng to/thu nhỏ quanh con trỏ (cần listener không passive)
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const wh = (e: WheelEvent) => { e.preventDefault(); const r = svg.getBoundingClientRect(), v = sim.view, mx = e.clientX - r.left, my = e.clientY - r.top, k2 = Math.min(3, Math.max(0.2, v.k * (e.deltaY < 0 ? 1.12 : 0.89))); v.x = mx - (mx - v.x) * (k2 / v.k); v.y = my - (my - v.y) * (k2 / v.k); v.k = k2; sim.apply(); };
    svg.addEventListener("wheel", wh, { passive: false });
    return () => svg.removeEventListener("wheel", wh);
  }, [sim]);

  const nodeOf = (t: EventTarget) => { const g = (t as Element).closest?.(".gn"); return g ? sim.nodes[Number(g.getAttribute("data-i"))] : undefined; };
  const edgeOf = (t: EventTarget) => { const g = (t as Element).closest?.(".gedge"); return g ? sim.edges[Number(g.getAttribute("data-e"))] : undefined; };
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || sim.playing) return;
    const sx = e.clientX, sy = e.clientY; let moved = false;
    const n = nodeOf(e.target);
    if (n) {
      const was = n.pin; n.pin = true;
      const mv = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) { moved = true; sim.hl(n); }
        if (moved && !n.fixed) { const p = sim.toWorld(ev); n.x = p.x; n.y = p.y; sim.alpha = Math.max(sim.alpha, 0.25); sim.loop(); sim.paint(); }
      };
      const up = () => { removeEventListener("pointermove", mv); n.pin = !!was || !!n.fixed; if (moved) sim.hl(null); else jump(n.id); };
      addEventListener("pointermove", mv); addEventListener("pointerup", up, { once: true });
      return;
    }
    const ed = edgeOf(e.target);
    if (ed) { sim.hlEdge(ed); addEventListener("pointerup", () => sim.hlEdge(null), { once: true }); return; }
    let lx = sx, ly = sy;
    const mv = (ev: PointerEvent) => { sim.view.x += ev.clientX - lx; sim.view.y += ev.clientY - ly; lx = ev.clientX; ly = ev.clientY; sim.apply(); };
    addEventListener("pointermove", mv); addEventListener("pointerup", () => removeEventListener("pointermove", mv), { once: true });
  };
  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const n = nodeOf(e.target), ed = n ? undefined : edgeOf(e.target); if (!n && !ed) return;
    e.preventDefault(); if (n) jump(n.id); else if (ed) openDetail(ed.s.id);
  };
  const onContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault(); const n = nodeOf(e.target); if (!n) return;
    showMenu(e.clientX, e.clientY, [
      { icon: "focus", label: "Làm trung tâm", fn: () => { gsSet(st, { roots: [n.id], depth: Math.max(st.depth, 2) }); rebuild(); } },
      { icon: "external", label: "Mở trong tab", fn: () => jump(n.id) },
      { icon: "info", label: "Chi tiết", fn: () => openDetail(n.id) },
      { sep: 1 },
      { icon: "tag", label: "Trạng thái", sub: statusItems([n.id]) },
    ]);
  };
  const openTypes = (btn: HTMLButtonElement) => {
    if (tpWas.current) { tpWas.current = false; closePop(); return; }
    setTpOn(true);
    openPop(btn, <TypePick counts={data.counts} st={st} onChange={() => { savePref(); rebuild(); }} />, "tpk tp-type", () => setTpOn(false));
  };

  const { nodes, edges, counts } = data;
  const tids = Object.keys(counts), vis = tids.filter((t) => !st.hide.has(+t)).length;
  const edgeAria = (e: GEdge) => `${I.acc[e.s.id]?.label} → ${e.rel.fwd} → ${I.acc[e.t.id]?.label}`;
  return <div ref={wrapRef} className={`gwrap ${edges.length <= 24 ? "few" : ""}`}>
    <div className="gbar">
      {st.roots ? <div className="groots">{st.roots.slice(0, 4).map((id) => <LChip key={id} id={id} />)}{st.roots.length > 4 ? <span className="mut">+{st.roots.length - 4} dòng</span> : null}</div>
        : <span className="gtitle"><Ico n="network" sz={16} />Sơ đồ liên kết · {scopeInfo().name}</span>}
      {st.roots ? <><span className="glab">Số cấp liên kết</span>
        <div className="seg" role="group" aria-label="Số cấp liên kết">{[1, 2, 3, 99].map((n) => <button key={n} className={st.depth === n ? "on" : ""} title={n === 99 ? "Tất cả các cấp" : "Tối đa " + n + " cấp"} onClick={() => { gsSet(st, { depth: n }); savePref(); rebuild(); }}>{n === 99 ? "Tất cả" : n}</button>)}</div></> : null}
      <button className={`btn outline sm cvt gtypes ${tpOn ? "on" : ""} ${vis < tids.length ? "act" : ""}`} aria-haspopup="true" title="Lọc theo tab"
        onPointerDown={() => { tpWas.current = !!document.querySelector(".hs-layer .pop.tp-type"); }} onClick={(e) => openTypes(e.currentTarget)}>
        <Ico n="layers" sz={15} /><span>Loại</span><em className="gcnt">{vis < tids.length ? vis + "/" + tids.length : "Tất cả"}</em><Ico n="chevd" sz={14} cls="cv" />
      </button>
      <span className="gkey" title="Mũi tên đi từ dòng khai báo liên kết → dòng được liên kết" aria-label="Chú thích mũi tên"><Ico n="info" sz={15} /></span><div className="grow" />
      {st.roots && global ? <button className="btn sm ghost" title="Bỏ dòng trung tâm, xem toàn bộ" onClick={() => { gsSet(st, { roots: null }); rebuild(); }}><Ico n="x" sz={15} /><span>Xem toàn bộ</span></button> : null}
      <button className="btn sm ghost" title="Đưa sơ đồ về trung tâm" onClick={() => sim.focusView()}><Ico n="focus" sz={15} /><span>Về trung tâm</span></button>
      {overlay ? <button className="btn icon ghost" title="Đóng sơ đồ" onClick={() => onClose?.()}><Ico n="x" sz={16} /></button> : null}
    </div>
    <svg ref={svgRef} className="gsvg" role="group" aria-label="Sơ đồ liên kết giữa các dòng" onPointerDown={onPointerDown} onKeyDown={onKeyDown} onContextMenu={onContextMenu}>
      <defs>
        <ArwMarker id={mk + "ga"} c="#8797AB" sz={8} /><ArwMarker id={mk + "gaon"} c="#2276C9" sz={9} />
        <radialGradient id={mk + "ggl"}><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset=".3" stopColor="#7dd3fc" stopOpacity=".55" /><stop offset="1" stopColor="#0ea5e9" stopOpacity="0" /></radialGradient>
      </defs>
      <g ref={vpRef} className="vp"><Fragment key={data.key}>
        {edges.map((e, i) => <g key={"e" + i} className={`gedge ${e.unk ? "unk" : ""}`} data-e={i} tabIndex={0} role="button" aria-label={edgeAria(e)} ref={elRef(e, "g")}>
          <path className="geh" ref={elRef(e, "hit")} /><path className="ge" markerEnd={`url(#${mk}ga)`} ref={elRef(e, "el")} />
        </g>)}
        {edges.length <= 120 ? edges.map((e, i) => <text key={"l" + i} className="gel" data-e={i} textAnchor="middle" ref={elRef(e, "lb")}>{e.lbl}</text>) : null}
        {nodes.map((n, i) => { const a = I.acc[n.id], t = a ? I.tab[a.tab_id] : undefined, s = a ? stOf(I, a) : undefined, r = n.root ? 26 : 18; if (!a) return null;
          return <g key={n.id} className={`gn ${n.root ? "groot" : ""}`} data-i={i} tabIndex={0} role="button" aria-label={a.label + " — " + (t?.name || "") + (s ? ", " + s.label : "")} ref={elRef(n, "el")}>
            <circle r={r + 7} fill="transparent" />{n.root ? <circle className="halo" r={30} /> : null}
            <circle r={r} fill="#fff" stroke={s?.color || GREY} strokeWidth={n.root ? 4 : 3} />
            <g transform="translate(-9 -9) scale(.75)" fill="none" stroke="#667085" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: IC[t?.icon || ""] || IC.user }} />
            <text y={r + 15} textAnchor="middle" className="gl">{a.label.length > 20 ? a.label.slice(0, 19) + "…" : a.label}</text>
          </g>; })}
      </Fragment></g>
    </svg>
    <div className="gempty" style={{ display: nodes.length ? "none" : "flex" }}><Ico n="network" sz={34} /><span>Chưa có liên kết để hiển thị</span></div>
  </div>;
}

/** openGraph(ids): hộp sơ đồ toàn màn (#gov) lấy các dòng làm trung tâm, 2 cấp. */
export function openGraph(ids: Id[]) {
  closePop();
  const st: GState = { roots: [...ids], depth: 2, hide: new Set() };
  const close = () => { closeOverlay("gov"); };
  openOverlay("gov", <div className="overlay c gov" id="gov" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div className="gcard"><GraphView state={st} overlay onClose={close} /></div>
  </div>);
}
