"use client";

// Bộ UI dùng chung của AccountsHS (giữ đúng class/CSS gốc): lớp nổi (popover · menu có menu con · modal · sheet · confirm · toast),
// combobox thay <select> trần, "+N nữa" cho danh sách dài. API mệnh lệnh (openPop/showMenu/openModal/openSheet/confirmBox)
// như bản cũ để các màn chuyển sang React không phải đổi luồng.
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Ico } from "./icons";
import { UI } from "./store";

/* ───────── lớp nổi ───────── */
type Anchor = HTMLElement | { x: number; y: number };
interface Layer { id: number; kind: "pop" | "sub" | "modal" | "sheet" | "confirm" | "toast"; node: ReactNode; cls?: string; anchor?: Anchor; onClose?: () => void; canClose?: () => Promise<boolean> | boolean; wide?: boolean }
const layers: Layer[] = []; let seq = 0; const ls = new Set<() => void>();
let snapshot: Layer[] = [];
const notify = () => { snapshot = [...layers]; for (const f of ls) f(); };
const sub = (f: () => void) => { ls.add(f); return () => { ls.delete(f); }; };
const getSnap = () => snapshot;
const add = (l: Omit<Layer, "id">) => { const id = ++seq; layers.push({ ...l, id }); notify(); return id; };
export function closeLayer(id: number) { const i = layers.findIndex((l) => l.id === id); if (i < 0) return; const [l] = layers.splice(i, 1); notify(); l.onClose?.(); }
const closeKind = (k: Layer["kind"]) => { for (const l of [...layers]) if (l.kind === k) closeLayer(l.id); };

/** popover gắn vào phần tử (hoặc toạ độ chuột) — đóng popover cũ, click ngoài để đóng. */
export function openPop(anchor: Anchor, node: ReactNode, cls = "", onClose?: () => void) { closePop(); return add({ kind: "pop", node, cls, anchor, onClose }); }
export function closePop() { closeKind("sub"); closeKind("pop"); }
export function openModal(node: ReactNode, wide = false, cls = "", canClose?: Layer["canClose"], onClose?: () => void) { closeKind("modal"); return add({ kind: "modal", node, wide, cls, canClose, onClose }); }
export function closeModal() { closeKind("modal"); }
export function openSheet(node: ReactNode, canClose?: Layer["canClose"], onClose?: () => void) { closeKind("sheet"); closePop(); return add({ kind: "sheet", node, canClose, onClose }); }
export function closeSheet() { closeKind("sheet"); }
export function closeAll() { closePop(); closeSheet(); closeModal(); }
export function confirmBox(msg: string, okLabel = "Xóa", ic = "trash", cls = "danger"): Promise<boolean> {
  return new Promise((res) => {
    const id = add({ kind: "confirm", node: null });
    const done = (v: boolean) => { closeLayer(id); res(v); };
    const l = layers.find((x) => x.id === id)!;
    l.node = <div className="modal sm"><div className="mbody"><p className="cmsg">{msg}</p></div><footer><button className="btn outline" onClick={() => done(false)}>Hủy</button><button className={"btn " + cls} onClick={() => done(true)}><Ico n={ic} sz={15} />{okLabel}</button></footer></div>;
    l.onClose = () => res(false);
    notify();
  });
}
/** toast: chỉ hiện lỗi (lưu/copy im lặng) — luật UI đã chốt. */
export function toast(msg: string, kind?: "err" | "ok") {
  if (kind !== "err") return;
  const id = add({ kind: "toast", node: <><Ico n="x" sz={15} /><span>{msg}</span></>, cls: "err" });
  setTimeout(() => closeLayer(id), 2600);
}
UI.toast = toast; UI.confirm = confirmBox; UI.closeAll = closeAll;

