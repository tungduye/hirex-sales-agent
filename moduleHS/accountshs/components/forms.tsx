"use client";

// Biểu mẫu của AccountsHS — port từ v7.py: sheet Thêm/Sửa (4892-4923 + ACT sclose/ssave/fst/fpick/funlink/ftog, trường file 6089-6114),
// chọn liên kết (pickLinks 5016-5034), sửa hàng loạt đối chiếu cũ → mới (5487-5545, bản vá cuối của openMass) + bản mass_set cũ (4998-5016),
// xuất / sao chép tuỳ chỉnh (4872-4892 + 5804-5811), thêm nhanh (quick), soạn ghi chú định dạng RTE (Quill 2, 5959-6054; ghi chú 6317-6334).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Account, Attachment, Device, Field, Id } from "../types";
import { cellText, lookupSecret, lookupVal, payload, sortIds, treeOrder, TYPEIC, type AccountX, type ExportFmt, type TabKey } from "../core/model";
import { GREY, indent, isRich, nz, rteText, sepCh } from "../core/text";
import { Ico } from "./icons";
import { I, S, confirmBox, copyText, dlXlsx, download, emit, mut, savePref, toast, useHs } from "./store";
import { Combo, bindHandle, closeModal, closePop, closeSheet, openModal, openPop, openSheet as uiSheet, type ComboOpt } from "./ui-kit";
import { FmtBar, PresetCombo, matchTok, openBulk, tokLabel, type Tok, type TokKey } from "./forms-bulk";
import { FileField } from "./attachments";
import { devOptList } from "./devices";

export { openBulk };

/* ═════════════════════════ ghi chú định dạng (RTE) ═════════════════════════ */
const Q_JS = "https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js", Q_CSS = "https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.core.css";
const SIZES: Array<[string, string]> = [["Nhỏ", "12px"], ["Thường", ""], ["Lớn", "18px"], ["Rất lớn", "24px"]];
const COLORS = ["", "#c64747", "#b56e15", "#22815d", "#2276c9", "#7c3aed", "#475467"];
const HL = ["", "#fef3c7", "#dcfce7", "#dbeafe", "#fce7f3", "#f3f4f6"];
const OKT = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "SPAN", "OL", "UL", "LI", "A", "H1", "H2", "H3", "BLOCKQUOTE", "PRE", "CODE", "DIV", "SUB", "SUP", "FONT"]);
const CSSOK = /^(color|background-color|font-size|font-weight|font-style|text-decoration|text-align)$/;
const ESC = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface QRange { index: number; length: number }
interface QuillLike {
  root: HTMLElement; history: { undo(): void; redo(): void };
  getSelection(focus?: boolean): QRange | null; getFormat(r: QRange): Record<string, unknown>;
  format(name: string, value: unknown, source?: string): void; removeFormat(i: number, l: number, source?: string): void;
  focus(): void; setSelection(i: number, l: number): void; getLength(): number;
  on(ev: string, fn: (...a: unknown[]) => void): void; off?(ev: string, fn: (...a: unknown[]) => void): void;
}
interface QuillCtor { new (el: HTMLElement, opts: Record<string, unknown>): QuillLike; import(p: string): unknown; register(x: unknown, overwrite?: boolean): void }
declare global { interface Window { Quill?: QuillCtor } }

/** lọc HTML ghi chú: chỉ giữ thẻ/thuộc tính an toàn (clean() gốc) */
export function rteClean(html: string): string {
  if (typeof document === "undefined") return ESC(rteText(html));
  const t = document.createElement("template"); t.innerHTML = html || "";
  const walk = (n: ParentNode) => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType !== 1) continue; const e = c as HTMLElement;
      if (!OKT.has(e.tagName)) { if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|svg|math)$/i.test(e.tagName)) e.remove(); else { walk(e); e.replaceWith(...e.childNodes); } continue; }
      if (e.classList && e.classList.contains("ql-ui")) { e.remove(); continue; }
      for (const a of [...e.attributes]) {
        const n2 = a.name.toLowerCase();
        if (n2 === "style") { const k = e.style, keep: string[] = []; for (let j = 0; j < k.length; j++) { const p = k[j]; if (CSSOK.test(p)) keep.push(p + ":" + k.getPropertyValue(p)); } if (keep.length) e.setAttribute("style", keep.join(";")); else e.removeAttribute("style"); }
        else if (n2 === "href") { if (!/^(https?:|mailto:|tel:)/i.test(a.value.trim())) e.removeAttribute("href"); else { e.setAttribute("target", "_blank"); e.setAttribute("rel", "noopener noreferrer"); } }
        else if (!(n2 === "data-list" || n2 === "target" || n2 === "rel" || (n2 === "class" && /^ql-(align|indent|size)/.test(a.value)))) e.removeAttribute(a.name);
      }
      walk(e);
    }
  };
  walk(t.content); return t.innerHTML;
}
/** HTML → text, mỗi khối 1 dòng (RTE.text gốc, bản DOM) */
export function rteTextDom(v: unknown): string {
  if (!isRich(v)) return String(v ?? "");
  if (typeof document === "undefined") return rteText(v);
  const d = document.createElement("div"); d.innerHTML = rteClean(String(v));
  const out: string[] = [], blk = /^(P|DIV|LI|H1|H2|H3|BLOCKQUOTE|PRE)$/, lst = /^(OL|UL)$/;
  const line = (n: Node): string => { let s = ""; n.childNodes.forEach((c) => { if (c.nodeType === 3) s += c.nodeValue; else if (c.nodeName === "BR") s += "\n"; else if (c.nodeType === 1) { if (blk.test(c.nodeName) || lst.test(c.nodeName)) return; s += line(c); } }); return s; };
  const walk = (n: Node) => {
    let inl = ""; const fl = () => { if (inl !== "") { out.push(inl); inl = ""; } };
    n.childNodes.forEach((c) => {
      if (c.nodeType === 1 && (blk.test(c.nodeName) || lst.test(c.nodeName))) {
        fl(); if (lst.test(c.nodeName)) walk(c);
        else { const t = line(c); out.push(t === "\n" ? "" : t.replace(/\n$/, "")); if ([...(c as Element).children].some((x) => blk.test(x.nodeName) || lst.test(x.nodeName))) walk(c); }
      } else if (c.nodeType === 3) inl += c.nodeValue; else if (c.nodeName === "BR") inl += "\n"; else if (c.nodeType === 1) inl += line(c);
    });
    fl();
  };
  walk(d); return out.join("\n").replace(/ /g, " ").replace(/\n+$/, "");
}
const plainHtml = (v: unknown) => String(v ?? "").split("\n").map((l) => `<p>${ESC(l) || "<br>"}</p>`).join("");
/** HTML của trình soạn → giá trị lưu: không có định dạng thì trả text thuần */
export function rteNorm(html: string): string {
  const c = rteClean(html).replace(/<span class="ql-cursor">.*?<\/span>/g, "");
  const d = document.createElement("div"); d.innerHTML = c;
  const fmt = d.querySelector("b,strong,i,em,u,s,strike,a,ol,ul,h1,h2,h3,blockquote,pre,code,sub,sup,font,[style],[class]");
  const t = rteTextDom(c.startsWith("<") ? c : "<p>" + c + "</p>");
  if (!fmt) return t.trim() ? t : ""; return t.trim() ? c : "";
}
/** hiển thị ghi chú: rich → HTML đã lọc; thường → text giữ xuống dòng */
export function RteView({ v }: { v: string }) {
  return isRich(v) ? <div className="rtv" dangerouslySetInnerHTML={{ __html: rteClean(v) }} /> : <div className="rtv pl">{v}</div>;
}
/* định dạng hiển thị tách khỏi dữ liệu: giá trị là text thuần, định dạng ở data._fmt[khoá] (chỉ dùng khi text còn khớp) */
type HasData = { note?: string | null; data: Record<string, unknown> };
const fmtMap = (d: Record<string, unknown> | undefined): Record<string, string> => { const m = d?._fmt; return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, string>) : {}; };
export function fmtOf(a: HasData, k: string): string {
  const plain = k === "note" ? a.note || "" : String(a.data[k] ?? ""); if (isRich(plain)) return plain;
  const f = fmtMap(a.data)[k]; return f && rteTextDom(f) === plain ? f : plain;
}
export function fmtData(a: HasData, k: string, v: string): { plain: string; fmt: Record<string, string> | undefined } {
  const plain = rteTextDom(v), m = { ...fmtMap(a.data) }; if (isRich(v)) m[k] = v; else delete m[k];
  return { plain, fmt: Object.keys(m).length ? m : undefined };
}

