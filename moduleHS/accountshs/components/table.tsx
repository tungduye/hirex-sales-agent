"use client";

// Bảng dữ liệu AccountsHS: thanh công cụ (#bar), bảng ảo hoá (#tw), thanh chọn (#sel), menu chuột phải.
// Port của renderBar/renderBody/renderWindow/rowHtml/rowAll/cell…/renderSel/rowMenu + chọn dòng kéo chuột/ctrl/shift
// + cột "Cập nhật" r60 (hist_last) + độ rộng cột v5 + Loại (typePick) của v7.py. DOM/class giữ nguyên để CSS gốc áp đúng.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { CondKey, Field, HistLast, Id, Tab } from "../types";
import {
  TYPEIC, barCnt, baseRows, condsOf, deptOf, exportRows, getView, isTbl, kMeta, lookupSecret, lookupVal, neighbors, sortIds, stOf, tokLabel, treeOrder, visCols,
  type AccountX, type ExportFmt,
} from "../core/model";
import { GREY, HC, attStr, fmtD, fmtFull, isRich, linkHref, rel, rteText, sepCh, type Hue } from "../core/text";
import { Ico } from "./icons";
import { I, S, api, confirmBox, copyText, emit, jump, lzEnsure, mut, refreshView, savePref, store, useHs } from "./store";
import { closePop, openPop, showMenu, type MenuItem } from "./ui-kit";
import { FilterChips, openFlt } from "./table-filter";
import { openExport, openMass, openSheet } from "./forms";
import { deviceItems } from "./devices";
import { openBulk } from "./forms-bulk";
import { KIND, hlText, linkListPop, lpick, openDetail, openHist } from "./detail";
import { cellTV } from "./detail-text";
import { openGraph } from "./graph";
import { OvSwitch } from "./reports";
import { openOwlAuto } from "./owl-auto";
import { AttList } from "./attachments";

/* ───────── tiện ích chung ───────── */
const cvar = (k: string, v: string | number): CSSProperties => ({ [k]: v } as CSSProperties);
const run = (p: Promise<unknown>) => { p.catch(() => undefined); };
const sameK = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);
/** thụt lề cây owner trong menu (khoảng trắng không gộp như bản gốc) */
const indentNb = (n: number, s: string) => (n ? "  ".repeat(n) + "└ " : "") + s;
const TAB_NEUTRAL = "#667085";
const ownTint = (c?: string | null) => { const x = (c || "").toLowerCase(); return x && x !== TAB_NEUTRAL && x !== "#52525b" ? cvar("--c", x) : undefined; };
const tabTintStyle = (t: Tab) => ownTint(t.color);
const rect = (el: Element) => el.getBoundingClientRect();
const curTab = (): Tab | undefined => (typeof S.tab === "number" ? I.tab[S.tab] : undefined);
const canEdit = () => store.canEdit;
/** khoá cột từ data-k: id trường → số */
const asKey = (k: string): CondKey => (/^\d+$/.test(k) ? +k : (k as CondKey));

/* ───────── ghi dữ liệu ───────── */
const exportText = (ids: Id[], fmt: ExportFmt) => { const sp = sepCh(fmt.sep || "|"); return exportRows(S, I, ids, fmt).map((r) => r.join(sp)).join("\n"); };
function selLines(ids: Id[]) { const t = I.tab[I.acc[ids[0]].tab_id]; return exportText(ids, { use: t.fields.map((f) => f.id), sep: "|" }); }
/** xoá các dòng (hỏi xác nhận kèm số lượng) */
export async function delAccs(ids: Id[]) {
  if (!ids.length) return;
  if (await confirmBox(`Xóa ${ids.length} dòng?`)) { try { await mut("delete_accounts", { ids }); } catch { /* api đã báo lỗi */ } }
}


