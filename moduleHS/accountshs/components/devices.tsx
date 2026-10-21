"use client";

// Tab Thiết bị: thanh công cụ (tìm · Loại máy · Tình trạng · kiểu xem · Excel · thêm/hàng loạt) · dải tổng quan · thẻ / bảng 1 dòng/máy
// · phóng vào máy (FLIP) · form thiết bị / thêm hàng loạt. Port của v3 thiết bị (v7.py 5545-5640, ACT 5726-5740)
// + thiết kế lại 6476-6617 (dvBar/DVPICK/pickPop/dvInfo/devArt/dvCard/dvTable/dvZoom).
// Kèm các hàm dùng chung cho bảng (menu thiết bị của dòng, gán máy có kiểm tra giới hạn): deviceItems/assignDev/capOk/devOptList.
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type ReactNode } from "react";
import type { Device, DeviceKind, Id, Tab } from "../types";
import { deptOf, inScope, scoped, stOf, treeOrder, type OwnerX } from "../core/model";
import { COLL, GREY, TAB_NEUTRAL, fmtFull, indent } from "../core/text";
import { Ico } from "./icons";
import { I, S, apiBlob, confirmBox, copyText, download, emit, jump, lzEnsure, mut, navPush, savePref, toast, useHs } from "./store";
import { Combo, MoreBtn, closeModal, closePop, lim, openModal, openPop, useMore, type ComboOpt, type MenuItem } from "./ui-kit";

/* ───────── hằng số ───────── */
export const KIND: Record<string, string> = { phone: "smartphone", pc: "monitor", boxphone: "server" };
export const KINDS: DeviceKind[] = ["phone", "pc", "boxphone"];
export const DKLAB: Record<string, string> = { phone: "Điện thoại", pc: "Máy tính", boxphone: "Box phone" };
type DState = "over" | "full" | "free" | "idle";
const DSL: Record<DState, [string, string]> = { over: ["Vượt giới hạn", "danger"], full: ["Đầy", "warn"], free: ["Còn chỗ", "ok"], idle: ["Trống", "mut"] };
const DVSTATE2: Array<[DState, string]> = [["free", "Còn chỗ"], ["full", "Đầy"], ["over", "Vượt giới hạn"], ["idle", "Trống"]];
const cvar = (c: string) => ({ "--c": c } as CSSProperties);
const ownTint = (o: { color?: string }) => { const c = (o.color || "").toLowerCase(); return c && c !== TAB_NEUTRAL && c !== "#52525b" ? cvar(c) : undefined; };

/* ───────── trạng thái riêng của tab (DVS) ───────── */
type SortK = "name" | "serial" | "owner" | "load" | "state";
const DVS: { sort: { k: SortK; d: 1 | -1 } | null; fs: Set<string>; view: "card" | "list" } = {
  sort: null, fs: new Set(),
  view: (() => { try { return localStorage.getItem("ahs.dvview") === "list" ? "list" : "card"; } catch { return "card"; } })(),
};
const dvStateOk = (k: DState) => !DVS.fs.size || DVS.fs.has(k);

/* ───────── tính toán ───────── */
/** máy trong phạm vi đang xem + lọc loại máy + từ khoá #q */
export function devList(): Device[] {
  const s = S.q.toLowerCase().split(/\s+/).filter(Boolean);
  return S.devices.filter((d) => (S.dept === "all" || d.dept_id === S.dept) && (!I.scO || (d.owner_id != null && I.scO.has(d.owner_id))) && (!S.dk.size || S.dk.has(d.kind))
    && (!s.length || s.every((x) => (d.name + " " + d.serial + " " + d.note + " " + ((d.owner_id != null && I.own[d.owner_id]?.name) || "")).toLowerCase().includes(x))));
}
export interface DevTotals { used: number; cap: number; u: Record<Id, number>; over: boolean }
export function devTotals(d: Device): DevTotals {
  const u = I.devUse[d.id] || {}; let used = 0, cap = 0;
  for (const n of Object.values(u)) used += n;
  for (const c of Object.values(d.caps || {})) cap += +c || 0;
  return { used, cap, u, over: Object.entries(d.caps || {}).some(([t, c]) => +c > 0 && (u[+t] || 0) > +c) };
}
function devState(d: Device): { t: DevTotals; k: DState } { const t = devTotals(d), full = t.cap > 0 && t.used >= t.cap; return { t, k: t.over ? "over" : !t.used ? "idle" : full ? "full" : "free" }; }
function devStateCounts() { const c: Record<string, number> = { all: 0, free: 0, full: 0, over: 0, idle: 0 }; for (const d of devList()) { c.all++; c[devState(d).k]++; } return c; }
interface DvQ { tt: Tab; n: number; c: number; over: boolean }
interface DvInfo { d: Device; t: DevTotals; k: DState; pc: number; lab: string; tabs: DvQ[] }
function dvInfo(d: Device): DvInfo {
  const { t, k } = devState(d), left = t.cap ? Math.max(0, t.cap - t.used) : 0;
  return {
    d, t, k, pc: t.cap ? Math.min(100, (t.used / t.cap) * 100) : 0, lab: k === "free" && t.cap ? "Còn " + left + " chỗ" : DSL[k][0],
    tabs: S.meta.tabs.filter((tt) => (t.u[tt.id] || 0) || (+d.caps[tt.id] || 0)).map((tt) => { const n = t.u[tt.id] || 0, c = +d.caps[tt.id] || 0; return { tt, n, c, over: !!(c && n > c) }; }),
  };
}
const rpPct = (n: number, t: number) => (t ? Math.round((n / t) * 100) : 0);
const ownName = (id: Id | null) => (id != null && I.own[id]?.name) || "";

