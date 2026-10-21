"use client";

// Cú vọ — khung chat AI (port _ai_frontend.js của v7): hỏi/ra lệnh tiếng Việt · chip "tôi hiểu như sau" (bỏ từng điều kiện) ·
// kết quả hiện ngay lên bảng chính (S.idf) · duyệt thay đổi từng dòng ✓/✕ hoặc tất cả · 👍/👎 để Cú vọ học · mục Cài đặt.
// Khung chat là cửa sổ nổi (kéo/đổi cỡ, nhớ vị trí) gắn vào .hs-acc bằng root React riêng → không mất khi đổi tab.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CondKey, Id } from "../types";
import { scopeCalc, setConds } from "../core/model";
import { I, S, api, copyText, emit, jump, lzEnsure, mut, navPush, savePref, store, useHs } from "./store";
import { closeAll, confirmBox, Dot, Switch } from "./ui-kit";
import { Ico } from "./icons";
import { fly, srcPoint } from "./animation";

/* ───────── kiểu dữ liệu trả về từ /ai_chat ───────── */
type Spec = Record<string, unknown> & { tab?: Id | "all" | null; owner?: Id | Id[] | null; dept?: Id | null; sub?: boolean; sort?: unknown; where?: unknown[] };
interface Chip { k: string; ic: string; t: string; ui?: boolean; neg?: boolean; i?: number; dots?: Array<string | null> }
interface Row { id: Id; tab: string; icon: string; label: string; status?: string | null; color?: string | null; owner?: string | null; lk?: string }
interface Edit { k: string | number; field: string; before: string; after: string }
interface Change { key: string; id: Id | null; label: string; edits: Edit[] }
interface Preview { token: string; count: number; changes: Change[]; ids: Id[]; destructive: boolean; matched: number }
interface Opt { t: string; ref?: string; term?: string; q?: string }
interface Reply {
  kind: string; msg?: string; chips?: Chip[]; spec?: Spec; rows?: Row[]; stats?: Array<{ t: string; c: string; n: number }>; ids?: Id[]; count?: number; groups?: Array<{ t: string; n: number; c: string | null }>;
  preview?: Preview; ops?: unknown[]; add?: boolean; data?: unknown[]; options?: Opt[]; suggest?: string[]; relax?: Array<{ k: string; i?: number; t: string; n: number }>; next?: string[];
  src?: string | null; fid?: string; cache?: boolean; note?: string | null; aierr?: string | null; llm?: { model?: string; asked?: string; pn?: string; ms?: number } | null; auto?: boolean; tabs?: Id[]; q?: string; depth?: number;
}
interface UMsg { r: "u"; t: string; rq?: string | null; t0?: number }
interface BMsg { r: "b"; d: Reply; q?: string; t0?: number; shown?: number; gshown?: number; dshown?: number; rs?: Record<string, "ok" | "no">; nok?: number; nno?: number; busy?: boolean; err?: string | null; fb?: "ok" | "no"; ln?: "run" | number; cp?: boolean }
type Msg = UMsg | BMsg;
interface Fx { on: boolean; delay: number; after: number; info: boolean }
interface Cfg { on: boolean; model: string; timeout: number; retries: number; retry_delay: number; key_set: boolean; n_patterns?: number; n_auto?: number; fx?: Record<string, Fx>; providers?: Array<{ id: string; name: string; model: string; models: string[]; hint: string }>; train?: { open: number; fixed: number }; backups?: Array<{ name: string; ts: number; patterns: number }> }

/* ───────── trạng thái module (sống qua các lần đổi tab) ───────── */
const LS = "accountshs.ai.pos", LSZ = "accountshs.ai.size";
const rd = <X,>(k: string): X | null => { try { return JSON.parse(localStorage.getItem(k) || "null") as X | null; } catch { return null; } };
const A = {
  open: false, msgs: [] as Msg[], cfg: null as Cfg | null, spec: null as Spec | null, busy: false, diff: new Map<Id, Array<{ k: string | number; after: string }>>(), flash: new Set<Id>(),
  hist: [] as string[], hi: -1, sug: null as string[] | null, reply: null as number | null, k: 0, lq: [] as BMsg[], lrun: false, ids: null as Id[] | null, keep: false, lzw: 0,
  pos: null as { x: number; y: number } | null, sz: null as { w: number; h: number } | null, loaded: false, painted: false,
};
const ls = new Set<() => void>(); let ver = 0;
const ping = () => { ver++; for (const f of ls) f(); };
const useOwl = () => useSyncExternalStore((f) => { ls.add(f); return () => { ls.delete(f); }; }, () => ver, () => ver);

async function cfgLoad() {
  try { A.cfg = await api<Cfg>("ai_cfg"); } catch { A.cfg = null; }
  A.loaded = true; if (!A.cfg?.on && A.open) close(); ping(); emit();
}
const ctxIds = () => (S.sel.size ? [...S.sel] : A.ids ?? []).slice(0, 5000);