let QLD: Promise<QuillCtor | null> | null = null;
/** nạp Quill 2 từ CDN (4s không xong → bộ soạn dự phòng contenteditable) */
export function loadQuill(): Promise<QuillCtor | null> {
  return (QLD ??= new Promise((res) => {
    if (typeof window === "undefined") { res(null); return; }
    if (window.Quill) { res(window.Quill); return; }
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = Q_CSS; document.head.appendChild(l);
    const s = document.createElement("script"); s.src = Q_JS; let done = false;
    const fail = () => { if (done) return; done = true; s.remove(); l.remove(); res(null); };
    const t = setTimeout(fail, 4000);
    s.onload = () => {
      if (done) return; done = true; clearTimeout(t); const Q = window.Quill; if (!Q) { res(null); return; }
      try { const Sz = Q.import("attributors/style/size") as { whitelist?: string[] }; Sz.whitelist = SIZES.map((x) => x[1]).filter(Boolean); Q.register(Sz, true); } catch { /* bản Quill khác */ }
      res(Q);
    };
    s.onerror = () => { clearTimeout(t); fail(); };
    document.head.appendChild(s);
  }));
}
const SV = (p: string) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
type RtKey = "b" | "i" | "u" | "s" | "size" | "color" | "hl" | "ul" | "ol" | "link" | "undo" | "redo" | "clear";
const RIC: Record<RtKey, string> = {
  b: SV('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'), i: SV('<path d="M19 4h-9M14 20H5M15 4 9 20"/>'), u: SV('<path d="M6 4v6a6 6 0 0 0 12 0V4M4 20h16"/>'), s: SV('<path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16"/>'),
  size: SV('<path d="M4 7V4h10v3M9 4v16M7 20h4M14 13v-2h7v2M17.5 11v9M16 20h3"/>'), color: SV('<path d="m5 18 5-13h1l5 13M7 13h7"/><path d="M4 21h16" stroke-width="3"/>'), hl: SV('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  ul: SV('<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="2.4"/>'), ol: SV('<path d="M10 6h10M10 12h10M10 18h10M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
  link: SV('<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'), clear: SV('<path d="M4 7V4h16v3M5 20h6M13 4 8 20M15 15l5 5M20 15l-5 5"/>'),
  undo: SV('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'), redo: SV('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
};
const TB: Array<[RtKey, string] | "|"> = [["b", "In đậm (Ctrl+B)"], ["i", "In nghiêng (Ctrl+I)"], ["u", "Gạch chân (Ctrl+U)"], ["s", "Gạch ngang"], "|", ["size", "Cỡ chữ"], ["color", "Màu chữ"], ["hl", "Tô nền"], "|", ["ul", "Danh sách chấm"], ["ol", "Danh sách số"], ["link", "Chèn liên kết"], "|", ["undo", "Hoàn tác (Ctrl+Z)"], ["redo", "Làm lại (Ctrl+Y)"], ["clear", "Xóa định dạng"]];
export interface RteApi { get(): string; focus(): void; closeMenu(): boolean; lib: "quill" | "native" }
type MenuK = "size" | "color" | "hl" | "link";

/** Trình soạn ghi chú định dạng (không điều khiển: `value` chỉ là giá trị ban đầu — đổi `key` để nạp lại). Không nạp được Quill → contenteditable. */
export function NoteEditor({ value, onChange, placeholder = "", autoFocus = false, onKey, className = "", apiRef, preferNative = false }: {
  value: string; onChange?: (v: string) => void; placeholder?: string; autoFocus?: boolean; onKey?: (e: KeyboardEvent) => void; className?: string;
  apiRef?: { current: RteApi | null }; preferNative?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null), ed = useRef<HTMLDivElement>(null);
  const act = useRef<Partial<Record<RtKey, (v?: string) => void>>>({});
  const curOf = useRef<(k: string) => string>(() => "");
  const [on, setOn] = useState<Partial<Record<RtKey, boolean>>>({});
  const [menu, setMenu] = useState<{ k: MenuK; x: number; y: number; cur: string } | null>(null);
  const menuR = useRef(menu); useLayoutEffect(() => { menuR.current = menu; });
  const cb = useRef({ onChange, onKey }); useLayoutEffect(() => { cb.current = { onChange, onKey }; });
  const init = useRef({ value, placeholder, autoFocus, preferNative, apiRef });
  useEffect(() => {
    const el = ed.current; if (!el) return;
    let alive = true; const off: Array<() => void> = []; const apiRef0 = init.current.apiRef;
    const v0 = init.current.value || "", html = isRich(v0) ? rteClean(v0) : plainHtml(v0);
    el.innerHTML = `<div class="rte-ld">${html}</div>`;
    const closeMenu = () => { if (!menuR.current) return false; setMenu(null); return true; };
    void (async () => {
      const Q = init.current.preferNative ? null : await loadQuill(); if (!alive || !el.isConnected) return;
      let api: RteApi;
      if (Q) {
        el.innerHTML = html;
        const q = new Q(el, { modules: { toolbar: false, history: { delay: 600, maxStack: 200, userOnly: true } }, formats: ["bold", "italic", "underline", "strike", "size", "color", "background", "list", "link", "header", "align", "indent"], placeholder: init.current.placeholder });
        const root = q.root; root.setAttribute("spellcheck", "false");
        const fmt = (): Record<string, unknown> => { const r = q.getSelection(); return r ? q.getFormat(r) : {}; };
        act.current = {
          b: () => q.format("bold", !fmt().bold, "user"), i: () => q.format("italic", !fmt().italic, "user"), u: () => q.format("underline", !fmt().underline, "user"), s: () => q.format("strike", !fmt().strike, "user"),
          ul: () => q.format("list", fmt().list === "bullet" ? false : "bullet", "user"), ol: () => q.format("list", fmt().list === "ordered" ? false : "ordered", "user"),
          undo: () => q.history.undo(), redo: () => q.history.redo(),
          clear: () => { const r = q.getSelection(true); if (r && r.length) q.removeFormat(r.index, r.length, "user"); else q.format("list", false, "user"); },
          size: (v) => q.format("size", v || false, "user"), color: (v) => q.format("color", v || false, "user"), hl: (v) => q.format("background", v || false, "user"), link: (v) => q.format("link", v || false, "user"),
        };
        curOf.current = (k) => { const v = fmt()[k]; return typeof v === "string" ? v : ""; };
        const state = () => { const f = fmt(); setOn({ b: !!f.bold, i: !!f.italic, u: !!f.underline, s: !!f.strike, ul: f.list === "bullet", ol: f.list === "ordered", link: !!f.link, size: !!f.size, color: !!f.color, hl: !!f.background }); };
        const tc = () => cb.current.onChange?.(rteNorm(root.innerHTML));
        q.on("editor-change", state); q.on("text-change", tc); off.push(() => { q.off?.("editor-change", state); q.off?.("text-change", tc); });
        const kd = (e: KeyboardEvent) => cb.current.onKey?.(e); root.addEventListener("keydown", kd); off.push(() => root.removeEventListener("keydown", kd));
        api = { get: () => rteNorm(root.innerHTML), focus: () => { q.focus(); q.setSelection(q.getLength(), 0); }, closeMenu, lib: "quill" };
      } else {
        el.innerHTML = `<div class="rte-ce ql-editor" contenteditable="true" spellcheck="false">${html}</div>`;
        const ce = el.firstChild as HTMLElement; try { document.execCommand("styleWithCSS", false, "true"); } catch { /* */ }
        const qs = (k: string) => { try { return document.queryCommandState(k); } catch { return false; } };
        const state = () => setOn({ b: qs("bold"), i: qs("italic"), u: qs("underline"), s: qs("strikeThrough"), ul: qs("insertUnorderedList"), ol: qs("insertOrderedList") });
        const ex = (c: string, v?: string) => { ce.focus(); document.execCommand(c, false, v); cb.current.onChange?.(rteNorm(ce.innerHTML)); state(); };
        const PX: Record<string, string> = { "12px": "2", "": "3", "18px": "5", "24px": "6" };
        act.current = { b: () => ex("bold"), i: () => ex("italic"), u: () => ex("underline"), s: () => ex("strikeThrough"), ul: () => ex("insertUnorderedList"), ol: () => ex("insertOrderedList"), undo: () => ex("undo"), redo: () => ex("redo"), clear: () => ex("removeFormat"),
          size: (v) => ex("fontSize", PX[v || ""]), color: (v) => ex("foreColor", v || "#182230"), hl: (v) => ex("hiliteColor", v || "transparent"), link: (v) => (v ? ex("createLink", v) : ex("unlink")) };
        curOf.current = () => "";
        const inp = () => cb.current.onChange?.(rteNorm(ce.innerHTML)); ce.addEventListener("input", inp); off.push(() => ce.removeEventListener("input", inp));
        const sc = () => { if (ce.isConnected && ce.contains(document.getSelection()?.anchorNode ?? null)) state(); }; document.addEventListener("selectionchange", sc); off.push(() => document.removeEventListener("selectionchange", sc));
        const kd = (e: KeyboardEvent) => cb.current.onKey?.(e); ce.addEventListener("keydown", kd); off.push(() => ce.removeEventListener("keydown", kd));
        api = { get: () => rteNorm(ce.innerHTML), focus: () => { ce.focus(); const r = document.createRange(); r.selectNodeContents(ce); r.collapse(false); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); }, closeMenu, lib: "native" };
      }
      if (init.current.apiRef) init.current.apiRef.current = api;
      if (init.current.autoFocus) api.focus();
    })();
    return () => { alive = false; for (const f of off) f(); if (apiRef0) apiRef0.current = null; };
  }, []);
  const tb = (k: RtKey, btn: HTMLElement) => {
    if (k === "size" || k === "color" || k === "hl" || k === "link") {
      const r = btn.getBoundingClientRect(), h = host.current!.getBoundingClientRect();
      setMenu({ k, x: r.left - h.left, y: r.bottom - h.top + 4, cur: curOf.current(k === "hl" ? "background" : k) }); return;
    }
    act.current[k]?.();
  };
  return <div ref={host} className={`rte ${className}`} onKeyDown={(e) => { if (e.key === "Escape" && menuR.current) { e.stopPropagation(); setMenu(null); } }}>
    <div className="rte-tb" role="toolbar" aria-label="Định dạng" onMouseDown={(e) => { if ((e.target as HTMLElement).closest("[data-rt]")) e.preventDefault(); }}>
      {TB.map((x, i) => x === "|" ? <span key={i} className="rte-sep" /> : <button key={x[0]} type="button" className={`rte-b ${on[x[0]] ? "on" : ""}`} data-rt={x[0]} title={x[1]} aria-label={x[1]} onClick={(e) => tb(x[0], e.currentTarget)} dangerouslySetInnerHTML={{ __html: RIC[x[0]] }} />)}
    </div>
    <div ref={ed} className="rte-ed" />
    {menu ? <RteMenu m={menu} host={host} close={() => setMenu(null)} pick={(k, v) => act.current[k]?.(v)} /> : null}
  </div>;
}
function RteMenu({ m, host, close, pick }: { m: { k: MenuK; x: number; y: number; cur: string }; host: React.RefObject<HTMLDivElement | null>; close: () => void; pick: (k: RtKey, v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null), inp = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { const el = ref.current, h = host.current; if (!el || !h) return; el.style.left = Math.max(0, Math.min(m.x, h.offsetWidth - el.offsetWidth - 4)) + "px"; el.style.top = m.y + "px"; inp.current?.focus(); }, [m, host]);
  useEffect(() => { const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(`[data-rt="${m.k}"]`)) close(); }; document.addEventListener("mousedown", off, true); return () => document.removeEventListener("mousedown", off, true); }, [m.k, close]);
  const go = (v: string) => { pick(m.k, v); close(); };
  const linkOk = (rm: boolean) => { const u = (inp.current?.value || "").trim(); pick("link", rm ? "" : u ? (/^[a-z]+:/i.test(u) ? u : "https://" + u) : ""); close(); };
  const sw = (list: string[]) => <div className="rte-sw">{list.map((c) => <button key={c || "_"} type="button" title={c || "Mặc định"} className={(m.cur || "") === c ? "on" : ""} style={c ? ({ "--c": c } as React.CSSProperties) : undefined} onClick={() => go(c)}>{c ? null : <i />}</button>)}</div>;
  return <div ref={ref} className="rte-m" onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault(); }}>
    {m.k === "size" ? <div className="rte-ls">{SIZES.map(([l, v]) => <button key={l} type="button" style={v ? { fontSize: v } : undefined} className={(m.cur || "") === v ? "on" : ""} onClick={() => go(v)}>{l}</button>)}</div>
      : m.k === "color" ? sw(COLORS) : m.k === "hl" ? sw(HL)
        : <div className="rte-lk"><input ref={inp} className="in" placeholder="https://…" defaultValue={m.cur} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); linkOk(false); } if (e.key === "Escape") { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); close(); } }} />
          <button type="button" className="btn sm pri" title="Chèn liên kết" onClick={() => linkOk(false)} dangerouslySetInnerHTML={{ __html: RIC.link }} />
          {m.cur ? <button type="button" className="btn sm ghost" title="Bỏ liên kết" onClick={() => linkOk(true)}>✕</button> : null}</div>}
  </div>;
}

