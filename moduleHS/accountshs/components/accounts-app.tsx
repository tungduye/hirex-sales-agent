"use client";

// Khung AccountsHS trong HireX: #top (phạm vi · đếm · giao diện · cài đặt) · #tb (tab) · #bar (tìm/lọc/thêm) · #main · #foot · #sel.
// Bố cục/DOM giữ như v7.py để CSS gốc + 20 theme áp được nguyên vẹn. Dữ liệu: store.ts (S/I); từng màn ở các file cùng thư mục.
import "./accountshs.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Id } from "../types";
import { getView, isTbl, scopeTotal, scoped, stOf, type TabKey } from "../core/model";
import { TAB_NEUTRAL } from "../core/text";
import { Ico } from "./icons";
import { GS, I, NAV, S, UI, emit, load, loadPref, navGo, navPush, reload, savePref, setTab, store, useHs } from "./store";
import { LayerHost, closePop, openPop } from "./ui-kit";
import { TableView, BarView, SelBar } from "./table";
import { ScopeMenu } from "./scope";
import { openSettings, ThemePicker, useTheme } from "./settings";
import { DevicesView } from "./devices";
import { ReportView, OverviewView, OverviewBar } from "./reports";
import { GraphView } from "./graph";
import { OwlButton } from "./owl-chat";
import { installAnimation } from "./animation";
import { installShortcuts } from "./shortcuts";
import { CheckerPanel } from "./checker-panel";
import { CrmPanel } from "./crm-panel";

export function AccountsApp({ canEdit, canManage }: { canEdit: boolean; canManage: boolean }) {
  useHs();
  const [boot, setBoot] = useState<"loading" | "ok" | "err">("loading");
  const [err, setErr] = useState("");
  const theme = useTheme();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (store.canEdit === canEdit && store.canManage === canManage) return;
    store.canEdit = canEdit; store.canManage = canManage; emit();
  }, [canEdit, canManage]);

  useEffect(() => {
    let alive = true;
    (async () => {
      loadPref(); try { S.ov = localStorage.getItem("ahs.ov") === "1"; } catch { /* bộ nhớ bị khoá */ }
      try { await load(true); if (!alive) return; if (S.tab == null) S.tab = "all"; navPush(); store.booted = true; setBoot("ok"); emit(); }
      catch (e) { if (!alive) return; setErr(e instanceof Error ? e.message : String(e)); setBoot("err"); }
    })();
    const un1 = installShortcuts(), un2 = installAnimation(root.current!);
    return () => { alive = false; un1(); un2(); UI.closeAll(); };
  }, []);

  return <div ref={root} className="hs-acc" data-theme={theme === "base" ? undefined : theme}>
    <div id="app">
      {boot === "loading" ? <div id="boot" role="status" aria-live="polite"><i className="ldr" /><span id="bt">Đang tải dữ liệu…</span></div> : null}
      {boot === "err" ? <div id="boot" role="alert"><Ico n="alert" sz={18} /><span id="bt">{err}</span><button className="btn sm outline" onClick={() => { setBoot("loading"); void load(true).then(() => { store.booted = true; setBoot("ok"); emit(); }).catch((e) => { setErr(String(e?.message || e)); setBoot("err"); }); }}><Ico n="refresh" sz={14} />Thử lại</button></div> : null}
      {boot === "ok" ? <><Top /><Tabs /><Bar /><Main /><Foot /><CheckerPanel />{store.canManage ? <CrmPanel /> : null}</> : null}
    </div>
    {boot === "ok" ? <SelBar /> : null}
    <LayerHost theme={theme === "base" ? undefined : theme} />
  </div>;
}