/* ───────── đưa kết quả lên bảng chính (lọc đúng danh sách id server trả về) ───────── */
function lzNeed(sp: Spec | null, tabs?: Id[]) {
  const t = [...(sp && sp.tab !== undefined && sp.tab !== null && sp.tab !== "all" ? [Number(sp.tab)] : []), ...(tabs ?? [])];
  return [...new Set(t)].filter((x) => I.tab[x]?.lazy && !S.lz.has(x));
}
async function lzAll(need: Id[]) { for (const t of need) { try { await lzEnsure(t); } catch { /* tab không nạp được: bảng vẫn hiện phần đã có */ } } }
function show(sp: Spec, ids: Id[] | null, tabs?: Id[]) {
  const need = lzNeed(sp, tabs);
  if (need.length) { const k = ++A.lzw; void lzAll(need).then(() => { if (k === A.lzw) show(sp, ids); }); return; }
  closeAll();
  S.tab = typeof sp.tab === "number" && I.tab[sp.tab] ? sp.tab : "all"; S.devf = null; S.q = ""; S.st = new Set(); S.tf = new Set(); S.sel.clear(); S.focus = null; setConds(S, []); S.ov = false;
  const ows = (Array.isArray(sp.owner) ? sp.owner : sp.owner !== undefined && sp.owner !== null ? [sp.owner] : []).map((i) => I.own[i]).filter(Boolean);
  S.dept = typeof sp.dept === "number" ? sp.dept : ows.length === 1 ? ows[0].dept_id : "all"; S.owner = ows.length === 1 ? ows[0].id : null; S.sub = sp.sub !== false; scopeCalc(S, I);
  S.idf = ids ? { tab: S.tab, set: new Set(ids), k: "ai" + ++A.k } : null;
  const s0 = (Array.isArray(sp.sort) ? sp.sort[0] : sp.sort) as { field?: unknown; dir?: string } | undefined, key = String(S.tab);
  if (s0 && (typeof s0.field === "number" || (typeof s0.field === "string" && ["status", "owner", "created", "updated", "note", "device"].includes(s0.field)))) S.sort[key] = { k: s0.field as CondKey, d: s0.dir === "desc" ? -1 : 1 };
  else delete S.sort[key];
  S.page = 1; savePref(); navPush(); emit();
}
function histOf() {
  const h: Array<{ u: string; a: string }> = []; let u: string | null = null;
  for (const m of A.msgs) { if (m.r === "u") u = m.t; else if (u !== null) { h.push({ u, a: JSON.stringify({ kind: m.d.kind, msg: m.d.msg, spec: m.d.spec }).slice(0, 500) }); u = null; } }
  return h.slice(-4);
}
const left = (m: BMsg) => { const pv = m.d.preview; return pv ? Math.max(0, pv.count - (m.nok || 0) - (m.nno || 0)) : 0; };
function rediff(m: BMsg | null) {
  A.diff = new Map(); const pv = m?.d.preview; if (!m || !pv || left(m) <= 0) return;
  for (const c of pv.changes) if (!m.rs?.[c.key] && c.id !== null) A.diff.set(c.id, c.edits.map((e) => ({ k: e.k, after: e.after })));
}
function handle(d: Reply, at?: number) {
  const m: BMsg = { r: "b", d, q: d.q };
  if (at !== undefined) A.msgs[at] = m; else A.msgs.push(m);
  A.diff = new Map();
  if (d.kind === "search" || d.kind === "count" || d.kind === "group") { A.spec = d.spec ?? null; show(d.spec ?? {}, d.ids ?? [], d.tabs); }
  else if (d.kind === "change") { A.spec = d.spec ?? null; rediff(m); if (d.add) show({ tab: d.spec?.tab }, null); else show(d.spec ?? {}, d.preview?.ids?.length ? d.preview.ids : null, d.tabs); }
  ping(); paintSoon();
}
async function send(text0: string, x: { silent?: boolean; shown?: string; learn?: { term: string; ref: string }; engine?: string; rejected?: string; depth?: number } = {}) {
  const text = (text0 || "").trim(); if (!text || A.busy) return;
  const rp = A.reply !== null ? A.msgs[A.reply] : undefined, rpm = rp && rp.r === "b" ? rp : null;
  if (!x.silent) { A.hist.unshift(text); A.hi = -1; A.msgs.push({ r: "u", t: x.shown || text, rq: rpm ? rpText(rpm) : null }); }
  const ctx = { selected: ctxIds(), sub: S.sub !== false, spec: A.spec, ...(rpm ? { reply: { spec: rpm.d.spec, msg: rpm.d.msg } } : {}), ...(x.learn ? { learn: x.learn } : {}), ...(x.rejected ? { rejected: x.rejected } : {}) };
  A.reply = null; A.busy = true; ping();
  try { const d = await api<Reply>("ai_chat", { text, engine: x.engine, ctx, hist: histOf() }); d.q = text; d.depth = x.depth || 0; A.busy = false; handle(d); }
  catch (e) { A.busy = false; A.msgs.push({ r: "b", d: { kind: "error", msg: e instanceof Error ? e.message : String(e) } }); ping(); }
}
async function rerun(i: number, spec: Spec) {
  const m = A.msgs[i]; if (!m || m.r !== "b") return; A.busy = true; ping();
  try { const d = await api<Reply>("ai_chat", { spec, ops: m.d.ops, rows: m.d.add ? m.d.data : undefined }); d.q = m.d.q; handle(d, i); } catch { /* api đã báo lỗi */ }
  A.busy = false; ping();
}
async function applyKeys(i: number, keys: string[] | "all") {
  const m = A.msgs[i]; if (!m || m.r !== "b" || !m.d.preview || m.busy) return; const pv = m.d.preview, n = keys === "all" ? left(m) : keys.length;
  if (pv.destructive && !(await confirmBox(`Xóa ${n} dòng? Hệ thống tự sao lưu trước khi xóa.`, "Xóa", "trash", "danger"))) return;
  m.busy = true; m.err = null; ping(); const rs = (m.rs ??= {});
  try {
    const r = await mut<{ applied: number; left: number }>("ai_apply", { token: pv.token, keys });
    m.nok = (m.nok || 0) + r.applied;
    if (m.d.fid && !m.fb) { m.fb = "ok"; api("ai_feedback", { fid: m.d.fid, ok: true }).catch(() => undefined); }
    const ks = keys === "all" ? pv.changes.filter((c) => !rs[c.key]).map((c) => c.key) : keys; for (const k of ks) rs[k] = "ok";
    A.flash = new Set(ks.map(Number).filter((x) => !Number.isNaN(x)));
    rediff(m); if (m.d.add && left(m) <= 0) show({ tab: m.d.spec?.tab }, null);
    setTimeout(() => { A.flash.clear(); paintSoon(); }, 3200);
  } catch (e) { m.err = e instanceof Error ? e.message : String(e); }
  m.busy = false; ping(); paintSoon();
}
async function skipKeys(i: number, keys: string[] | "all") {
  const m = A.msgs[i]; if (!m || m.r !== "b" || !m.d.preview) return; const pv = m.d.preview, n = keys === "all" ? left(m) : keys.length, rs = (m.rs ??= {});
  try { await api("ai_drop", { token: pv.token, keys }); } catch { /* bỏ qua: phiên có thể đã hết hạn */ }
  m.nno = (m.nno || 0) + n; for (const k of keys === "all" ? pv.changes.filter((c) => !rs[c.key]).map((c) => c.key) : keys) rs[k] = "no";
  rediff(m); ping(); paintSoon();
}
/* học ngầm: 👍 → AI viết thêm câu tương tự (cú nháy mắt khi đang học, không chặn khung chat) */
function learnQ(m: BMsg) { m.ln = "run"; A.lq.push(m); ping(); if (!A.lrun) void learnRun(); }
async function learnRun() {
  A.lrun = true;
  while (A.lq.length) { const m = A.lq.shift()!; ping(); try { const r = await api<{ added?: number }>("ai_learn", { fid: m.d.fid }); m.ln = r?.added || 0; } catch { m.ln = 0; } ping(); }
  A.lrun = false; ping(); void cfgLoad();
}
function feedback(i: number, ok: boolean) {
  const m = A.msgs[i]; if (!m || m.r !== "b") return; m.fb = ok ? "ok" : "no";
  if (ok) api<{ learn?: boolean }>("ai_feedback", { fid: m.d.fid, ok: true }).then((r) => { if (r?.learn && store.canManage) learnQ(m); }).catch(() => undefined);
  else {
    if (m.d.kind === "change" && m.d.preview && left(m) > 0) void skipKeys(i, "all");
    api<{ removed?: number }>("ai_feedback", { fid: m.d.fid, ok: false }).then((r) => { if (r?.removed) void cfgLoad(); }).catch(() => undefined);
    if ((m.d.depth || 0) < 2 && A.cfg?.key_set && m.q) void send(m.q, { engine: "ai", silent: true, rejected: m.d.fid, depth: (m.d.depth || 0) + 1 });
  }
  ping();
}