/** menu: items [{label, icon, dot, hint, check, danger, fn, sub:[…]}, {sep}, {head}] — menu con mở khi rê chuột. */
export interface MenuItem { label?: string; icon?: string; dot?: string; hint?: string | number | null; check?: boolean; danger?: boolean; fn?: () => void; sub?: MenuItem[]; sep?: boolean | 1; head?: string; __fast?: boolean }
export function showMenu(x: number, y: number, items: MenuItem[]) { return openPop({ x, y }, <Menu items={items} />); }
export function Menu({ items, root = true }: { items: MenuItem[]; root?: boolean }) {
  const t = useRef<number>(0);
  const openSubFor = (btn: HTMLElement, it: MenuItem) => { closeKind("sub"); add({ kind: "sub", node: <Menu items={it.sub!} root={false} />, anchor: btn }); };
  return <>{items.map((it, i) => it.sep ? <div key={i} className="sep" /> : it.head ? <div key={i} className="mh">{it.head}</div> :
    <button key={i} className={`mi ${it.danger ? "danger" : ""} ${it.sub ? "has" : ""}`}
      onMouseEnter={(e) => { clearTimeout(t.current); const el = e.currentTarget; if (it.sub) t.current = window.setTimeout(() => openSubFor(el, it), it.__fast ? 0 : 60); else t.current = window.setTimeout(() => closeKind("sub"), 90); }}
      onClick={(e) => { if (it.sub) { openSubFor(e.currentTarget, it); return; } closePop(); it.fn?.(); }}>
      {it.dot ? <i className="dot" style={{ background: it.dot }} /> : it.icon ? <Ico n={it.icon} sz={15} /> : null}<span className="t">{it.label}</span>
      {it.check ? <Ico n="check" sz={14} cls="r" /> : null}{it.hint != null ? <em>{String(it.hint)}</em> : null}{it.sub ? <Ico n="chevr" sz={14} cls="r" /> : null}
    </button>)}{root ? null : null}</>;
}

function Positioned({ layer, children }: { layer: Layer; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const place = useCallback(() => {
    const p = ref.current, a = layer.anchor; if (!p || !a) return;
    const r = "getBoundingClientRect" in a ? a.getBoundingClientRect() : { left: a.x, right: a.x, top: a.y, bottom: a.y };
    const w = p.offsetWidth, h = p.offsetHeight;
    let x: number, y: number;
    if (layer.kind === "sub") { x = r.right + 2; y = r.top - 5; if (x + w > innerWidth - 8) x = r.left - w - 2; if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8); }
    else { x = r.left; y = r.bottom + 6; if (x + w > innerWidth - 8) x = innerWidth - w - 8; if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6); }
    p.style.left = Math.max(8, x) + "px"; p.style.top = y + "px";
  }, [layer]);
  useLayoutEffect(() => { place(); const ro = new ResizeObserver(place); if (ref.current) ro.observe(ref.current); return () => ro.disconnect(); }, [place]);
  return <div ref={ref} className={`pop ${layer.kind === "sub" ? "sub" : ""} ${layer.cls || ""}`} data-layer={layer.id} onMouseDown={(e) => e.stopPropagation()}>{children}</div>;
}

/** Cập nhật handle mệnh lệnh (do nơi mở modal/sheet tạo ra, vd { dirty }) — gọi trong effect sau mỗi lần commit, không gọi trong render. */
export function bindHandle<T extends object>(h: T, v: Partial<T>) { Object.assign(h, v); }

