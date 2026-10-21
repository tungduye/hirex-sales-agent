"use client";

// Hộp chi tiết dòng (#dbox) · cây "Thuộc quản lý" · panel xem nhanh (.hvp) · popup danh sách liên kết · lịch sử thay đổi (r60).
// Port của detailBody/openDetail (4835-4860), orgTreeHtml (bản cuối 6259), registry quan hệ relOf/relInText/treeHtml/hv* (5647-5703),
// ACT.linklist (5092) và openHist/hcLabel/hcVal (6884-6912) trong v7.py.
//
// #dbox và #gov (sơ đồ) là lớp nổi RIÊNG như bản gốc (không thay modal đang mở): vẽ bằng root React riêng, gắn ngay TRƯỚC
// host lớp nổi của ui-kit để sheet/modal mở sau (Sửa…) vẫn nằm trên, còn #dbox (.overlay.top, z 110) nằm trên modal.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Account, Field, HistChange, HistInfo, HistItem, HistLast, Id, Tab } from "../types";
import { TYPEIC, deptOf, lookupSecret, lookupVal, stOf, type AccountX } from "../core/model";
import { GREY, attStr, fmtD, fmtFull, rteText } from "../core/text";
import { Ico } from "./icons";
import { I, S, UI, api, copyText, jump, useHs } from "./store";
import { closePop, openModal, closeModal, openPop } from "./ui-kit";
import { RteView, fmtOf, openLinkPick, openSheet, saveAcc } from "./forms";
import { AttList, attList } from "./attachments";
import { openGraph } from "./graph";
import { aw } from "./settings";

export { cellTV } from "./detail-text";

const cssv = (o: Record<string, string | number | undefined>) => o as CSSProperties;
export const KIND: Record<string, string> = { phone: "smartphone", pc: "monitor", boxphone: "server" };

/* ───────── lớp nổi riêng: #dbox · #gov · .hvp ───────── */
type OvId = "dbox" | "gov" | "hvp";
const OV = new Map<OvId, { host: HTMLDivElement; root: Root; onClose?: () => void }>();
const curTheme = () => document.querySelector<HTMLElement>(".hs-acc[data-theme]:not(.hs-ovl)")?.dataset.theme;
function mkHost(): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "hs-acc hs-ovl";
  d.style.cssText = "height:0;min-height:0;background:none";
  const th = curTheme(); if (th) d.dataset.theme = th;
  const lh = document.querySelector("body > .hs-layer:not(.hs-ovl)");
  if (lh) document.body.insertBefore(d, lh); else document.body.appendChild(d);
  return d;
}
/** mở 1 lớp nổi riêng (đóng lớp cùng id trước) — dùng cho #dbox, #gov, .hvp */
export function openOverlay(id: OvId, node: ReactNode, onClose?: () => void) {
  closeOverlay(id); installGlobal();
  const host = mkHost(), root = createRoot(host);
  root.render(node);
  OV.set(id, { host, root, onClose });
}
export function closeOverlay(id: OvId): boolean {
  const o = OV.get(id); if (!o) return false;
  OV.delete(id); o.host.remove();
  setTimeout(() => o.root.unmount(), 0);
  o.onClose?.();
  return true;
}
export const overlayOpen = (id: OvId) => OV.has(id);

let installed = false;
function installGlobal() {
  if (installed || typeof window === "undefined") return; installed = true;
  // closeAll() gốc gỡ cả #gov/#dbox: bọc UI.closeAll (store.jump/setScope/navGo gọi qua đây)
  const prev = UI.closeAll;
  UI.closeAll = () => { hvHide(true); closeOverlay("dbox"); closeOverlay("gov"); prev(); };
  // Esc theo thứ tự gốc: popover → #dbox → #gov → modal/sheet (của ui-kit)
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    hvHide(true);
    if (document.querySelector(".hs-layer:not(.hs-ovl) .pop")) return;
    if (document.querySelector(".hs-layer:not(.hs-ovl) .overlay.top")) return;
    const top: OvId | null = OV.has("dbox") ? "dbox" : OV.has("gov") ? "gov" : null;
    if (!top) return;
    e.preventDefault(); e.stopPropagation(); closeOverlay(top);
  }, true);
  document.addEventListener("mousedown", (e) => { const t = e.target as HTMLElement | null; if (!t?.closest?.(".hvp")) hvHide(true); }, true);
  document.addEventListener("scroll", () => hvHide(true), true);
  addEventListener("ahs:theme", (e) => {
    const id = (e as CustomEvent<string>).detail;
    for (const o of OV.values()) { if (!id || id === "base") delete o.host.dataset.theme; else o.host.dataset.theme = id; }
  });
}