/* ═════════════════════════ tiện ích chung ═════════════════════════ */
/** lưu 1 phần của dòng (saveAcc gốc): ghi đè note / data / links lên payload hiện tại */
export async function saveAcc(a: Account, p: { note?: string; data?: Record<string, unknown>; links?: Record<string, Id[]> }) {
  const b = payload(I, a); if (p.note !== undefined) b.note = p.note;
  if (p.data) Object.assign(b.data as Record<string, unknown>, p.data); if (p.links) Object.assign(b.links, p.links);
  await mut("account", b);
}
export function devTotals(d: Device) {
  const u = I.devUse[d.id] || {}; let used = 0, cap = 0;
  for (const n of Object.values(u)) used += n; for (const c of Object.values(d.caps || {})) cap += +c || 0;
  return { used, cap, u, over: Object.entries(d.caps || {}).some(([t, c]) => +c > 0 && (u[+t] || 0) > +c) };
}
/** kiểm tra giới hạn tài khoản/máy trước khi gán (hỏi xác nhận nếu vượt) */
export async function capOk(items: Array<{ tab: Id; id: Id | null }>, devId: Id): Promise<boolean> {
  const d = I.dev[devId]; if (!d) return true; const add: Record<string, number> = {}, use = I.devUse[devId] || {};
  for (const x of items) if (!x.id || I.acc[x.id]?.device_id !== devId) add[x.tab] = (add[x.tab] || 0) + 1;
  const over = Object.entries(add).filter(([t, n]) => { const c = +d.caps[t] || 0; return c > 0 && (use[+t] || 0) + n > c; });
  return !over.length || confirmBox(d.name + ": " + over.map(([t, n]) => `${I.tab[+t]?.name} ${(use[+t] || 0) + n}/${d.caps[t]}`).join(" · "), "OK", "check", "pri");
}
const ownerOpts = (dept: Id, none = "{Chưa gán}"): ComboOpt[] => [{ v: "", t: none }, ...treeOrder(I, dept).map(({ o, d }) => ({ v: String(o.id), t: indent(d, o.name) }))];
const fIcon = (f: Field) => (f.type === "link" ? I.tab[f.link_tab ?? -1]?.icon || "link" : f.type === "file" ? "clip" : TYPEIC[f.type]);
const optList = (f: Field) => (f.opts || "").split(",").map((x) => x.trim()).filter(Boolean);
const tint = (c: string) => ({ "--c": c } as React.CSSProperties);
const curDept = (): Id => (S.dept === "all" ? (S.owner != null ? I.own[S.owner]?.dept_id : undefined) ?? S.meta.depts[0]?.id ?? 0 : S.dept);

/** thêm nhanh 1 dòng chỉ có trường đầu (route quick) → id mới */
export async function quickAdd(tabId: Id, text: string, deptId?: Id | null, ownerId?: Id | null): Promise<Id> {
  const r = await mut<{ id: Id }>("quick", { tab_id: tabId, dept_id: deptId ?? curDept(), owner_id: ownerId ?? null, text });
  return r.id;
}