/* ───────── tô bảng chính: ô đổi (trước → sau), dòng xoá, dòng vừa áp dụng ───────── */
let paintT = 0;
function paintSoon() { if (typeof window === "undefined") return; cancelAnimationFrame(paintT); paintT = requestAnimationFrame(paint); }
function paint() {
  const tw = document.getElementById("tw"); if (!tw) return;
  if (!A.diff.size && !A.flash.size && !A.painted) return;
  tw.querySelectorAll("tr.ai-del, tr.ai-flash").forEach((t) => t.classList.remove("ai-del", "ai-flash"));
  tw.querySelectorAll<HTMLElement>("td.ai-chg").forEach((td) => { td.classList.remove("ai-chg"); delete td.dataset.ai; });
  A.painted = !!(A.diff.size || A.flash.size);
  const ix = new Set<number>();
  tw.querySelectorAll<HTMLElement>("tbody tr[data-id]").forEach((tr) => {
    const id = Number(tr.dataset.id);
    if (A.flash.has(id)) tr.classList.add("ai-flash");
    for (const c of A.diff.get(id) ?? []) {
      if (c.k === "delete") { tr.classList.add("ai-del"); continue; }
      const td = c.k === "status" ? tr.querySelector<HTMLElement>(".c-st") : c.k === "owner" ? tr.querySelector<HTMLElement>(".c-own") : tr.querySelector<HTMLElement>(`td[data-edit="${String(c.k)}"]`);
      if (td) { td.classList.add("ai-chg"); td.dataset.ai = c.after || "{trống}"; ix.add((td as HTMLTableCellElement).cellIndex + 1); }
    }
  });
  let st = document.getElementById("aiwstyle"); // cột có thay đổi tự nới rộng; hết đề xuất thì trả về độ rộng cũ
  if (!st) { st = document.createElement("style"); st.id = "aiwstyle"; document.head.appendChild(st); }
  st.textContent = [...ix].map((i) => `.hs-acc #tw table.grid th:nth-child(${i}),.hs-acc #tw table.grid td:nth-child(${i}){width:auto!important;max-width:none!important}.hs-acc #tw table.grid th:nth-child(${i}){box-shadow:inset 0 -2px 0 #f5b544}`).join("");
}
let installed = false;
function install() {
  if (installed || typeof window === "undefined") return; installed = true;
  store.subscribe(() => { paintSoon(); ping(); });
  new MutationObserver(() => { if (A.diff.size || A.flash.size || A.painted) paintSoon(); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey || e.altKey) && e.key.toLowerCase() === "j" && document.querySelector(".hs-acc")) { e.preventDefault(); toggle(); return; }
    const p = document.getElementById("aip");
    if (e.key === "Escape" && A.open && p && e.target instanceof Node && p.contains(e.target)) { e.stopImmediatePropagation(); e.preventDefault(); close(); }
  }, true);
}