/* ───────── menu: trạng thái · owner · thiết bị · sao chép ───────── */
function statusItemsMulti(ids: Id[]): MenuItem[] {
  const g: Record<string, Id[]> = {}; for (const i of ids) { const a = I.acc[i]; if (a) (g[a.tab_id] ??= []).push(i); }
  const tabs = Object.keys(g), out: MenuItem[] = [];
  for (const tid of tabs) {
    const t = I.tab[+tid], xs = g[tid]; if (!t) continue;
    if (tabs.length > 1) out.push({ head: t.name });
    for (const s of t.statuses) out.push({ dot: s.color, label: s.label, check: xs.length > 0 && xs.every((i) => I.acc[i].status_id === s.id), fn: () => run(mut("status_set", { ids: xs, status_id: s.id })) });
  }
  return out;
}
/** r56: mọi bộ phận + owner của từng bộ phận; bấm bộ phận = về bộ phận đó, không owner */
function ownerItems(ids: Id[]): MenuItem[] {
  const cur = new Set(ids.map((i) => I.acc[i].dept_id)), out: MenuItem[] = [];
  const ds = S.meta.depts.slice().sort((a, b) => (cur.has(b.id) ? 1 : 0) - (cur.has(a.id) ? 1 : 0));
  ds.forEach((d, k) => {
    if (k) out.push({ sep: 1 });
    out.push({ icon: "folder", label: d.name, hint: "Bộ phận", check: ids.every((i) => I.acc[i].dept_id === d.id && !I.acc[i].owner_id), fn: () => run(mut("owner_set", { ids, owner_id: null, dept_id: d.id })) });
    for (const { o, d: dp } of treeOrder(I, d.id)) out.push({ dot: o.color, label: indentNb(dp + 1, o.name), hint: I.ownN[o.id] || 0, check: ids.every((i) => I.acc[i].owner_id === o.id), fn: () => run(mut("owner_set", { ids, owner_id: o.id })) });
  });
  out.push({ sep: 1 }, { icon: "x", label: "Bỏ owner", fn: () => run(mut("owner_set", { ids, owner_id: null })) });
  return out;
}
const fieldIc = (f: Field) => (f.type === "link" ? I.tab[f.link_tab ?? -1]?.icon || "link" : TYPEIC[f.type]);
function copyItems(ids: Id[]): MenuItem[] {
  const tabs = [...new Set(ids.map((i) => I.acc[i].tab_id))], items: MenuItem[] = [];
  const cp = (s: string) => void copyText(s);
  if (tabs.length === 1) {
    const t = I.tab[tabs[0]];
    items.push({ icon: "list", label: "Dòng đầy đủ", hint: "a|b|c", fn: () => cp(exportText(ids, { use: t.fields.map((f) => f.id), sep: "|" })) });
    for (const f of t.fields.slice(0, 12)) items.push({ icon: fieldIc(f), label: f.label, fn: () => cp(exportText(ids, { use: [f.id], sep: "|" })) });
    const last = S.ex[String(t.id)];
    if (last && last.use?.length) items.push({ sep: 1 }, { icon: "save", label: "Định dạng gần nhất", hint: last.use.slice(0, 3).map((x) => tokLabel(I, x)).join(last.sep || "|"), fn: () => cp(exportText(ids, last)) });
  } else items.push({ icon: "key", label: "Tên", fn: () => cp(exportText(ids, { use: ["label"], sep: "|" })) }, { icon: "list", label: "Tên | Loại | Trạng thái | Owner", fn: () => cp(exportText(ids, { use: ["label", "tab", "status", "owner"], sep: "|" })) });
  items.push({ sep: 1 }, { icon: "sliders", label: "Tùy chỉnh / Xuất…", fn: () => openExport(ids) });
  return items;
}
/** menu chuột phải trên dòng (áp cho các dòng đang chọn) */
export function rowMenu(x: number, y: number) {
  const ids = sortIds(S, S.sel).filter((i) => I.acc[i]); if (!ids.length) return;
  const one = ids.length === 1 ? I.acc[ids[0]] : null, nb = one ? neighbors(I, one.id) : [], ctx = S.ctx != null && I.acc[S.ctx] ? S.ctx : ids[0];
  showMenu(x, y, [
    { icon: "network", label: "Sơ đồ liên kết", fn: () => openGraph(ids) },
    ...(one ? [{ icon: "edit", label: "Sửa", fn: () => openSheet(one) }, { icon: "note", label: "Ghi chú", fn: () => cellTV(one, "note") }] : [{ icon: "sliders", label: "Sửa hàng loạt", hint: ids.length, fn: () => openMass(ids) }]),
    { icon: "zap", label: "Tự động hóa", sub: [{ icon: "owl", label: "Cú vọ", hint: ids.length > 1 ? ids.length : null, fn: () => openOwlAuto(ids) }] },
    { sep: 1 }, { icon: "copy", label: "Sao chép", sub: copyItems(ids) }, { icon: "tag", label: "Trạng thái", sub: statusItemsMulti(ids) }, { icon: "users", label: "Owner", sub: ownerItems(ids) }, { icon: "smartphone", label: "Thiết bị", sub: deviceItems(ids) },
    ...(nb.length ? [{ icon: "link", label: "Đi tới", sub: nb.map((i) => ({ icon: I.tab[I.acc[i].tab_id]?.icon || "link", label: I.acc[i].label, fn: () => jump(i) })) }] : []),
    ...(canEdit() ? [{ sep: 1 as const }, { icon: "trash", label: "Xóa", danger: true, fn: () => void delAccs(ids) }] : []),
    { sep: 1 }, { icon: "info", label: "Chi tiết", fn: () => openDetail(ctx) },
  ]);
}
/** Ctrl+A: chọn mọi dòng đang hiển thị */
export function selectAllView() { S.sel = new Set(S.view); emit(); }
/** nút Thêm: tab "Tất cả" → chọn tab trong menu; tab thường → mở form */
function addAct(el: HTMLElement) {
  if (S.tab === "all") { const r = rect(el); showMenu(r.left, r.bottom - 6, S.meta.tabs.map((t) => ({ icon: t.icon, label: t.name, fn: () => openSheet(undefined, t.id) }))); return; }
  const t = curTab(); if (t) openSheet(undefined, t.id);
}

/* ───────── r60: cột Cập nhật = thay đổi gần nhất (GET hist_last theo lô) ───────── */
const HL = { m: new Map<Id, { u: number; e: HistLast | null }>(), q: new Set<Id>(), t: 0, v: 0, ls: new Set<() => void>() };
const hlSub = (f: () => void) => { HL.ls.add(f); return () => { HL.ls.delete(f); }; };
const hlVer = () => HL.v;
/* Cài đặt › Xóa lịch sử phát "ahs:hist-clear" → bỏ bộ nhớ đệm cột "thay đổi gần nhất" */
if (typeof window !== "undefined") window.addEventListener("ahs:hist-clear", () => { HL.m.clear(); HL.q.clear(); HL.v++; for (const f of HL.ls) f(); });
function hlFlush() {
  clearTimeout(HL.t);
  HL.t = window.setTimeout(async () => {
    const ids = [...HL.q].filter((i) => I.acc[i]).slice(0, 300); HL.q.clear(); if (!ids.length) return;
    let r: Record<string, HistLast | null> = {};
    try { r = await api<Record<string, HistLast | null>>("hist_last?ids=" + ids.join(",")); } catch { /* lỗi: ghi rỗng để không gọi lại liên tục */ }
    for (const id of ids) { const a = I.acc[id]; if (a) HL.m.set(id, { u: a.updated, e: r[id] || null }); }
    HL.v++; for (const f of HL.ls) f();
  }, 80);
}