/* ───────── #top ───────── */
function scopeInfo() {
  if (S.owner != null && I.own[S.owner]) { const o = I.own[S.owner], d = S.meta.depts.find((x) => x.id === o.dept_id); return { kind: "Owner", name: o.name, sub: d ? d.name : "", ic: "user" }; }
  if (S.dept !== "all" && S.meta.depts.find((x) => x.id === S.dept)) { const d = S.meta.depts.find((x) => x.id === S.dept)!; return { kind: "Bộ phận", name: d.name, sub: "", ic: "briefcase" }; }
  return { kind: "Toàn hệ thống", name: "Toàn hệ thống", sub: "", ic: "globe" };
}
function Top() {
  useHs();
  const sc = scopeInfo();
  const [spin, setSpin] = useState(false);
  const doReload = async () => { if (spin) return; setSpin(true); try { await reload(); } finally { setSpin(false); } };
  return <div id="top">
    <div className="navb">
      <button className="btn icon sm ghost" title="Quay lại (Alt+←)" disabled={NAV.i <= 0} onClick={() => navGo(-1, document.getElementById("tw")?.scrollTop)}><Ico n="chevl" sz={16} /></button>
      <button className="btn icon sm ghost" title="Đi tiếp (Alt+→)" disabled={NAV.i >= NAV.h.length - 1} onClick={() => navGo(1, document.getElementById("tw")?.scrollTop)}><Ico n="chevr" sz={16} /></button>
    </div>
    <button className={`btn icon sm ghost ${spin ? "busy" : ""}`} data-a="reload" title="Làm mới & về Tất cả" onClick={doReload}><Ico n="refresh" sz={16} /></button><span className="tsep" />
    <button className="btn scp" aria-haspopup="true" title="Chọn phạm vi xem: toàn hệ thống, bộ phận hoặc owner" onClick={(e) => openPop(e.currentTarget, <ScopeMenu />, "scpm")}>
      <span className="scp-k">Phạm vi</span><span className="scp-sp" /><span className="nm">{sc.name}</span>
      {sc.ic !== "globe" ? <span className="scp-sub">{sc.kind}{sc.sub ? " · " + sc.sub : ""}</span> : null}<Ico n="chevd" sz={14} />
    </button>
    <div className="grow" /><Counts />
    <button className="btn icon ghost thpk" title="Giao diện" aria-label="Giao diện" onClick={(e) => openPop(e.currentTarget, <ThemePicker />, "thp")}><Ico n="palette" sz={18} /></button>
    {store.canManage ? <button className="btn icon ghost" title="Tùy chỉnh" aria-label="Tùy chỉnh" onClick={() => openSettings()}><Ico n="gear" sz={18} /></button> : null}
  </div>;
}
export function Counts({ drag }: { drag?: boolean }) {
  useHs();
  const n = S.sel.size;
  const c: Record<string, number> = {};
  if (n && !drag) for (const id of S.sel) { const s = I.acc[id] ? stOf(I, I.acc[id]) : undefined; const k = s ? s.color : "#d4d4d8"; c[k] = (c[k] || 0) + 1; }
  return <div className="cnts" id="cnt">
    <span className={`cn s ${n ? "on" : ""} ${drag ? "drag" : ""}`} title="Số dòng đang chọn"><Ico n="check" sz={14} /><span className="l">Đã chọn</span><b>{n}</b>
      {n && !drag ? <span className="dots">{Object.entries(c).slice(0, 5).map(([k, v]) => <i key={k} style={{ background: k }} title={String(v)} />)}</span> : null}</span>
    {isTbl(S) ? <span className="cn" title="Số dòng đang hiển thị sau khi lọc"><Ico n="eye" sz={14} /><span className="l">Hiển thị</span><b>{S.view.length}</b></span> : null}
    <span className="cn" title="Tổng số trong phạm vi đang xem"><Ico n="layers" sz={14} /><span className="l">Tổng</span><b>{scopeTotal(S, I)}</b></span>
  </div>;
}

