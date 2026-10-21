"use client";

// Báo cáo (tab "Báo cáo", v9: tình trạng → cần xử lý → phân bổ → hoạt động) và Tổng quan của tab Tất cả (r70: cây Phạm vi ›
// Bộ phận › Owner × nền tảng, live/die, tăng/giảm theo khoảng). Port của reportData/rpDonut/rpChart/rpRow/renderReport/rpSheets
// (5235-5335) và ovData/renderOverview/ovSheets/ACT.ov* (7328-7442) trong v7.py.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { Account, Id } from "../types";
import { deptOf, inScope, outCount, ordAll, scoped, stOf, treeOrder, type AccountX, type OwnerX } from "../core/model";
import { DP, GREY, HC, TAB_NEUTRAL, fmtFull, nf, rel, type Hue } from "../core/text";
import { Ico } from "./icons";
import { I, NAV, S, api, apiBlob, download, emit, jump, navSnap, savePref, setScope, setTab, useHs, type NavEntry } from "./store";
import { MoreBtn, closePop, lim, openPop, showMenu, useMore } from "./ui-kit";
import { LChip } from "./detail";

const cssv = (o: Record<string, string | number | undefined>) => o as CSSProperties;
const HUES: Hue[] = ["g", "w", "b", "n"];
type HCnt = Record<Hue, number>;
export const RPL: Record<Hue, string> = { g: "Hoạt động", w: "Cảnh báo", b: "Lỗi / Die", n: "Chưa có trạng thái" };
const rpPct = (n: number, t: number) => (t ? Math.round(n / t * 100) : 0);
const rpH = (a: Account): Hue => (a.status_id != null && I.status[a.status_id]?.h) || "n";
const rpE = (): HCnt => ({ g: 0, w: 0, b: 0, n: 0 });
const rpPc = (p: number) => (p >= 80 ? "ok" : p >= 50 ? "warn" : "bad");
const fm = (n: number) => (+n || 0).toLocaleString("vi");

/** scopeInfo() gốc: tên phạm vi đang xem (có tiền tố "Owner: " / "Bộ phận: "). */
export function scopeInfo(): { kind: string; name: string; sub: string; ic: string } {
  if (S.owner != null && I.own[S.owner]) { const o = I.own[S.owner], d = deptOf(S, o.dept_id); return { kind: "Owner", name: "Owner: " + o.name, sub: d.id ? d.name : "", ic: "user" }; }
  if (S.dept !== "all" && S.meta.depts.find((x) => x.id === S.dept)) { const d = deptOf(S, S.dept); return { kind: "Bộ phận", name: "Bộ phận: " + d.name, sub: "", ic: "briefcase" }; }
  return { kind: "Toàn hệ thống", name: "Toàn hệ thống", sub: "", ic: "globe" };
}
export function xlsxName(p: string) { const d = new Date(), z = (n: number) => String(n).padStart(2, "0"); return p + "_" + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + "_" + z(d.getHours()) + z(d.getMinutes()); }
export type Sheets = Record<string, Array<Array<string | number>>>;
/** tải file Excel nhiều sheet (POST xlsx {name, sheets, hdr}) */
export async function dlSheets(name: string, sheets: Sheets) {
  try { download(await apiBlob("xlsx", { name, sheets, hdr: 1 }), name + ".xlsx"); } catch { /* apiBlob đã báo lỗi */ }
}
const ownTint = (o: OwnerX | undefined) => { const c = (o?.color || "").toLowerCase(); return c && c !== TAB_NEUTRAL && c !== "#52525b" ? cssv({ "--c": c }) : undefined; };
/** avatar(o): ô owner tròn có màu riêng */
export function Avatar({ o }: { o: OwnerX | undefined }) {
  return o ? <span className="oi" style={ownTint(o)} title={"Owner: " + o.path.map((i) => I.own[i]?.name).join(" / ")}><Ico n="user" sz={14} /></span>
    : <span className="oi n" title="Chưa gán Owner"><Ico n="user" sz={14} /></span>;
}