/* ───────── ô của bảng ───────── */
const Mini = ({ v }: { v: string }) => <button className="mini" onClick={(e) => { e.stopPropagation(); void copyText(v); }}><Ico n="copy" sz={13} /></button>;
function Rv({ k }: { k: string }) {
  const sh = S.reveal || S.rv.has(k);
  return <button className="mini" onClick={() => { if (S.rv.has(k)) S.rv.delete(k); else S.rv.add(k); emit(); }}><Ico n={sh ? "eyeoff" : "eye"} sz={13} /></button>;
}
function Badge({ ids, tab, edit }: { ids: Id[]; tab: Tab; edit?: { a: AccountX; f: Field } }) {
  if (!ids.length) return null;
  return <button className="inb" style={cvar("--c", tab.color)} title={`${ids.length} ${tab.name} — bấm để xem danh sách`} onClick={(e) => linkListPop(e.currentTarget, ids, edit ? { id: edit.a.id, f: edit.f.id } : undefined)}>
    <Ico n={tab.icon} sz={13} /><b>{ids.length}</b><span className="dots">{ids.slice(0, 4).map((i) => <i key={i} style={{ background: stOf(I, I.acc[i])?.color || GREY }} />)}</span></button>;
}
function OutCell({ a, f }: { a: AccountX; f: Field }) {
  const ids = (I.out[a.id]?.[f.id] || []).filter((i) => I.acc[i]), tt = I.tab[f.link_tab ?? -1];
  if (!tt) return <span className="ph"><Ico n="link" sz={13} /></span>;
  return ids.length ? <Badge ids={ids} tab={tt} edit={{ a, f }} /> : <button className="inb ept" title={`Thêm liên kết ${tt.name}`} onClick={() => lpick(a.id, f.id)}><Ico n={tt.icon} sz={13} /><span>Thêm liên kết</span></button>;
}
const groupBy = (ids: Id[]) => { const g: Record<number, Id[]> = {}; for (const i of ids) { const s = I.acc[i]; if (s) (g[s.tab_id] ??= []).push(s.id); } return Object.entries(g); };
const InCell = ({ a }: { a: AccountX }) => <>{groupBy((I.inn[a.id] || []).map((x) => x.src)).map(([tid, ids]) => I.tab[+tid] ? <Badge key={tid} ids={ids} tab={I.tab[+tid]} /> : null)}</>;
const OutAll = ({ a }: { a: AccountX }) => <>{groupBy(Object.values(I.out[a.id] || {}).flat()).map(([tid, ids]) => I.tab[+tid] ? <Badge key={tid} ids={ids} tab={I.tab[+tid]} /> : null)}</>;
/** định dạng hiển thị của ghi chú (data._fmt) — chỉ để biết có định dạng hay không */
function noteFmt(a: AccountX) {
  const plain = a.note || ""; if (isRich(plain)) return plain;
  const fm: unknown = (a.data as Record<string, unknown>)._fmt;
  const f = fm && typeof fm === "object" ? (fm as Record<string, unknown>).note : undefined;
  return typeof f === "string" && rteText(f) === plain ? f : plain;
}
function NoteCell({ a }: { a: AccountX }) {
  if (!a.note) return <span className="ph"><Ico n="note" sz={14} /></span>;
  const ls = rteText(a.note).split("\n");
  return <>{isRich(noteFmt(a)) ? <span className="rtm" title="Có định dạng"><Ico n="type" sz={11} /></span> : null}<span className="nt">{ls[0]}</span>{ls.length > 1 ? <em className="nl">+{ls.length - 1}</em> : null}</>;
}
function DepCell({ a }: { a: AccountX }) {
  const d = I.dpt[a.dept_id];
  return d ? <span className="dp" title={"Bộ phận: " + d.name}><i className="dot" style={{ background: d.color || GREY }} /><span>{d.name}</span></span> : null;
}
function OwnCell({ a }: { a: AccountX }) {
  const o = a.owner_id != null ? I.own[a.owner_id] : undefined;
  const open = (el: HTMLElement) => { const r = rect(el); showMenu(r.left, r.bottom - 4, ownerItems([a.id])); };
  if (!o) { const dp = I.dpt[a.dept_id];
    return <button className="own" title={dp ? "Bộ phận: " + dp.name + " · chưa gán owner" : "Chưa gán Owner"} onClick={(e) => open(e.currentTarget)}><span className="oi n"><Ico n="user" sz={14} /></span><span className="mut">Chưa gán</span></button>; }
  const up = o.path.slice(0, -1).map((i) => I.own[i]?.name || ""), pre = up.length ? up.join(" > ") + " > " : "";
  return <button className="own" title={"Owner: " + deptOf(S, o.dept_id).name + " > " + pre + o.name} onClick={(e) => open(e.currentTarget)}>
    <span className="oi" style={ownTint(o.color)} title={"Owner: " + o.path.map((i) => I.own[i]?.name || "").join(" / ")}><Ico n="user" sz={14} /></span>
    <span className="op">{pre ? <span className="opp">{pre}</span> : null}<span className="opn">{o.name}</span></span></button>;
}
function DevCell({ a }: { a: AccountX }) {
  const d = a.device_id != null ? I.dev[a.device_id] : undefined;
  return <button className="own" title={d ? d.name + " · " + d.serial : ""} onClick={(e) => { const r = rect(e.currentTarget); showMenu(r.left, r.bottom - 4, deviceItems([a.id])); }}>
    {d ? <><span className="ci" style={cvar("--c", "#0369a1")}><Ico n={KIND[d.kind] || "smartphone"} sz={12} /></span><span>{d.name}</span></> : <span className="ph"><Ico n="smartphone" sz={14} /></span>}</button>;
}
function Pill({ a }: { a: AccountX }) {
  const st = stOf(I, a);
  return <td className="c-st"><button className="pill" onClick={(e) => { const r = rect(e.currentTarget); showMenu(r.left, r.bottom - 4, statusItemsMulti([a.id])); }}><i className="dot" style={{ background: st?.color || GREY }} />{st?.label || "{Chưa có}"}<Ico n="chevd" sz={12} /></button></td>;
}
function Cell({ a, f, i }: { a: AccountX; f: Field; i: number }) {
  const v0 = a.data[String(f.id)], v = v0 ?? "", s = typeof v === "object" ? attStr(v) : String(v), k = a.id + ":" + f.id;
  let h: ReactNode = null;
  if (f.type === "file") return <td data-edit={f.id} className="c-att">{Array.isArray(v0) && v0.length ? <AttList list={v0} compact max={2} /> : null}</td>;
  if (f.type === "link") h = <OutCell a={a} f={f} />;
  else if (f.type === "lookup") {
    const lv = lookupVal(I, a, f), sec = lookupSecret(I, f), sh = S.reveal || S.rv.has(k);
    h = lv ? <><span className="lkv" title="Liên kết giá trị (tự lấy, chỉ đọc)"><Ico n="swap" sz={12} /><span className={`sec ${sec && !sh ? "mask" : ""}`}>{sec && !sh ? "••••••••" : lv.length > 48 ? lv.slice(0, 48) + "…" : lv}</span></span>{sec ? <Rv k={k} /> : null}<Mini v={lv} /></> : <span className="ph"><Ico n="swap" sz={13} /></span>;
  } else if (!v) h = null;
  else if (f.type === "secret") { const sh = S.reveal || S.rv.has(k); h = <><span className={`sec ${sh ? "" : "mask"}`}>{sh ? s : "••••••••"}</span><Rv k={k} /><Mini v={s} /></>; }
  else if (f.type === "url") h = <><a className="urlt" href={linkHref(s)} target="_blank" rel="noopener noreferrer" title="Mở link"><Ico n="external" sz={13} /><span>{s}</span></a><Mini v={s} /></>;
  else if (f.type === "select") h = <span className="tag">{s}</span>;
  else if (f.type === "date") h = fmtD(s);
  else h = <><span className={`txt ${i === 0 ? "prim" : ""}`}>{s}</span><Mini v={s} /></>;
  return <td data-edit={f.id}>{h}</td>;
}
function TimeCell({ a }: { a: AccountX }) {
  const c = HL.m.get(a.id), t = c && c.u === a.updated ? hlText(c.e) : null;
  if (!c || c.u !== a.updated) HL.q.add(a.id);
  return <td className={`c-time${t ? " hl" : ""}`} data-hid={a.id} title={(t ? t + "\n" : "") + fmtFull(a.updated) + " · nhấp đúp xem lịch sử"}>{t ? <span className="hlt">{t}</span> : null}<em>{rel(a.updated)}</em></td>;
}
function Tail({ a }: { a: AccountX }) {
  return <><td className="c-note" data-edit="note" title={rteText(a.note || "").slice(0, 300)}><NoteCell a={a} /></td><TimeCell a={a} />
    <td className="c-act">
      <button className="btn icon sm ghost" title="Sơ đồ" onClick={() => openGraph([a.id])}><Ico n="network" sz={15} /></button>
      <button className="btn icon sm ghost" title="Chi tiết" onClick={() => openDetail(a.id)}><Ico n="info" sz={15} /></button>
      <button className="btn icon sm ghost" title="Sửa" onClick={() => openSheet(a)}><Ico n="edit" sz={15} /></button>
    </td></>;
}
const RowChk = ({ on, id }: { on: boolean; id: Id }) => <td className="c-chk"><button className={`chk ${on ? "on" : ""}`} title="Chọn dòng" onClick={(e) => chkClick(id, e.shiftKey)}>{on ? <Ico n="check" sz={12} /> : null}</button></td>;
function RowTab({ a, ix, cols, hasIn, tt }: { a: AccountX; ix: number; cols: Field[]; hasIn: boolean; tt: Tab }) {
  const sel = S.sel.has(a.id), rc = +tt.tint && a.tab_id === tt.id ? stOf(I, a)?.color : null;
  return <tr data-id={a.id} tabIndex={0} data-ix={ix} style={rc ? cvar("--rt", rc) : undefined} className={`${sel ? "sel" : ""} ${S.focus === a.id ? "focus" : ""}`}>
    <RowChk on={sel} id={a.id} /><td className="c-idx">{ix + 1}</td><Pill a={a} /><td className="c-dep"><DepCell a={a} /></td><td className="c-own"><OwnCell a={a} /></td><td className="c-dev"><DevCell a={a} /></td>
    {cols.map((f, k) => <Cell key={f.id} a={a} f={f} i={k} />)}{hasIn ? <td className="c-in"><InCell a={a} /></td> : null}<Tail a={a} /></tr>;
}
function RowAll({ a, ix }: { a: AccountX; ix: number }) {
  const sel = S.sel.has(a.id), t = I.tab[a.tab_id];
  return <tr data-id={a.id} tabIndex={0} data-ix={ix} className={`${sel ? "sel" : ""} ${S.focus === a.id ? "focus" : ""}`}>
    <RowChk on={sel} id={a.id} /><td className="c-idx">{ix + 1}</td><Pill a={a} />
    <td className="c-ty" title={t?.name}><span className="ci" style={cvar("--c", t?.color || GREY)}><Ico n={t?.icon || "layers"} sz={13} /></span></td>
    <td data-edit="label"><span className="txt prim">{a.label}</span><Mini v={a.label} /></td>
    <td className="c-dep"><DepCell a={a} /></td><td className="c-own"><OwnCell a={a} /></td><td className="c-dev"><DevCell a={a} /></td>
    <td className="c-in"><OutAll a={a} /></td><td className="c-in"><InCell a={a} /></td><Tail a={a} /></tr>;
}