/* ───────── registry quan hệ (trường kiểu "link") ───────── */
export interface Rel { id: Id; unk: boolean; fwd: string; rev: string; custom: boolean; st: Tab | null; dt: Tab | null }
export function relOf(fid: Id): Rel {
  const f = I.field[fid];
  if (!f || f.type !== "link") return { id: fid, unk: true, fwd: "Liên kết chưa phân loại", rev: "Liên kết chưa phân loại", custom: false, st: null, dt: null };
  const rv = String(f.opts || "").trim();
  return { id: f.id, unk: false, fwd: f.label, rev: rv || "Là «" + f.label + "» của", custom: !!rv, st: I.tab[f.tab_id] || null, dt: f.link_tab != null ? I.tab[f.link_tab] || null : null };
}
export function relInText(r: Rel, n: number, tab: Tab | null | undefined) {
  const tn = tab ? tab.name : "dòng";
  if (r.unk) return `Được ${n} ${tn} liên kết (chưa phân loại)`;
  return r.custom ? `Được ${n} ${tn} · ${r.rev}` : `Được ${n} ${tn} dùng làm «${r.fwd}»`;
}
function relLines(a: Account) {
  const L: Array<{ d: string; t: string }> = [];
  for (const [fid, ids] of Object.entries(I.out[a.id] || {})) { const v = ids.filter((i) => I.acc[i]); if (!v.length) continue; const r = relOf(+fid); L.push({ d: aw().o + " Liên kết đi", t: `${r.fwd} · ${v.length} ${r.dt ? r.dt.name : "dòng"}` }); }
  const g: Record<string, { tab: Tab | undefined; rel: Rel; n: number }> = {};
  for (const x of I.inn[a.id] || []) { const s = I.acc[x.src]; if (!s) continue; const k = s.tab_id + ":" + x.f; (g[k] ??= { tab: I.tab[s.tab_id], rel: relOf(x.f), n: 0 }).n++; }
  for (const x of Object.values(g)) L.push({ d: aw().i + " Liên kết đến", t: relInText(x.rel, x.n, x.tab) });
  return L;
}

/* ───────── chip dòng (chip / relChip gốc) ───────── */
/** chip(id) gốc: bấm = nhảy tới dòng. */
export function LChip({ id }: { id: Id }) {
  const b = I.acc[id]; if (!b) return null;
  const t = I.tab[b.tab_id], s = stOf(I, b);
  return <button className="lchip" data-id={id} style={cssv({ "--c": t?.color })} aria-label={`${b.label} — ${t?.name || ""}${s ? ", " + s.label : ""}`} onClick={() => { closePop(); jump(id); }}>
    <span className="ci"><Ico n={t?.icon || "link"} sz={12} /></span><span>{b.label}</span><i className="dot" style={{ background: s?.color || GREY }} />
  </button>;
}
function RelChip({ id, from }: { id: Id; from: Id }) {
  const b = I.acc[id]; if (!b) return null;
  const t = I.tab[b.tab_id], s = stOf(I, b);
  const sh = from ? (I.inn[id] || []).filter((x) => x.src !== from).length : 0;
  return <button className="lchip" data-id={id} style={cssv({ "--c": t?.color })} onClick={() => { closePop(); hvHide(true); jump(id); }} onMouseEnter={() => hvShow(id)} onMouseLeave={hvLeave}>
    <span className="ci"><Ico n={t?.icon || "link"} sz={12} /></span><span>{b.label}</span><i className="dot" style={{ background: s?.color || GREY }} />
    {sh ? <i className="sh" title={`Còn ${sh} dòng khác cũng dùng dòng này`}>+{sh} dùng chung</i> : null}
  </button>;
}