/* ═════════════════════════ chọn liên kết ═════════════════════════ */
export interface LinkPickOpts { anchor?: HTMLElement | { x: number; y: number }; tab: Id; selected: Id[]; onPick: (ids: Id[]) => void; multi?: boolean; dept?: Id | null; owner?: Id | null }
/** popover chọn dòng của tab liên kết (tìm, tích nhiều, gõ tên chưa có → tạo mới). Đóng popover = gửi kết quả nếu có thay đổi. */
export function openLinkPick(o: LinkPickOpts) {
  if (!I.tab[o.tab]) { toast("Trường chưa gắn tab liên kết", "err"); return; }
  const cur = o.selected.slice(), st = { pick: new Set(cur) };
  openPop(o.anchor ?? { x: Math.max(8, innerWidth / 2 - 135), y: 120 }, <LinkPicker o={o} st={st} />, "", () => { if (st.pick.size !== cur.length || cur.some((x) => !st.pick.has(x))) o.onPick([...st.pick]); });
}
/** chọn đúng 1 dòng (thay cả tập đã chọn) */
function pickOnly(st: { pick: Set<Id> }, id: Id) { st.pick = new Set([id]); }
function LinkPicker({ o, st }: { o: LinkPickOpts; st: { pick: Set<Id> } }) {
  useHs();
  const [qq, setQq] = useState(""); const [, force] = useState(0); const busy = useRef(false);
  const tt = I.tab[o.tab]; if (!tt) return null;
  const all = S.accs.filter((x) => x.tab_id === o.tab).map((x) => I.acc[x.id]).filter((x): x is AccountX => !!x);
  const s = qq.trim().toLowerCase(), dep = o.dept ?? null, pk = st.pick;
  const rows = all.filter((x) => !s || x.label.toLowerCase().includes(s)).sort((a, b) => (+pk.has(b.id) - +pk.has(a.id)) || (+(b.dept_id === dep) - +(a.dept_id === dep)) || b.id - a.id).slice(0, 60);
  const canNew = !!s && !all.some((x) => x.label.toLowerCase() === s);
  const tog = (id: Id) => { if (o.multi === false) { pickOnly(st, id); closePop(); return; } if (pk.has(id)) pk.delete(id); else pk.add(id); force((x) => x + 1); };
  const make = async () => {
    if (busy.current) return; busy.current = true;
    try { const id = await quickAdd(tt.id, qq.trim(), o.dept ?? curDept(), o.owner ?? null); if (o.multi === false) { pickOnly(st, id); closePop(); return; } pk.add(id); setQq(""); }
    catch { /* lỗi đã toast */ } finally { busy.current = false; }
  };
  return <div className="picker">
    <div className="psearch"><Ico n="search" sz={14} /><input className="in" placeholder="Tìm hoặc tạo mới" autoFocus value={qq} onChange={(e) => setQq(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (canNew) void make(); else if (rows.length === 1 && s) tog(rows[0].id); else closePop(); } }} /></div>
    <div className="plist">{rows.length || canNew ? <>
      {rows.map((x) => { const sc = x.status_id != null ? I.status[x.status_id] : undefined, on = pk.has(x.id); return <button key={x.id} className="mi" onClick={() => tog(x.id)}><span className={`chk ${on ? "on" : ""}`}>{on ? <Ico n="check" sz={12} /> : null}</span><i className="dot" style={{ background: sc?.color || GREY }} /><span className="t">{x.label}</span></button>; })}
      {canNew ? <button className="mi" onClick={() => void make()}><Ico n="plus" sz={14} /><span className="t">{qq.trim()}</span><em>{tt.name}</em></button> : null}
    </> : <div className="ph pad"><Ico n="inbox" sz={20} /></div>}</div>
    <div className="pfoot"><button className="btn sm pri" title="Xong" onClick={() => closePop()}><Ico n="check" sz={14} /></button></div>
  </div>;
}

/* ═════════════════════════ sheet Thêm / Sửa ═════════════════════════ */
interface FState { id: Id | null; tab_id: Id; dept_id: Id; owner_id: Id | null; device_id: Id | null; ver?: number; status_id: Id | null; note: string; data: Record<string, unknown>; links: Record<string, Id[]> }
const snapF = (F: FState) => JSON.stringify({ s: F.status_id, n: F.note, d: F.data, l: F.links, o: F.owner_id, dp: F.dept_id, dv: F.device_id });