/* ═════════════════════════ BÁO CÁO ═════════════════════════ */
type RpBy = "tab" | "dept" | "owner";
const RP: { by: RpBy; sc: number } = { by: "tab", sc: 0 };
interface RpRow { key: string; name: string; ic?: string; c?: string; dot?: boolean; o?: OwnerX; lv?: number; dept?: string; h: HCnt; n: number; direct?: number; on?: boolean; go: () => void }
interface Issue { k: string; lv: "b" | "w"; ic: string; t: string; d: string; ids: Id[]; pairs?: Array<[Id, Id]> }
/** tính một lần, dùng cho cả màn hình lẫn file Excel */
function reportData() {
  const A = scoped(S, I), now = Date.now() / 1000, hc = rpE(), tH: Record<string, HCnt> = {}, dH: Record<string, HCnt> = {}, oH: Record<string, HCnt> = {};
  for (const a of A) { const h = rpH(a); hc[h]++; (tH[a.tab_id] ??= rpE())[h]++; (dH[a.dept_id] ??= rpE())[h]++; if (a.owner_id) (oH[a.owner_id] ??= rpE())[h]++; }
  const T = A.length, new7 = A.filter((a) => a.created > now - 7 * 86400).length, up24 = A.filter((a) => a.updated > now - 86400).length;
  const risk: Array<[Id, Id]> = [];
  for (const l of S.links) { const s = I.acc[l.src], d = I.acc[l.dst]; if (s && d && inScope(S, I, s) && rpH(s) === "g" && rpH(d) === "b") risk.push([s.id, d.id]); }
  const shared = A.filter((a) => (I.inn[a.id] || []).length >= 5).sort((a, b) => I.inn[b.id].length - I.inn[a.id].length);
  const lt = new Set<Id>(); for (const t of S.meta.tabs) for (const f of t.fields) if (f.type === "link") { lt.add(t.id); if (f.link_tab != null) lt.add(f.link_tab); }
  const orphan = A.filter((a) => lt.has(a.tab_id) && !outCount(I, a) && !(I.inn[a.id] || []).length), noown = A.filter((a) => !a.owner_id), stale = A.filter((a) => a.updated < now - 7 * 86400);
  const issues: Issue[] = [
    { k: "risk", lv: "b", ic: "alert", t: "Đang hoạt động nhưng phụ thuộc dòng lỗi", d: "Dòng live đang liên kết tới dòng die — dễ bị ảnh hưởng theo.", ids: [...new Set(risk.map((r) => r[0]))], pairs: risk },
    { k: "shared", lv: "w", ic: "users", t: "Một tài nguyên bị dùng chung quá nhiều", d: "Từ 5 dòng trở lên dùng chung một tài nguyên — hỏng một cái là ảnh hưởng hàng loạt.", ids: shared.map((a) => a.id) },
    { k: "orphan", lv: "w", ic: "link", t: "Chưa có liên kết nào", d: "Dòng thuộc tab có liên kết nhưng chưa nối với dòng nào.", ids: orphan.map((a) => a.id) },
    { k: "stale", lv: "w", ic: "clock", t: "Quá 7 ngày chưa cập nhật", d: "Dữ liệu có thể đã cũ — nên kiểm tra lại trạng thái.", ids: stale.map((a) => a.id) },
    { k: "noown", lv: "w", ic: "user", t: "Chưa có owner", d: "Không rõ ai chịu trách nhiệm dòng này.", ids: noown.map((a) => a.id) },
  ];
  const sum = (h: HCnt) => h.g + h.w + h.b + h.n;
  const byTab: RpRow[] = S.meta.tabs.map((t) => { const h = tH[t.id] || rpE(); return { key: "t" + t.id, name: t.name, ic: t.icon, c: t.color, h, n: sum(h), go: () => setTab(t.id) }; });
  const byDept: RpRow[] = S.meta.depts.map((d) => { const h = dH[d.id] || rpE(); return { key: "d" + d.id, name: d.name, c: d.color, dot: true, h, n: sum(h), on: S.dept === d.id && S.owner == null, go: () => setScope(d.id) }; });
  const memo: Record<string, HCnt> = {};
  const sub = (id: Id): HCnt => { if (memo[id]) return memo[id]; const h = { ...(oH[id] || rpE()) }; for (const k of I.kids[id] || []) { const x = sub(k); for (const q of HUES) h[q] += x[q]; } return (memo[id] = h); };
  const byOwner: RpRow[] = [];
  for (const dd of S.dept === "all" ? S.meta.depts : [deptOf(S, S.dept)]) for (const { o, d } of treeOrder(I, dd.id)) {
    if (S.owner != null && I.scO && !I.scO.has(o.id)) continue;
    const h = sub(o.id), own = oH[o.id] || rpE();
    byOwner.push({ key: "o" + o.id, name: o.name, lv: d, o, dept: dd.name, h, n: sum(h), direct: sum(own), on: S.owner === o.id, go: () => setScope(dd.id, o.id) });
  }
  const days = 14, b0 = new Date(); b0.setHours(0, 0, 0, 0);
  const t0 = b0.getTime() / 1000 - (days - 1) * 86400, cr: number[] = Array(days).fill(0), up: number[] = Array(days).fill(0);
  for (const a of A) { const c = Math.floor((a.created - t0) / 86400), u = Math.floor((a.updated - t0) / 86400); if (c >= 0 && c < days) cr[c]++; if (u >= 0 && u < days) up[u]++; }
  const recent = [...A].sort((a, b) => b.updated - a.updated).slice(0, 8);
  return { A, T, hc, new7, up24, issues, issueN: issues.reduce((n, x) => n + x.ids.length, 0), byTab, byDept, byOwner, cr, up, t0, recent };
}

function RpChart({ cr, up, t0 }: { cr: number[]; up: number[]; t0: number }) {
  const days = cr.length, W = 640, H = 190, mx = Math.max(1, ...cr, ...up), L = Math.max(30, String(mx).length * 7 + 12);
  const X = (i: number) => L + (W - L - 8) * i / (days - 1), Y = (v: number) => H - (H - 10) * v / mx;
  const path = (a: number[]) => a.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
  const dl = (i: number) => new Date((t0 + i * 86400) * 1000);
  const dots = (a: number[], c: string, l: string) => a.map((v, i) => <circle key={c + i} cx={X(i).toFixed(1)} cy={Y(v).toFixed(1)} r="3.2" className={c}><title>{dl(i).toLocaleDateString("vi-VN")} · {l}: {v}</title></circle>);
  return <svg viewBox={`0 0 ${W} ${H + 24}`} className="rp-chart" role="img" aria-label="Hoạt động 14 ngày">
    {[0, 0.5, 1].map((f) => { const y = Y(mx * f).toFixed(1); return <g key={f}><line x1={L} x2={W - 8} y1={y} y2={y} className="rp-gl" /><text x={L - 6} y={(+y + 3).toFixed(1)} textAnchor="end" className="rp-gt">{Math.round(mx * f)}</text></g>; })}
    {cr.map((_, i) => (i % 2 ? null : <text key={"x" + i} x={X(i).toFixed(1)} y={H + 16} textAnchor="middle" className="rp-gt">{dl(i).getDate()}/{dl(i).getMonth() + 1}</text>))}
    <path d={`${path(cr)} L${X(days - 1).toFixed(1)} ${H} L${X(0).toFixed(1)} ${H} Z`} className="rp-ar1" /><path d={path(cr)} className="rp-ln1" /><path d={path(up)} className="rp-ln2" />
    {dots(up, "rp-dt2", "Cập nhật")}{dots(cr, "rp-dt1", "Tạo mới")}
  </svg>;
}
function RpRowView({ o, max }: { o: RpRow; max: number }) {
  const p = rpPct(o.h.g, o.n);
  const lead = o.ic ? <span className="ci" style={cssv({ "--c": o.c })}><Ico n={o.ic} sz={12} /></span> : o.dot ? <i className="dot" style={{ background: o.c }} /> : <Avatar o={o.o} />;
  return <button className={`rp-row ${o.on ? "on" : ""}`} title={o.direct != null ? `Trực tiếp: ${o.direct}` : undefined} onClick={o.go}>
    <span className="rp-nm" style={{ paddingLeft: (o.lv || 0) * 14 }}>{lead}<span>{o.name}</span></span>
    <span className="rp-bar"><span style={{ width: (max ? Math.max(o.n ? 2 : 0, o.n / max * 100) : 0) + "%" }}>{HUES.filter((k) => o.h[k]).map((k) => <i key={k} style={{ flex: o.h[k], background: HC[k] }} title={`${RPL[k]}: ${o.h[k]}`} />)}</span></span>
    <b className="rp-n">{o.n.toLocaleString("vi")}</b><span className={`rp-p ${o.n ? rpPc(p) : ""}`}>{o.n ? p + "%" : "—"}</span>
  </button>;
}
function rpSheets(): Sheets {
  const D = reportData(), sc = scopeInfo(), T = D.T, H = ["Tổng", RPL.g, RPL.w, RPL.b, RPL.n, "% hoạt động"], hr = (h: HCnt, n: number) => [n, h.g, h.w, h.b, h.n, rpPct(h.g, n)];
  const sheets: Sheets = {};
  sheets["Tổng quan"] = [["Chỉ số", "Giá trị"], ["Phạm vi", sc.name + (sc.sub ? " · " + sc.sub : "")], ["Thời điểm xuất", new Date().toLocaleString("vi-VN")], ["Tổng số dòng", T], [RPL.g, D.hc.g], [RPL.w, D.hc.w], [RPL.b, D.hc.b], [RPL.n, D.hc.n], ["% hoạt động", rpPct(D.hc.g, T)], ["Mới 7 ngày", D.new7], ["Cập nhật 24 giờ", D.up24], ...D.issues.map((x) => ["Cần xử lý: " + x.t, x.ids.length])];
  sheets["Theo tab"] = [["Loại", ...H], ...D.byTab.map((r) => [r.name, ...hr(r.h, r.n)])];
  sheets["Bộ phận"] = [["Bộ phận", ...H], ...D.byDept.map((r) => [r.name, ...hr(r.h, r.n)])];
  sheets["Owner"] = [["Owner", "Bộ phận", "Cấp", ...H, "Trực tiếp"], ...D.byOwner.map((r) => [r.name, r.dept || "", (r.lv || 0) + 1, ...hr(r.h, r.n), r.direct || 0])];
  const pairOf: Record<string, string[]> = {}; for (const [s, d] of D.issues[0].pairs || []) (pairOf[s] ??= []).push(I.acc[d]?.label || "");
  const lines: Array<Array<string | number>> = [["Vấn đề", "Dòng", "Loại", "Trạng thái", "Owner", "Bộ phận", "Ghi chú"]];
  for (const x of D.issues) for (const id of x.ids.slice(0, 5000)) {
    const a = I.acc[id]; if (!a) continue;
    lines.push([x.t, a.label, I.tab[a.tab_id]?.name || "", stOf(I, a)?.label || "", (a.owner_id != null && I.own[a.owner_id]?.name) || "", deptOf(S, a.dept_id).name,
      x.k === "risk" ? "Phụ thuộc: " + (pairOf[id] || []).join(", ") : x.k === "shared" ? (I.inn[id] || []).length + " dòng dùng chung" : x.k === "stale" ? "Cập nhật cuối: " + fmtFull(a.updated) : ""]);
  }
  sheets["Cần xử lý"] = lines;
  sheets["Hoạt động 14 ngày"] = [["Ngày", "Tạo mới", "Cập nhật"], ...D.cr.map((v, i) => [new Date((D.t0 + i * 86400) * 1000).toLocaleDateString("vi-VN"), v, D.up[i]])];
  return sheets;
}