/* ───────── mở / đóng khung chat (root React riêng trong .hs-acc) ───────── */
let host: { el: HTMLDivElement; root: Root } | null = null;
function ensureHost() {
  const par = document.querySelector(".hs-acc") ?? document.body;
  if (host && host.el.isConnected && host.el.parentElement === par) return;
  host?.root.unmount(); const el = document.createElement("div"); el.className = "ai-host"; par.appendChild(el);
  host = { el, root: createRoot(el) }; host.root.render(<OwlPanel />);
}
let lastBtn: HTMLElement | null = null;
function open() {
  if (!A.cfg?.on) return; ensureHost(); A.open = true; ping();
  if (!A.sug) api<Reply>("ai_chat", { text: "help", ctx: {} }).then((r) => { A.sug = r.suggest ?? []; ping(); }).catch(() => undefined);
  requestAnimationFrame(() => { const p = document.getElementById("aip"); if (p) { const o = srcPoint(p, lastBtn); if (o) fly(p, "open", o[0], o[1]); } (document.getElementById("aiq") as HTMLTextAreaElement | null)?.focus(); });
  emit();
}
function close() { A.open = false; ping(); emit(); }
function toggle() { if (A.open) close(); else open(); }
/** mở Cú vọ với các dòng này làm ngữ cảnh ("các dòng đang chọn") */
export function openOwlForIds(ids: Id[]) { A.ids = ids.length ? [...ids] : null; if (!A.loaded) void cfgLoad().then(open); else open(); }

/** nút Cú vọ trên thanh công cụ (+ chip "đang hiện kết quả" khi bảng đang lọc theo kết quả của Cú vọ) */
export function OwlButton() {
  useOwl(); useHs();
  useEffect(() => { install(); if (!A.loaded) void cfgLoad(); }, []);
  if (!A.cfg?.on) return null;
  const idf = S.idf && S.idf.tab === S.tab && String(S.idf.k).startsWith("ai") ? S.idf : null;
  return <>
    <button className={`btn outline icon fbtn ${A.open || idf ? "on" : ""}`} title="Cú vọ  (Ctrl+J)" aria-label="Cú vọ" onClick={(e) => { lastBtn = e.currentTarget; toggle(); }}><Ico n="owl" sz={16} /></button>
    {idf ? <button className="chip on" title="Đang hiện kết quả của Cú vọ - bấm để bỏ" onClick={() => { S.idf = null; S.page = 1; savePref(); emit(); }}><Ico n="owl" sz={13} /><span>{idf.set.size}</span><Ico n="x" sz={12} /></button> : null}
  </>;
}