/** Gắn 1 lần trong AccountsApp: vẽ mọi lớp nổi vào body (vẫn mang class .hs-acc để ăn CSS/theme). */
export function LayerHost({ theme }: { theme?: string }) {
  const list = useSyncExternalStore(sub, getSnap, getSnap);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  // lớp nổi gắn thẳng vào body: chỉ tạo được sau mount (phía client), rồi báo cho React vẽ portal vào đó
  // eslint-disable-next-line react-hooks/set-state-in-effect -- phần tử body tạo sau mount (tránh lệch hydrate SSR), cần 1 lần render lại để vẽ portal
  useEffect(() => { const d = document.createElement("div"); d.className = "hs-acc hs-layer"; document.body.appendChild(d); hostRef.current = d; setHost(d); return () => { hostRef.current = null; d.remove(); }; }, []);
  useEffect(() => { const h = hostRef.current; if (h) { if (theme) h.dataset.theme = theme; else delete h.dataset.theme; } }, [host, theme]);
  useEffect(() => {
    const md = (e: MouseEvent) => { const t = e.target as HTMLElement; if (t.closest?.(".pop[data-layer]") || t.closest?.(".dpc")) return; closePop(); };
    const kd = (e: KeyboardEvent) => { if (e.key !== "Escape") return; const top = layers[layers.length - 1]; if (!top || top.kind === "toast") return; if (top.kind === "pop" || top.kind === "sub") { closePop(); return; } void tryClose(top); };
    document.addEventListener("mousedown", md, true); document.addEventListener("keydown", kd);
    return () => { document.removeEventListener("mousedown", md, true); document.removeEventListener("keydown", kd); };
  }, []);
  if (!host) return null;
  const toasts = list.filter((l) => l.kind === "toast");
  return createPortal(<>
    {list.map((l) => {
      if (l.kind === "pop" || l.kind === "sub") return <Positioned key={l.id} layer={l}>{l.node}</Positioned>;
      if (l.kind === "modal") return <div key={l.id} className="overlay c" data-layer={l.id} onMouseDown={(e) => { if (e.target === e.currentTarget) void tryClose(l); }}><div className={`modal ${l.wide ? "wide" : ""} ${l.cls || ""}`}>{l.node}</div></div>;
      if (l.kind === "sheet") return <div key={l.id} className="overlay c" data-layer={l.id} onMouseDown={(e) => { if (e.target === e.currentTarget) void tryClose(l); }}><aside className="sheet">{l.node}</aside></div>;
      if (l.kind === "confirm") return <div key={l.id} className="overlay c top" style={{ zIndex: 150 }} data-layer={l.id} onMouseDown={(e) => { if (e.target === e.currentTarget) closeLayer(l.id); }}>{l.node}</div>;
      return null;
    })}
    <div id="toast">{toasts.map((t) => <div key={t.id} className={`toast ${t.cls || ""}`}>{t.node}</div>)}</div>
  </>, host);
}
async function tryClose(l: Layer) { if (l.canClose && !(await l.canClose())) return; closeLayer(l.id); }

/* ───────── "+N nữa" cho danh sách dài (lim / moreBtn / ACT.more) ───────── */
const MORE: Record<string, number> = {}; const moreLs = new Set<() => void>(); let moreV = 0;
export const lim = (k: string, n: number) => n + (MORE[k] || 0);
export function useMore() { return useSyncExternalStore((f) => { moreLs.add(f); return () => { moreLs.delete(f); }; }, () => moreV, () => moreV); }
export function MoreBtn({ k, n, step = 400, label = "nữa" }: { k: string; n: number; step?: number; label?: string }) {
  if (n <= 0) return null;
  return <button className="btn sm ghost more" onClick={() => { MORE[k] = (MORE[k] || 0) + step; moreV++; for (const f of moreLs) f(); }}>+{n.toLocaleString("vi")} {label}</button>;
}