/** nhớ kiểu nhóm của báo cáo khi rời tab */
function rpRemember(k: RpBy) { RP.by = k; }
/** ReportView: tab "Báo cáo" (phạm vi đang chọn). */
export function ReportView() {
  useHs(); useMore();
  const [by, setBy] = useState<RpBy>(RP.by);
  const box = useRef<HTMLDivElement>(null);
  // rời tab rồi quay lại → về đúng chỗ cuộn cũ
  useLayoutEffect(() => { if (box.current) box.current.scrollTop = RP.sc; }, []);
  const D = reportData(), sc = scopeInfo(), T = D.T;
  const own = D.A.filter((a) => a.owner_id).length;
  const kc = (cls: string, l: string, v: number, sub: ReactNode) => <div key={l} className={`ovkc ${cls}`}><span>{l}</span><b>{fm(v)}</b><em>{sub}</em></div>;
  const rows = by === "tab" ? D.byTab : by === "dept" ? D.byDept : D.byOwner, mx = Math.max(1, ...rows.map((r) => r.n));
  const pick = (k: RpBy) => { rpRemember(k); setBy(k); };
  return <div ref={box} className="rp" onScroll={(e) => { RP.sc = e.currentTarget.scrollTop; }}>
    <div className="rp-head"><h2>Báo cáo</h2><span className="rp-sub"><b>{sc.name}{sc.sub ? " · " + sc.sub : ""}</b> · cập nhật {nowHM()}</span><div className="grow" />
      <button className="btn icon ghost" title="Xuất báo cáo ra Excel" aria-label="Xuất báo cáo ra Excel" onClick={() => void dlSheets(xlsxName("bao-cao"), rpSheets())}><Ico n="download" sz={17} /></button></div>
    <section className="rp-c rp-kp">
      <div className="ovks rp-ks">
        {kc("", "Tổng", T, `${D.byTab.filter((r) => r.n).length} loại · ${fm(own)} đã có owner`)}
        {kc("g", "Live", D.hc.g, rpPct(D.hc.g, T) + "%")}
        {kc(D.hc.b ? "b" : "", "Die", D.hc.b, rpPct(D.hc.b, T) + "%")}
        {kc("", "Khác", D.hc.w + D.hc.n, "cảnh báo / chưa rõ")}
        {kc("", "Mới 7 ngày", D.new7, `cập nhật 24 giờ: ${fm(D.up24)}`)}
        {kc(D.issueN ? "b" : "", "Cần xử lý", D.issueN, D.issueN ? "xem bên dưới" : "mọi thứ ổn")}
      </div>
      <div className="rp-dist"><span className="ovb rp-db">{HUES.filter((k) => D.hc[k]).map((k) => <i key={k} style={{ flex: D.hc[k], background: HC[k] }} title={`${RPL[k]}: ${D.hc[k]}`} />)}</span>
        <span className="rp-dl2">{HUES.map((k) => <span key={k} className="rp-lg2"><i style={{ background: HC[k] }} />{RPL[k]}<b>{(D.hc[k] || 0).toLocaleString("vi")}</b><small>{rpPct(D.hc[k], T)}%</small></span>)}</span></div>
    </section>
    <div className="rp-c"><h3>Cần xử lý<span className="sp" /><em>{D.issueN ? "bấm để mở danh sách" : "không có vấn đề"}</em></h3>
      <div className="rp-isl">{D.issues.map((x, i) => {
        const n = x.ids.length;
        if (!n) return <div key={x.k} className="rp-is ok"><div className="rp-sm"><span className="rp-ii"><Ico n="check" sz={16} /></span><span className="rp-it"><b>{x.t}</b></span><span className="rp-ic">0</span></div></div>;
        const rk = "rp" + x.t, np = lim(rk, 8), nc = lim(rk, 24);
        const body = x.pairs ? <>{x.pairs.slice(0, np).map(([s, d], j) => <div key={j} className="rp-pr"><LChip id={s} /><span className="rp-arw"><Ico n="chevr" sz={14} /></span><LChip id={d} /></div>)}{x.pairs.length > np ? <MoreBtn k={rk} n={x.pairs.length - np} step={50} label="cặp khác" /> : null}</>
          : <div className="rp-chips">{x.ids.slice(0, nc).map((id) => <LChip key={id} id={id} />)}{n > nc ? <MoreBtn k={rk} n={n - nc} step={200} label="nữa" /> : null}</div>;
        return <details key={x.k} className={`rp-is ${x.lv}`} open={i === 0}><summary className="rp-sm"><span className="rp-ii"><Ico n={x.ic} sz={16} /></span><span className="rp-it"><b>{x.t}</b><small>{x.d}</small></span><span className="rp-ic">{n.toLocaleString("vi")}</span><span className="rp-cv"><Ico n="chevd" sz={14} /></span></summary><div className="rp-ib">{body}</div></details>;
      })}</div></div>
    <div className="rp-c"><h3>Phân bổ<span className="sp" />
      <div className="rp-seg" role="tablist">{([["tab", "layers", "Tab"], ["dept", "briefcase", "Bộ phận"], ["owner", "users", "Owner"]] as Array<[RpBy, string, string]>).map(([k, ic, l]) => <button key={k} className={by === k ? "on" : ""} role="tab" aria-selected={by === k} onClick={() => pick(k)}><Ico n={ic} sz={13} />{l}</button>)}</div></h3>
      <div className="rp-rh"><span>{by === "tab" ? "Loại" : by === "dept" ? "Bộ phận" : "Owner (gồm cấp dưới)"}</span><span>Trạng thái</span><span className="r">SL</span><span className="r">% live</span></div>
      <div className="rp-rows">{rows.length ? rows.map((r) => <RpRowView key={r.key} o={r} max={mx} />) : <div className="ph pad"><Ico n="inbox" sz={20} /></div>}</div></div>
    <div className="rp-two">
      <div className="rp-c"><h3>Hoạt động 14 ngày<span className="sp" /><span className="rp-k"><i className="k1" />Tạo mới<i className="k2" />Cập nhật</span></h3><RpChart cr={D.cr} up={D.up} t0={D.t0} /></div>
      <div className="rp-c"><h3>Mới cập nhật</h3><div className="rp-rcl">{D.recent.length ? D.recent.map((a) => { const t = I.tab[a.tab_id], s = stOf(I, a);
        return <button key={a.id} className="rp-rc" onClick={() => jumpTo(a.id)}><span className="ci" style={cssv({ "--c": t?.color })}><Ico n={t?.icon || "user"} sz={12} /></span><span className="rp-rn">{a.label}</span><i className="dot" style={{ background: s?.color || GREY }} /><span className="rp-rt">{rel(a.updated)}</span></button>; })
        : <div className="ph pad"><Ico n="inbox" sz={20} /></div>}</div></div>
    </div>
  </div>;
}
const nowHM = () => new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
function jumpTo(id: Id) { closePop(); jump(id); }