/* ───────── #tb: dải tab ───────── */
function allTabInfo() {
  if (S.owner != null && I.own[S.owner]) return { ic: "user", n: "Tất cả của " + I.own[S.owner].name };
  if (S.dept !== "all" && S.meta.depts.find((x) => x.id === S.dept)) return { ic: "briefcase", n: "Tất cả của " + S.meta.depts.find((x) => x.id === S.dept)!.name };
  return { ic: "apps", n: "Tất cả" };
}
export const tabTint = (t: { color?: string }) => { const c = (t.color || "").toLowerCase(); return c && c !== TAB_NEUTRAL && c !== "#52525b" ? ({ "--c": c } as React.CSSProperties) : undefined; };
function Tb({ id, ic, name, n, style }: { id: TabKey; ic: string; name: string; n?: number; style?: React.CSSProperties }) {
  return <button className={`tab ${S.tab === id ? "on" : ""}`} style={style} role="tab" aria-selected={S.tab === id} title={name} onClick={() => { closePop(); setTab(id); }}>
    <Ico n={ic} sz={15} /><span>{name}</span>{n != null ? <em>{n}</em> : null}</button>;
}
function Tabs() {
  useHs();
  const cnt: Record<number, number> = {}; const sc = scoped(S, I); for (const a of sc) cnt[a.tab_id] = (cnt[a.tab_id] || 0) + 1;
  const at = allTabInfo();
  const solo = !isTbl(S) || (S.tab !== "all" && !(typeof S.tab === "number" && I.tab[S.tab]));
  return <div id="tb" className={solo ? "solo" : ""}>
    <nav className="tabs" role="tablist" aria-label="Các tab và công cụ">
      <Tb id="all" ic={at.ic} name={at.n} n={sc.length} /><span className="tsep" />
      {S.meta.tabs.map((t) => <Tb key={t.id} id={t.id} ic={t.icon} name={t.name} n={(cnt[t.id] || 0) + (t.lazy_n || 0)} style={tabTint(t)} />)}
      <span className="tsep" /><Tb id="graph" ic="network" name="Sơ đồ liên kết" /><Tb id="report" ic="chart" name="Báo cáo" /><Tb id="device" ic="smartphone" name="Thiết bị" n={S.devices.length} />
    </nav>
  </div>;
}

/* ───────── #bar ───────── */
function Bar() {
  useHs();
  if (S.tab === "device") return <div id="bar"><DevicesView.Bar /></div>;
  if (S.tab === "all" && S.ov) return <div id="bar"><OverviewBar /></div>;
  if (!isTbl(S) || (S.tab !== "all" && !(typeof S.tab === "number" && I.tab[S.tab]))) return <div id="bar" style={{ display: "none" }} />;
  return <div id="bar"><BarView extra={<OwlButton />} /></div>;
}

/* ───────── #main ───────── */
function Main() {
  useHs();
  if (S.tab === "graph") return <div id="main" className="main gp"><GraphView global state={GS} /></div>;
  if (S.tab === "report") return <div id="main" className="main"><ReportView /></div>;
  if (S.tab === "all" && S.ov) return <div id="main" className="main"><OverviewView /></div>;
  if (S.tab === "device") return <div id="main" className="main"><DevicesView /></div>;
  if (S.tab !== "all" && !(typeof S.tab === "number" && I.tab[S.tab])) return <div id="main" className="main"><div className="empty"><Ico n="inbox" sz={28} /></div></div>;
  return <div id="main" className="main"><TableView /></div>;
}

/* ───────── #foot ───────── */
function Foot() {
  useHs();
  if (!isTbl(S)) return <div id="foot" style={{ display: "none" }} />;
  const n = getView(S, I).length;
  const unl = S.tab === "all" ? S.meta.tabs.filter((x) => x.lazy && !S.lz.has(x.id)) : [];
  return <div id="foot"><div className="grow" /><span className="pg" title="Tổng số dòng đang hiển thị">{n.toLocaleString("vi")} dòng</span>
    {unl.length ? <span className="pg lzn" title="Tab tải riêng — chưa nạp nên chưa nằm trong “Tất cả”. Mở tab để nạp.">Chưa tải: {unl.map((x) => x.name).join(" · ")}</span> : null}</div>;
}

export { savePref, GS };
export type { Id };