/* ───────── cây "Thuộc quản lý" (orgTreeHtml bản cuối) ───────── */
export function OrgTree({ a }: { a: AccountX }) {
  const t = I.tab[a.tab_id], s = stOf(I, a), o = a.owner_id != null ? I.own[a.owner_id] : undefined, d = deptOf(S, a.dept_id);
  const ch = o ? o.path.map((i) => I.own[i]).filter(Boolean) : [];
  const row = (key: string, lv: number, ic: string, role: string, name: string, mut: boolean, cls = "", x?: ReactNode) =>
    <div key={key} className={`lt-r ${cls}`} role="listitem" style={cssv({ "--lv": lv })}>{lv ? <i className="br" /> : null}<span className="oi"><Ico n={ic} sz={14} /></span><span className="lt-k">{role}</span><b className={mut ? "mut" : ""}>{name}</b>{x}</div>;
  const up = ch.slice(0, -1), me = ch[ch.length - 1], lv = up.length + 1;
  return <div className="orgtree" role="list" aria-label="Thuộc quản lý">
    {row("d", 0, "briefcase", "Bộ phận", d.id ? d.name : "Chưa phân loại", !d.id)}
    {up.map((c, i) => row("u" + c.id, i + 1, "user", "Owner cấp trên", c.name, false))}
    <div className="lt-grp" role="group" aria-current="true" style={cssv({ "--lv": lv })}><i className="br" /><div className="lt-gin">
      {row("o", 0, "user", "Owner", me ? me.name : "Chưa phân loại", !me, "lt-own")}
      {row("a", 1, t?.icon || "user", t?.name || "", a.label, false, "leaf", <><i className="dot" style={{ background: s?.color || GREY }} /><span className="mut">{s?.label || "Chưa có trạng thái"}</span></>)}
    </div></div>
  </div>;
}

/* ───────── hộp chi tiết ───────── */
/** openDetail(id): mở hộp chi tiết (#dbox) — mọi trường kể cả cột ẩn, liên kết đi/đến, ghi chú, thiết bị, thời điểm. */
export function openDetail(id: Id) {
  if (!I.acc[id]) return;
  closePop(); hvHide(true);
  openOverlay("dbox", <div className="overlay c top" id="dbox" onMouseDown={(e) => { if (e.target === e.currentTarget) closeOverlay("dbox"); }}>
    <div className="modal dbox"><DetailBody id={id} /></div>
  </div>);
}
const fi = (f: Field) => (f.type === "link" ? (f.link_tab != null && I.tab[f.link_tab]?.icon) || "link" : TYPEIC[f.type]);
function DRow({ ic, l, tt, children }: { ic: string; l?: string; tt?: string; children: ReactNode }) {
  return <div className="dr"><span className="dl" title={tt}><Ico n={ic} sz={14} />{l ? <span>{l}</span> : null}</span><div className="dv">{children}</div></div>;
}
const CpBtn = ({ v }: { v: string }) => <button className="mini" style={{ opacity: 1 }} title="Chép giá trị" onClick={(e) => { e.stopPropagation(); void copyText(v); }}><Ico n="copy" sz={13} /></button>;