/* ═════════════════════════ TỔNG QUAN (tab Tất cả) ═════════════════════════ */
interface Cell { T: HCnt; tab: Record<string, HCnt>; dt: Record<string, number> }
interface OvRow { k: string; lv: number; cls?: string; d: Id | "all"; o?: Id; name: string; tg?: string; x?: boolean; lead: ReactNode }
type Period = { k: "r"; a: string; b: string };
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* bộ nhớ trình duyệt bị khoá */ } } };
const ovP7 = (): Period => { const t = DP.today(); return { k: "r", a: DP.day(DP.num(t) - 6), b: t }; };
const OV: { init: boolean; X: Set<string>; S: string; P: Period; T: { ts: number; del: Array<{ tab_id: Id; dept_id: Id; owner_id: Id | null; ts: number }>; since: number; busy: boolean };
  SK: string | null; F: { k: string; t: Id } | null; scr: { t: number; p: number }; v: number } = {
  init: false, X: new Set(), S: "all", P: { k: "r", a: "", b: "" }, T: { ts: 0, del: [], since: 0, busy: false }, SK: null, F: null, scr: { t: 0, p: 0 }, v: 0,
};
/** đọc tuỳ chọn Tổng quan đã nhớ (ahs.ov / ahs.ovx / ahs.ovs / ahs.ovp) — 1 lần, phía trình duyệt */
function ovInit() {
  if (OV.init || typeof window === "undefined") return; OV.init = true;
  S.ov = ls.get("ahs.ov") === "1";
  try { OV.X = new Set(JSON.parse(ls.get("ahs.ovx") || "[]") as string[]); } catch { OV.X = new Set(); }
  OV.S = ls.get("ahs.ovs") || "all";
  try { const p = JSON.parse(ls.get("ahs.ovp") || "null") as Period | null; OV.P = p && p.k === "r" && p.a && p.b ? p : ovP7(); } catch { OV.P = ovP7(); }
}
ovInit();
const ovLs = new Set<() => void>();
const ovBump = () => { OV.v++; for (const f of ovLs) f(); };
const useOv = () => useSyncExternalStore((f) => { ovLs.add(f); return () => { ovLs.delete(f); }; }, () => OV.v, () => 0);
const ovSave = () => { ls.set("ahs.ov", S.ov ? "1" : "0"); ls.set("ahs.ovx", JSON.stringify([...OV.X])); };
const ovN = (h: HCnt | undefined) => (h ? h.g + h.w + h.b + h.n : 0);
const ovTs = (d: string) => new Date(d + "T00:00:00").getTime() / 1000;
const ovRange = (): [number, number] => [ovTs(OV.P.a), ovTs(OV.P.b) + 86400];
const ovFmtD = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
function ovLo() { let m = Infinity; for (const a of ordAll(S, I)) if (a.created && a.created < m) m = a.created; return m === Infinity ? DP.today() : DP.ymd(new Date(m * 1000)); }
function rgPresets(lo: string, hi: string): Array<[string, string, string]> {
  const t = DP.today(), tn = DP.num(t), d = new Date(), y = d.getFullYear(), mo = d.getMonth(), q = Math.floor(mo / 3) * 3;
  const P2 = (n: number) => String(n).padStart(2, "0"), last = (Y: number, M: number) => new Date(Y, M + 1, 0).getDate(), pm = mo ? mo - 1 : 11, py = mo ? y : y - 1;
  return [["Hôm nay", t, t], ["7 ngày", DP.day(tn - 6), t], ["30 ngày", DP.day(tn - 29), t], ["Tháng này", `${y}-${P2(mo + 1)}-01`, t], ["Tháng trước", `${py}-${P2(pm + 1)}-01`, `${py}-${P2(pm + 1)}-${last(py, pm)}`], ["Quý này", `${y}-${P2(q + 1)}-01`, t], ["Năm nay", `${y}-01-01`, t], ["Toàn bộ", lo, hi]];
}
function ovPerLab() { const lo = ovLo(), hi = DP.today(), p = rgPresets(lo, hi).find(([, x, y]) => (x < lo ? lo : x) === OV.P.a && (y > hi ? hi : y) === OV.P.b); return p ? p[0] : OV.P.a === OV.P.b ? ovFmtD(OV.P.a) : ovFmtD(OV.P.a) + " – " + ovFmtD(OV.P.b); }
function ovTrendLoad() {
  const since = ovRange()[0];
  if ((OV.T.since && OV.T.since <= since && Date.now() - OV.T.ts < 60000) || OV.T.busy) return;
  OV.T.busy = true;
  api<{ ts: number; del?: typeof OV.T.del }>("ov_trend", { since })
    .then((r) => { OV.T = { ts: Date.now(), del: r.del || [], since, busy: false }; ovBump(); })
    .catch(() => { OV.T.ts = Date.now(); OV.T.since = since; })
    .finally(() => { OV.T.busy = false; });
}
function ovSetP(p: Period) { OV.P = p; ls.set("ahs.ovp", JSON.stringify(p)); ovBump(); }

