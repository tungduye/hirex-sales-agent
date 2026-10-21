"use client";

// Kho trạng thái của AccountsHS: S (trạng thái), I (chỉ mục), NAV (tới/lui), api/load/mut — port của phần JS trong v7.py.
// Mọi component đọc qua useHs(); hàm ghi gọi store.emit() (tương đương renderAll()).
import { useSyncExternalStore } from "react";
import type { Account, Delta, Id, Snapshot, TabRows } from "../types";
import { PREF_KEY, applyDelta, applyPref, buildIndex, emptyIndex, getView, initialState, prefSnapshot, scopeCalc, inScope, type Index, type State, type TabKey } from "../core/model";

export const API = "/api/hs/accountshs/";
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

type Listener = () => void;
class Store {
  S: State = initialState();
  I: Index = emptyIndex();
  NAV: { h: NavEntry[]; i: number; lock: boolean } = { h: [], i: -1, lock: false };
  /** GS: sơ đồ liên kết */
  GS: { roots: Id[] | null; depth: number; hide: Set<Id> } = { roots: null, depth: 2, hide: new Set() };
  booted = false; bootMsg = "Đang tải dữ liệu…"; error: string | null = null; busy = 0;
  /** quyền của người đang xem: canEdit = accounts.view · canManage = Quản trị viên */
  canEdit = false; canManage = false;
  private ls = new Set<Listener>(); private v = 0;
  subscribe = (fn: Listener) => { this.ls.add(fn); return () => { this.ls.delete(fn); }; };
  version = () => this.v;
  emit() { this.v++; for (const fn of this.ls) fn(); }
}
export interface NavEntry { ov?: boolean; tab: TabKey; dept: Id | "all"; owner: Id | null; focus: Id | null; devf: Id | null; scroll?: number; last?: Id | null; q?: string; st?: Id[]; tf?: Id[]; page?: number }
export const store = new Store();
export const S = store.S, I = store.I, NAV = store.NAV, GS = store.GS;
/** Re-render khi store đổi. */
export const useHs = () => useSyncExternalStore(store.subscribe, store.version, store.version);
export const emit = () => store.emit();

/* ───────── toast / confirm: do ui-kit đăng ký ───────── */
export const UI: { toast: (m: string, kind?: "err" | "ok") => void; confirm: (msg: string, okLabel?: string, ic?: string, cls?: string) => Promise<boolean>; closeAll: () => void } = {
  toast: (m, kind) => { if (kind === "err") console.error(m); }, confirm: async () => true, closeAll: () => undefined,
};
export const toast = (m: string, kind?: "err" | "ok") => UI.toast(m, kind);
export const confirmBox = (msg: string, okLabel = "Xóa", ic = "trash", cls = "danger") => UI.confirm(msg, okLabel, ic, cls);

/* ───────── API ───────── */
export async function api<R = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<R> {
  const r = await fetch(API + path, { method: body !== undefined ? "POST" : "GET", headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin", ...init });
  if (!r.ok) {
    let m = "Lỗi máy chủ"; try { m = (await r.json()).error || m; } catch { /* không phải JSON */ }
    toast(m, "err"); throw new ApiError(m, r.status);
  }
  return r.json() as Promise<R>;
}
/** tải file nhị phân (xlsx, backup, đính kèm) */
export async function apiBlob(path: string, body?: unknown): Promise<Blob> {
  const r = await fetch(API + path, { method: body !== undefined ? "POST" : "GET", headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  if (!r.ok) { let m = "Lỗi máy chủ"; try { m = (await r.json()).error || m; } catch { /* */ } toast(m, "err"); throw new ApiError(m, r.status); }
  return r.blob();
}
export function download(blob: Blob, name: string) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
export async function dlXlsx(name: string, rows: unknown[][], hdr = false) { download(await apiBlob("xlsx", { name, rows, hdr }), name + ".xlsx"); }

/* ───────── tuỳ chọn (localStorage) ───────── */
export function savePref() { try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...prefSnapshot(S), gd: GS.depth, gh: [...GS.hide] })); } catch { /* bộ nhớ trình duyệt có thể bị khoá */ } }
export function loadPref() {
  try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || localStorage.getItem("accmgr.v1") || "{}"); applyPref(S, p); GS.depth = p.gd || 2; GS.hide = new Set(p.gh || []); } catch { /* bỏ qua */ }
}