/* ───────── dùng chung với bảng: gán máy cho dòng ───────── */
/** kiểm tra giới hạn theo tab trước khi gán; vượt → hỏi xác nhận */
export async function capOk(items: Array<{ tab: Id; id?: Id }>, devId: Id): Promise<boolean> {
  const d = I.dev[devId]; if (!d) return true;
  const add: Record<string, number> = {};
  for (const x of items) if (!x.id || I.acc[x.id]?.device_id !== devId) add[x.tab] = (add[x.tab] || 0) + 1;
  const used = I.devUse[devId] || {};
  const over = Object.entries(add).filter(([t, n]) => { const c = +d.caps[t] || 0; return c > 0 && (used[+t] || 0) + n > c; });
  return !over.length || confirmBox(d.name + ": " + over.map(([t, n]) => `${I.tab[+t]?.name || ""} ${(used[+t] || 0) + n}/${d.caps[t]}`).join(" · "), "OK", "check", "pri");
}
export async function assignDev(ids: Id[], devId: Id | null) {
  if (devId && !(await capOk(ids.filter((i) => I.acc[i]).map((i) => ({ tab: I.acc[i].tab_id, id: i })), devId))) return;
  try { await mut("device_set", { ids, device_id: devId || null }); } catch { /* đã báo */ }
}
/** mục menu "Thiết bị" cho 1 hoặc nhiều dòng (ô c-dev, chuột phải, thanh chọn) */
export function deviceItems(ids: Id[]): MenuItem[] {
  const depts = new Set(ids.map((i) => I.acc[i]?.dept_id)), out: MenuItem[] = [];
  for (const d of S.devices.filter((x) => x.dept_id != null && depts.has(x.dept_id)).slice(0, 60)) {
    const t = devTotals(d);
    out.push({ icon: KIND[d.kind] || "smartphone", label: d.name, hint: t.cap ? `${t.used}/${t.cap}` : t.used, check: ids.every((i) => I.acc[i]?.device_id === d.id), fn: () => void assignDev(ids, d.id) });
  }
  if (!out.length) out.push({ icon: "inbox", label: "—", fn: () => undefined });
  out.push({ sep: 1 }, { icon: "x", label: "Bỏ thiết bị", fn: () => void assignDev(ids, null) });
  return out;
}
/** lựa chọn thiết bị cho Combo (form dòng): máy cùng bộ phận + máy đang chọn, kèm dùng/giới hạn */
export function devOptList(dept: Id | null, sel: Id | null): ComboOpt[] {
  return [{ v: "", t: "{Chưa gán}" }, ...S.devices.filter((d) => d.dept_id === dept || d.id === sel).map((d) => { const t = devTotals(d); return { v: String(d.id), t: d.name + (t.cap ? `  (${t.used}/${t.cap})` : "") }; })];
}
const ownerOpts = (dept: Id | null | undefined): ComboOpt[] => [{ v: "", t: "{Chưa gán}" }, ...(dept != null ? treeOrder(I, dept) : []).map(({ o, d }) => ({ v: String(o.id), t: indent(d, o.name) }))];

/* ───────── điều hướng: xem dòng của máy (devgo) ───────── */
function devgo(d: Id, t?: Id) {
  dvZoomClose(true); closePop();
  S.devf = d; S.tab = t ?? "all"; S.q = ""; S.st.clear(); S.tf.clear(); S.sel.clear(); S.page = 1; S.focus = null;
  savePref(); navPush(); emit();
  if (t != null) void lzEnsure(t).then((did) => { if (did) emit(); }, () => undefined);
}

/* ───────── Excel ───────── */
const xlsxName = (p: string) => { const d = new Date(), z = (n: number) => String(n).padStart(2, "0"); return p + "_" + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + "_" + z(d.getHours()) + z(d.getMinutes()); };
function dvSheets(): Record<string, Array<Array<string | number>>> {
  const all = devList().map((d) => ({ d, ...devState(d) })).filter((x) => dvStateOk(x.k)), tabs = S.meta.tabs;
  const sh: Record<string, Array<Array<string | number>>> = {};
  sh["Thiết bị"] = [["Tên", "Loại", "Serial", "Bộ phận", "Owner", "Đang dùng", "Giới hạn", "Tình trạng", ...tabs.flatMap((t) => [t.name + " (dùng)", t.name + " (giới hạn)"]), "Ghi chú"],
    ...all.map(({ d, t, k }) => [d.name, DKLAB[d.kind] || d.kind, d.serial, deptOf(S, d.dept_id).name, ownName(d.owner_id), t.used, t.cap || "", DSL[k][0], ...tabs.flatMap((tt) => [t.u[tt.id] || 0, +d.caps[tt.id] || ""]), d.note || ""])];
  sh["Chưa gắn máy"] = [["Loại", "Tên", "Trạng thái", "Owner", "Bộ phận"], ...scoped(S, I).filter((a) => inScope(S, I, a) && !(a.device_id && I.dev[a.device_id])).slice(0, 20000)
    .map((a) => [I.tab[a.tab_id]?.name || "", a.label, stOf(I, a)?.label || "", ownName(a.owner_id), deptOf(S, a.dept_id).name])];
  const dn: Record<string, number> = {}, rn: Record<string, number> = {};
  for (const { d, t } of all) if (d.owner_id) { dn[d.owner_id] = (dn[d.owner_id] || 0) + 1; rn[d.owner_id] = (rn[d.owner_id] || 0) + t.used; }
  sh["Theo owner"] = [["Owner", "Bộ phận", "Số máy", "Đang chạy"], ...Object.keys(dn).map((id) => I.own[+id]).filter((o): o is OwnerX => !!o).sort((a, b) => dn[b.id] - dn[a.id]).map((o) => [o.name, deptOf(S, o.dept_id).name, dn[o.id], rn[o.id]])];
  return sh;
}
async function dvxls() { const name = xlsxName("thiet-bi"); try { download(await apiBlob("xlsx", { name, sheets: dvSheets(), hdr: 1 }), name + ".xlsx"); } catch { /* đã báo */ } }