/** luôn dựng CẢ cây (toàn hệ thống); phạm vi đang chọn chỉ quyết định dòng được chọn sẵn */
function ovData() {
  const A = ordAll(S, I), C: Record<string, Cell> = {};
  const cell = (k: string) => (C[k] ??= { T: rpE(), tab: {}, dt: {} });
  const add = (k: string, a: AccountX, h: Hue) => { const c = cell(k); (c.tab[a.tab_id] ??= rpE())[h]++; c.T[h]++; };
  for (const a of A) { const h = rpH(a); add("all", a, h); add("d" + a.dept_id, a, h); const o = a.owner_id != null ? I.own[a.owner_id] : undefined; if (o) for (const id of o.path) add("o" + id, a, h); else add("u" + a.dept_id, a, h); }
  const [pa, pb] = ovRange(), ks = (dp: Id, ow: Id | null) => { const o = ow != null ? I.own[ow] : undefined; return ["all", "d" + dp, ...(o ? o.path.map((i) => "o" + i) : ["u" + dp])]; };
  const dl = (k: string, t: Id, v: number) => { const z = cell(k).dt; z[t] = (z[t] || 0) + v; z.T = (z.T || 0) + v; };
  for (const a of A) if (a.created >= pa && a.created < pb) for (const k of ks(a.dept_id, a.owner_id)) dl(k, a.tab_id, 1);
  for (const r of OV.T.del) { if (r.ts < pa || r.ts >= pb) continue; for (const k of ks(r.dept_id, r.owner_id)) dl(k, r.tab_id, -1); }
  const tabs = S.meta.tabs.filter((t) => C.all && C.all.tab[t.id]);
  const rows: OvRow[] = [{ k: "all", lv: 0, cls: "r0", d: "all", name: "Toàn hệ thống", lead: null }];
  for (const d of S.meta.depts) {
    const kd = "d" + d.id, x = OV.X.has(kd);
    rows.push({ k: kd, lv: 0, cls: "r1", d: d.id, name: d.name, tg: kd, x, lead: <i className="dot" style={{ background: d.color }} /> });
    if (x) continue;
    for (const { o, d: lv } of treeOrder(I, d.id)) { if (!C["o" + o.id]) continue; rows.push({ k: "o" + o.id, lv: lv + 1, d: d.id, o: o.id, name: o.name, lead: <Avatar o={o} /> }); }
    if (C["u" + d.id]) rows.push({ k: "u" + d.id, lv: 1, cls: "ru", d: d.id, name: "Dùng chung", lead: <Ico n="users" sz={15} /> });
  }
  return { A, C, tabs, rows };
}
const OvStat = ({ x }: { x: HCnt }) => <><span className="n0">{fm(ovN(x))}</span><span className="ng">{fm(x.g)}</span><span className="nb">{fm(x.b)}</span></>;
const OvDelta = ({ v }: { v: number }) => (v > 0 ? <span className="up">+{v.toLocaleString("vi")}</span> : v < 0 ? <span className="dn">−{(-v).toLocaleString("vi")}</span> : <span className="zz">0</span>);

/* điều hướng: Quay lại / Đi tiếp nhớ cả kiểu xem Tổng quan */
function ovPushNav() {
  const e: NavEntry & { ov: boolean; ovs: string } = { tab: S.tab, dept: S.dept, owner: S.owner, focus: S.focus, devf: S.devf, tf: [...S.tf], ov: S.ov, ovs: OV.S };
  NAV.h = NAV.h.slice(0, NAV.i + 1); NAV.h.push(e); while (NAV.h.length > 10) NAV.h.shift(); NAV.i = NAV.h.length - 1; emit();
}
/** chuyển Tổng quan ↔ Chi tiết (ACT.ovset) */
export function ovSet(on: boolean) { if (on === S.ov) return; navSnap(); S.ov = on; ovSave(); S.sel.clear(); ovPushNav(); }
const ownerEmpty = (k: string) => { S.fl[k] = [...(S.fl[k] || []).filter((c) => c.k !== "owner"), { k: "owner", op: "empty" }]; savePref(); emit(); };
/** Liên kết: về bảng Chi tiết của tab Tất cả, đúng phạm vi + lọc nền tảng (ACT.ovgo) */
function ovGo(d: Id | "all", o: Id | null, t: Id | null, u: boolean) {
  navSnap(); S.ov = false; ovSave(); S.tf = new Set(t != null ? [t] : []);
  NAV.lock = true; try { setScope(d, o); } finally { NAV.lock = false; }
  ovPushNav(); if (u) ownerEmpty("all");
}
/** Thông tin: mở đúng tab nền tảng trong phạm vi bộ phận / owner đang chọn (ovInfo) */
function ovInfo(d: Id | "all", o: Id | null, t: Id, u: boolean) {
  navSnap(); NAV.lock = true; try { setScope(d, o); setTab(t); } finally { NAV.lock = false; }
  if (u) ownerEmpty(String(t));
  ovPushNav();
}
function ovSheets(): Sheets {
  const D = ovData(), H = ["Phạm vi", "Cấp", ...D.tabs.map((t) => t.name), "Tổng", RPL.g, RPL.w, RPL.b, RPL.n, "% " + RPL.g.toLowerCase()];
  return { "Tổng quan": [H, ...D.rows.map((r) => { const c = D.C[r.k], t = c?.T || rpE(), n = ovN(t); return [r.name, r.lv, ...D.tabs.map((x) => ovN(c?.tab[x.id])), n, t.g, t.w, t.b, t.n, rpPct(t.g, n)]; })] };
}
export const ovXls = () => void dlSheets(xlsxName("tong-quan"), ovSheets());