/** mở form thêm (a rỗng; tab = tabId hoặc tab đang xem) / sửa (a) */
export function openSheet(a?: Account | null, tabId?: TabKey) {
  const tid = a ? a.tab_id : tabId ?? S.tab, t = typeof tid === "number" ? I.tab[tid] : undefined; if (!t) return;
  const F: FState = {
    id: a ? a.id : null, tab_id: t.id, dept_id: a ? a.dept_id : curDept(), owner_id: a ? a.owner_id : S.owner ?? null, device_id: a ? a.device_id : null, ver: a ? a.updated : undefined,
    status_id: a ? a.status_id : t.statuses[0]?.id ?? null, note: a ? a.note || "" : "", data: { ...(a ? a.data : {}) }, links: JSON.parse(JSON.stringify(a ? I.out[a.id] || {} : {})) as Record<string, Id[]>,
  };
  if (F.owner_id != null && I.own[F.owner_id]?.dept_id !== F.dept_id) F.owner_id = null;
  const h = { F0: snapF(F), cur: F, dirty: () => snapF(h.cur) !== h.F0 };
  uiSheet(<SheetView init={F} h={h} />, async () => !h.dirty() || confirmBox("Bỏ các thay đổi chưa lưu?", "Bỏ", "x", "danger"));
}
function SecIn({ value, onChange, readOnly, placeholder, title }: { value: string; onChange?: (v: string) => void; readOnly?: boolean; placeholder?: string; title?: string }) {
  const [show, setShow] = useState(false);
  return <div className="sec-in"><input className="in" type={show ? "text" : "password"} value={value} readOnly={readOnly} placeholder={placeholder} title={title} autoComplete="off" onChange={(e) => onChange?.(e.target.value)} />
    <button type="button" className="btn icon ghost" title={show ? "Ẩn" : "Hiện"} onClick={() => setShow(!show)}><Ico n="eye" sz={15} /></button></div>;
}
function SheetView({ init, h }: { init: FState; h: { cur: FState; dirty: () => boolean } }) {
  useHs();
  const [F, setF] = useState(init); useLayoutEffect(() => { bindHandle(h, { cur: F }); });
  const busy = useRef(false);
  const [ta] = useState(() => new Set((I.tab[init.tab_id]?.fields || []).filter((f) => { const v = String(init.data[String(f.id)] ?? ""); return !["number", "date", "select", "secret", "lookup", "link", "file"].includes(f.type) && (v.includes("\n") || v.length > 90); }).map((f) => f.id)));
  const [note0] = useState(() => fmtOf(init, "note"));
  useEffect(() => { const t = setTimeout(() => document.querySelector<HTMLElement>(".sheet input.in,.sheet textarea")?.focus(), 40); return () => clearTimeout(t); }, []);
  const t = I.tab[F.tab_id]; if (!t) return null;
  const setData = (k: string, v: unknown) => setF((f) => ({ ...f, data: { ...f.data, [k]: v } }));
  const setLinks = (k: string, ids: Id[]) => setF((f) => ({ ...f, links: { ...f.links, [k]: ids } }));
  const setNote = (v: string) => setF((f) => { const r = fmtData(f, "note", v), d = { ...f.data }; if (r.fmt) d._fmt = r.fmt; else delete d._fmt; return { ...f, note: r.plain, data: d }; });
  const tryClose = async () => { if (h.dirty() && !(await confirmBox("Bỏ các thay đổi chưa lưu?", "Bỏ", "x", "danger"))) return; closeSheet(); };
  const save = async () => {
    if (busy.current) return; const f = h.cur;
    if (f.device_id && !(await capOk([{ tab: f.tab_id, id: f.id }], f.device_id))) return;
    if (!Object.entries(f.data).some(([k, v]) => k !== "_fmt" && (Array.isArray(v) ? v.length > 0 : !!String(v ?? "").trim())) && !Object.values(f.links).some((l) => l.length)) { toast("Nhập ít nhất 1 trường", "err"); return; }
    busy.current = true;
    try { await mut("account", f); closeSheet(); } catch { busy.current = false; }
  };
  const files = t.fields.filter((x) => x.type === "file");
  const field = (f: Field) => {
    const k = String(f.id), v = F.data[k] ?? ""; let c: ReactNode;
    if (f.type === "link") c = <div className="lbox">{(F.links[k] || []).map((id) => { const b = I.acc[id]; if (!b) return null; const bt = I.tab[b.tab_id], s = b.status_id != null ? I.status[b.status_id] : undefined; return <span key={id} className="lchip" style={tint(bt?.color || GREY)}><span className="ci"><Ico n={bt?.icon || "link"} sz={12} /></span><span>{b.label}</span><i className="dot" style={{ background: s?.color || GREY }} /><button type="button" className="x" title="Bỏ liên kết" onClick={() => setLinks(k, (F.links[k] || []).filter((x) => x !== id))}><Ico n="x" sz={12} /></button></span>; })}
      <button type="button" className="btn icon sm outline" title="Thêm liên kết" onClick={(e) => { if (f.link_tab == null || !I.tab[f.link_tab]) { toast("Trường chưa gắn tab liên kết", "err"); return; } openLinkPick({ anchor: e.currentTarget, tab: f.link_tab, selected: F.links[k] || [], onPick: (ids) => setLinks(k, ids), dept: F.dept_id, owner: F.owner_id }); }}><Ico n="plus" sz={14} /></button></div>;
    else if (f.type === "file") c = <FileField value={F.data[k] as Attachment[] | undefined} paste={files.length === 1} onChange={(L) => setF((x) => { const d = { ...x.data }; if (L.length) d[k] = L; else delete d[k]; return { ...x, data: d }; })} />;
    else if (f.type === "select") { const sv = String(v), o = [...new Set([...optList(f), sv].filter(Boolean))]; c = <Combo value={sv} opts={[{ v: "", t: "" }, ...o.map((x) => ({ v: x, t: x }))]} title={f.label} onChange={(x) => setData(k, x)} />; }
    else if (f.type === "secret") c = <SecIn value={String(v)} onChange={(x) => setData(k, x)} />;
    else if (f.type === "lookup") { const base = F.id != null ? I.acc[F.id] : undefined, lv = base ? lookupVal(I, { ...base, data: F.data as Account["data"] }, f) : "", sec = lookupSecret(I, f), tt = "Liên kết giá trị — chỉ đọc, tự lấy theo cấu hình trong Cài đặt";
      c = sec ? <SecIn value={lv} readOnly placeholder="(tự lấy từ dòng liên kết)" title={tt} /> : <div className="sec-in"><input className="in" type="text" value={lv} readOnly placeholder="(tự lấy từ dòng liên kết)" title={tt} /></div>; }
    else if (ta.has(f.id)) { const s = String(v); c = <textarea className="in fta" rows={Math.min(10, Math.max(3, s.split("\n").length + (s.length > 90 ? 1 : 0)))} spellCheck={false} value={s} onChange={(e) => setData(k, e.target.value)} />; }
    else c = <input className="in" type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={String(v)} onChange={(e) => setData(k, e.target.value)} />;
    return <div key={f.id} className={`fld ${f.type === "link" || f.type === "file" ? "full" : ""}`}><label><Ico n={fIcon(f)} sz={13} />{f.label}</label>{c}</div>;
  };
  return <div style={{ display: "contents" }} onKeyDown={(e) => {
    const el = e.target as HTMLElement;
    if (e.key === "Enter" && !e.nativeEvent.isComposing && ((e.ctrlKey || e.metaKey) || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "file" && !el.closest(".rte")))) { e.preventDefault(); e.stopPropagation(); void save(); }
  }}>
    <header><span className="ti" style={tint(t.color)}><Ico n={t.icon} sz={16} /></span><h3>{F.id != null ? I.acc[F.id]?.label ?? t.name : t.name}</h3><div className="grow" /><button type="button" className="btn icon ghost" title="Đóng" onClick={() => void tryClose()}><Ico n="x" sz={16} /></button></header>
    <div className="sbody">
      <div className="chips2">{t.statuses.map((s) => <button key={s.id} type="button" className={`chip ${F.status_id === s.id ? "on" : ""}`} onClick={() => setF((f) => ({ ...f, status_id: s.id }))}><i className="dot" style={{ background: s.color }} />{s.label}</button>)}</div>
      {t.fields.map(field)}
      <div className="fld full"><label><Ico n="note" sz={13} /></label><NoteEditor className="rte-host" value={note0} placeholder="Ghi chú…" onChange={setNote} /></div>
      <div className="fld"><label><Ico n="folder" sz={13} /></label><Combo value={String(F.dept_id)} title="Bộ phận" opts={S.meta.depts.map((d) => ({ v: String(d.id), t: d.name }))} onChange={(v) => setF((f) => ({ ...f, dept_id: +v, owner_id: null }))} /></div>
      <div className="fld"><label><Ico n="users" sz={13} /></label><Combo value={F.owner_id != null ? String(F.owner_id) : ""} title="Owner" opts={ownerOpts(F.dept_id)} onChange={(v) => setF((f) => ({ ...f, owner_id: v ? +v : null }))} /></div>
      <div className="fld"><label><Ico n="smartphone" sz={13} /></label><Combo value={F.device_id != null ? String(F.device_id) : ""} title="Thiết bị" opts={devOptList(F.dept_id, F.device_id)} onChange={(v) => setF((f) => ({ ...f, device_id: v ? +v : null }))} /></div>
    </div>
    <footer><button type="button" className="btn outline" onClick={() => void tryClose()}>Hủy</button><button type="button" className="btn pri" title="Lưu (Enter)" onClick={() => void save()}><Ico n="check" sz={16} /><span>Lưu</span></button></footer>
  </div>;
}

/* ═════════════════════════ sửa hàng loạt: đối chiếu cũ → mới theo từng cột (rows_set) ═════════════════════════ */
const MXCAP = 400;
type Ed = Record<string, Record<string, string>>;
interface MState { ids: Id[]; tab: Id | null; col: string; ed: Ed; paste: boolean }
export interface RowItem { id: Id; data?: Record<string, string | null>; status_id?: Id | null; owner_id?: Id | null; device_id?: Id | null; note?: string | null }
function mxCols(tab: Id | null) {
  const t = tab != null ? I.tab[tab] : null, c: Array<{ k: string; l: string; ic: string }> = [];
  if (t) { t.fields.filter((f) => f.type !== "link" && f.type !== "file").forEach((f) => c.push({ k: String(f.id), l: f.label, ic: f.type === "secret" ? "lock" : f.type === "date" ? "calendar" : "type" })); c.push({ k: "status", l: "Trạng thái", ic: "tag" }); }
  c.push({ k: "owner", l: "Owner", ic: "users" }, { k: "device", l: "Thiết bị", ic: "smartphone" }, { k: "note", l: "Ghi chú", ic: "note" }); return c;
}
function mxCur(a: Account, col: string): string {
  if (col === "note") return a.note || ""; if (col === "status") return a.status_id ? String(a.status_id) : ""; if (col === "owner") return a.owner_id ? String(a.owner_id) : ""; if (col === "device") return a.device_id ? String(a.device_id) : "";
  const v = a.data[col]; return Array.isArray(v) ? "" : String(v ?? "");
}
const mxShow = (col: string, raw: string) => (col === "status" ? I.status[+raw]?.label || "" : col === "owner" ? I.own[+raw]?.name || "" : col === "device" ? I.dev[+raw]?.name || "" : col === "note" ? rteText(raw) : raw);
function mxOpts(col: string, tabId: Id | null): Array<[string, string]> | null {
  if (col === "status") return (tabId != null ? I.tab[tabId]?.statuses || [] : []).map((s) => [String(s.id), s.label]);
  if (col === "owner") return S.meta.depts.flatMap((d) => treeOrder(I, d.id).map(({ o, d: dp }) => [String(o.id), d.name + " · " + indent(dp, o.name)] as [string, string]));
  if (col === "device") return S.devices.map((d) => [String(d.id), d.name]);
  const f = I.field[+col]; if (f?.type === "select") return optList(f).map((x) => [x, x]); return null;
}
const mxCount = (ed: Ed) => { let n = 0; for (const c in ed) n += Object.keys(ed[c]).length; return n; };
/** ghi 1 ô sửa (mxSet): undefined = giữ nguyên; trùng giá trị cũ (khác rỗng) = bỏ */
function mxSet(ed: Ed, id: Id, col: string, v: string | undefined): Ed {
  const a = I.acc[id]; if (!a) return ed; const e = { ...(ed[col] || {}) };
  if (v === undefined || (v !== "" && v === mxCur(a, col))) delete e[id]; else e[id] = v;
  const n = { ...ed }; if (Object.keys(e).length) n[col] = e; else delete n[col]; return n;
}