/* ───────── bộ chọn Loại máy / Tình trạng (pickPop dùng chung khung .tpk) ───────── */
interface PickItem { id: string; label: string; n: number; ic?: string; dot?: string }
interface Picker { cls: string; ic: string; label: string; title: string; all: string; items: () => PickItem[]; get: () => Set<string>; set: (g: Set<string>) => void; name: (k: string) => string }
const DVPICK: Picker[] = [
  {
    cls: "dvk-k", ic: "smartphone", label: "Loại máy", title: "Loại máy", all: "Tất cả loại máy",
    items: () => { const c: Record<string, number> = {}; for (const d of S.devices) c[d.kind] = (c[d.kind] || 0) + 1; return KINDS.map((k) => ({ id: k, label: DKLAB[k], n: c[k] || 0, ic: KIND[k] })); },
    get: () => new Set<string>(S.dk.size ? KINDS.filter((k) => S.dk.has(k)) : KINDS),
    set: (g) => { S.dk = new Set(g.size === KINDS.length ? [] : g.size ? g : ["-"]); },
    name: (k) => DKLAB[k] || k,
  },
  {
    cls: "dvk-s", ic: "tag", label: "Tình trạng", title: "Tình trạng", all: "Tất cả tình trạng",
    items: () => { const c = devStateCounts(); return DVSTATE2.map(([k, l]) => ({ id: k, label: l, n: c[k] || 0, dot: k })); },
    get: () => new Set<string>(DVS.fs.size ? DVSTATE2.map((x) => x[0]).filter((k) => DVS.fs.has(k)) : DVSTATE2.map((x) => x[0])),
    set: (g) => { DVS.fs = new Set(g.size === DVSTATE2.length ? [] : g.size ? g : ["-"]); },
    name: (k) => DSL[k as DState]?.[0] || k,
  },
];
const pickVal = (g: Set<string>, l: string[], name: (k: string) => string) => (g.size === l.length ? "Tất cả" : g.size === 1 ? name([...g][0]) : g.size + "/" + l.length);
const dvFiltered = () => DVPICK.some((p) => p.get().size !== p.items().length);
let PICK_OPEN: string | null = null;

const PkBox = ({ on, part }: { on: boolean; part: boolean }) => <span className={`chk ${on ? "on" : part ? "part" : ""}`}>{on ? <Ico n="check" sz={12} /> : part ? <b className="bar" /> : null}</span>;
const PkMark = ({ x }: { x: PickItem }) => x.dot ? <span className="tpk-ic"><i className={`dvs-d ${x.dot}`} /></span> : x.ic ? <span className="tpk-ic"><Ico n={x.ic} sz={15} /></span> : null;
function PickList({ p }: { p: Picker }) {
  useHs();
  const L = p.items(), G = p.get(), k = L.filter((x) => G.has(x.id)).length, all = k === L.length;
  const click = (id: string) => {
    const ids = p.items().map((x) => x.id), cur = p.get();
    let N: Set<string>;
    if (id === "*") N = new Set(cur.size === ids.length ? [] : ids);
    else { N = new Set(cur); if (N.has(id)) N.delete(id); else N.add(id); }
    p.set(N); emit();
  };
  return <>
    <div className="tpk-h"><span>{p.title}</span><em>{k}/{L.length}</em></div>
    <button className={`colrow tpk-all ${all ? "" : "off"}`} role="menuitemcheckbox" aria-checked={all} onClick={() => click("*")}><PkBox on={all} part={k > 0} /><span className="t">{p.all}</span><em className="r">{L.reduce((t, x) => t + (x.n || 0), 0)}</em></button>
    <div className="sep" />
    <div className="tpk-l">{L.map((x) => { const on = G.has(x.id); return <button key={x.id} className={`colrow ${on ? "" : "off"}`} role="menuitemcheckbox" aria-checked={on} onClick={() => click(x.id)}><PkBox on={on} part={false} /><PkMark x={x} /><span className="t">{x.label}</span><em className="r">{x.n}</em></button>; })}</div>
  </>;
}
function PickBtn({ p }: { p: Picker }) {
  const just = useRef(false);
  const L = p.items().map((x) => x.id), G = p.get();
  const open = (el: HTMLElement) => { PICK_OPEN = p.cls; openPop(el, <PickList p={p} />, "tpk " + p.cls, () => { if (PICK_OPEN === p.cls) PICK_OPEN = null; emit(); }); emit(); };
  return <button className={`btn outline cvt ${PICK_OPEN === p.cls ? "on" : ""} ${G.size !== L.length ? "act" : ""}`} aria-haspopup="true" title={"Lọc theo " + p.label.toLowerCase()}
    onPointerDown={() => { just.current = PICK_OPEN === p.cls; }}
    onClick={(e) => { if (just.current) { just.current = false; return; } if (PICK_OPEN === p.cls) { closePop(); return; } open(e.currentTarget); }}>
    <Ico n={p.ic} sz={15} /><span>{p.label}</span><em className="gcnt">{pickVal(G, L, p.name)}</em><Ico n="chevd" sz={14} cls="cv" />
  </button>;
}

/* ───────── #bar của tab Thiết bị ───────── */
function DevBar() {
  useHs();
  const [q, setQ] = useState(S.q);
  const sq = S.q;
  const [prevSq, setPrevSq] = useState(sq);
  if (sq !== prevSq) { setPrevSq(sq); setQ(sq); }
  useEffect(() => {
    if (q === S.q) return;
    const t = setTimeout(() => { S.q = q; S.page = 1; S.focus = null; savePref(); emit(); }, 120);
    return () => clearTimeout(t);
  }, [q]);
  return <>
    <div className="search"><Ico n="search" sz={15} /><input className="in" id="q" placeholder="Tìm tên máy, serial, owner…  ( / )" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} /></div>
    {DVPICK.map((p) => <PickBtn key={p.cls} p={p} />)}
    {dvFiltered() ? <button className="btn icon ghost" title="Bỏ lọc" aria-label="Bỏ lọc" onClick={dvClear}><Ico n="x" sz={15} /></button> : null}
    <div className="grow" />
    <div className="dvvw" role="group" aria-label="Kiểu hiển thị">{([["card", "grid", "Dạng thẻ"], ["list", "list", "Dạng bảng"]] as const).map(([v, ic, l]) =>
      <button key={v} className={DVS.view === v ? "on" : ""} aria-pressed={DVS.view === v} title={l} aria-label={l} onClick={() => dvSetView(v)}><Ico n={ic} sz={15} /></button>)}</div>
    <button className="btn icon ghost" title="Xuất danh sách thiết bị ra Excel" aria-label="Xuất Excel" onClick={() => void dvxls()}><Ico n="download" sz={16} /></button>
    <button className="btn outline" title="Thêm nhiều thiết bị cùng lúc" onClick={openDevBulk}><Ico n="bulkadd" sz={16} /><span>Thêm hàng loạt</span></button>
    <button className="btn pri" title="Thêm một thiết bị" onClick={() => openDevice(null)}><Ico n="plus" sz={16} /><span>Thêm</span></button>
  </>;
}
function dvSetView(v: "card" | "list") { DVS.view = v; try { localStorage.setItem("ahs.dvview", v); } catch { /* bộ nhớ trình duyệt bị khoá */ } emit(); }
function dvClear() { S.dk.clear(); DVS.fs.clear(); emit(); }