/** công tắc kiểu xem Tổng quan / Chi tiết (đặt đầu #bar của tab Tất cả) */
export function OvSwitch() {
  useHs();
  return <div className="ovsw" role="group" aria-label="Kiểu xem">{([["ov", "chart", "Tổng quan"], ["dt", "list", "Chi tiết"]] as const).map(([v, ic, l]) => {
    const on = (v === "ov") === S.ov;
    return <button key={v} className={on ? "on" : ""} aria-pressed={on} title={l} aria-label={l} onClick={() => ovSet(v === "ov")}><Ico n={ic} sz={16} /></button>; })}</div>;
}
/** nội dung #bar khi đang ở Tổng quan: công tắc + xuất Excel */
export function OverviewBar() {
  return <><OvSwitch /><div className="grow" /><button className="btn icon ghost" title="Xuất Excel" aria-label="Xuất Excel" onClick={ovXls}><Ico n="download" sz={16} /></button></>;
}

/* popup chọn khoảng Tăng / giảm (ACT.ovper) */
function OvPeriod() {
  useOv();
  const lo = ovLo(), hi = DP.today(), days = new Map<string, number>();
  for (const a of ordAll(S, I)) if (a.created) { const d = DP.ymd(new Date(a.created * 1000)); days.set(d, (days.get(d) || 0) + 1); }
  let a = OV.P.a < lo ? lo : OV.P.a; const b = OV.P.b > hi ? hi : OV.P.b; if (a > b) a = b;
  const D = DP.num(hi) - DP.num(lo) + 1;
  const set = (A: string, B: string) => { if (A > B) [A, B] = [B, A]; ovSetP({ k: "r", a: A, b: B }); };
  let cnt = 0; days.forEach((c, d) => { if (d >= a && d <= b) cnt += c; });
  return <>
    <div className="tpk-h"><span>Tăng / giảm trong khoảng</span></div>
    <div className="drg">
      <div className="rg-pre" role="group" aria-label="Khoảng nhanh">{rgPresets(lo, hi).map(([l, x, y]) => { const xa = x < lo ? lo : x, yb = y > hi ? hi : y;
        return <button key={l} className={`chip ${xa === a && yb === b ? "on" : ""}`} disabled={xa > yb} onClick={() => set(xa, yb)}>{l}</button>; })}</div>
      {D === 1 ? <div className="rg-one"><Ico n="calendar" sz={14} /><span>Toàn bộ dữ liệu nằm trong ngày {DP.fmt(lo)}</span></div>
        : <div className="rg-box"><DateSlider lo={lo} hi={hi} a={a} b={b} days={days} onChange={set} /></div>}
      <div className="rg-in">
        <label className="rg-f"><span>Từ</span><input type="date" className="in" min={lo} max={hi} value={a} onChange={(e) => { const v = e.target.value; if (v) set(v < lo ? lo : v, b); }} /></label>
        <span className="rg-ar"><Ico n="chevr" sz={14} /></span>
        <label className="rg-f"><span>Đến</span><input type="date" className="in" min={lo} max={hi} value={b} onChange={(e) => { const v = e.target.value; if (v) set(a, v > hi ? hi : v); }} /></label>
      </div>
      <div className="rg-info"><b>{nf(cnt)}</b><span>dòng mới tạo trong khoảng</span></div>
    </div>
  </>;
}
/** thanh trượt khoảng ngày (bản rút gọn như bộ lọc ngày của bảng): biểu đồ cột theo ngày + 2 nút kéo */
function DateSlider({ lo, hi, a, b, days, onChange }: { lo: string; hi: string; a: string; b: string; days: Map<string, number>; onChange: (a: string, b: string) => void }) {
  const N = DP.num(hi) - DP.num(lo) + 1, n0 = DP.num(lo), ia = Math.max(0, DP.num(a) - n0), ib = Math.min(N - 1, DP.num(b) - n0);
  const nb = Math.max(1, Math.min(48, N)), bs = N / nb, bk: number[] = Array(nb).fill(0);
  days.forEach((n, d) => { const i = DP.num(d) - n0; if (i >= 0 && i < N) bk[Math.min(nb - 1, Math.floor(i / bs))] += n; });
  const mx = Math.max(...bk, 1), pct = (i: number) => (N > 1 ? (i / (N - 1)) * 100 : 50);
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ w: "a" | "b"; A: number; B: number } | null>(null);
  const day = (i: number) => DP.day(n0 + Math.max(0, Math.min(N - 1, i)));
  const idx = (e: { clientX: number }) => { const el = track.current; if (!el) return 0; const r = el.getBoundingClientRect(); return Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (N - 1)); };
  const ca = drag ? drag.A : ia, cb = drag ? drag.B : ib;
  const startDrag = (e: React.PointerEvent, w: "a" | "b") => {
    e.preventDefault(); let A = ia, B = ib; setDrag({ w, A, B });
    const mv = (ev: PointerEvent) => { const i = idx(ev); if (w === "a") A = Math.min(i, B); else B = Math.max(i, A); setDrag({ w, A, B }); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); setDrag(null); onChange(day(A), day(B)); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  const onTrack = (e: React.PointerEvent) => { if (e.target !== track.current) return; const i = idx(e); if (Math.abs(i - ia) <= Math.abs(i - ib)) onChange(day(Math.min(i, ib)), b); else onChange(a, day(Math.max(i, ia))); };
  const key = (e: React.KeyboardEvent, w: "a" | "b") => {
    const st = e.shiftKey ? 7 : 1, map: Record<string, number> = { ArrowLeft: -st, ArrowDown: -st, ArrowRight: st, ArrowUp: st, PageDown: -30, PageUp: 30 };
    let v = w === "a" ? ia : ib; if (e.key in map) v += map[e.key]; else if (e.key === "Home") v = w === "a" ? 0 : ia; else if (e.key === "End") v = w === "a" ? ib : N - 1; else return; e.preventDefault();
    if (w === "a") onChange(day(Math.max(0, Math.min(v, ib))), b); else onChange(a, day(Math.min(N - 1, Math.max(v, ia))));
  };
  const tipI = drag?.w === "b" ? cb : ca;
  return <div className={`dps ${drag ? "drag" : ""}`}>
    <div className="dps-h">{bk.map((n, i) => { const s = Math.floor(i * bs), e = Math.ceil((i + 1) * bs) - 1;
      return <i key={i} className={e >= ca && s <= cb ? "dp-on" : ""} style={{ height: (n ? Math.max(8, (n / mx) * 100) : 3) + "%" }} title={`${DP.fmt(day(s))}${bs > 1.5 ? " – " + DP.fmt(day(Math.min(N - 1, e))) : ""}: ${n} dòng`} onClick={() => onChange(day(s), day(Math.min(N - 1, e)))} />; })}</div>
    <div ref={track} className="dps-t" onPointerDown={onTrack}>
      <div className="dps-f" style={{ left: pct(ca) + "%", width: pct(cb) - pct(ca) + "%" }} />
      <button type="button" className="dps-k" role="slider" aria-label="Từ ngày" aria-valuetext={DP.fmt(day(ca))} style={{ left: pct(ca) + "%", zIndex: ca >= N - 1 ? 3 : 1 }} onPointerDown={(e) => startDrag(e, "a")} onKeyDown={(e) => key(e, "a")} />
      <button type="button" className="dps-k" role="slider" aria-label="Đến ngày" aria-valuetext={DP.fmt(day(cb))} style={{ left: pct(cb) + "%", zIndex: 2 }} onPointerDown={(e) => startDrag(e, "b")} onKeyDown={(e) => key(e, "b")} />
    </div>
    <div className="dps-e"><span>{DP.fmt(lo)}</span><span>{DP.fmt(hi)}</span></div>
    <div className="dps-tip" style={{ left: `calc(8px + (100% - 16px) * ${pct(tipI) / 100})` }}>{DP.fmt(day(tipI))}</div>
  </div>;
}