/* ───────── chọn dòng: kéo chuột / ctrl / shift ───────── */
interface Drag { a: number; cur: number; id: Id; base: Set<Id>; moved: boolean; chk: boolean; mode: "add" | "del"; shift: boolean; x: number; y: number; first?: boolean }
let DR: Drag | null = null, NOCLICK = false, DRT = 0;
const ROWSEL = "#tw tbody tr[data-id]";
const elOf = (t: EventTarget | null) => (t instanceof Element ? t : null);
function rowAt(x: number, y: number) { return elOf(document.elementFromPoint(x, y))?.closest<HTMLElement>(ROWSEL) ?? null; }
function applyDrag() { if (!DR) return; const v = S.view, lo = Math.min(DR.a, DR.cur), hi = Math.max(DR.a, DR.cur), s = new Set(DR.base); for (let i = lo; i <= hi; i++) { if (i < 0 || i >= v.length) continue; if (DR.mode === "del") s.delete(v[i]); else s.add(v[i]); } S.sel = s; emit(); }
function chkClick(id: Id, shift: boolean) {
  if (NOCLICK) return;
  if (shift && S.last != null) { const a = S.view.indexOf(S.last), b = S.view.indexOf(id); if (a >= 0 && b >= 0) for (const i of S.view.slice(Math.min(a, b), Math.max(a, b) + 1)) S.sel.add(i); }
  else if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
  S.last = id; emit();
}
function installSelect(): () => void {
  const md = (e: MouseEvent) => {
    if (e.button !== 0) return; const tg = elOf(e.target), tr = tg?.closest<HTMLElement>(ROWSEL); if (!tg || !tr) return;
    const isChk = !!tg.closest(".chk"); if (!isChk && tg.closest("button,input,select,textarea,a")) return;
    const id = +(tr.dataset.id || 0), ix = +(tr.dataset.ix || 0);
    if (S.focus != null) S.focus = null;
    DR = { a: ix, cur: ix, id, base: e.ctrlKey || e.metaKey || isChk ? new Set(S.sel) : new Set(), moved: false, chk: isChk, mode: isChk && S.sel.has(id) ? "del" : "add", shift: e.shiftKey, x: e.clientX, y: e.clientY };
  };
  const mm = (e: MouseEvent) => {
    if (!DR) return;
    if (!DR.moved) {
      if (Math.abs(e.clientX - DR.x) + Math.abs(e.clientY - DR.y) < 5) return;
      DR.moved = true; if (DR.shift && S.last != null) DR.a = S.view.indexOf(S.last); getSelection()?.removeAllRanges();
      DRT = window.setInterval(() => {
        const tw = document.getElementById("tw"); if (!tw || !DR) return; const r = tw.getBoundingClientRect(); let d = 0;
        if (DR.y < r.top + 50) d = -Math.max(6, (r.top + 50 - DR.y) / 3); else if (DR.y > r.bottom - 40) d = Math.max(6, (DR.y - r.bottom + 40) / 3);
        if (d) { tw.scrollTop += d; const t = rowAt(DR.x, Math.min(Math.max(DR.y, r.top + 45), r.bottom - 4)); if (t) { DR.cur = +(t.dataset.ix || 0); applyDrag(); } }
      }, 30);
    }
    DR.x = e.clientX; DR.y = e.clientY; const t = rowAt(e.clientX, e.clientY);
    if (t) { const c = +(t.dataset.ix || 0); if (c !== DR.cur || DR.first !== true) { DR.cur = c; DR.first = true; applyDrag(); } }
  };
  const mu = (e: MouseEvent) => {
    if (!DR) return; const d = DR; DR = null; clearInterval(DRT);
    if (d.moved) { NOCLICK = true; setTimeout(() => { NOCLICK = false; }, 0); S.last = S.view[d.cur] ?? S.last; emit(); return; }
    if (d.chk) return;
    if (e.shiftKey && S.last != null) { const a = S.view.indexOf(S.last), b = d.a; S.sel = new Set(e.ctrlKey || e.metaKey ? S.sel : []); if (a >= 0) for (const i of S.view.slice(Math.min(a, b), Math.max(a, b) + 1)) S.sel.add(i); else S.sel.add(d.id); }
    else if (e.ctrlKey || e.metaKey) { if (S.sel.has(d.id)) S.sel.delete(d.id); else S.sel.add(d.id); S.last = d.id; }
    else { if (S.sel.size === 1 && S.sel.has(d.id)) S.sel.clear(); else S.sel = new Set([d.id]); S.last = d.id; }
    emit();
  };
  const cm = (e: MouseEvent) => {
    const tr = elOf(e.target)?.closest<HTMLElement>(ROWSEL); if (!tr) return; e.preventDefault();
    const id = +(tr.dataset.id || 0); S.ctx = id;
    if (!S.sel.has(id)) { S.sel = new Set([id]); S.last = id; emit(); }
    rowMenu(e.clientX, e.clientY);
  };
  document.addEventListener("mousedown", md); document.addEventListener("mousemove", mm); document.addEventListener("mouseup", mu); document.addEventListener("contextmenu", cm);
  return () => { document.removeEventListener("mousedown", md); document.removeEventListener("mousemove", mm); document.removeEventListener("mouseup", mu); document.removeEventListener("contextmenu", cm); clearInterval(DRT); DR = null; };
}