/* ───────── mảnh hiển thị ───────── */
const DvBarH = ({ p, cls = "" }: { p: number; cls?: string }) => <span className={`dvx-b ${cls}`}><i style={{ width: Math.max(0, Math.min(100, p)) + "%" }} /></span>;
const dvTone = (x: DvInfo) => (x.t.over || x.k === "full" ? "r" : "");
const DvStat = ({ x }: { x: DvInfo }) => <span className={`dvs2 ${x.k}`}><i className={`dvs-d ${x.k}`} />{x.lab}</span>;
function Avatar({ o }: { o: OwnerX | undefined }) {
  return o ? <span className="oi" style={ownTint(o)} title={"Owner: " + o.path.map((i) => I.own[i]?.name || "").join(" / ")}><Ico n="user" sz={14} /></span> : <span className="oi n" title="Chưa gán Owner"><Ico n="user" sz={14} /></span>;
}
/** hình máy vẽ bằng CSS: màn hình hiển thị tải */
function DevArt({ x, big }: { x: DvInfo; big?: boolean }) {
  const kind = KIND[x.d.kind] ? x.d.kind : "phone", t = x.t;
  return <span className={`dva ${kind} ${big ? "big" : ""}`} aria-hidden="true">
    {kind === "boxphone" ? <span className="dva-rk"><i /><i /><i /></span> : null}
    <span className="dva-s"><span className={`dva-f ${dvTone(x)}`} style={{ height: (t.cap ? x.pc : 0) + "%" }} /><span className="dva-n"><b>{t.used}</b>{t.cap ? <i>{"\u00a0/ " + t.cap}</i> : null}</span>
      {big ? <span className="dva-l">{t.cap ? Math.round((t.used / t.cap) * 100) + "% tải" : "không giới hạn"}</span> : null}</span>
    {kind === "pc" ? <span className="dva-st" /> : null}
  </span>;
}
function DvQBtn({ q, act }: { q: DvQ; act?: Id }) {
  const title = `${q.tt.name}: ${q.n}${q.c ? " / " + q.c : ""}${q.over ? " — vượt giới hạn" : ""}`;
  const inner = <><Ico n={q.tt.icon} sz={13} /><span><b>{q.n}</b>{q.c ? <i>/{q.c}</i> : null}</span></>;
  return act != null ? <button className={`dvq ${q.over ? "over" : ""} ${q.n ? "" : "z"}`} title={title} onClick={(e) => { e.stopPropagation(); devgo(act, q.tt.id); }}>{inner}</button>
    : <span className={`dvq ${q.over ? "over" : ""} ${q.n ? "" : "z"}`} title={title}>{inner}</span>;
}
const CopySerial = ({ v }: { v: string }) => <button className="mini" title="Chép serial" aria-label="Chép serial" onClick={(e) => { e.stopPropagation(); void copyText(v); }}><Ico n="copy" sz={12} /></button>;
/** chip một dòng (bấm → nhảy tới dòng) */
function AccChip({ id }: { id: Id }) {
  const b = I.acc[id]; if (!b) return null;
  const t = I.tab[b.tab_id], s = stOf(I, b);
  return <button className="lchip" style={cvar(t?.color || GREY)} aria-label={`${b.label} — ${t?.name || ""}${s ? ", " + s.label : ""}`} onClick={() => { dvZoomClose(true); jump(id); }}>
    <span className="ci"><Ico n={t?.icon || "user"} sz={12} /></span><span>{b.label}</span><i className="dot" style={{ background: s?.color || GREY }} /></button>;
}

/* ───────── DevicesView (#main) ───────── */
function sumCell(l: string, v: ReactNode, u: string, foot: ReactNode, go?: () => void) {
  const inner = <><span className="dvx-l">{l}</span><span className="dvx-v"><b>{v}</b>{u ? <em>{u}</em> : null}</span>{foot}</>;
  return go ? <button key={l} className="dvx-c lk" title="Xem dòng chưa gắn máy" onClick={go}>{inner}</button> : <div key={l} className="dvx-c">{inner}</div>;
}
export function DevicesView() {
  useHs(); useMore(); useZoom();
  useEffect(() => () => { if (DZ.id != null) { DZ.id = null; DZ.src = null; DZ.closing = false; } }, []);
  const A = scoped(S, I); let assigned = 0, unas = 0;
  for (const a of A) { if (a.device_id && I.dev[a.device_id]) assigned++; else unas++; }
  const all = devList(), st = all.map(dvInfo), cnt: Record<DState, number> = { free: 0, full: 0, over: 0, idle: 0 };
  for (const x of st) cnt[x.k]++;
  let list = st.filter((x) => dvStateOk(x.k));
  const so = DVS.sort;
  if (so) {
    const key = (x: DvInfo): string | number => so.k === "name" ? x.d.name : so.k === "serial" ? x.d.serial || "\uffff" : so.k === "owner" ? (ownName(x.d.owner_id) || "\uffff")
      : so.k === "load" ? (x.t.cap ? x.t.used / x.t.cap : x.t.used ? 2 : 0) : ["over", "full", "free", "idle"].indexOf(x.k);
    list = [...list].sort((a, b) => { const p = key(a), q = key(b); return (typeof p === "number" && typeof q === "number" ? p - q : COLL.compare(String(p), String(q))) * so.d; });
  }
  const shown = list.slice(0, lim("dv", 500));
  let U = 0, C = 0; for (const { t } of st) { U += t.used; if (t.cap) C += t.cap; }
  const tot = assigned + unas, cov = rpPct(assigned, tot), load = C ? Math.min(100, Math.round((U / C) * 100)) : 0, kc: Record<string, number> = {};
  for (const d of all) kc[d.kind] = (kc[d.kind] || 0) + 1;
  const warn = cnt.over ? <span className="dvx-n bad"><Ico n="alert" sz={13} />{cnt.over} vượt giới hạn</span> : cnt.full ? <span className="dvx-n bad">{cnt.full} máy đã đầy</span> : null;
  const kinds = KINDS.filter((k) => kc[k]);
  const sum = <div className="dvx">
    {sumCell("Thiết bị", all.length, "máy", <span className="dvx-s">{kinds.length ? kinds.map((k) => <span key={k} title={DKLAB[k]}><Ico n={KIND[k]} sz={13} />{kc[k]}</span>) : "—"}{warn}</span>)}
    {sumCell("Đang chạy", U, C ? `/ ${C} chỗ · ${load}%` : "", C ? <DvBarH p={load} cls={load >= 100 ? "r" : ""} /> : <span className="dvx-s">Chưa đặt giới hạn</span>)}
    {sumCell("Đã gắn máy", cov + "%", `${assigned} / ${tot} dòng`, <DvBarH p={cov} cls="g" />)}
    {sumCell("Chưa gắn máy", unas, "dòng", <span className="dvx-s">{unas ? <>Xem danh sách<Ico n="chevr" sz={13} /></> : "Tất cả đã có máy"}</span>, unas ? () => devgo(-1) : undefined)}
  </div>;
  const more = list.length > shown.length ? <div className="rp-more c"><MoreBtn k="dv" n={list.length - shown.length} step={500} label="máy nữa" /></div> : null;
  const empty = <div className="empty"><Ico n="smartphone" sz={30} />{S.devices.length
    ? <><span>Không có thiết bị phù hợp</span><button className="btn outline" onClick={dvClear}><Ico n="x" sz={15} /><span>Bỏ lọc</span></button></>
    : <button className="btn pri" onClick={() => openDevice(null)}><Ico n="plus" sz={16} /><span>Thêm</span></button>}</div>;
  return <div className="dvp dvp3">
    {sum}
    {!shown.length ? empty : DVS.view === "list" ? <><DvTable rows={shown} />{more}</> : <div className="dvcg">{shown.map((x) => <DvCard key={x.d.id} x={x} />)}{more}</div>}
    <DvZoom />
  </div>;
}
DevicesView.Bar = DevBar;