function DetailBody({ id }: { id: Id }) {
  useHs();
  const a = I.acc[id];
  useEffect(() => { if (!a) closeOverlay("dbox"); }, [a]);
  if (!a) return null;
  const t = I.tab[a.tab_id], s = stOf(I, a), dv = a.device_id != null ? I.dev[a.device_id] : undefined;
  if (!t) return null;
  const kv = t.fields.filter((f) => f.type !== "link").map((f) => {
    if (f.type === "file") { const L = attList(a.data[String(f.id)]); return L.length ? <DRow key={f.id} ic={fi(f)} l={f.label}><AttList list={L} compact={false} /></DRow> : null; }
    const lk = f.type === "lookup", v = lk ? lookupVal(I, a, f) : attStr(a.data[String(f.id)]);
    if (v == null || v === "") return null;
    const sh = !(f.type === "secret" || (lk && lookupSecret(I, f))) || S.reveal;
    return <DRow key={f.id} ic={fi(f)} l={f.label}><span className="vt">{sh ? (f.type === "date" ? fmtD(v) : v) : "••••••••"}</span><CpBtn v={v} /></DRow>;
  });
  const note = a.note ? fmtOf(a, "note") : "";
  // liên kết: tách rõ chiều gốc — mỗi vai trò (trường) là một nhóm riêng
  const outs = Object.entries(I.out[a.id] || {}).map(([fid, ids]) => [relOf(+fid), ids.filter((i) => I.acc[i])] as const).filter((x) => x[1].length);
  const gi: Record<string, Id[]> = {};
  for (const x of I.inn[a.id] || []) { const sa = I.acc[x.src]; if (sa) (gi[sa.tab_id + ":" + x.f] ??= []).push(x.src); }
  const inG = Object.entries(gi);
  const A = aw();
  return <>
    <header>
      <span className="ti" style={cssv({ "--c": t.color })}><Ico n={t.icon} sz={16} /></span><h3>{a.label}</h3>
      <span className="stchip" title="Trạng thái"><i className="dot" style={{ background: s?.color || GREY }} />{s?.label || "Chưa có trạng thái"}</span>
      <div className="grow" />
      <button className="btn icon ghost" title="Lịch sử thay đổi" onClick={() => { closeOverlay("dbox"); openHist(a.id); }}><Ico n="clock" sz={16} /></button>
      <button className="btn icon ghost" title="Sơ đồ liên kết" onClick={() => openGraph([a.id])}><Ico n="network" sz={16} /></button>
      <button className="btn icon ghost" title="Sửa" onClick={() => { closeOverlay("dbox"); void openSheet(a); }}><Ico n="edit" sz={16} /></button>
      <button className="btn icon ghost" title="Đóng" onClick={() => closeOverlay("dbox")}><Ico n="x" sz={16} /></button>
    </header>
    <div className="dflat">
      <section className="dorg" aria-label="Thuộc quản lý"><h4>Thuộc quản lý</h4><OrgTree a={a} /></section>
      <div className="dcard"><div className="dkv">
        {kv}
        {dv ? <DRow ic={KIND[dv.kind] || "smartphone"} l="Thiết bị"><span className="vt">{dv.name} <em className="mut">{dv.serial || ""}</em></span></DRow> : null}
        {note ? <DRow ic="note" l="Ghi chú"><span className="vt nt"><RteView v={note} /></span></DRow> : null}
        <DRow ic="clock" l="Tạo / cập nhật"><span className="vt">{fmtFull(a.created)} → {fmtFull(a.updated)}</span></DRow>
      </div></div>
      {outs.length || inG.length ? <div className="dlinks">
        {outs.length ? <section className="rsec" aria-label="Liên kết đi"><h4 title="Dòng này khai báo và sử dụng các dòng bên dưới (phụ thuộc vào chúng)"><b className="arw">{A.o}</b>Liên kết đi</h4>
          {outs.map(([r, ids]) => { const tt = r.dt, tn = tt ? tt.name : "dòng";
            return <div key={r.id} className="rg"><div className="rh"><Ico n={tt ? tt.icon : "link"} sz={15} /><span>{r.fwd}</span><em>{ids.length} {tn}</em></div><div className="rl">{ids.map((i) => <RelChip key={i} id={i} from={a.id} />)}</div></div>; })}
        </section> : null}
        {inG.length ? <section className="rsec" aria-label="Liên kết đến"><h4 title="Các dòng bên dưới khai báo dòng này — dòng này đang làm chủ / ảnh hưởng đến chúng"><b className="arw">{A.i}</b>Liên kết đến</h4>
          {inG.map(([k, ids]) => { const [tid, fid] = k.split(":"), tt = I.tab[+tid], r = relOf(+fid);
            return <div key={k} className="rg"><div className="rh"><Ico n={tt?.icon || "link"} sz={15} /><span>{relInText(r, ids.length, tt)}</span></div><div className="rl">{ids.map((i) => <RelChip key={i} id={i} from={0} />)}</div></div>; })}
        </section> : null}
      </div> : <div className="empty-s">Chưa có liên kết</div>}
    </div>
  </>;
}