/** khung giả lúc đang tải lần đầu: giống hệt bố cục Tổng quan */
function OvSkel() {
  const bar = (w: string, d = 0, lg = false) => <span className={`ovskb ${lg ? "lg" : ""}`} style={cssv({ width: w, "--d": d + "s" })} />;
  const W = ["62%", "48%", "70%", "55%", "66%", "44%", "58%", "52%", "68%", "46%", "60%", "50%"];
  return <div className="ovw ovsk" aria-busy="true">
    <nav className="ovtr"><div className="ovth"><span>Phạm vi</span><span>Tổng</span><span className="ng">Live</span><span className="nb">Die</span></div>
      <div className="ovtb">{W.map((w, i) => <div key={i} className="ovi ovsr" style={cssv({ "--lv": i % 4 ? 1 : 0 })}><span className="nm0" style={cssv({ "--lv": i % 4 ? 1 : 0 })}><span className="ovsp" />{bar(w, i * 0.06)}</span>{bar("70%", i * 0.06 + 0.1)}{bar("70%", i * 0.06 + 0.15)}{bar("50%", i * 0.06 + 0.2)}</div>)}</div></nav>
    <section className="ovpn"><div className="ovph">{bar("180px")}</div>
      <div className="ovks">{[0, 1, 2, 3].map((i) => <div key={i} className="ovkc">{bar("40%", i * 0.08)}{bar("62%", i * 0.08 + 0.1, true)}{bar("30%", i * 0.08 + 0.2)}</div>)}</div>
      <div className="ovtw2"><table className="ovt"><thead><tr><th>Nền tảng</th><th>Tổng</th><th className="g">Live</th><th className="b">Die</th><th className="hm">Khác</th><th className="tr">{ovPerLab()}</th></tr></thead>
        <tbody>{[0, 1, 2, 3, 4, 5].map((i) => <tr key={i}>{["55%", "40%", "40%", "35%", "35%", "45%"].map((w, k) => <td key={k}>{bar(w, i * 0.06 + k * 0.03)}</td>)}</tr>)}</tbody></table></div>
    </section>
  </div>;
}