/* ───────── bảng ảo hoá ───────── */
/** chiều cao dòng (đo lại theo theme sau khi vẽ) · vùng đệm (r: 14 dòng, chỉ dựng lại khi cách mép < 3 dòng) */
let VROWH = 46; const VBUF = 14;
const LZP = new Set<Id>();
const NO_ROWS: AccountX[] = [];
let VIEW_ROWS: AccountX[] | null = null, VIEW_SET = new Set<Id>(), SHOWN_N = -1;
/** ghi danh sách đang hiển thị ra S.view (dùng cho chọn/kéo/đếm). Trả về true khi tập dòng đổi (để vẽ lại #sel/#cnt). */
function viewSync(rows: AccountX[]): boolean {
  if (rows === VIEW_ROWS) return false;
  const ids = rows.map((a) => a.id), set = new Set(ids), changed = set.size !== VIEW_SET.size || ids.some((id) => !VIEW_SET.has(id));
  VIEW_ROWS = rows; S.view = ids; VIEW_SET = set; return changed;
}
/** bấm tiêu đề cột: tăng → giảm → bỏ sắp xếp */
function sortToggle(tab: string, key: CondKey) {
  const c = S.sort[tab];
  if (c && sameK(c.k, key)) { if (c.d === 1) c.d = -1; else delete S.sort[tab]; } else S.sort[tab] = { k: key, d: 1 };
  savePref(); emit();
}
const hlab: Record<Hue, string> = { g: "Tốt", w: "Cảnh báo", b: "Lỗi", n: "—" };
interface Head { k?: string; label?: string; icon?: string; cls?: string }