/* ───────── panel xem nhanh (.hvp): chỉ ở popup danh sách liên kết + chip trong hộp chi tiết ───────── */
const HV: { key: Id; t: number; h: number; tok: number } = { key: 0, t: 0, h: 0, tok: 0 };
export function hvHide(now?: boolean) {
  clearTimeout(HV.t); clearTimeout(HV.h); HV.key = 0;
  const o = OV.get("hvp"); if (!o) return;
  if (now) { closeOverlay("hvp"); return; }
  const tok = ++HV.tok; o.host.querySelector(".hvp")?.classList.remove("on");
  setTimeout(() => { if (HV.tok === tok && OV.get("hvp") === o) closeOverlay("hvp"); }, 130);
}
function hvPanel(id: Id) {
  if (!I.acc[id]) return; if (OV.has("hvp") && HV.key === id) return;
  HV.tok++; HV.key = id;
  openOverlay("hvp", <HvPanel id={id} />);
}
export function hvLeave() { clearTimeout(HV.t); clearTimeout(HV.h); HV.h = window.setTimeout(() => hvHide(), 170); }
export function hvShow(id: Id) { clearTimeout(HV.h); clearTimeout(HV.t); HV.t = window.setTimeout(() => hvPanel(id), 130); }
function HvPanel({ id }: { id: Id }) {
  useHs();
  const [on, setOn] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, []);
  const a = I.acc[id]; if (!a) return null;
  const t = I.tab[a.tab_id], dv = a.device_id != null ? I.dev[a.device_id] : undefined; if (!t) return null;
  const kv = (k: string, key: string, v: string) => <div key={key} className="lt-d"><span className="k">{k}</span><span className="v">{v}</span></div>;
  const det: ReactNode[] = t.fields.filter((f) => f.type !== "link").slice(1).map((f) => {
    const lk = f.type === "lookup", raw = lk ? lookupVal(I, a, f) : a.data[String(f.id)];
    if (raw == null || raw === "" || (Array.isArray(raw) && !raw.length)) return null;
    const mask = (f.type === "secret" || (lk && lookupSecret(I, f))) && !S.reveal, v = attStr(raw);
    return kv(f.label, "f" + f.id, mask ? "••••••" : f.type === "date" ? fmtD(v) : v);
  });
  if (dv) det.push(kv("Thiết bị", "dv", dv.name + (dv.serial ? " · " + dv.serial : "")));
  if (a.note) det.push(kv("Ghi chú", "nt", rteText(a.note).split("\n")[0].slice(0, 80)));
  det.push(kv("Cập nhật", "up", fmtFull(a.updated)));
  const L = relLines(a);
  return <div className={`hvp ${on ? "on" : ""}`} onMouseEnter={() => clearTimeout(HV.h)} onMouseLeave={() => hvLeave()}>
    <div className="ltree"><div className="lt-h">Thuộc quản lý</div><OrgTree a={a} /><div className="lt-det">{det}</div>
      <div className="lt-rel">{L.length ? <>{L.slice(0, 6).map((l, i) => <div key={i} className="lt-q"><span className="dir">{l.d}</span><span title={l.t}>{l.t}</span></div>)}
        {L.length > 6 ? <div className="lt-q"><span className="dir" /><span className="mut">và {L.length - 6} quan hệ khác</span></div> : null}</>
        : <div className="lt-q"><span className="dir">Liên kết</span><span className="mut">Chưa có liên kết</span></div>}</div>
      <div className="lt-act"><button className="btn sm" onClick={() => { setTimeout(() => hvHide(true), 0); openDetail(id); }}>Mở chi tiết</button></div>
    </div>
  </div>;
}