function DvCard({ x }: { x: DvInfo }) {
  const d = x.d, o = d.owner_id != null ? I.own[d.owner_id] : undefined;
  return <div className={`dvc ${x.k}`} tabIndex={0} role="button" data-id={d.id} aria-label={`${d.name} — ${x.lab}`}
    onClick={(e) => dvZoom(e.currentTarget, d.id)}
    onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); if (DZ.id == null) dvZoom(e.currentTarget, d.id); } }}>
    <div className="dvc-a"><DevArt x={x} /></div>
    <div className="dvc-b">
      <div className="dvc-h"><b>{d.name}</b><DvStat x={x} /></div>
      <div className="dvc-m">{o ? <><Avatar o={o} /><span>{o.name}</span></> : <><Ico n="user" sz={14} /><span>Chưa gán owner</span></>}</div>
      <div className="dvc-q">{x.tabs.length ? <>{x.tabs.slice(0, 4).map((q) => <DvQBtn key={q.tt.id} q={q} />)}{x.tabs.length > 4 ? <span className="dvq-m">+{x.tabs.length - 4}</span> : null}</> : <span className="dvc-e">Chưa có dòng nào</span>}</div>
    </div>
  </div>;
}

function DvTable({ rows }: { rows: DvInfo[] }) {
  const so = DVS.sort;
  const sortBy = (k: SortK) => { const c = DVS.sort; if (c && c.k === k) { if (c.d === 1) c.d = -1; else DVS.sort = null; } else DVS.sort = { k, d: 1 }; emit(); };
  const th = (k: SortK | null, ic: string, l: string, cls = "", w?: string) =>
    <th key={l} className={cls} style={w ? { width: w } : undefined} data-k={k ?? undefined} data-ns={k ? undefined : "1"} onClick={k ? () => sortBy(k) : undefined}>
      <Ico n={ic} sz={13} /><span>{l}</span>{so && k && so.k === k ? <Ico n={so.d > 0 ? "up" : "down"} sz={12} /> : null}</th>;
  return <div className="tw dvx-tw"><table className="grid">
    <thead><tr><th className="c-idx" data-ns="1" style={{ width: 52 }}><Ico n="hash" sz={13} /></th>
      {th("name", "smartphone", "Thiết bị", "", "16%")}{th("serial", "key", "Serial", "c-sn", "12%")}{th("owner", "users", "Owner", "", "15%")}
      {th(null, "briefcase", "Bộ phận", "c-dp", "10%")}{th("load", "activity", "Tải", "", "168px")}{th("state", "tag", "Tình trạng", "", "118px")}{th(null, "layers", "Phân bổ theo loại")}
      <th data-ns="1" style={{ width: 80 }} /></tr></thead>
    <tbody>{rows.map((x, ix) => {
      const d = x.d, o = d.owner_id != null ? I.own[d.owner_id] : undefined, dp = deptOf(S, d.dept_id), q = x.tabs;
      const qs = q.length > 5 ? <>{q.slice(0, 4).map((z) => <DvQBtn key={z.tt.id} q={z} act={d.id} />)}<span className="dvq-m">+{q.length - 4}</span></> : q.map((z) => <DvQBtn key={z.tt.id} q={z} act={d.id} />);
      return <tr key={d.id} data-dev={d.id} className={`dv-${x.k}`}>
        <td className="c-idx">{ix + 1}</td>
        <td><span className="dvr-n"><Ico n={KIND[d.kind] || "smartphone"} sz={15} /><b>{d.name}</b></span></td>
        <td className="dvr-sn c-sn">{d.serial ? <><code>{d.serial}</code><CopySerial v={d.serial} /></> : <span className="ph">—</span>}</td>
        <td>{o ? <span className="dvr-o"><Avatar o={o} /><span>{o.name}</span></span> : <span className="dvr-o mut"><Ico n="user" sz={14} /><span>Chưa gán</span></span>}</td>
        <td className="mut c-dp">{dp.id ? dp.name : "—"}</td>
        <td className="dvr-l"><span className="dvr-ln"><b className={x.t.over ? "neg" : ""}>{x.t.used}</b>{x.t.cap ? <i>{"\u00a0/ " + x.t.cap}</i> : null}</span>{x.t.cap ? <DvBarH p={x.pc} cls={dvTone(x)} /> : <span className="dvr-nl">Không giới hạn</span>}</td>
        <td><DvStat x={x} /></td><td className="dvr-q">{q.length ? qs : <span className="ph">—</span>}</td>
        <td className="c-act"><button className="btn icon sm ghost" title="Sửa" aria-label="Sửa thiết bị" onClick={() => openDevice(d)}><Ico n="edit" sz={15} /></button><button className="btn icon sm ghost" title="Xóa thiết bị" aria-label="Xóa thiết bị" onClick={() => void devDel(d.id)}><Ico n="trash" sz={15} /></button></td>
      </tr>;
    })}</tbody></table></div>;
}