/* ───────── khung chat ───────── */
/** hiệu ứng "tin mới": đóng dấu lần đầu tin được vẽ (A.msgs là kho ngoài React), trong 450ms đầu nối tiếp animation */
function msgAnim(m: Msg, now: number) { m.t0 ??= now; const dt = now - m.t0; return dt < 450 ? { cls: " ca-new", style: { animationDelay: -dt + "ms" } } : { cls: "", style: undefined }; }
/** "+N dòng nữa" của khối thay đổi / nhóm (trạng thái hiển thị nằm trên tin trong A.msgs) */
function moreDiff(m: BMsg) { m.dshown = (m.dshown || 40) + 100; A.keep = true; rediff(m); ping(); paintSoon(); }
function moreGroups(m: BMsg, gs: number) { m.gshown = gs + 50; A.keep = true; ping(); }
const rpText = (m: BMsg) => String(m.d.msg || m.d.kind || "").slice(0, 90);
function OwlPanel() {
  useOwl(); useHs();
  const pRef = useRef<HTMLDivElement>(null), bRef = useRef<HTMLDivElement>(null), taRef = useRef<HTMLTextAreaElement>(null), [q, setQ] = useState("");
  useEffect(() => { A.pos = rd(LS); A.sz = rd(LSZ); ping(); }, []);
  const n = A.msgs.length, busy = A.busy, open = A.open;
  useLayoutEffect(() => { const b = bRef.current; if (!b) return; if (A.keep) A.keep = false; else b.scrollTop = b.scrollHeight; }, [n, busy, open]);
  if (!A.open) return <div id="aip" className="ai-p" hidden />;
  const st: React.CSSProperties = {};
  if (A.sz && typeof window !== "undefined") { st.width = Math.min(A.sz.w, innerWidth - 16); st.height = Math.min(A.sz.h, innerHeight - 16); }
  if (A.pos && typeof window !== "undefined") { st.left = Math.max(0, Math.min(A.pos.x, innerWidth - 120)); st.top = Math.max(0, Math.min(A.pos.y, innerHeight - 60)); st.right = "auto"; }
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(A.pos)); localStorage.setItem(LSZ, JSON.stringify(A.sz)); } catch { /* bộ nhớ trình duyệt bị khoá */ } };
  const resize = (d: string) => (e: React.PointerEvent<HTMLElement>) => {
    const p = pRef.current; if (!p) return; e.preventDefault(); const g = e.currentTarget, r = p.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY; g.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0; let L = r.left, W = r.width, H = r.height;
      if (d.includes("r")) W = Math.min(Math.max(320, r.width + dx), innerWidth - r.left - 4);
      if (d.includes("l")) { W = Math.min(Math.max(320, r.width - dx), r.right - 4); L = r.right - W; }
      if (d.includes("b")) H = Math.min(Math.max(280, r.height + dy), innerHeight - r.top - 4);
      Object.assign(p.style, { left: L + "px", top: r.top + "px", right: "auto", width: W + "px", height: H + "px" }); A.pos = { x: L, y: r.top }; A.sz = { w: W, h: H };
    };
    const up = () => { g.removeEventListener("pointermove", mv); g.removeEventListener("pointerup", up); save(); };
    g.addEventListener("pointermove", mv); g.addEventListener("pointerup", up);
  };
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pRef.current; if (!p || (e.target instanceof Element && e.target.closest("button"))) return;
    const h = e.currentTarget, r = p.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top; h.setPointerCapture(e.pointerId); h.classList.add("drag");
    const mv = (ev: PointerEvent) => { const x = Math.max(0, Math.min(innerWidth - 120, ev.clientX - dx)), y = Math.max(0, Math.min(innerHeight - 60, ev.clientY - dy)); Object.assign(p.style, { left: x + "px", top: y + "px", right: "auto" }); A.pos = { x, y }; };
    const up = () => { h.removeEventListener("pointermove", mv); h.removeEventListener("pointerup", up); h.classList.remove("drag"); save(); };
    h.addEventListener("pointermove", mv); h.addEventListener("pointerup", up);
  };
  const grow = (t: HTMLTextAreaElement) => { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; };
  const go = () => { const v = q; setQ(""); if (taRef.current) taRef.current.style.height = "auto"; void send(v); };
  // eslint-disable-next-line react-hooks/purity -- cần giờ thật lúc vẽ để nối tiếp hiệu ứng "tin mới" (ca-new) khi khung vẽ lại giữa chừng
  const sel = ctxIds().length, learning = A.lrun || A.lq.length > 0, rp = A.reply !== null ? A.msgs[A.reply] : undefined, now = Date.now();
  const nw = (m: Msg) => msgAnim(m, now);
  return <div id="aip" className="ai-p" ref={pRef} style={st}>
    {["l", "r", "b", "bl", "br"].map((d) => <i key={d} className={`ai-rz ${d}`} onPointerDown={resize(d)} />)}
    <div className="ai-h" id="aih" onPointerDown={drag}>
      <span className={`ai-logo ${learning ? "learn" : ""}`} title={learning ? "Cú vọ đang học câu này" : ""}><Ico n="owl" sz={15} /></span><b>Cú vọ</b><span className="grow" />
      <button className="btn icon sm ghost" title="Cuộc trò chuyện mới" onClick={() => { A.msgs = []; A.spec = null; A.reply = null; A.diff = new Map(); A.ids = null; if (S.idf && String(S.idf.k).startsWith("ai")) S.idf = null; ping(); emit(); paintSoon(); }}><Ico n="plus" sz={16} /></button>
      <button className="btn icon sm ghost" title="Đóng  (Esc)" onClick={close}><Ico n="x" sz={16} /></button>
    </div>
    <div className="ai-ctx" id="aictx" hidden={!sel}><Ico n="check" sz={13} /><span>{sel} dòng đang chọn</span>{!S.sel.size && A.ids ? <button className="btn icon sm ghost" title="Bỏ ngữ cảnh" onClick={() => { A.ids = null; ping(); }}><Ico n="x" sz={12} /></button> : null}</div>
    <div className="ai-b" id="aib" ref={bRef}>
      {!n && !A.busy ? <div className="ai-e"><div className="hd"><Ico n="owl" sz={26} /><b style={{ color: "var(--fg)" }}>Hỏi bằng tiếng Việt</b></div><Sug list={A.sug} /></div> : null}
      {A.msgs.map((m, i) => { const a = nw(m); return m.r === "u"
        ? <div key={i} className={"ai-u" + a.cls} style={a.style}>{m.rq ? <div className="ai-q"><Ico n="reply" sz={11} /> {m.rq}</div> : null}<div>{m.t}</div><CopyBtn cls="ai-ucp" sz={12} text={() => m.t} /></div>
        : <div key={i} className={"ai-m" + a.cls + (m.ln === "run" ? " ai-learning" : "")} style={a.style}><Bot m={m} i={i} last={i === n - 1} /></div>; })}
      {A.busy ? <div className="ai-dots"><i /><i /><i /></div> : null}
    </div>
    <div className="ai-f"><div className="ai-cmp">
      <div className="ai-rp" id="airp" hidden={!rp || rp.r !== "b"}>{rp && rp.r === "b" ? <><Ico n="reply" sz={13} /><span>{rpText(rp)}</span><button title="Bỏ trả lời" onClick={() => { A.reply = null; ping(); }}><Ico n="x" sz={12} /></button></> : null}</div>
      <textarea id="aiq" ref={taRef} rows={1} placeholder="Hỏi hoặc ra lệnh…" autoComplete="off" value={q} onChange={(e) => { setQ(e.target.value); grow(e.target); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go(); }
          else if (e.key === "ArrowUp" && !q && A.hist.length) { e.preventDefault(); A.hi = Math.min(A.hi + 1, A.hist.length - 1); setQ(A.hist[A.hi]); }
          else if (e.key === "ArrowDown" && A.hi >= 0) { e.preventDefault(); A.hi--; setQ(A.hi >= 0 ? A.hist[A.hi] : ""); }
        }} />
      <div className="ai-cb"><span className="ai-hint" /><button className="ai-go" id="aigo" title="Gửi" disabled={!q.trim() || A.busy} onClick={go}><Ico n="send" sz={15} /></button></div>
    </div></div>
  </div>;
}
function Sug({ list }: { list?: string[] | null }) { return <div className="ai-sg">{(list ?? []).map((t) => <button key={t} onClick={() => void send(t)}><Ico n="search" sz={14} /><span>{t}</span></button>)}</div>; }
function CopyBtn({ cls, sz, text, title = "Sao chép" }: { cls: string; sz: number; text: () => string; title?: string }) {
  const [ok, setOk] = useState(false);
  return <button className={`${cls} ${ok ? "ok" : ""}`} title={title} onClick={() => void copyText(text()).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); })}><Ico n={ok ? "check" : "copy"} sz={sz} /></button>;
}
/** toàn bộ câu trả lời dạng chữ (nút sao chép) */
function aiText(d: Reply) {
  const L: string[] = []; if (d.msg) L.push(d.msg);
  if (d.groups) for (const g of d.groups) L.push(`${g.t}: ${(+g.n).toLocaleString("vi-VN")}`);
  else if (d.rows?.length) { for (const r of d.rows) L.push(r.label + (r.lk ? " — " + r.lk : "") + (r.owner ? " · " + r.owner : "")); if ((d.count ?? 0) > d.rows.length) L.push(`… +${(d.count ?? 0) - d.rows.length} dòng`); }
  for (const o of d.options ?? []) L.push("- " + o.t);
  for (const c of d.preview?.changes ?? []) L.push(c.label + ": " + c.edits.map((e) => `${e.field} ${e.before || ""} → ${e.after || ""}`).join("; "));
  if (d.note) L.push(d.note);
  return L.join("\n");
}
function ChipV({ c, i }: { c: Chip; i: number }) {
  return <span className={`ai-c ${c.ui ? "ui" : ""} ${c.neg ? "n" : ""}`} title={c.ui ? "Lấy từ màn hình bạn đang xem" : undefined}>
    {c.dots ? c.dots.map((d, k) => <Dot key={k} c={d} />) : <Ico n={c.ic || "tag"} sz={12} />}<span>{c.t}</span>
    {c.k === "rows" ? null : <button title="Bỏ điều kiện này" onClick={() => rmChip(i, c.k, c.i)}><Ico n="x" sz={11} /></button>}
  </span>;
}
function rmChip(i: number, k: string, ci?: number) {
  const m = A.msgs[i]; if (!m || m.r !== "b" || !m.d.spec) return;
  const sp = JSON.parse(JSON.stringify(m.d.spec)) as Spec;
  if (k === "where") { (sp.where ?? []).splice(ci ?? 0, 1); if (!sp.where?.length) delete sp.where; } else delete sp[k];
  void rerun(i, sp);
}
function Diff({ m, i }: { m: BMsg; i: number }) {
  const pv = m.d.preview; if (!pv || !pv.count) return null;
  const rs = m.rs ?? {}, L = left(m), shownN = Math.min(m.dshown || 40, pv.changes.length), more = pv.count - shownN;
  return <>
    <div className="ai-rs">
      {pv.changes.slice(0, m.dshown || 40).map((c) => { const s = rs[c.key]; return <div key={c.key} className={`ai-d ${s || ""}`}>
        <div className="dm"><div className="l">{c.label}</div>{c.edits.map((e, k) => <div key={k} className="x"><span className="f">{e.field}</span>{e.k === "create" ? null : <><s>{e.before || "{trống}"}</s><Ico n="chevr" sz={12} /></>}<b>{e.after || "{trống}"}</b></div>)}</div>
        {s ? <span className="st"><Ico n={s === "ok" ? "check" : "x"} sz={14} /></span>
          : <div className="bt"><button className="ok" title="Chấp nhận dòng này" onClick={() => void applyKeys(i, [c.key])}><Ico n="check" sz={14} /></button><button className="no" title="Bỏ qua dòng này" onClick={() => void skipKeys(i, [c.key])}><Ico n="x" sz={14} /></button></div>}
      </div>; })}
      {more > 0 ? shownN < pv.changes.length ? <button className="ai-more mb" onClick={() => moreDiff(m)}><Ico n="chevd" sz={12} /><span>+{more.toLocaleString("vi")} dòng nữa</span></button>
        : <div className="ai-more">+{more.toLocaleString("vi")} dòng nữa · áp dụng tất cả vẫn gồm cả các dòng này</div> : null}
    </div>
    {m.busy ? <div className="ai-ok no" title="Đang ghi"><Ico n="clock" sz={15} /></div>
      : m.err ? <div className="ai-ok bad"><Ico n="alert" sz={15} /><span>{m.err}</span></div>
      : L > 0 ? (store.canEdit ? <div className="ai-ac"><button className={`btn sm ${pv.destructive ? "danger" : "pri"}`} title={`${pv.destructive ? "Xóa" : "Chấp nhận"} tất cả (${L})`} onClick={() => void applyKeys(i, "all")}><Ico n={pv.destructive ? "trash" : "check"} sz={14} /><span>{L}</span></button><button className="btn sm icon" title="Bỏ qua tất cả" onClick={() => void skipKeys(i, "all")}><Ico n="x" sz={14} /></button></div>
        : <div className="ai-ok no" title="Bạn chưa có quyền sửa mục Tài khoản"><Ico n="lock" sz={15} /></div>)
      : <div className={`ai-ok ${m.nok ? "" : "no"}`} title={(m.nok ? `Đã áp dụng ${m.nok} dòng` : "Không thay đổi gì") + (m.nno && m.nok ? ` · bỏ qua ${m.nno}` : "")}><Ico n={m.nok ? "check" : "x"} sz={15} />{m.nok ? <span>{m.nok}</span> : null}{m.nno && m.nok ? <span className="sk"><Ico n="x" sz={12} />{m.nno}</span> : null}</div>}
  </>;
}
function Core({ m, i }: { m: BMsg; i: number }) {
  const d = m.d, k = d.kind;
  if (k === "error") return <div className="ai-t err">{d.msg}</div>;
  if (k === "ask") return <><div className="ai-t">{d.msg}</div>{d.options?.length ? <div className="ai-opt">{d.options.map((o, j) => <button key={j} className="chip" onClick={() => { if (o.ref && m.q) void send(m.q, { learn: { term: o.term ?? "", ref: o.ref }, shown: o.t }); else void send(o.q || o.t); }}>{o.t}</button>)}</div> : null}</>;
  if (k === "say" || k === "info") return <div className="ai-t">{d.msg}</div>;
  if (k === "help") return <><div className="ai-t">Thử hỏi</div><Sug list={d.suggest} /></>;
  const head = <><div className="ai-t">{d.msg || ""}</div><div className="ai-cs">{(d.chips ?? []).map((c, j) => <ChipV key={j} c={c} i={i} />)}</div></>;
  if (k === "change") return <>{head}<Diff m={m} i={i} /></>;
  if (k === "group" && d.groups) {
    const mx = Math.max(1, ...d.groups.map((g) => g.n)), gs = m.gshown || 15;
    return <>{head}<div className="ai-rs ai-gp">{d.groups.slice(0, gs).map((g, j) => <div key={j} className="ai-g"><span className="gl">{g.c ? <Dot c={g.c} /> : null}{g.t}</span><span className="gb"><i style={{ width: Math.max(4, (g.n / mx) * 100) + "%" }} /></span><b>{(+g.n).toLocaleString("vi-VN")}</b></div>)}
      {d.groups.length > gs ? <button className="ai-more mb" onClick={() => moreGroups(m, gs)}><Ico n="chevd" sz={12} /><span>+{d.groups.length - gs} nhóm nữa</span></button> : null}</div></>;
  }
  let body: ReactNode = null;
  if (d.count) {
    const rows = (d.rows ?? []).slice(0, m.shown || 8), cnt = d.count;
    body = <>{d.stats?.length ? <div className="ai-st">{d.stats.slice(0, 6).map((s, j) => <span key={j} className="ai-sp"><Dot c={s.c} />{s.t}<em>{s.n}</em></span>)}</div> : null}
      <div className="ai-rs">{rows.map((r) => <button key={r.id} className={`ai-r ${r.lk ? "lk" : ""}`} title="Mở dòng này" onClick={() => openRow(r.id, d)}><Ico n={r.icon || "user"} sz={14} /><span className="l">{r.label}{r.lk ? <small>{r.lk}</small> : null}</span><Dot c={r.color} /><span className="o">{r.owner || ""}</span></button>)}
        {cnt > rows.length ? rows.length < (d.ids ?? []).length || rows.length < (d.rows ?? []).length
          ? <button className="ai-more mb" title="Hiện thêm" onClick={(e) => void more(m, e.currentTarget)}><Ico n="chevd" sz={12} /><span>+{(cnt - rows.length).toLocaleString("vi")} dòng nữa</span></button>
          : <div className="ai-more">+{(cnt - rows.length).toLocaleString("vi")} dòng nữa · xem đủ trên bảng</div> : null}</div></>;
  } else if (d.relax?.length) body = <div className="ai-opt">{d.relax.map((r, j) => <button key={j} className="chip" title="Bỏ điều kiện này" onClick={() => rmChip(i, r.k, r.i)}><Ico n="x" sz={12} /><span>Bỏ &quot;{r.t}&quot; · {r.n} dòng</span></button>)}</div>;
  else if (d.suggest) body = <Sug list={d.suggest} />;
  return <>{head}{body}</>;
}
async function more(m: BMsg, el: HTMLButtonElement) {
  const d = m.d, want = (m.shown || 8) + 50, rows = d.rows ?? [];
  if (rows.length < want && (d.ids ?? []).length > rows.length) { el.disabled = true; try { const r = await api<{ rows: Row[] }>("ai_rows", { ids: (d.ids ?? []).slice(rows.length, want), spec: d.spec ?? {} }); d.rows = rows.concat(r.rows ?? []); } catch { /* api đã báo lỗi */ } }
  m.shown = want; A.keep = true; ping();
}
function openRow(id: Id, d: Reply) { if (I.acc[id]) { jump(id); return; } const need = lzNeed(null, d.tabs); if (need.length) void lzAll(need).then(() => { if (I.acc[id]) jump(id); }); }
function SrcTag({ d }: { d: Reply }) {
  if (!d.src) return null; const l = d.llm ?? {}, full = l.model || "", pn = l.pn || ""; let t: string, tip: string;
  if (d.src === "ai") { const mn = (full || l.asked || "").replace(/-\d{4}-\d{2}-\d{2}$/, ""); t = (pn ? pn + " · " : "") + (mn || "AI") + (l.ms ? ` · ${(l.ms / 1000).toFixed(1)}s` : ""); tip = `Trả lời bởi ${pn || "AI"} · ${full || "?"}` + (l.asked && l.asked !== full ? `  (đã chọn: ${l.asked})` : ""); }
  else { t = "Cú vọ"; tip = "Cú vọ trả lời ngay, không tốn lượt gọi AI"; }
  return <span className={`ai-src ${d.src === "ai" ? "" : "lg"}`} title={tip}>{d.aierr ? <span className="ai-ae" title={"AI lỗi: " + d.aierr}><Ico n="alert" sz={11} /></span> : null}{t}</span>;
}
function Bot({ m, i, last }: { m: BMsg; i: number; last: boolean }) {
  const d = m.d, fbOk = !!d.fid && ["search", "count", "group", "change"].includes(d.kind) && !m.fb;
  return <>
    <Core m={m} i={i} />
    {d.next?.length && last ? <div className="ai-opt ai-nx">{d.next.map((t) => <button key={t} className="chip" title="Lọc tiếp trên kết quả này" onClick={() => void send(t)}><Ico n="search" sz={12} /><span>{t}</span></button>)}</div> : null}
    <div className="ai-meta"><CopyBtn cls="ai-cp" sz={13} title="Sao chép câu trả lời" text={() => aiText(d)} />
      {fbOk && d.cache && (d.src !== "pattern" || d.auto) ? <button title={d.src === "pattern" ? "Đúng ý - xác nhận mẫu máy tự học này" : "Đúng ý - ghi nhớ để lần sau trả lời ngay, không gọi lại AI"} onClick={() => feedback(i, true)}><Ico n="like" sz={14} /></button> : null}
      {fbOk ? <button data-a="ai_fb_no" title="Chưa đúng" onClick={() => feedback(i, false)}><Ico n="dislike" sz={14} /></button> : null}
      <SrcTag d={d} /></div>
    {d.note ? <div className="ai-ig warn">{d.note}</div> : null}
    {d.kind !== "error" ? <button className="btn icon sm ghost ai-ra" title="Trả lời tin nhắn này" onClick={() => { A.reply = i; ping(); document.getElementById("aiq")?.focus(); }}><Ico n="reply" sz={14} /></button> : null}
  </>;
}