/* ───────── nạp dữ liệu ───────── */
const lzParam = () => (S.lz.size ? "&lz=" + [...S.lz].join(",") : "");
function afterLoad() {
  buildIndex(S, I);
  if (S.dept !== "all" && !S.meta.depts.find((x) => x.id === S.dept)) { S.dept = "all"; S.owner = null; }
  if (S.owner != null && !I.own[S.owner]) S.owner = null;
  scopeCalc(S, I);
  if (!["graph", "report", "all", "device"].includes(String(S.tab)) && !(typeof S.tab === "number" && I.tab[S.tab])) S.tab = S.meta.tabs.length ? "all" : null;
  S.sel = new Set([...S.sel].filter((id) => I.acc[id]));
  DET.clear();
}
/** load(full): lần đầu / sau thao tác lớn tải toàn bộ, còn lại chỉ lấy phần thay đổi (delta theo updated). */
export async function load(full = false) {
  const delta = !full && S.ts && S.accs.length;
  const d = await api<Snapshot | Delta>((delta ? "delta?since=" + S.ts : "data?x=1") + lzParam());
  S.meta = d.meta; S.devices = d.devices || []; S.ts = d.ts;
  if ("delta" in d && d.delta) applyDelta(S, d); else { S.accs = d.accounts; S.links = d.links; }
  // tab "tải riêng" đã nạp trước đó nhưng giờ đã tắt lazy → bỏ khỏi danh sách
  for (const id of [...S.lz]) if (!S.meta.tabs.find((t) => t.id === id && t.lazy)) S.lz.delete(id);
  afterLoad();
  // đang đứng ở tab tải riêng chưa nạp (vừa mở app / vừa bật tính năng) → nạp luôn
  if (typeof S.tab === "number" && I.tab[S.tab]?.lazy && !S.lz.has(S.tab)) await lzEnsure(S.tab);
}
/** Tab "tải riêng": nạp dòng của tab khi người dùng mở lần đầu. */
const LZ = new Map<Id, Promise<boolean>>();
export function lzEnsure(tab: Id): Promise<boolean> {
  const t = I.tab[tab]; if (!t || !t.lazy || S.lz.has(tab)) return Promise.resolve(false);
  let p = LZ.get(tab);                                         // chống nạp trùng (setTab + TableView cùng gọi)
  if (!p) { p = lzLoad(tab).finally(() => LZ.delete(tab)); LZ.set(tab, p); }
  return p;
}
async function lzLoad(tab: Id): Promise<boolean> {
  const t = I.tab[tab];
  const d = await api<TabRows>(`tab_rows?tab=${tab}&skip=${[...S.lz].join(",")}`);
  S.lz.add(tab);
  const have = new Set(S.accs.map((a) => a.id)); for (const a of d.accounts) if (!have.has(a.id)) S.accs.push(a);
  const lk = new Set(S.links.map((l) => l.id)); for (const l of d.links) if (!lk.has(l.id)) S.links.push(l);
  if (t) delete t.lazy_n; afterLoad(); return true;
}
const FULL = new Set(["delete", "repair", "backup_restore", "ai_apply"]);
const needFull = (p: string, b: unknown) => FULL.has(p) || (p === "tab" && !!b && typeof b === "object" && "lazy" in (b as object));
/** mut(path, body): ghi → tải lại → vẽ lại. Xung đột phiên bản (409) → tải lại toàn bộ rồi báo lỗi. */
export async function mut<R = Record<string, unknown>>(path: string, body: unknown): Promise<R> {
  let r: R;
  store.busy++; emit();
  try { r = await api<R>(path, body); }
  catch (e) { if (e instanceof ApiError && e.status === 409) { await load(true); emit(); } throw e; }
  finally { store.busy--; }
  await load(needFull(path, body)); emit(); return r;
}
export const DET = new Map<Id, unknown>();