export function TableView() {
  useHs(); useSyncExternalStore(hlSub, hlVer, hlVer);
  const tw = useRef<HTMLDivElement>(null);
  const win = useRef<{ top: number; end: number; rows: AccountX[] | null; h: number }>({ top: -1, end: -1, rows: null, h: 0 });
  const raf = useRef(0);
  const [, setTick] = useState(0);
  const tab = S.tab, all = tab === "all", t = curTab();
  const lazyWait = !!t && !!+t.lazy && !S.lz.has(t.id);
  const rows: AccountX[] = lazyWait || (!all && !t) ? NO_ROWS : getView(S, I);
  // S.view cập nhật sau commit (trước layout effect dưới); tập dòng đổi → vẽ lại #sel/#cnt đã vẽ trước bảng
  useLayoutEffect(() => { if (viewSync(rows)) emit(); }, [rows]);

  const calc = (force: boolean) => {
    const el = tw.current, total = rows.length, H = el?.clientHeight || 600, st = el?.scrollTop || 0, w = win.current;
    const first = Math.floor(st / VROWH), last = Math.ceil((st + H) / VROWH);
    if (!force && w.top >= 0 && first >= w.top + 3 && last <= w.end - 3) return { top: Math.min(w.top, total), end: Math.min(w.end, total) };
    return { top: Math.max(0, Math.min(first - VBUF, total)), end: Math.min(total, Math.max(0, last + VBUF)) };
  };
  // cửa sổ hàng ảo hoá: đọc vị trí cuộn (DOM) + cửa sổ trước để giữ ổn định — có chủ đích, tránh 1 lần render thừa mỗi lần cuộn
  // eslint-disable-next-line react-hooks/refs -- ảo hoá bảng: tính cửa sổ hàng từ scrollTop/cửa sổ trước ngay trong render
  const wv = calc(win.current.rows !== rows || win.current.h !== VROWH);
  // eslint-disable-next-line react-hooks/refs -- ảo hoá bảng: nhớ cửa sổ vừa vẽ để onScroll so sánh (không dùng cho hiển thị)
  win.current = { ...wv, rows, h: VROWH };

  useEffect(() => installSelect(), []);
  useEffect(() => { const f = () => setTick((x) => x + 1); addEventListener("resize", f); return () => { removeEventListener("resize", f); cancelAnimationFrame(raf.current); }; }, []);
  useEffect(() => () => { VIEW_ROWS = null; SHOWN_N = -1; }, []);
  useEffect(() => {
    if (!lazyWait || !t || LZP.has(t.id)) return; LZP.add(t.id);
    lzEnsure(t.id).then((d) => { if (d) emit(); }).catch(() => undefined).finally(() => LZP.delete(t.id));
  }, [lazyWait, t]);
  useLayoutEffect(() => {
    const el = tw.current; if (!el) return; let again = false;
    const tr = el.querySelector<HTMLElement>("tbody tr[data-id]");
    if (tr) { const h = Math.round(tr.getBoundingClientRect().height); if (h >= 20 && h <= 90 && h !== VROWH) { VROWH = h; again = true; } }
    if (S.scrollTo != null) { const i = S.view.indexOf(S.scrollTo); if (i >= 0) { el.scrollTop = Math.max(0, i * VROWH - el.clientHeight / 2); again = true; } S.scrollTo = null; }
    if (S.scrollTop != null) { el.scrollTop = S.scrollTop; S.scrollTop = null; again = true; }
    if (HL.q.size) hlFlush();
    if (again) setTick((x) => x + 1);
    if (S.view.length !== SHOWN_N) { SHOWN_N = S.view.length; emit(); }
  });
  const onScroll = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; const nw = calc(false); if (nw.top !== win.current.top || nw.end !== win.current.end) setTick((x) => x + 1); });
  };
  const onDbl = (e: React.MouseEvent) => {
    const tg = elOf(e.target); if (!tg) return;
    const tm = tg.closest<HTMLElement>("td.c-time[data-hid]"); if (tm) { e.preventDefault(); openHist(+(tm.dataset.hid || 0)); return; }
    const td = tg.closest<HTMLElement>("td[data-edit]"); if (!td || tg.closest("button,a,input")) return;
    const a = I.acc[+(td.closest<HTMLElement>("tr")?.dataset.id || 0)]; if (!a) return;
    getSelection()?.removeAllRanges();
    const k = td.dataset.edit || ""; cellTV(a, k === "note" || k === "label" ? k : +k);
  };

  const so = S.sort[String(tab)], cd = condsOf(S);
  const sortBy = (k: string) => sortToggle(String(tab), asKey(k));
  let heads: Head[]; let cols: Field[] = [], hasIn = false;
  if (all) heads = [{ k: "status", label: "Trạng thái", icon: "tag", cls: "c-st" }, { k: "tab", label: "Loại", icon: "layers", cls: "c-ty" }, { k: "label", label: "Tên", icon: "key", cls: "pk" }, { k: "dept", label: "Bộ phận", icon: "folder", cls: "c-dep" }, { k: "owner", label: "Owner", icon: "users", cls: "c-own" }, { k: "device", label: "Thiết bị", icon: "smartphone", cls: "c-dev" }, { k: "outl", label: "Liên kết đi", icon: "lkout", cls: "c-in" }, { k: "links", label: "Liên kết đến", icon: "lkin", cls: "c-in" }, { k: "note", label: "Ghi chú", icon: "note" }, { k: "updated", label: "Cập nhật", icon: "clock" }];
  else if (t) {
    cols = visCols(S, t); hasIn = S.meta.tabs.some((x) => x.fields.some((f) => f.link_tab === t.id));
    heads = [{ k: "status", label: "Trạng thái", icon: "tag", cls: "c-st" }, { k: "dept", label: "Bộ phận", icon: "folder", cls: "c-dep" }, { k: "owner", label: "Owner", icon: "users", cls: "c-own" }, { k: "device", label: "Thiết bị", icon: "smartphone", cls: "c-dev" },
      ...cols.map((f): Head => (f.id === t.fields[0]?.id ? { k: String(f.id), label: f.label, icon: "key", cls: "pk" } : { k: String(f.id), label: f.label, icon: fieldIc(f) })),
      ...(hasIn ? [{ k: "links", label: "Liên kết đến", icon: "lkin", cls: "c-in" }] : []), { k: "note", label: "Ghi chú", icon: "note" }, { k: "updated", label: "Cập nhật", icon: "clock" }];
  } else heads = [];
  const n = S.view.length; let c = 0;
  if (S.sel.size) for (const id of S.sel) if (VIEW_SET.has(id)) c++;
  const allOn = n > 0 && c === n;
  const chkall = () => { if (allOn) for (const i of S.view) S.sel.delete(i); else for (const i of S.view) S.sel.add(i); emit(); };
  const chkmenu = (el: HTMLElement) => {
    const r = rect(el), g: Record<string, { c: string; l: string; ids: Id[] }> = {};
    for (const id of S.view) { const a = I.acc[id], s = a ? stOf(I, a) : undefined, h: Hue = s?.h || "n", k = all ? h : String(a?.status_id);
      (g[k] ??= { c: all ? HC[h] : s?.color || GREY, l: all ? hlab[h] : s?.label || "—", ids: [] }).ids.push(id); }
    showMenu(r.left, r.bottom, [
      { icon: "check", label: "Chọn tất cả", hint: S.view.length, fn: () => { S.sel = new Set(S.view); emit(); } },
      { icon: "x", label: "Bỏ chọn", fn: () => { S.sel.clear(); emit(); } },
      { icon: "swap", label: "Đảo chọn", fn: () => { const s = new Set<Id>(); for (const i of S.view) if (!S.sel.has(i)) s.add(i); S.sel = s; emit(); } },
      { sep: 1 }, { head: "Chọn theo trạng thái" }, ...Object.values(g).map((x): MenuItem => ({ dot: x.c, label: x.l, hint: x.ids.length, fn: () => { S.sel = new Set(x.ids); emit(); } })),
    ]);
  };
  // độ rộng cột (v5): style riêng theo tab, vị trí cột = nth-child
  const cw = S.cw[String(tab)] || {}, allHeads: Head[] = [{}, {}, ...heads, {}]; let css = "";
  const p = `.hs-acc #tw[data-t="${String(tab)}"] table.grid`;
  allHeads.forEach((h, i) => { const v = h.k != null ? cw[h.k] : 0; if (v) css += `${p} th:nth-child(${i + 1}),${p} td:nth-child(${i + 1}){width:${v}px;min-width:${v}px;max-width:${v}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`; });

  const { top, end } = wv, padTop = top * VROWH, padBot = Math.max(0, (rows.length - end) * VROWH);
  return <div className="tw" id="tw" data-t={String(tab)} ref={tw} onScroll={onScroll}>
    <table className="grid">
      <thead><tr>
        <th className="c-chk" style={{ cursor: "default" }}>
          <button className={`chk ${allOn ? "on" : c ? "part" : ""}`} title="Chọn / bỏ chọn tất cả" onClick={chkall}>{allOn ? <Ico n="check" sz={12} /> : c ? <b className="bar" /> : null}</button>
          <button className="chkcaret" title="Chọn nhanh theo trạng thái" onClick={(e) => { e.stopPropagation(); chkmenu(e.currentTarget); }}><Ico n="chevd" sz={12} /></button>
        </th>
        <th className="c-idx" style={{ cursor: "default" }} title="Số thứ tự"><Ico n="hash" sz={13} /></th>
        {heads.map((h) => <th key={h.k} className={h.cls || ""} data-k={h.k} onClick={() => sortBy(h.k!)}>
          {h.icon ? <Ico n={h.icon} sz={13} /> : null}{h.label ? <span>{h.label}</span> : null}{so && sameK(so.k, h.k) ? <Ico n={so.d > 0 ? "up" : "down"} sz={12} /> : null}
          {h.k === "links" || h.k === "outl" ? null : <button className={`thf ${cd.some((x) => sameK(x.k, h.k)) ? "on" : ""}`} title="Lọc cột" onClick={(e) => { e.stopPropagation(); openFlt(e.currentTarget, h.k); }}><Ico n="filter" sz={11} /></button>}
        </th>)}
        <th />
      </tr></thead>
      <tbody onDoubleClick={onDbl}>
        {padTop ? <tr className="vsp"><td colSpan={99} style={{ height: padTop }} /></tr> : null}
        {rows.slice(top, end).map((a, i) => all ? <RowAll key={a.id} a={a} ix={top + i} /> : t ? <RowTab key={a.id} a={a} ix={top + i} cols={cols} hasIn={hasIn} tt={t} /> : null)}
        {padBot ? <tr className="vsp"><td colSpan={99} style={{ height: padBot }} /></tr> : null}
      </tbody>
    </table>
    {lazyWait ? <div className="empty" role="status" aria-live="polite"><i className="ldr" /><span>Đang tải {t?.name}…</span></div>
      : rows.length ? null : <div className="empty"><Ico n="inbox" sz={30} />{canEdit() ? <button className="btn pri" data-a="add" onClick={(e) => addAct(e.currentTarget)}><Ico n="plus" sz={16} /><span>Thêm</span></button> : null}</div>}
    {css ? <style>{css}</style> : null}
  </div>;
}