/* ───────── mục "Cú vọ" trong Cài đặt (icon thay chữ; key OpenAI đặt ở máy chủ) ───────── */
const FX0: Fx = { on: true, delay: 1.2, after: 1.5, info: true };
export function OwlSettings() {
  useOwl();
  const [c, setC] = useState<Cfg | null>(null), [tst, setTst] = useState<{ busy?: boolean; err?: string; t?: string } | null>(null);
  useEffect(() => { if (!A.cfg) void cfgLoad(); }, []);
  const cur = c ?? A.cfg;
  if (!cur) return <div className="aic"><div className="aic-hd"><span className="aic-lg"><Ico n="owl" sz={16} /></span><b>Cú vọ</b></div><div className="ai-dots"><i /><i /><i /></div></div>;
  const up = (p: Partial<Cfg>) => setC({ ...cur, ...p }), mk = "openai|" + cur.model, fxOf = (k: string): Fx => ({ ...FX0, ...(cur.fx?.[k] ?? {}) });
  const setFx = (k: string, p: Partial<Fx>) => up({ fx: { ...(cur.fx ?? {}), [k]: { ...fxOf(k), ...p } } });
  const save = async (x: Cfg = cur, quiet = false) => {
    try { A.cfg = await api<Cfg>("ai_cfg_set", { on: x.on, model: x.model, retries: x.retries, retry_delay: x.retry_delay, timeout: x.timeout, fx: x.fx ?? {} }); setC(null); setTst(quiet ? null : { t: "" }); ping(); emit(); if (!A.cfg.on && A.open) close(); return true; }
    catch (e) { setTst({ err: e instanceof Error ? e.message : String(e) }); return false; }
  };
  const num = (ic: string, tip: string, v: number, u: string, lo: number, hi: number, step: number, set: (n: number) => void) =>
    <label className="aic-n" title={tip}><Ico n={ic} sz={14} /><input type="number" value={v} min={lo} max={hi} step={step} onChange={(e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) set(n); }} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} /><i>{u}</i></label>;
  const fxBox = (k: string) => { const f = fxOf(k); return <><div className="aic-sub"><b><Ico n="spark" sz={15} /><span>Hiệu ứng</span></b><Switch on={f.on} title="Hiệu ứng khi AI đang nghĩ (tắt = chỉ hiện ...)" onChange={(v) => setFx(k, { on: v })} /></div>
    {f.on ? <div className="aic-nums">{num("play", "Chỉ hiện hiệu ứng khi nghĩ lâu hơn", f.delay, "s", 0, 30, 0.1, (n) => setFx(k, { delay: n }))}{num("timer", "Giữ hiệu ứng thêm sau khi AI xong (0 = tắt ngay)", f.after, "s", 0, 10, 0.1, (n) => setFx(k, { after: n }))}
      <button className={`aic-n aic-tg ${f.info ? "on" : ""}`} title="Hiện thông số suy luận (thời gian · ô quét · khớp · tương đồng)" onClick={() => setFx(k, { info: !f.info })}><Ico n="activity" sz={14} /></button></div> : null}</>; };
  const pv = cur.providers?.[0], models = [...new Set([...(pv?.models ?? []), cur.model].filter(Boolean))];
  return <div className="aic">
    <div className="aic-hd"><span className="aic-lg"><Ico n="owl" sz={16} /></span><b>Cú vọ</b><Switch on={cur.on} title="Bật / tắt Cú vọ" onChange={(v) => void save({ ...cur, on: v }, true)} /></div>
    <div className="aic-card" data-off={cur.on ? undefined : ""}>
      <div className="aic-row"><input className="in" list="aic-ml" value={cur.model} placeholder={pv?.model || "tên model"} autoComplete="off" spellCheck={false} title="Model OpenAI" onChange={(e) => up({ model: e.target.value.trim() })} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} /><datalist id="aic-ml">{models.map((m) => <option key={m} value={m} />)}</datalist></div>
      <div className="aic-row" title={pv?.hint}><Ico n={cur.key_set ? "check" : "alert"} sz={14} /><span className="ai-ig">{pv?.hint ?? (cur.key_set ? "Key đặt ở máy chủ" : "Máy chủ chưa có OPENAI_API_KEY")}</span></div>
      <hr />{fxBox(mk)}
      <hr /><div className="aic-nums">{num("retry", "Thử lại tối đa khi AI lỗi", cur.retries, "lần", 0, 10, 1, (n) => up({ retries: n }))}{num("clock", "Nghỉ giữa các lần thử", cur.retry_delay, "s", 0, 30, 0.5, (n) => up({ retry_delay: n }))}{num("hourglass", "Chờ tối đa mỗi lần", cur.timeout, "s", 10, 180, 5, (n) => up({ timeout: n }))}</div>
    </div>
    <div className="aic-card" data-off={cur.on ? undefined : ""}>
      <div className="aic-sub"><b><Ico n="owl" sz={15} /><span>Cú vọ</span><em>{cur.n_patterns || 0}</em></b></div>
      {fxBox("wayer")}
    </div>
    <div className="aic-ft">
      {tst ? tst.busy ? <span className="st"><span className="ai-spin"><Ico n="refresh" sz={15} /></span></span> : tst.err ? <span className="st err" title={tst.err}><Ico n="alert" sz={15} /><span>{tst.err}</span></span> : <span className="st ok"><Ico n="check" sz={15} />{tst.t ? <span>{tst.t}</span> : null}</span> : <span className="st" />}
      <button className="btn icon sm" title="Kiểm tra kết nối" onClick={async () => { if (!(await save(cur, true))) return; setTst({ busy: true }); try { const r = await api<{ ms: number; model: string }>("ai_test", {}); setTst({ t: `${(r.ms / 1000).toFixed(1)}s · ${r.model}` }); } catch (e) { setTst({ err: e instanceof Error ? e.message : String(e) }); } }}><Ico n="zap" sz={15} /></button>
      <button className="btn pri icon sm" title="Lưu" onClick={() => void save()}><Ico n="save" sz={15} /></button>
    </div>
  </div>;
}
/** đang có thay đổi Cú vọ đề xuất cho dòng này? (bảng có thể dùng để tô sẵn khi vẽ) */
export const owlDiffOf = (id: Id) => A.diff.get(id);
export const owlActive = () => A.open;