/* ───────── combobox: mọi <select> trần đổi thành danh sách có tìm ───────── */
export interface ComboOpt { v: string; t: string; dis?: boolean }
export function Combo({ value, onChange, opts, className = "in", title, disabled, minWidth }: { value: string; onChange: (v: string) => void; opts: ComboOpt[]; className?: string; title?: string; disabled?: boolean; minWidth?: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  const cur = opts.find((o) => o.v === value);
  const open = () => { if (disabled) return; const el = ref.current!; openPop(el, <ComboList opts={opts} value={value} width={Math.max(el.offsetWidth, minWidth ?? 160)} onPick={(v) => { closePop(); if (v !== value) onChange(v); el.focus(); }} />, "cbx"); };
  return <button ref={ref} type="button" className={className + " cb"} title={title} disabled={disabled} onClick={open}
    onKeyDown={(e) => { if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); open(); } }}>
    <span className="t">{cur ? (cur.t.trim() === "" ? "{Để trống}" : cur.t) : value || ""}</span><Ico n="chevd" sz={13} />
  </button>;
}
function ComboList({ opts, value, width, onPick }: { opts: ComboOpt[]; value: string; width: number; onPick: (v: string) => void }) {
  const many = opts.length > 8; const [q, setQ] = useState(""); const [hl, setHl] = useState(Math.max(0, opts.findIndex((o) => o.v === value)));
  const vis = opts.filter((o) => !q || o.t.toLowerCase().includes(q)); const h = Math.min(hl, Math.max(0, vis.length - 1));
  const inp = useRef<HTMLInputElement>(null); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (many) inp.current?.focus(); else box.current?.focus({ preventScroll: true }); }, [many]);
  useEffect(() => { box.current?.querySelector(".hl")?.scrollIntoView({ block: "nearest" }); }, [h, q]);
  const kd = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { setHl(Math.min(vis.length - 1, h + 1)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setHl(Math.max(0, h - 1)); e.preventDefault(); }
    else if (e.key === "Enter") { if (vis[h] && !vis[h].dis) onPick(vis[h].v); e.preventDefault(); }
    else if (e.key === "Escape") { closePop(); e.stopPropagation(); }
  };
  return <div style={{ minWidth: width }} onKeyDown={kd} tabIndex={-1} ref={box}>
    {many ? <div className="psearch"><Ico n="search" sz={14} /><input ref={inp} className="in" autoComplete="off" value={q} onChange={(e) => { setQ(e.target.value.toLowerCase()); setHl(0); }} /></div> : null}
    <div className="cblist">{vis.length ? vis.map((o, k) => <button key={o.v + k} className={`mi ${o.v === value ? "on" : ""} ${k === h ? "hl" : ""}`} disabled={o.dis} onMouseMove={() => k !== h && setHl(k)} onClick={() => onPick(o.v)}><span className="t">{o.t.trim() === "" ? "{Để trống}" : o.t}</span>{o.v === value ? <Ico n="check" sz={14} cls="r" /> : null}</button>) : <div className="ph pad"><Ico n="inbox" sz={20} /></div>}</div>
  </div>;
}

/** ô tìm kiếm có icon */
export function Search({ value, onChange, placeholder, id, title, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; id?: string; title?: string; autoFocus?: boolean }) {
  return <div className="search"><Ico n="search" sz={15} /><input className="in" id={id} placeholder={placeholder} title={title} value={value} autoComplete="off" autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} /></div>;
}
/** nút công tắc .sw */
export const Switch = ({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title?: string }) => <button type="button" className={`sw ${on ? "on" : ""}`} title={title} aria-pressed={on} onClick={() => onChange(!on)} />;
/** ô chọn .chk */
export const Chk = ({ on, part, onClick, title }: { on: boolean; part?: boolean; onClick?: (e: React.MouseEvent) => void; title?: string }) => <button type="button" className={`chk ${on ? "on" : part ? "part" : ""}`} title={title} onClick={onClick}>{on ? <Ico n="check" sz={12} /> : part ? <b className="bar" /> : null}</button>;
/** chấm màu */
export const Dot = ({ c }: { c?: string | null }) => <i className="dot" style={{ background: c || "#a1a1aa" }} />;
/** 4 trạng thái: tải · rỗng (+1 nút) · lỗi · có dữ liệu */
export const Empty = ({ icon = "inbox", children }: { icon?: string; children?: ReactNode }) => <div className="empty"><Ico n={icon} sz={30} />{children}</div>;