/** OverviewView: tab Tất cả › Tổng quan (cây phạm vi bên trái, bảng nền tảng của mục đang chọn bên phải). */
/** chọn dòng của Tổng quan / mở menu dòng (OV là kho riêng của màn, ngoài React) */
function ovPick(k: string) { OV.S = k; ls.set("ahs.ovs", k); ovBump(); }
function ovFocus(k: string, t: Id) { OV.F = { k, t }; ovBump(); }
export function OverviewView() {
  useHs(); useOv();
  const tb = useRef<HTMLDivElement>(null), pn = useRef<HTMLElement>(null);
  useEffect(() => { if (S.ts) ovTrendLoad(); });
  useLayoutEffect(() => { if (tb.current) tb.current.scrollTop = OV.scr.t; if (pn.current) pn.current.scrollTop = OV.scr.p; }, []);
  const sk = S.owner != null ? "o" + S.owner : S.dept !== "all" ? "d" + S.dept : "all";
  // đổi phạm vi (thanh Phạm vi / quay lại) → chọn sẵn mục tương ứng, mở nhánh bộ phận của nó, cuộn tới
  useLayoutEffect(() => {
    if (OV.SK === sk) return;
    OV.SK = sk; OV.S = sk;
    if (S.dept !== "all") OV.X.delete("d" + S.dept); else if (S.owner != null && I.own[S.owner]) OV.X.delete("d" + I.own[S.owner].dept_id);
    ovBump();
    const r = requestAnimationFrame(() => tb.current?.querySelector(".ovi.on")?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(r);
  }, [sk]);
  // hiệu ứng (core_animation): ca-sw khi đổi mục đang xem, ca-new cho mục cây vừa xuất hiện (cùng phạm vi)
  const prevSel = useRef<string | null>(null), prevRows = useRef<{ sk: string; ks: Set<string> } | null>(null);
  useLayoutEffect(() => {
    const t = tb.current, p = pn.current; if (!t || !p) return;
    const sel = t.querySelector<HTMLElement>(".ovi.on")?.dataset.k ?? null;
    if (sel !== null && OV.S !== sel) OV.S = sel;
    if (prevSel.current !== null && sel !== prevSel.current) { p.classList.remove("ca-sw"); void p.offsetWidth; p.classList.add("ca-sw"); }
    prevSel.current = sel;
    const els = [...t.querySelectorAll<HTMLElement>(".ovi[data-k]")], ks = new Set(els.map((e) => e.dataset.k || ""));
    const pr = prevRows.current;
    if (pr && pr.sk === sk) for (const e of els) if (!pr.ks.has(e.dataset.k || "")) e.classList.add("ca-new");
    prevRows.current = { sk, ks };
  });
  if (!S.accs.length && !S.ts) return <OvSkel />;
  const D = ovData();
  let sel = OV.S;
  if (!D.rows.some((r) => r.k === sel)) { const o = sel[0] === "o" ? I.own[+sel.slice(1)] : undefined; sel = o && D.rows.some((r) => r.k === "d" + o.dept_id) ? "d" + o.dept_id : sel[0] === "u" && D.rows.some((r) => r.k === "d" + sel.slice(1)) ? "d" + sel.slice(1) : "all"; }
  if (!D.A.length) return <div className="empty"><Ico n="inbox" sz={28} /><span>Chưa có dữ liệu trong phạm vi này</span></div>;
  const r = D.rows.find((x) => x.k === sel) || D.rows[0], c = D.C[r.k] || { T: rpE(), tab: {}, dt: {} }, h = c.T, T = ovN(h);
  const path = r.k[0] === "o" && r.o != null ? [...(I.own[r.o]?.path.slice(0, -1).map((i) => I.own[i]?.name) || []), deptOf(S, r.d === "all" ? null : r.d).name].filter(Boolean).reverse().join(" › ") : r.k[0] === "u" ? deptOf(S, r.d === "all" ? null : r.d).name : "";
  const noown = r.k === "all" ? D.A.filter((a) => !a.owner_id).length : r.k[0] === "d" ? ovN(D.C["u" + r.d]?.T) : null;
  const kc = (cls: string, l: string, v: number, sub: ReactNode) => <div key={l} className={`ovkc ${cls}`}><span>{l}</span><b>{fm(v)}</b><em>{sub}</em></div>;
  const pickRow = (k: string) => ovPick(k);
  const toggle = (k: string) => { if (OV.X.has(k)) OV.X.delete(k); else OV.X.add(k); ovSave(); ovBump(); };
  const rowMenu = (e: React.MouseEvent<HTMLTableRowElement>, t: Id) => {
    ovFocus(sel, t);
    const el = e.currentTarget.getBoundingClientRect(), x = e.clientX || el.left + 40, y = e.clientY || el.bottom, o = r.o ?? null, u = r.k[0] === "u";
    showMenu(x, y, [{ icon: "info", label: "Thông tin", fn: () => ovInfo(r.d, o, t, u) }, { icon: "link", label: "Liên kết", fn: () => ovGo(r.d, o, t, u) }]);
  };
  return <div className="ovw">
    <nav className="ovtr" aria-label="Phạm vi"><div className="ovth"><span>Phạm vi</span><span>Tổng</span><span className="ng">Live</span><span className="nb">Die</span></div>
      <div ref={tb} className="ovtb" onScroll={(e) => { OV.scr.t = e.currentTarget.scrollTop; }}>{D.rows.map((x) => { const cc = D.C[x.k]?.T || rpE(), on = sel === x.k;
        return <button key={x.k} data-k={x.k} className={`ovi ${x.cls || ""} ${on ? "on" : ""}`} style={cssv({ "--lv": x.lv })} aria-current={on} onClick={(e) => { if ((e.target as HTMLElement).closest("[data-tg]")) return; pickRow(x.k); }}>
          <span className="nm0" style={cssv({ "--lv": x.lv })}>
            {x.tg ? <span className={`ovcv ${x.x ? "x" : ""}`} data-tg={x.tg} role="button" aria-label={x.x ? "Mở" : "Thu gọn"} onClick={(e) => { e.stopPropagation(); toggle(x.tg!); }}><Ico n="chevd" sz={14} /></span> : x.k === "all" ? null : <span className="ovsp" />}
            {x.lead}<span className="t">{x.name}</span></span>
          <OvStat x={cc} /></button>; })}</div></nav>
    <section ref={pn} className="ovpn" onScroll={(e) => { OV.scr.p = e.currentTarget.scrollTop; }}>
      <div className="ovph">{r.lead}<div><h2>{r.name}</h2>{path ? <small>{path}</small> : null}</div></div>
      <div className="ovks">
        {kc("", "Tổng", T, <>{D.tabs.filter((t) => ovN(c.tab[t.id])).length} nền tảng · {ovPerLab()} <OvDelta v={c.dt.T || 0} /></>)}
        {kc("g", "Live", h.g, rpPct(h.g, T) + "%")}
        {kc(h.b ? "b" : "", "Die", h.b, rpPct(h.b, T) + "%")}
        {noown != null ? kc("", "Dùng chung", noown, rpPct(noown, T) + "%") : kc("", "Khác", h.w + h.n, "chưa rõ trạng thái")}
      </div>
      <div className="ovtw2"><table className="ovt"><thead><tr><th>Nền tảng</th><th>Tổng</th><th className="g">Live</th><th className="b">Die</th><th className="hm">Khác</th>
        <th className="tr"><button className="ovpb" aria-haspopup="true" title="Tăng / giảm số tài khoản (mới tạo − đã xóa) — bấm để đổi khoảng thời gian" onClick={(e) => openPop(e.currentTarget, <OvPeriod />, "tpk ovrgp")}>{ovPerLab()}<Ico n="chevd" sz={13} /></button></th></tr></thead>
        <tbody>{D.tabs.filter((t) => ovN(c.tab[t.id])).map((t) => { const x = c.tab[t.id], n = ovN(x);
          return <tr key={t.id} className={OV.F && OV.F.k === sel && OV.F.t === t.id ? "focus" : ""} onClick={(e) => rowMenu(e, t.id)}>
            <td><span className="pf"><Ico n={t.icon} sz={15} />{t.name}</span></td><td className="s0">{fm(n)}</td><td className="g">{fm(x.g)}</td><td className="b">{fm(x.b)}</td><td className="hm s0">{fm(x.w + x.n)}</td><td className="tr"><OvDelta v={c.dt[t.id] || 0} /></td></tr>; })}</tbody></table></div>
    </section>
  </div>;
}