/** Sửa hàng loạt các dòng đang chọn (bản cuối của v7.py: bảng đối chiếu cũ → mới, ghi qua rows_set) */
export function openMass(ids: Id[]) { openRowsDiff(ids); }
/** Bảng đối chiếu cũ → mới; `items` (tuỳ chọn) điền sẵn các thay đổi đề xuất (vd từ Cú vọ) để người dùng duyệt rồi ghi. */
export function openRowsDiff(ids: Id[], items?: RowItem[]) {
  const ok = ids.filter((i) => I.acc[i]); if (!ok.length) return;
  const tabs = [...new Set(ok.map((i) => I.acc[i].tab_id))], tab = tabs.length === 1 ? tabs[0] : null;
  let ed: Ed = {};
  for (const it of items || []) {
    if (!I.acc[it.id]) continue; const S2 = (v: Id | null | undefined) => (v == null ? "" : String(v));
    if (it.note !== undefined) ed = mxSet(ed, it.id, "note", it.note ?? "");
    if (it.status_id !== undefined) ed = mxSet(ed, it.id, "status", S2(it.status_id));
    if (it.owner_id !== undefined) ed = mxSet(ed, it.id, "owner", S2(it.owner_id));
    if (it.device_id !== undefined) ed = mxSet(ed, it.id, "device", S2(it.device_id));
    for (const [k, v] of Object.entries(it.data || {})) ed = mxSet(ed, it.id, k, v ?? "");
  }
  const cols = mxCols(tab), first = cols.find((c) => ed[c.k]);
  const M: MState = { ids: sortIds(S, ok), tab, col: first ? first.k : tab != null ? "status" : "owner", ed, paste: false };
  const h = { dirty: () => false };
  openModal(<MassView init={M} h={h} />, true, "mx", async () => !h.dirty() || confirmBox("Bỏ nội dung đang nhập?", "Bỏ", "x", "danger"));
}
function MassView({ init, h }: { init: MState; h: { dirty: () => boolean } }) {
  useHs();
  const [M, setM] = useState(init); const [gen, setGen] = useState(0); const [cap, setCap] = useState(MXCAP); const [fillV, setFillV] = useState("");
  const fillIn = useRef<HTMLInputElement>(null), pasteTa = useRef<HTMLTextAreaElement>(null), busy = useRef(false);
  useLayoutEffect(() => { bindHandle(h, { dirty: () => mxCount(M.ed) > 0 }); });
  const cols = mxCols(M.tab), cur = cols.find((c) => c.k === M.col) || cols[0], col = cur.k;
  const rows = M.ids.map((i) => I.acc[i]).filter((a): a is AccountX => !!a);
  const opAny = mxOpts(col, rows[0]?.tab_id ?? M.tab), cnt = (k: string) => (M.ed[k] ? Object.keys(M.ed[k]).length : 0), n = mxCount(M.ed);
  const set = (id: Id, v: string | undefined) => setM((m) => ({ ...m, ed: mxSet(m.ed, id, col, v) }));
  const redraw = (p: Partial<MState>) => { setM((m) => ({ ...m, ...p })); setGen((g) => g + 1); };
  const fill = () => {
    const raw = opAny ? fillV : fillIn.current?.value ?? ""; if (raw === "" && opAny) return;
    let ed = M.ed; for (const id of M.ids) { const a = I.acc[id]; if (!a) continue; const op = mxOpts(col, a.tab_id); if (op && raw !== "" && !op.some(([k]) => k === raw)) continue; ed = mxSet(ed, id, col, raw); }
    redraw({ ed });
  };
  const pasteOk = () => {
    const ls = (pasteTa.current?.value || "").split(/\r?\n/); if (ls.length && ls[ls.length - 1] === "") ls.pop();
    let ed = M.ed; M.ids.forEach((id, i) => { if (i >= ls.length) return; const a = I.acc[id]; if (!a) return; const op = mxOpts(col, a.tab_id); let v = ls[i].trim(); if (op) { const m = op.find(([k, t]) => t.toLowerCase() === v.toLowerCase() || k === v); if (!m) return; v = m[0]; } ed = mxSet(ed, id, col, v); });
    redraw({ ed, paste: false });
  };
  const go = async () => {
    if (busy.current) return; const items: Record<string, { id: Id; note?: string; status_id?: Id | null; owner_id?: Id | null; device_id?: Id | null; data?: Record<string, string> }> = {};
    for (const c in M.ed) for (const id in M.ed[c]) { const v = M.ed[c][id], it = (items[id] ??= { id: +id }); if (c === "note") it.note = v; else if (c === "status") it.status_id = v ? +v : null; else if (c === "owner") it.owner_id = v ? +v : null; else if (c === "device") it.device_id = v ? +v : null; else (it.data ??= {})[c] = v; }
    const list = Object.values(items); if (!list.length) return;
    const byDev: Record<string, Array<{ tab: Id; id: Id }>> = {}; for (const it of list) if (it.device_id) (byDev[it.device_id] ??= []).push({ tab: I.acc[it.id].tab_id, id: it.id });
    for (const d in byDev) if (!(await capOk(byDev[d], +d))) return;
    busy.current = true; try { await mut("rows_set", { items: list }); closeModal(); } catch { busy.current = false; }
  };
  const editor = (a: AccountX) => {
    const e = M.ed[col] || {}, has = a.id in e, v = has ? e[a.id] : "", op = mxOpts(col, a.tab_id);
    if (op) return <Combo value={has ? (v === "" ? "__clr" : v) : ""} opts={[{ v: "", t: "{Giữ nguyên}" }, { v: "__clr", t: "{Xóa trống}" }, ...op.map(([k, t]) => ({ v: k, t }))]} onChange={(x) => set(a.id, x === "" ? undefined : x === "__clr" ? "" : x)} />;
    const f = I.field[+col], ty = f?.type === "date" ? "date" : f?.type === "number" ? "number" : "text";
    return <div style={{ display: "flex", gap: 4 }}><input key={`${col}:${gen}:${a.id}`} className="in" type={ty} defaultValue={has ? v : ""} placeholder={has && v === "" ? "{Xóa trống}" : ""} onChange={(ev) => set(a.id, ev.target.value === "" ? undefined : ev.target.value)} />
      <button type="button" className="btn icon sm ghost" title="Xóa giá trị" onClick={() => { set(a.id, ""); setGen((g) => g + 1); }}><Ico n="eraser" sz={14} /></button></div>;
  };
  const row = (a: AccountX, i: number) => {
    const e = M.ed[col] || {}, c0 = mxCur(a, col), chg = a.id in e && e[a.id] !== c0, sh = mxShow(col, c0), stc = col === "status" ? I.status[+c0]?.color : undefined;
    return <tr key={a.id} data-r={a.id} className={chg ? "chg" : ""}><td className="ix">{i + 1}</td><td className="lb"><span className="txt">{a.label}</span></td>
      <td className="old">{stc ? <><i className="dot" style={{ background: stc }} /> </> : null}{sh || <span style={{ opacity: 0.4 }}>—</span>}</td><td className="ar"><Ico n="chevr" sz={14} /></td><td>{editor(a)}</td></tr>;
  };
  return <>
    <header><span className="ti" style={tint("#0ea5e9")}><Ico n="sliders" sz={16} /></span><h3>{M.ids.length}</h3><div className="grow" /><button type="button" className="btn icon ghost" title="Đóng" onClick={() => void (async () => { if (h.dirty() && !(await confirmBox("Bỏ nội dung đang nhập?", "Bỏ", "x", "danger"))) return; closeModal(); })()}><Ico n="x" sz={16} /></button></header>
    <div className="mbody" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="mx-tools">
        <Combo value={col} title="Cột" minWidth={190} opts={cols.map((c) => ({ v: c.k, t: c.l + (cnt(c.k) ? "  (" + cnt(c.k) + ")" : "") }))} onChange={(v) => { setM((m) => ({ ...m, col: v, paste: false })); setFillV(""); setCap(MXCAP); }} />
        {opAny ? <Combo value={fillV} title={cur.l} opts={[{ v: "", t: "{Giữ nguyên}" }, ...opAny.map(([k, t]) => ({ v: k, t }))]} onChange={setFillV} />
          : <input key={"fill:" + col} ref={fillIn} className="in" placeholder={cur.l} type={I.field[+col]?.type === "date" ? "date" : "text"} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fill(); } }} />}
        <button type="button" className="btn outline" title="Điền tất cả" onClick={fill}><Ico n="check" sz={16} /><span>{rows.length}</span></button>
        <button type="button" className="btn outline icon" title="Dán danh sách (mỗi dòng 1 giá trị)" onClick={() => { setM((m) => ({ ...m, paste: !m.paste })); setTimeout(() => pasteTa.current?.focus(), 0); }}><Ico n="listplus" sz={16} /></button>
        {M.tab != null ? <button type="button" className="btn outline icon" title="Nhập nhiều cột cùng lúc (dán dữ liệu, khớp theo khóa với các dòng đang chọn)" onClick={() => { const ids = M.ids.slice(), tid = M.tab!; closeModal(); openBulk(tid, ids); }}><Ico n="bulkadd" sz={16} /></button> : null}
        <button type="button" className="btn outline icon" title="Hoàn tác cột này" onClick={() => { const ed = { ...M.ed }; delete ed[col]; redraw({ ed }); }}><Ico n="undo" sz={16} /></button>
      </div>
      {M.paste ? <div className="mx-tools" style={{ alignItems: "flex-start" }}><textarea ref={pasteTa} className="in" id="mxtxt" rows={5} spellCheck={false} style={{ flex: 1, height: "auto", padding: "8px 10px", fontFamily: "inherit", fontSize: 12 }} placeholder="1 dòng = 1 giá trị, theo đúng thứ tự bên dưới" />
        <button type="button" className="btn pri" title="Áp dụng" onClick={pasteOk}><Ico n="check" sz={16} /></button></div> : null}
      <div className="mx-wrap"><table className="mx"><thead><tr><th>#</th><th><Ico n="key" sz={13} /></th><th>{cur.l}</th><th /><th><Ico n="edit" sz={13} /></th></tr></thead>
        <tbody id="mxb">{rows.slice(0, cap).map(row)}</tbody></table>
        {rows.length > cap ? <button type="button" className="mbtn" title="Hiện thêm" onClick={() => setCap((c) => c + 1000)}><Ico n="chevd" sz={13} /><span>+{(rows.length - cap).toLocaleString("vi")} dòng nữa</span></button> : null}</div>
    </div>
    <footer><button type="button" className="btn outline" onClick={() => void (async () => { if (h.dirty() && !(await confirmBox("Bỏ nội dung đang nhập?", "Bỏ", "x", "danger"))) return; closeModal(); })()}>Hủy</button>
      <button type="button" className="btn pri" id="mxgo" disabled={!n} onClick={() => void go()}><Ico n="check" sz={16} /><span id="mxn">{n + " / " + M.ids.length}</span></button></footer>
  </>;
}