/* ───────── popup danh sách liên kết (ACT.linklist) ───────── */
/** linkListPop(anchor, ids, edit?): danh sách dòng liên kết (bấm = nhảy tới); edit = {id: dòng, f: trường link} thêm nút sửa liên kết. */
export function linkListPop(anchor: HTMLElement, ids: Id[], edit?: { id: Id; f: Id }) {
  openPop(anchor, <LinkList ids={ids} edit={edit} />);
}
function LinkList({ ids, edit }: { ids: Id[]; edit?: { id: Id; f: Id } }) {
  useHs();
  return <>
    {ids.map((i) => { const b = I.acc[i]; if (!b) return null; const s = stOf(I, b);
      return <button key={i} className="mi lk2" data-id={i} onClick={() => { closePop(); hvHide(true); jump(i); }} onMouseEnter={() => hvShow(i)} onMouseLeave={hvLeave}>
        <span className="t lkl">{b.label}</span><i className="dot" style={{ background: s?.color || GREY }} /></button>; })}
    {edit ? <><div className="sep" /><button className="mi" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); closePop(); hvHide(true); lpick(edit.id, edit.f, { x: r.left, y: r.bottom }); }}><Ico n="edit" sz={15} /></button></> : null}
  </>;
}
/** lpick(aid, fid, anchor?): sửa liên kết của 1 ô kiểu link (pickLinks → saveAcc gốc). */
export function lpick(aid: Id, fid: Id, anchor?: HTMLElement | { x: number; y: number }) {
  const a = I.acc[aid], f = I.field[fid]; if (!a || !f || f.link_tab == null) return;
  void openLinkPick({ anchor, tab: f.link_tab, selected: I.out[a.id]?.[f.id] || [], multi: true, dept: a.dept_id, owner: a.owner_id,
    onPick: (ids: Id[]) => { const b = I.acc[aid]; if (b) void saveAcc(b, { links: { [String(fid)]: ids } }); } });
}