/* ───────── #sel: thanh thao tác khi đang chọn ───────── */
export function SelBar() {
  useHs();
  const n = S.sel.size, on = n > 0 && isTbl(S);
  // số đã chọn gần nhất: giữ nội dung #sel trong lúc thanh trượt ẩn
  const [last, setLast] = useState(0);
  if (n && n !== last) setLast(n);
  const ids = () => sortIds(S, S.sel).filter((i) => I.acc[i]);
  const up = (el: HTMLElement, items: MenuItem[]) => { const r = rect(el); showMenu(r.left, r.top - 4, items); };
  return <div id="sel" className={on ? "on" : ""} aria-hidden={!on}>{last || n ? <>
    <span className="cnt"><Ico n="check" sz={15} />{n || last}</span><div className="vs" />
    <button className="btn icon" title="Trạng thái" onClick={(e) => up(e.currentTarget, statusItemsMulti(ids()))}><Ico n="tag" sz={16} /></button>
    <button className="btn icon" title="Owner" onClick={(e) => up(e.currentTarget, ownerItems(ids()))}><Ico n="users" sz={16} /></button>
    <button className="btn icon" title="Thiết bị" onClick={(e) => up(e.currentTarget, deviceItems(ids()))}><Ico n="smartphone" sz={16} /></button>
    <button className="btn icon" title="Sửa hàng loạt" onClick={() => openMass(ids())}><Ico n="sliders" sz={16} /></button>
    <button className="btn icon" title="Sơ đồ" onClick={() => openGraph(ids())}><Ico n="network" sz={16} /></button>
    <button className="btn icon" title="Sao chép" onClick={() => { const x = ids(); if (!x.length) return; const tabs = new Set(x.map((i) => I.acc[i].tab_id)); void copyText(tabs.size === 1 ? selLines(x) : exportText(x, { use: ["label", "tab", "status", "owner"], sep: "|" })); }}><Ico n="copy" sz={16} /></button>
    <button className="btn icon" title="Xuất / định dạng" onClick={() => openExport(ids())}><Ico n="download" sz={16} /></button>
    {canEdit() ? <button className="btn icon" title="Xóa" onClick={() => void delAccs(ids())}><Ico n="trash" sz={16} /></button> : null}
    <div className="vs" /><button className="btn icon" title="Bỏ chọn (Esc)" onClick={() => { S.sel.clear(); emit(); }}><Ico n="x" sz={16} /></button>
  </> : null}</div>;
}