/* ═════════════════════════ sửa nhiều (bản mass_set cũ: cùng 1 giá trị cho mọi dòng) ═════════════════════════ */
interface MSet { ids: Id[]; tab: Id | null; rows: Array<{ f: Id; v: string }>; status: Id | null; owner: string; device: string; note: string; mode: "replace" | "append" }
/** form "Sửa nhiều" gốc (4998-5016): trạng thái · owner · thiết bị · các trường · ghi chú thay thế/nối thêm → route mass_set */
export function openMassSet(ids: Id[]) {
  const ok = ids.filter((i) => I.acc[i]); if (!ok.length) return; const tabs = [...new Set(ok.map((i) => I.acc[i].tab_id))];
  const h = { dirty: () => false };
  openModal(<MassSetView init={{ ids: ok, tab: tabs.length === 1 ? tabs[0] : null, rows: [], status: null, owner: "__keep", device: "__keep", note: "", mode: "replace" }} h={h} />, false, "", async () => !h.dirty() || confirmBox("Bỏ nội dung đang nhập?", "Bỏ", "x", "danger"));
}
function MassSetView({ init, h }: { init: MSet; h: { dirty: () => boolean } }) {
  useHs();
  const [M, setM] = useState(init); const busy = useRef(false); const up = (p: Partial<MSet>) => setM((m) => ({ ...m, ...p }));
  useLayoutEffect(() => { bindHandle(h, { dirty: () => M.rows.length > 0 || M.status != null || M.owner !== "__keep" || M.device !== "__keep" || M.note !== "" }); });
  const t = M.tab != null ? I.tab[M.tab] : null, fs = t ? t.fields.filter((x) => x.type !== "link" && x.type !== "file") : [];
  const ownOpts: ComboOpt[] = [{ v: "__keep", t: "{Giữ nguyên}" }, { v: "", t: "{Bỏ owner}" }, ...S.meta.depts.flatMap((d) => [{ v: "d:" + d.id, t: d.name + " · {cả bộ phận}" }, ...treeOrder(I, d.id).map(({ o, d: dp }) => ({ v: String(o.id), t: d.name + " · " + indent(dp, o.name) }))])];
  const go = async () => {
    if (busy.current) return; const data: Record<string, string> = {}; M.rows.forEach((r) => { data[r.f] = r.v; });
    const b: Record<string, unknown> = { ids: M.ids, data, status_id: M.status };
    if (M.owner !== "__keep") { b.set_owner = 1; const dm = /^d:(\d+)$/.exec(M.owner); b.owner_id = dm || !M.owner ? null : +M.owner; if (dm) b.dept_id = +dm[1]; }
    if (M.device !== "__keep") { b.set_device = 1; b.device_id = M.device ? +M.device : null; }
    if (M.note !== "") { b.note = M.note; b.note_mode = M.mode; }
    busy.current = true; try { await mut("mass_set", b); closeModal(); } catch { busy.current = false; }
  };
  const close = async () => { if (h.dirty() && !(await confirmBox("Bỏ nội dung đang nhập?", "Bỏ", "x", "danger"))) return; closeModal(); };
  return <>
    <header><span className="ti" style={tint("#0ea5e9")}><Ico n="sliders" sz={16} /></span><h3>{M.ids.length}</h3><div className="grow" /><button type="button" className="btn icon ghost" title="Đóng" onClick={() => void close()}><Ico n="x" sz={16} /></button></header>
    <div className="mbody" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {t ? <div className="fld"><label><Ico n="tag" sz={13} /></label><div className="chips2">{t.statuses.map((s) => <button key={s.id} type="button" className={`chip ${M.status === s.id ? "on" : ""}`} onClick={() => up({ status: M.status === s.id ? null : s.id })}><i className="dot" style={{ background: s.color }} />{s.label}</button>)}</div></div> : null}
      <div className="fld"><label><Ico n="users" sz={13} /></label><Combo value={M.owner} title="Owner" opts={ownOpts} onChange={(v) => up({ owner: v })} /></div>
      <div className="fld"><label><Ico n="smartphone" sz={13} /></label><Combo value={M.device} title="Thiết bị" opts={[{ v: "__keep", t: "{Giữ nguyên}" }, { v: "", t: "{Bỏ thiết bị}" }, ...S.devices.map((d) => ({ v: String(d.id), t: d.name }))]} onChange={(v) => up({ device: v })} /></div>
      {t ? <div className="fld"><label><Ico n="columns" sz={13} /></label>{M.rows.map((r, i) => { const f = I.field[r.f]; const setR = (p: Partial<{ f: Id; v: string }>) => up({ rows: M.rows.map((x, j) => (j === i ? { ...x, ...p } : x)) });
        return <div key={i} className="mrow"><span style={{ flex: "none", width: 150, display: "inline-flex" }}><Combo value={String(r.f)} title="Trường" opts={fs.map((x) => ({ v: String(x.id), t: x.label }))} onChange={(v) => setR({ f: +v, v: "" })} /></span>
          {f?.type === "select" ? <Combo value={r.v} opts={[{ v: "", t: "" }, ...optList(f).map((x) => ({ v: x, t: x }))]} onChange={(v) => setR({ v })} /> : <input className="in" type={f?.type === "date" ? "date" : "text"} value={r.v} placeholder="(trống = xóa)" onChange={(e) => setR({ v: e.target.value })} />}
          <button type="button" className="btn icon sm ghost" title="Bỏ" onClick={() => up({ rows: M.rows.filter((_, j) => j !== i) })}><Ico n="x" sz={14} /></button></div>; })}
        <button type="button" className="btn outline sm" title="Thêm trường" onClick={() => { const f = fs.find((x) => !M.rows.some((r) => r.f === x.id)); if (f) up({ rows: [...M.rows, { f: f.id, v: "" }] }); }}><Ico n="plus" sz={14} /></button></div> : null}
      <div className="fld"><label><Ico n="note" sz={13} /><Combo className="in sm" value={M.mode} opts={[{ v: "replace", t: "{Thay thế}" }, { v: "append", t: "{Nối thêm}" }]} onChange={(v) => up({ mode: v === "append" ? "append" : "replace" })} /></label>
        <textarea className="in" rows={3} value={M.note} placeholder={M.mode === "append" ? "{Nối vào cuối ghi chú}" : ""} onChange={(e) => up({ note: e.target.value })} /></div>
    </div>
    <footer><button type="button" className="btn outline" onClick={() => void close()}>Hủy</button><button type="button" className="btn pri" onClick={() => void go()}><Ico n="check" sz={16} /><span>{M.ids.length}</span></button></footer>
  </>;
}