/* ───────── lịch sử thay đổi (r60) ───────── */
const HI: { v: HistInfo | null } = { v: null };
const STD_LBL: Record<string, string> = { status_id: "Trạng thái", owner_id: "Owner", dept_id: "Bộ phận", note: "Ghi chú", device_id: "Thiết bị" };
const STD_IC: Record<string, string> = { status_id: "tag", owner_id: "user", dept_id: "folder", note: "note", device_id: "smartphone" };
const fieldOf = (f: Id | string | undefined) => (f == null ? undefined : I.field[+f]);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
function hlFmtV(f: Id | string, v: unknown): string {
  if (v == null || v === "") return "∅";
  if (Array.isArray(v)) return v.length + " file";
  const F = fieldOf(f);
  if (F && (F.type === "secret" || String(F.type) === "password")) return "••••";
  if (F && F.type === "link") return String(v);
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/<[a-z]/i.test(s)) s = rteText(s);
  return oneLine(s);
}
export function hcLabel(c: HistChange) { return c.f != null ? fieldOf(c.f)?.label || "Trường " + c.f : STD_LBL[c.c || ""] || c.c || ""; }
export function hcVal(c: HistChange, v: unknown): string {
  if (c.f != null) return hlFmtV(c.f, v);
  if (v == null || v === "") return "∅";
  const n = Number(v);
  if (c.c === "status_id") return I.status[n]?.label || "#" + v;
  if (c.c === "owner_id") return I.own[n]?.name || "#" + v;
  if (c.c === "dept_id") return S.meta.depts.find((d) => d.id === n)?.name || "#" + v;
  if (c.c === "device_id") return S.devices.find((d) => d.id === n)?.name || "#" + v;
  if (c.c === "note") return oneLine(rteText(v));
  return String(v);
}
export const hcut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
/** hlText: 1 dòng tóm tắt thay đổi gần nhất (cột Cập nhật của bảng, từ GET hist_last). */
export function hlText(e: HistLast | null | undefined): string | null {
  if (!e) return null;
  if (e.k === "l+" || e.k === "l-") return (e.k === "l+" ? "+ " : "− ") + (fieldOf(e.f)?.label || "Liên kết") + ": " + ((e.t != null && I.acc[e.t]?.label) || "#" + e.t);
  const c = (e.ch || [])[0]; if (!c) return null;
  return hcLabel(c) + ": " + hcut(hcVal(c, c.a), 18) + " → " + hcut(hcVal(c, c.b), 24) + ((e.n || 0) > 1 ? ` (+${(e.n || 0) - 1})` : "");
}
/** openHist(id): hộp "Lịch sử thay đổi" của 1 dòng (GET hist?id=). */
export function openHist(id: Id) {
  if (!I.acc[id]) return;
  closePop();
  openModal(<HistView id={id} />, true, "hsm");
}
const hsTime = (ts: number) => new Date(ts * 1000).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
function HistView({ id }: { id: Id }) {
  useHs();
  const [d, setD] = useState<{ load: boolean; items: HistItem[] }>({ load: true, items: [] });
  useEffect(() => {
    let alive = true;
    (async () => {
      let items: HistItem[] = [];
      try { items = (await api<{ items: HistItem[] }>("hist?id=" + id)).items || []; } catch { /* api() đã báo lỗi */ }
      if (!HI.v) { try { HI.v = await api<HistInfo>("hist_info"); } catch { /* bỏ qua */ } }
      if (alive) setD({ load: false, items });
    })();
    return () => { alive = false; };
  }, [id]);
  const a = I.acc[id], t = a ? I.tab[a.tab_id] : undefined;
  const L: ReactNode[] = [];
  const row = (key: string, ts: number, ic: string, lab: string, body: ReactNode, cls = "") =>
    <div key={key} className={`hsr ${cls}`}><time title={fmtFull(ts)}>{hsTime(ts)}</time><span className="hsi"><Ico n={ic} sz={13} /></span><b>{lab}</b><span className="hsv">{body}</span></div>;
  const ab = (c: HistChange) => { const va = hcVal(c, c.a), vb = hcVal(c, c.b); return <><span className="hsa" title={va}>{hcut(va, 80)}</span><span className="hsar">→</span><span className="hsb" title={vb}>{hcut(vb, 120)}</span></>; };
  d.items.forEach((e, i) => {
    if (e.k === "new") L.push(row("n" + i, e.ts, "plus", "Tạo dòng", null, "hsn"));
    else if (e.k === "l+" || e.k === "l-") L.push(row("l" + i, e.ts, e.k === "l+" ? "link" : "x", fieldOf(e.f)?.label || "Liên kết", <span className={e.k === "l+" ? "hsb" : "hsa"}>{e.k === "l+" ? "Thêm" : "Bỏ"} {(e.t != null && I.acc[e.t]?.label) || "#" + e.t}</span>));
    else if (e.k === "u") (e.ch || []).forEach((c, j) => L.push(row(`u${i}.${j}`, e.ts, c.f != null ? TYPEIC[fieldOf(c.f)?.type || ""] || "edit" : STD_IC[c.c || ""] || "edit", hcLabel(c), ab(c))));
  });
  const hi = HI.v;
  return <>
    <header><span className="ti" style={cssv({ "--c": t?.color || GREY })}><Ico n="clock" sz={16} /></span><h3>Lịch sử thay đổi<small className="mut"> · {a?.label || "#" + id}</small></h3><div className="grow" /><button className="btn icon ghost" title="Đóng" onClick={() => closeModal()}><Ico n="x" sz={16} /></button></header>
    <div className="mbody hsl">{d.load ? <div className="ph pad"><i className="spin1" /></div> : L.length ? L : <div className="ph pad"><Ico n="inbox" sz={18} /><span>Chưa có thay đổi nào được ghi</span></div>}</div>
    <footer><span className="mut">{L.length} mục · {hi ? (hi.days ? "lưu " + hi.days + " ngày" : "lưu vĩnh viễn") : ""}</span><div className="grow" /><button className="btn outline" autoFocus onClick={() => closeModal()}>Đóng</button></footer>
  </>;
}