/* ───────── #bar: thanh công cụ của tab bảng ───────── */
/** Tất cả: chuyển Tổng quan / Chi tiết (r70 ovSw) */
function QInput() {
  useHs();
  const [v, setV] = useState(S.q), [prev, setPrev] = useState(S.q), tm = useRef(0);
  if (S.q !== prev) { setPrev(S.q); setV(S.q); }
  useEffect(() => () => clearTimeout(tm.current), []);
  return <div className="search"><Ico n="search" sz={15} /><input className="in" id="q" placeholder="Tìm…  trường:giá trị  -loại trừ  ( / )" title={'field:giá trị · -loại trừ · "cụm chính xác"'} value={v} autoComplete="off"
    onChange={(e) => { const x = e.target.value; setV(x); clearTimeout(tm.current); tm.current = window.setTimeout(() => { setPrev(x); S.q = x; S.focus = null; refreshView(); }, 120); }}
    onKeyDown={(e) => { if (e.key === "Escape" && v) { e.stopPropagation(); clearTimeout(tm.current); setV(""); setPrev(""); S.q = ""; S.focus = null; refreshView(); } }} /></div>;
}
/** ẩn/hiện 1 cột của tab */
function colToggle(tab: Id, id: Id) { const h = S.hid[String(tab)] || []; S.hid[String(tab)] = h.includes(id) ? h.filter((x) => x !== id) : [...h, id]; savePref(); emit(); }
function ColsPop() {
  useHs(); const t = curTab(); if (!t) return null; const hid = S.hid[String(t.id)] || [];
  const tog = (id: Id) => colToggle(t.id, id);
  return <>{t.fields.map((f) => { const on = !hid.includes(f.id);
    return <button key={f.id} className="colrow" onClick={() => tog(f.id)}><span className={`chk ${on ? "on" : ""}`}>{on ? <Ico n="check" sz={12} /> : null}</span><Ico n={fieldIc(f)} sz={14} /><span>{f.label}</span></button>; })}</>;
}
function CwPop() {
  useHs(); const key = String(S.tab), w = S.cw[key] || {};
  const ths = [...document.querySelectorAll<HTMLElement>("#tw thead th[data-k]")];
  const set = (k: string, v: number) => { (S.cw[key] ??= {})[k] = v; savePref(); emit(); };
  return <>{ths.map((th) => { const k = th.dataset.k || "", m = kMeta(I, asKey(k)), cur = w[k] || Math.round(th.getBoundingClientRect().width);
    return <div key={k} className="cwr"><Ico n={m.i} sz={14} /><span>{m.l}</span><input type="range" min={40} max={480} step={5} value={cur} onChange={(e) => set(k, +e.target.value)} /><em>{cur}</em></div>; })}
    <div className="sep" /><button className="mi" onClick={() => { delete S.cw[key]; savePref(); emit(); }}><Ico n="undo" sz={15} /><span className="t">Mặc định</span></button></>;
}
/* Loại (tab "Tất cả"): popup chọn dùng chung pickPop/typePick */
const allTypeCounts = () => { const c: Record<number, number> = {}; for (const t of S.meta.tabs) c[t.id] = 0; for (const a of baseRows(S, I)) if (a.tab_id in c) c[a.tab_id]++; return c; };
const allHidden = () => { const L = S.meta.tabs.map((t) => t.id); return new Set(S.tf.size ? L.filter((x) => !S.tf.has(x)) : []); };
function setHidden(H: Set<Id>) { const L = S.meta.tabs.map((t) => t.id); S.tf = new Set(H.size ? (H.size >= L.length ? [-1] : L.filter((x) => !H.has(x))) : []); S.page = 1; savePref(); emit(); }
const PBox = ({ on, part }: { on: boolean; part?: boolean }) => <span className={`chk ${on ? "on" : part ? "part" : ""}`}>{on ? <Ico n="check" sz={12} /> : part ? <b className="bar" /> : null}</span>;
function TypePick() {
  useHs();
  const C = allTypeCounts(), L = S.meta.tabs.map((t) => t.id), H = allHidden(), G = new Set(L.filter((x) => !H.has(x))), k = G.size, all = k === L.length;
  const pick = (id: Id | "*") => { let N: Set<Id>; if (id === "*") N = new Set(G.size === L.length ? [] : L); else { N = new Set(G); if (N.has(id)) N.delete(id); else N.add(id); } setHidden(new Set(L.filter((x) => !N.has(x)))); };
  return <><div className="tpk-h"><span>Tab</span><em>{k}/{L.length}</em></div>
    <button className="colrow tpk-all" role="menuitemcheckbox" aria-checked={all} onClick={() => pick("*")}><PBox on={all} part={k > 0} /><span className="t">Tất cả loại</span><em className="r">{L.reduce((s, x) => s + (C[x] || 0), 0)}</em></button>
    <div className="sep" />
    <div className="tpk-l">{S.meta.tabs.map((t) => { const on = G.has(t.id);
      return <button key={t.id} className={`colrow ${on ? "" : "off"}`} role="menuitemcheckbox" aria-checked={on} onClick={() => pick(t.id)}><PBox on={on} /><span className="tpk-ic" style={tabTintStyle(t)}><Ico n={t.icon} sz={15} /></span><span className="t">{t.name}</span><em className="r">{C[t.id] || 0}</em></button>; })}</div></>;
}
function TypeBtn() {
  const [open, setOpen] = useState(false), st = useRef({ open: false, closedAt: 0, skip: false });
  const L = S.meta.tabs.map((t) => t.id), H = allHidden(), G = L.filter((x) => !H.has(x));
  const val = G.length === L.length ? "Tất cả" : G.length === 1 ? I.tab[G[0]]?.name || "" : G.length + "/" + L.length;
  return <button className={`btn outline cvt ${open ? "on" : ""} ${H.size ? "act" : ""}`} data-a="typepick" aria-haspopup="true" title="Lọc theo tab"
    onMouseDown={() => { st.current.skip = st.current.open || performance.now() - st.current.closedAt < 60; }}
    onClick={(e) => {
      if (st.current.skip) { st.current.skip = false; if (st.current.open) closePop(); return; }
      st.current.open = true; setOpen(true);
      openPop(e.currentTarget, <TypePick />, "tpk tp-type", () => { st.current.open = false; st.current.closedAt = performance.now(); setOpen(false); });
    }}>
    <Ico n="layers" sz={15} /><span>Loại</span><em className="gcnt">{val}</em><Ico n="chevd" sz={14} cls="cv" /></button>;
}

export function BarView({ extra }: { extra?: ReactNode }) {
  useHs();
  const t = curTab(), all = S.tab === "all";
  if (!all && !t) return null;
  const rows = baseRows(S, I), nf = condsOf(S).length;
  const cnt = !all ? barCnt(S, I, rows, "status_id") : {};
  return <>
    {all ? <OvSwitch /> : null}
    <QInput />
    <button className={`btn outline icon fbtn ${nf ? "on" : ""}`} data-a="flt" title="Lọc & sắp xếp (Ctrl+K)" onClick={(e) => openFlt(e.currentTarget)}><Ico n="filter" sz={16} /><span>Bộ lọc</span>{nf ? <b>{nf}</b> : null}</button>
    {extra}
    {all ? <TypeBtn /> : null}
    {S.devf != null ? <button className="chip on" onClick={() => { S.devf = null; S.page = 1; emit(); }}><Ico n="smartphone" sz={14} />{S.devf === -1 ? "∅" : I.dev[S.devf]?.name || ""}<Ico n="x" sz={12} /></button> : null}
    <div className="grow" />
    <button className="btn icon ghost" data-a="reveal" title="Hiện mật khẩu" onClick={() => { S.reveal = !S.reveal; savePref(); emit(); }}><Ico n={S.reveal ? "eye" : "eyeoff"} sz={16} /></button>
    {!all ? <>
      <button className="btn icon ghost" data-a="cols" title="Cột" onClick={(e) => openPop(e.currentTarget, <ColsPop />)}><Ico n="grid" sz={16} /></button>
      <button className="btn icon ghost" data-a="cw" title="Độ rộng cột" onClick={(e) => openPop(e.currentTarget, <CwPop />, "cwp")}><Ico n="resize" sz={16} /></button>
      {canEdit() && t ? <button className="btn outline" data-a="bulk" title="Thêm / cập nhật hàng loạt" onClick={() => openBulk(t.id)}><Ico n="bulkadd" sz={16} /><span>Nhập hàng loạt</span></button> : null}
    </> : null}
    {canEdit() ? <button className="btn pri" data-a="add" onClick={(e) => addAct(e.currentTarget)}><Ico n="plus" sz={16} /><span>Thêm</span></button> : null}
    {!all && t ? <div className="fchrow" id="fchrow" role="group" aria-label="Bộ lọc nhanh">
      <button className={`chip ${S.st.size ? "" : "on"}`} onClick={() => { S.st.clear(); refreshView(); }}><span>Tất cả trạng thái</span><em>{rows.length}</em></button>
      {t.statuses.map((s) => <button key={s.id} className={`chip ${S.st.has(s.id) ? "on" : ""}`} onClick={() => { if (S.st.has(s.id)) S.st.delete(s.id); else S.st.add(s.id); refreshView(); }}><i className="dot" style={{ background: s.color }} />{s.label}<em>{cnt[s.id] || 0}</em></button>)}
    </div> : null}
    <FilterChips />
  </>;
}