/* ───────── điều hướng ───────── */
export function navSnap(scrollTop?: number) { const c = NAV.h[NAV.i]; if (c) { c.scroll = scrollTop ?? c.scroll; c.last = S.last; c.q = S.q; c.st = [...S.st]; c.tf = [...S.tf]; c.page = S.page; } }
export function navPush() {
  if (NAV.lock) return; navSnap();
  const e: NavEntry = { tab: S.tab, dept: S.dept, owner: S.owner, focus: S.focus, devf: S.devf, ov: S.ov }, c = NAV.h[NAV.i];
  if (c && c.tab === e.tab && c.dept === e.dept && c.owner === e.owner && c.focus === e.focus && c.devf === e.devf && !!c.ov === !!e.ov) return;
  NAV.h = NAV.h.slice(0, NAV.i + 1); NAV.h.push(e); while (NAV.h.length > 10) NAV.h.shift(); NAV.i = NAV.h.length - 1;
}
export function navGo(d: number, scrollTop?: number) {
  const j = NAV.i + d; if (j < 0 || j >= NAV.h.length) return;
  navSnap(scrollTop); NAV.i = j; const e = NAV.h[j]; UI.closeAll(); S.idf = null;
  S.dept = e.dept === "all" || S.meta.depts.find((x) => x.id === e.dept) ? e.dept : "all"; S.owner = e.owner != null && I.own[e.owner] ? e.owner : null; scopeCalc(S, I);
  S.tab = e.tab; S.ov = !!e.ov && e.tab === "all"; S.devf = e.devf ?? null; S.q = e.q || ""; S.st = new Set(e.st || []); S.tf = new Set(e.tf || []); S.sel.clear(); S.page = e.page || 1; S.last = e.last ?? null;
  const fid = e.focus != null && I.acc[e.focus] ? e.focus : e.last != null && I.acc[e.last] ? e.last : null; S.focus = fid; S.scrollTop = null;
  if (fid != null) { const i = getView(S, I).findIndex((x) => x.id === fid); if (i >= 0) { S.page = Math.floor(i / S.size) + 1; S.scrollTo = fid; } } else S.scrollTop = e.scroll ?? null;
  savePref(); emit();
}
export function setTab(t: TabKey) { S.idf = null; S.tab = t; S.devf = null; S.q = ""; S.st.clear(); S.tf.clear(); S.sel.clear(); S.page = 1; S.focus = null; savePref(); navPush(); emit(); if (typeof t === "number") void lzEnsure(t).then((did) => did && emit()); }
export function setScope(d: Id | "all", o?: Id | null) {
  UI.closeAll(); S.idf = null; S.dept = d; S.owner = o ?? null; scopeCalc(S, I);
  for (const t of Object.keys(S.fl)) { S.fl[t] = S.fl[t].filter((c) => c.k !== "owner" && c.k !== "dept"); if (!S.fl[t].length) delete S.fl[t]; }
  S.sel.clear(); S.page = 1; S.focus = null; savePref(); navPush(); emit();
}
/** nhảy tới một dòng (đổi phạm vi/tab nếu cần, bỏ lọc, cuộn tới dòng) */
export function jump(id: Id) {
  const a = I.acc[id]; if (!a) return; UI.closeAll();
  if (!inScope(S, I, a)) { S.dept = a.dept_id; S.owner = null; scopeCalc(S, I); }
  if (S.tab !== "all") S.tab = a.tab_id; S.devf = null;
  S.q = ""; S.st.clear(); S.tf.clear(); delete S.fl[String(S.tab)]; S.sel.clear(); S.focus = id; S.scrollTo = id;
  const i = getView(S, I).findIndex((x) => x.id === id); S.page = Math.max(1, Math.floor(Math.max(0, i) / S.size) + 1); savePref(); navPush(); emit();
}
/** Reload (đã chốt): về Tất cả, bỏ lọc/tìm/chọn, lên đầu, tải đủ, không mở lại trang; chỉ xoay icon. */
export async function reload() {
  S.q = ""; S.st.clear(); S.tf.clear(); S.sel.clear(); S.fl = {}; S.devf = null; S.idf = null; S.focus = null; S.page = 1; S.scrollTop = 0; S.tab = "all"; S.ov = false;
  await load(true); savePref(); emit();
}
export function refreshView() { S.page = 1; savePref(); emit(); }
export const accOf = (id: Id): Account | undefined => I.acc[id];
export function selToggle(id: Id, on?: boolean) { const v = on ?? !S.sel.has(id); if (v) S.sel.add(id); else S.sel.delete(id); emit(); }
export async function copyText(s: string) {
  try { await navigator.clipboard.writeText(s); }
  catch { const t = document.createElement("textarea"); t.value = s; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
}