/* ═════════════════════════ xuất / sao chép tuỳ chỉnh ═════════════════════════ */
interface EState { tab: Id; ids: Id[]; use: Tok[]; sep: string; header: boolean }
type ExPref = { use?: Array<Id | string>; sep?: string; header?: boolean; list?: string[] };
const exPref = (tab: Id) => S.ex[String(tab)] as ExPref | undefined;
const exAvail = (tab: Id): Tok[] => [...(I.tab[tab]?.fields || []).map((f) => f.id), ...(["status", "owner", "device", "note", "dept", "tab", "label"] as TokKey[])];
const exFmtText = (use: Tok[]) => use.map(tokLabel).join("|");
function parseExFmt(text: string, tab: Id): Tok[] {
  const X: Record<string, TokKey> = { bophan: "dept", dept: "dept", loai: "tab", tab: "tab", ten: "label", label: "label", name: "label" }, t = I.tab[tab];
  return text.split(/[|\t;,]+/).map((x) => x.trim()).filter(Boolean).map((x) => X[nz(x)] || (t ? matchTok(x, t) : null) || { n: x });
}
const exCell = (a: AccountX, tk: Tok) => (typeof tk === "object" ? "" : cellText(S, I, a, tk));
function exRows(ids: Id[], use: Tok[], header: boolean): string[][] {
  const L: string[][] = []; if (header) L.push(use.map(tokLabel));
  for (const id of sortIds(S, ids)) { const a = I.acc[id]; if (a) L.push(use.map((t) => exCell(a, t))); }
  return L;
}
const exText = (ids: Id[], use: Tok[], sep: string, header: boolean) => { const sp = sepCh(sep || "|"); return exRows(ids, use, header).map((r) => r.join(sp)).join("\n"); };
/** nhớ định dạng xuất của tab (S.ex[tab]: use/sep/header + mẫu đã lưu list) */
function exSave(E: EState, list?: string[]) {
  const p: ExPref = { ...(exPref(E.tab) || {}) }; p.use = E.use.filter((x): x is Id | TokKey => typeof x !== "object"); p.sep = E.sep; p.header = E.header; if (list) p.list = list;
  S.ex[String(E.tab)] = p as ExportFmt; savePref();
}
/** Xuất / sao chép các dòng (cùng tab với dòng đầu) theo định dạng cột tuỳ chọn */
export function openExport(ids: Id[]) {
  const a0 = ids.length ? I.acc[ids[0]] : undefined; if (!a0) return; const tid = a0.tab_id, t = I.tab[tid]; if (!t) return;
  const ids2 = ids.filter((i) => I.acc[i]?.tab_id === tid), last = exPref(tid);
  const use: Tok[] = last?.use?.filter((x) => typeof x !== "number" || I.field[x]).map((x) => (typeof x === "number" ? x : (x as TokKey))) || t.fields.map((f) => f.id);
  openModal(<ExportView init={{ tab: tid, ids: ids2, use, sep: last?.sep || "|", header: !!last?.header }} />, true, "bk");
}
function ExportView({ init }: { init: EState }) {
  useHs();
  const [E, setE] = useState(init); const t = I.tab[E.tab];
  const up = (p: Partial<EState>) => { const n = { ...E, ...p }; setE(n); exSave(n); };
  if (!t) return null;
  const pr = exPref(E.tab)?.list || [], ft = exFmtText(E.use), name = t.name || "export";
  const prev = exRows(E.ids.slice(0, 8), E.use, false);
  const xsave = () => { exSave(E, [ft, ...pr.filter((x) => x !== ft)].slice(0, 20)); emit(); };
  const xdelp = () => { if (!exPref(E.tab)) return; exSave(E, pr.filter((x) => x !== ft)); emit(); };
  const dl = () => { exSave(E); const csv = E.sep === ",", txt = exText(E.ids, E.use, E.sep, E.header); download(new Blob(["﻿" + txt], { type: "text/plain;charset=utf-8" }), name + (csv ? ".csv" : ".txt")); };
  const xls = () => { exSave(E); void dlXlsx(name, exRows(E.ids, E.use, true)); };
  const cp = () => { exSave(E); void copyText(exText(E.ids, E.use, E.sep, E.header)); closeModal(); };
  return <>
    <header><span className="ti" style={tint(t.color)}><Ico n={t.icon} sz={16} /></span><h3>{t.name}</h3><span className="bs">{E.ids.length}</span><div className="grow" /><button type="button" className="btn icon ghost" title="Đóng" onClick={() => closeModal()}><Ico n="x" sz={16} /></button></header>
    <div className="mbody">
      <div className="bctl">
        <input key={ft} className="in fmt" id="xfmt" defaultValue={ft} placeholder="uid|pass|2fa|email" spellCheck={false} title="Định dạng cột" onBlur={(e) => { if (e.target.value !== ft) up({ use: parseExFmt(e.target.value, E.tab) }); }} onKeyDown={(e) => { if (e.key === "Enter" && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); up({ use: parseExFmt(e.currentTarget.value, E.tab) }); } }} />
        <PresetCombo list={pr} onPick={(p) => up({ use: parseExFmt(p, E.tab) })} />
        <button type="button" className="btn icon outline" title="Lưu định dạng" onClick={xsave}><Ico n="save" sz={16} /></button>
        <button type="button" className="btn icon outline" title="Xóa định dạng đã lưu" onClick={xdelp}><Ico n="trash" sz={16} /></button>
      </div>
      <div className="bctl">
        <label className="lab" title="Phân cách"><Ico n="hash" sz={15} /><input className="in sepin" value={E.sep} onChange={(e) => up({ sep: e.target.value || "|" })} /></label>
        <label className="lab" title="Dòng đầu là tiêu đề"><Ico n="list" sz={15} /><button type="button" className={`sw ${E.header ? "on" : ""}`} aria-pressed={E.header} onClick={() => up({ header: !E.header })} /></label>
      </div>
      <FmtBar use={E.use} pool={exAvail(E.tab)} onChange={(u) => up({ use: u })} />
      <div className="bprev" id="exprev"><table><thead><tr>{E.use.map((u, i) => <th key={i}>{tokLabel(u)}</th>)}</tr></thead><tbody>{prev.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>{E.ids.length > 8 ? <div className="mh">… {E.ids.length}</div> : null}</div>
    </div>
    <footer><button type="button" className="btn outline" onClick={() => closeModal()}>Hủy</button>
      <button type="button" className="btn outline" title=".txt / .csv" onClick={dl}><Ico n="file" sz={16} /><span>TXT</span></button>
      <button type="button" className="btn outline" title=".xlsx" onClick={xls}><Ico n="grid" sz={16} /><span>XLSX</span></button>
      <button type="button" className="btn pri" title="Chép (Ctrl+Enter)" onClick={cp}><Ico n="copy" sz={16} /><span>{E.ids.length}</span></button></footer>
  </>;
}