async function devDel(id: Id) {
  const d = I.dev[id]; if (!d) return;
  const n = S.accs.filter((a) => a.device_id === d.id).length;
  if (await confirmBox(`"${d.name}"  ·  ${n}`)) { try { await mut("delete", { table: "devices", id: d.id }); toast("Đã xóa"); } catch { /* đã báo */ } }
}

/* ───────── phóng vào máy: thẻ → bảng chi tiết (FLIP) ───────── */
const DZ: { id: Id | null; src: HTMLElement | null; closing: boolean; v: number } = { id: null, src: null, closing: false, v: 0 };
const zLs = new Set<() => void>();
const zNotify = () => { DZ.v++; for (const f of zLs) f(); };
const useZoom = () => useSyncExternalStore((f) => { zLs.add(f); return () => { zLs.delete(f); }; }, () => DZ.v, () => DZ.v);
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export function dvZoom(src: HTMLElement | null, id: Id) {
  if (!I.dev[id]) return;
  dvZoomClose(true); closePop();
  DZ.id = id; DZ.src = src; DZ.closing = false; zNotify();
}
function zFinish() { DZ.id = null; DZ.src = null; DZ.closing = false; zNotify(); }
export function dvZoomClose(now?: boolean) {
  if (DZ.id == null || DZ.closing) return;
  const ov = document.getElementById("dvz");
  const src = DZ.src && DZ.src.isConnected ? DZ.src : document.querySelector<HTMLElement>(`.hs-acc .dvc[data-id="${DZ.id}"]`);
  if (!ov || now === true || reducedMotion() || !src) { zFinish(); return; }
  const P = ov.querySelector<HTMLElement>(".dvz-p"), Cn = ov.querySelector<HTMLElement>(".dvz-c"), bg = ov.querySelector<HTMLElement>(".dvz-bg");
  if (!P || !Cn || !bg) { zFinish(); return; }
  DZ.closing = true;
  const R = P.getBoundingClientRect(), r = src.getBoundingClientRect(), T = 260, ease = "cubic-bezier(.4,0,.2,1)";
  Cn.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" });
  bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T, fill: "forwards" });
  ov.style.pointerEvents = "none";
  P.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${r.left - R.left}px,${r.top - R.top}px) scale(${r.width / R.width},${r.height / R.height})`, opacity: 0.4 }], { duration: T, easing: ease, fill: "forwards" })
    .onfinish = () => { zFinish(); src.focus({ preventScroll: true }); };
}

function DvZoom() {
  useZoom(); useHs();
  const ref = useRef<HTMLDivElement>(null);
  const [extra, setExtra] = useState(0);
  const id = DZ.id, d = id != null ? I.dev[id] : undefined;
  // chỉ vẽ phía client (sau khi app nạp xong) → lớp nổi đã có sẵn trong DOM
  const [host] = useState<HTMLElement | null>(() => document.querySelector<HTMLElement>(".hs-acc.hs-layer") || document.querySelector<HTMLElement>(".hs-acc"));
  const [prevId, setPrevId] = useState(id);
  if (id !== prevId) { setPrevId(id); setExtra(0); }
  useEffect(() => { if (id != null && !d) zFinish(); }, [id, d]);
  /* Esc: đóng khi không có lớp nổi khác đang mở (modal/popover tự xử lý Esc của chúng) */
  useEffect(() => {
    if (id == null) return;
    const kd = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".hs-acc .overlay:not(.ca-out)") || document.querySelector(".hs-acc .pop:not(.ca-out)")) return;
      e.preventDefault(); e.stopImmediatePropagation(); dvZoomClose();
    };
    window.addEventListener("keydown", kd, true);
    return () => window.removeEventListener("keydown", kd, true);
  }, [id]);
  /* mở: nền + hình máy bay từ thẻ ra, thông tin hiện dần */
  useLayoutEffect(() => {
    const ov = ref.current; if (!ov || id == null) return;
    const P = ov.querySelector<HTMLElement>(".dvz-p"), Cn = ov.querySelector<HTMLElement>(".dvz-c"); if (!P || !Cn) return;
    const R = Cn.getBoundingClientRect();
    Object.assign(P.style, { left: R.left + "px", top: R.top + "px", width: R.width + "px", height: R.height + "px" });
    ov.querySelector<HTMLElement>("[data-a=dvzclose].btn")?.focus({ preventScroll: true });
    const src = DZ.src;
    if (reducedMotion() || !src || !src.isConnected) return;
    const r = src.getBoundingClientRect(), ease = "cubic-bezier(.2,.8,.2,1)", T = 340;
    P.animate([{ transform: `translate(${r.left - R.left}px,${r.top - R.top}px) scale(${r.width / R.width},${r.height / R.height})`, opacity: 0.6 }, { transform: "none", opacity: 1 }], { duration: T, easing: ease });
    ov.querySelector<HTMLElement>(".dvz-bg")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T, easing: "ease-out" });
    const sa = src.querySelector<HTMLElement>(".dva"), art = ov.querySelector<HTMLElement>(".dvz-art .dva");
    if (sa && art) {
      const a = sa.getBoundingClientRect(), b = art.getBoundingClientRect();
      art.animate([{ transform: `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px,${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(${a.width / b.width})` }, { transform: "none" }], { duration: T + 60, easing: ease });
    }
    const L = Cn.querySelector<HTMLElement>(".dvz-l");
    if (L) { const bg = getComputedStyle(L); L.animate([{ backgroundColor: "transparent", borderRightColor: "transparent" }, { backgroundColor: "transparent", borderRightColor: "transparent", offset: 0.4 }, { backgroundColor: bg.backgroundColor, borderRightColor: bg.borderRightColor }], { duration: T + 80, easing: "ease-out" }); }
    Cn.querySelectorAll<HTMLElement>(".dvz-r,.dvz-l>.dvs2").forEach((e) => e.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 0, offset: 0.45 }, { opacity: 1, transform: "none" }], { duration: T + 80, easing: "ease-out" }));
  }, [id, host]);
  if (id == null || !d || !host) return null;
  const x = dvInfo(d), o = d.owner_id != null ? I.own[d.owner_id] : undefined, dp = deptOf(S, d.dept_id), accs = S.accs.filter((a) => a.device_id === d.id);
  const kv = (ic: string, l: string, v: ReactNode) => <div key={l} className="dvz-kv"><span><Ico n={ic} sz={14} />{l}</span><div>{v}</div></div>;
  const lm = 60 + extra;
  return createPortal(<div id="dvz" data-id={d.id} ref={ref}>
    <div className="dvz-bg" onClick={() => dvZoomClose()} />
    <div className="dvz-p" />
    <div className="dvz-c" role="dialog" aria-modal="true" aria-label={d.name}>
      <div className="dvz-l"><div className="dvz-art"><DevArt x={x} big /></div><DvStat x={x} /></div>
      <div className="dvz-r">
        <header className="dvz-h"><span className="dvz-ki"><Ico n={KIND[d.kind] || "smartphone"} sz={16} /></span>
          <div className="dvz-tt"><h3>{d.name}</h3><span>{DKLAB[d.kind] || d.kind}{d.serial ? <> · <code>{d.serial}</code><CopySerial v={d.serial} /></> : null}</span></div><div className="grow" />
          <button className="btn icon ghost" title="Sửa thiết bị" aria-label="Sửa thiết bị" onClick={() => { dvZoomClose(true); openDevice(d); }}><Ico n="edit" sz={16} /></button>
          <button className="btn icon ghost" title="Xóa thiết bị" aria-label="Xóa thiết bị" onClick={() => { dvZoomClose(true); void devDel(d.id); }}><Ico n="trash" sz={16} /></button><span className="dvz-sep" />
          <button className="btn icon ghost" data-a="dvzclose" title="Đóng (Esc)" aria-label="Đóng" onClick={() => dvZoomClose()}><Ico n="x" sz={16} /></button></header>
        <div className="dvz-sc">
          <section><h4>Thông tin</h4><div className="dvz-g">
            {kv("users", "Owner", o ? <span className="dvr-o"><Avatar o={o} /><span>{o.name}</span></span> : <span className="mut">Chưa gán owner</span>)}
            {kv("briefcase", "Bộ phận", dp.id ? dp.name : <span className="mut">—</span>)}
            {kv("clock", "Thêm lúc", d.created ? fmtFull(d.created) : <span className="mut">—</span>)}
            {kv("note", "Ghi chú", d.note ? d.note : <span className="mut">—</span>)}
          </div></section>
          <section><h4>Sức chứa theo loại</h4><div className="dvz-caps">{x.tabs.length ? x.tabs.map((q) =>
            <button key={q.tt.id} className={`dvz-cap ${q.over ? "over" : q.c && q.n >= q.c ? "full" : ""}`} title={`Xem ${q.tt.name} trên máy này`} onClick={() => devgo(d.id, q.tt.id)}>
              <span className="dvz-ct"><Ico n={q.tt.icon} sz={14} /><span>{q.tt.name}</span></span>
              <span className="dvz-cn"><b>{q.n}</b>{q.c ? <i>{"\u00a0/ " + q.c}</i> : <em className="dvz-nl">không giới hạn</em>}</span>
              {q.c ? <DvBarH p={(q.n / q.c) * 100} cls={q.over || q.n >= q.c ? "r" : ""} /> : <span className="dvx-b z" />}
            </button>) : <div className="dvz-e">Chưa đặt giới hạn và chưa có dòng nào</div>}</div></section>
          <section><h4>Đang chạy trên máy<em>{accs.length}</em>{accs.length ? <button className="btn sm outline" onClick={() => devgo(d.id)}><Ico n="list" sz={14} /><span>Mở danh sách</span></button> : null}</h4>
            {accs.length ? <div className="dvz-ch">{accs.slice(0, lm).map((a) => <AccChip key={a.id} id={a.id} />)}
              {accs.length > lm ? <button className="btn sm ghost more" onClick={() => setExtra(extra + 300)}>+{(accs.length - lm).toLocaleString("vi")} nữa</button> : null}</div>
              : <div className="dvz-e">Chưa có dòng nào trên máy này</div>}</section>
        </div>
      </div>
    </div>
  </div>, host);
}

/* ───────── form thiết bị (openDevice) ───────── */
interface DvForm { id?: Id; name: string; serial: string; kind: DeviceKind; dept_id: Id | null; owner_id: Id | null; caps: Record<string, number>; note: string }
function defDept(): Id | null { if (S.dept !== "all") return S.dept; return (S.owner != null ? I.own[S.owner]?.dept_id : undefined) ?? S.meta.depts[0]?.id ?? null; }
const KindSeg = ({ cur, onPick }: { cur: DeviceKind; onPick: (k: DeviceKind) => void }) =>
  <div className="seg">{KINDS.map((k) => <button key={k} type="button" className={cur === k ? "on" : ""} title={DKLAB[k]} onClick={() => onPick(k)}><Ico n={KIND[k]} sz={16} /></button>)}</div>;
function Caps({ caps, onChange, onKeyDown }: { caps: Record<string, number>; onChange: (c: Record<string, number>) => void; onKeyDown?: (e: RKeyboardEvent<HTMLElement>) => void }) {
  return <>{S.meta.tabs.map((t) => <div key={t.id} className="mrow"><span className="ci" style={cvar(t.color)}><Ico n={t.icon} sz={13} /></span><span style={{ width: 110 }}>{t.name}</span>
    <input className="in" type="number" min={0} value={caps[t.id] || ""} placeholder="∞" onKeyDown={onKeyDown} onChange={(e) => { const n = +e.target.value, c = { ...caps }; if (n > 0) c[t.id] = n; else delete c[t.id]; onChange(c); }} /></div>)}</>;
}
const deptOpts = (): ComboOpt[] => S.meta.depts.map((d) => ({ v: String(d.id), t: d.name }));
/** Enter (ngoài textarea) = lưu */
const enterSave = (fn: () => void) => (e: RKeyboardEvent<HTMLElement>) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); fn(); } };

export function openDevice(d: Device | null) {
  const init: DvForm = { id: d?.id, name: d?.name || "", serial: d?.serial || "", kind: d?.kind || "phone", dept_id: d ? d.dept_id : defDept(), owner_id: d ? d.owner_id : S.owner ?? null, caps: { ...(d?.caps || {}) }, note: d?.note || "" };
  openModal(<DeviceForm init={init} />, false);
}
function DeviceForm({ init }: { init: DvForm }) {
  useHs();
  const [dv, setDv] = useState<DvForm>(init);
  const [busy, setBusy] = useState(false);
  const up = (p: Partial<DvForm>) => setDv((v) => ({ ...v, ...p }));
  const save = async () => {
    if (busy) return;
    if (!dv.name.trim()) { toast("Tên máy trống", "err"); return; }
    const { id, name, serial, kind, dept_id, owner_id, caps, note } = dv;
    setBusy(true);
    try { await mut("device", { id, name, serial, kind, dept_id, owner_id, caps, note }); closeModal(); toast("Đã lưu"); } catch { setBusy(false); }
  };
  const ent = enterSave(() => void save());
  return <>
    <header><span className="ti" style={cvar("#0284c7")}><Ico n={KIND[dv.kind]} sz={16} /></span><h3>{dv.name}</h3><div className="grow" /><button className="btn icon ghost" title="Đóng" onClick={() => closeModal()}><Ico n="x" sz={16} /></button></header>
    <div className="mbody" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="fld"><label><Ico n="type" sz={13} /></label><input className="in" value={dv.name} autoFocus autoComplete="off" onChange={(e) => up({ name: e.target.value })} onKeyDown={ent} /></div>
      <div className="fld"><label><Ico n="key" sz={13} /></label><input className="in" value={dv.serial} autoComplete="off" onChange={(e) => up({ serial: e.target.value })} onKeyDown={ent} /></div>
      <div className="fld"><KindSeg cur={dv.kind} onPick={(k) => up({ kind: k })} /></div>
      <div className="fld"><label><Ico n="folder" sz={13} /></label><Combo value={dv.dept_id != null ? String(dv.dept_id) : ""} opts={deptOpts()} onChange={(v) => up({ dept_id: +v, owner_id: null })} /></div>
      <div className="fld"><label><Ico n="users" sz={13} /></label><Combo value={dv.owner_id != null ? String(dv.owner_id) : ""} opts={ownerOpts(dv.dept_id)} onChange={(v) => up({ owner_id: v ? +v : null })} /></div>
      <div className="fld"><label><Ico n="layers" sz={13} /></label><Caps caps={dv.caps} onChange={(caps) => up({ caps })} onKeyDown={ent} /></div>
      <div className="fld"><label><Ico n="note" sz={13} /></label><textarea className="in" rows={3} value={dv.note} onChange={(e) => up({ note: e.target.value })} /></div>
    </div>
    <footer><button className="btn outline" onClick={() => closeModal()}>Hủy</button><button className="btn pri" disabled={busy} onClick={() => void save()}><Ico n="check" sz={16} /><span>Lưu</span></button></footer>
  </>;
}

/* ───────── thêm hàng loạt (openDevBulk) ───────── */
interface DbkForm { dept_id: Id | null; owner_id: Id | null; kind: DeviceKind; caps: Record<string, number>; text: string; prefix: string; count: number }
export function openDevBulk() {
  openModal(<DevBulkForm init={{ dept_id: defDept(), owner_id: S.owner ?? null, kind: "phone", caps: {}, text: "", prefix: "PH-", count: 10 }} />, false);
}
function DevBulkForm({ init }: { init: DbkForm }) {
  useHs();
  const [f, setF] = useState<DbkForm>(init);
  const [busy, setBusy] = useState(false);
  const up = (p: Partial<DbkForm>) => setF((v) => ({ ...v, ...p }));
  const gen = () => { const n = Math.min(500, Math.max(1, +f.count || 1)), ls: string[] = []; for (let i = 1; i <= n; i++) ls.push(f.prefix + String(i).padStart(2, "0") + "|"); up({ text: (f.text ? f.text.trimEnd() + "\n" : "") + ls.join("\n") }); };
  const go = async () => {
    if (busy) return;
    const rows = f.text.split(/\r?\n/).map((l) => l.split(/[|\t]/).map((x) => x.trim())).filter((p) => p[0]).map((p) => ({ name: p[0], serial: p[1] || "", kind: p[2] || "" }));
    if (!rows.length) return;
    const { dept_id, owner_id, kind, caps } = f;
    setBusy(true);
    try { const r = await mut<{ created: number }>("device_bulk", { dept_id, owner_id, kind, caps, rows }); closeModal(); toast("+" + r.created); } catch { setBusy(false); }
  };
  const n = f.text.split("\n").filter((x) => x.trim()).length;
  return <>
    <header><span className="ti" style={cvar("#0284c7")}><Ico n="bulkadd" sz={16} /></span><h3><Ico n="smartphone" sz={16} /></h3><div className="grow" /><button className="btn icon ghost" title="Đóng" onClick={() => closeModal()}><Ico n="x" sz={16} /></button></header>
    <div className="mbody" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="mrow">
        <input className="in" value={f.prefix} style={{ maxWidth: 120 }} autoComplete="off" onChange={(e) => up({ prefix: e.target.value })} onKeyDown={enterSave(gen)} />
        <input className="in" type="number" min={1} max={500} value={f.count} style={{ maxWidth: 90 }} onChange={(e) => up({ count: +e.target.value })} onKeyDown={enterSave(gen)} />
        <button className="btn outline" title="Sinh danh sách" onClick={gen}><Ico n="listplus" sz={16} /></button><div className="grow" /><KindSeg cur={f.kind} onPick={(k) => up({ kind: k })} />
      </div>
      <textarea className="in" id="dtext" rows={8} spellCheck={false} placeholder="name|serial|kind  (phone · pc · boxphone)" style={{ fontFamily: "inherit", fontSize: 12 }} value={f.text} onChange={(e) => up({ text: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void go(); } }} />
      <div className="mrow"><Combo value={f.dept_id != null ? String(f.dept_id) : ""} opts={deptOpts()} onChange={(v) => up({ dept_id: +v, owner_id: null })} /><Combo value={f.owner_id != null ? String(f.owner_id) : ""} opts={ownerOpts(f.dept_id)} onChange={(v) => up({ owner_id: v ? +v : null })} /></div>
      <div className="fld"><label><Ico n="layers" sz={13} /></label><Caps caps={f.caps} onChange={(caps) => up({ caps })} /></div>
    </div>
    <footer><button className="btn outline" onClick={() => closeModal()}>Hủy</button><button className="btn pri" disabled={busy || !n} onClick={() => void go()}><Ico n="check" sz={16} /><span>{n}</span></button></footer>
  </>;
}
