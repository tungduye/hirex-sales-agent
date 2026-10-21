"use client";

// Tùy chỉnh (modal .sg): Bộ phận · Owner · Tab · Trường · Trạng thái · Liên kết · Giao diện · Sao lưu · Nhật ký · Kiểm tra
// + giao diện (theme): useTheme() / ThemePicker. Sao lưu · Nhật ký (+ lịch sử hist_cfg) · Kiểm tra ở ./settings-data. Port của drawSettings + ACT (sec/sftab/sfdept/sadd/del/mv/iconpick/seticon/
// grpicon/setgicon/tablazy/tabtint/arw/tab_keys/lookup) và khối theme (thApply/thList/thPopHtml) trong v7.py.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { Dept, Field, FieldType, Id, Status, Tab } from "../types";
import { TYPES, buildIndex, desc, lookupCfg, scopeCalc, treeOrder } from "../core/model";
import { PAL, indent } from "../core/text";
import { IC, ICSEC, ICVI, Ico, TABICONS } from "./icons";
import { API, I, S, api, confirmBox, emit, load, mut, savePref, store, toast, useHs } from "./store";
import { Combo, Switch, closeModal, closePop, openModal, openPop, type ComboOpt } from "./ui-kit";
import { OwlSettings } from "./owl-chat";
import { BackupPane, HealthPane, LogPane } from "./settings-data";

export const cv = (c: string) => ({ "--c": c } as CSSProperties);
/** ghi cài đặt: lỗi → tải lại dữ liệu (như bản gốc: catch → load() → vẽ lại); trả về promise để ô nhập tự hoàn tác. */
function save<R = Record<string, unknown>>(path: string, body: unknown): Promise<R> {
  const r = mut<R>(path, body);
  r.catch(() => { load().then(emit, () => undefined); });
  return r;
}
type MetaTable = "depts" | "owners" | "tabs" | "fields" | "statuses";
type Sec = "dept" | "owner" | "tab" | "field" | "status" | "link" | "theme" | "owl" | "backup" | "log" | "health";

/* ───────── trạng thái modal (SET) ───────── */
const SET: { sec: Sec; tab: Id | null; dept: Id | null; v: number } = { sec: "dept", tab: null, dept: null, v: 0 };
const redrawLs = new Set<() => void>();
const redraw = () => { SET.v++; for (const f of redrawLs) f(); };
const useSet = () => useSyncExternalStore((f) => { redrawLs.add(f); return () => { redrawLs.delete(f); }; }, () => SET.v, () => SET.v);

/** openSettings(sec?) — mở modal Tùy chỉnh (chỉ khi có quyền quản trị). */
export function openSettings(sec?: Sec) {
  if (!store.canManage) return;
  if (sec) SET.sec = sec;
  if (SET.tab == null || !I.tab[SET.tab]) SET.tab = typeof S.tab === "number" && I.tab[S.tab] ? S.tab : S.meta.tabs[0]?.id ?? null;
  if (SET.dept == null || !S.meta.depts.find((d) => d.id === SET.dept)) SET.dept = S.dept !== "all" ? S.dept : S.meta.depts[0]?.id ?? null;
  openModal(<SettingsModal />, true);
}

const NAV: Array<[Sec, string]> = [["dept", "folder"], ["owner", "users"], ["tab", "layers"], ["field", "columns"], ["status", "tag"], ["link", "link"], ["theme", "palette"], ["owl", "owl"], ["backup", "save"], ["log", "activity"], ["health", "shield"]];
const NM: Record<Sec, string> = { dept: "Bộ phận", owner: "Owner", tab: "Tab", field: "Trường", status: "Trạng thái", link: "Liên kết", theme: "Giao diện", owl: "Cú vọ", backup: "Sao lưu", log: "Nhật ký", health: "Kiểm tra" };

function SettingsModal() {
  useHs(); useSet(); useThemeList();
  const t = SET.tab != null ? I.tab[SET.tab] : undefined;
  const nav = NAV.filter(([k]) => !(k === "theme" && TH.list && !TH.list.length));
  let body: ReactNode = null;
  if (SET.sec === "dept") body = <DeptSec />;
  else if (SET.sec === "owner") body = <OwnerSec />;
  else if (SET.sec === "tab") body = <TabSec />;
  else if (SET.sec === "field") body = t ? <FieldSec t={t} /> : <TabSel />;
  else if (SET.sec === "status") body = t ? <StatusSec t={t} /> : <TabSel />;
  else if (SET.sec === "link") body = <LinkSec />;
  else if (SET.sec === "theme") body = <ThemeGrid />;
  else if (SET.sec === "owl") body = <OwlSettings />;
  else if (SET.sec === "backup") body = <BackupPane />;
  else if (SET.sec === "log") body = <LogPane />;
  else if (SET.sec === "health") body = <HealthPane />;
  return <>
    <header><span className="ti" style={cv("#0ea5e9")}><Ico n="gear" sz={16} /></span><h3>Tùy chỉnh</h3><div className="grow" /><button className="btn icon ghost" title="Đóng" onClick={() => closeModal()}><Ico n="x" sz={16} /></button></header>
    <div className="sg">
      <div className="snav">{nav.map(([k, ic]) => <button key={k} className={SET.sec === k ? "on" : ""} onClick={() => { SET.sec = k; redraw(); }}><Ico n={ic} sz={16} /><span>{NM[k]}</span></button>)}</div>
      <div className="spane"><h4 className="sph">{NM[SET.sec]}</h4>{body}</div>
    </div>
  </>;
}

/* ───────── ô nhập: ghi khi blur / Enter (như sự kiện change gốc) ───────── */
function TxtIn({ value, onCommit, className = "in", placeholder, title, list, type, min, step, style }: { value: string; onCommit: (v: string) => unknown; className?: string; placeholder?: string; title?: string; list?: string; type?: string; min?: number; step?: number; style?: CSSProperties }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setV(value); }
  const commit = () => { if (v === value) return; const r = onCommit(v); if (r instanceof Promise) r.catch(() => setV(value)); };
  return <input className={className} value={v} placeholder={placeholder} title={title} list={list} type={type} min={min} step={step} style={style} autoComplete="off"
    onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }} />;
}
/** <input type=color class=clr>: chỉ ghi khi hộp chọn màu đóng (sự kiện change gốc), không ghi theo từng lần kéo. */
function ColorIn({ value, onCommit, className = "clr" }: { value: string; onCommit: (v: string) => unknown; className?: string }) {
  const ref = useRef<HTMLInputElement>(null); const cb = useRef(onCommit); useLayoutEffect(() => { cb.current = onCommit; });
  useEffect(() => { const el = ref.current; if (!el) return; const h = () => cb.current(el.value); el.addEventListener("change", h); return () => el.removeEventListener("change", h); }, []);
  return <input ref={ref} type="color" className={className} defaultValue={value} key={value} />;
}

/* ───────── sắp xếp (lên/xuống) · xoá ───────── */
function listOf(t: MetaTable, id: Id): Id[] {
  if (t === "depts") return S.meta.depts.map((x) => x.id);
  if (t === "tabs") return S.meta.tabs.map((x) => x.id);
  if (t === "fields") return (SET.tab != null ? I.tab[SET.tab]?.fields || [] : []).map((x) => x.id);
  if (t === "statuses") return (SET.tab != null ? I.tab[SET.tab]?.statuses || [] : []).map((x) => x.id);
  const o = I.own[id]; if (!o) return [];
  const p = o.parent_id != null ? I.own[o.parent_id] : undefined;
  return (p && p.dept_id === o.dept_id ? I.kids[p.id] || [] : I.roots[o.dept_id] || []).slice();
}
async function mv(t: MetaTable, id: Id, d: number) {
  const ids = listOf(t, id), i = ids.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await save("reorder", { table: t, ids }).catch(() => undefined);
}
function impactMsg(t: MetaTable, id: Id) {
  let nm = "", n = 0;
  if (t === "depts") { nm = I.dpt[id]?.name || "—"; n = I.deptN[id] || 0; }
  else if (t === "owners") { nm = I.own[id]?.name || ""; n = I.ownN[id] || 0; }
  else if (t === "tabs") { nm = I.tab[id]?.name || ""; n = S.accs.filter((a) => a.tab_id === id).length; }
  else if (t === "fields") { const f = I.field[id]; nm = f?.label || ""; n = S.accs.filter((a) => f?.type === "link" ? (I.out[a.id]?.[id] || []).length > 0 : (a.data[String(id)] ?? "") !== "").length; }
  else if (t === "statuses") { nm = I.status[id]?.label || ""; n = S.accs.filter((a) => a.status_id === id).length; }
  return `"${nm}"  ·  ${n} mục bị ảnh hưởng` + (t === "statuses" ? " (→ trạng thái trống)" : t === "owners" ? " (→ chuyển cho cấp trên)" : "") + ". Xóa?";
}
async function del(t: MetaTable, id: Id) {
  if (t === "depts" && S.meta.depts.length < 2) { toast("Cần ít nhất 1 bộ phận", "err"); return; }
  if (await confirmBox(impactMsg(t, id))) await save("delete", { table: t, id }).catch(() => undefined);
}
const MvBtns = ({ t, id }: { t: MetaTable; id: Id }) => <>
  <button className="btn icon ghost sm" title="Lên" onClick={() => void mv(t, id, -1)}><Ico n="up" sz={14} /></button>
  <button className="btn icon ghost sm" title="Xuống" onClick={() => void mv(t, id, 1)}><Ico n="down" sz={14} /></button>
  <button className="btn icon ghost sm" title="Xóa" onClick={() => void del(t, id)}><Ico n="trash" sz={15} /></button>
</>;
/** sau khi thêm: chọn ô tên của dòng mới (ins[ins.length-1].select()) */
const selectLast = () => setTimeout(() => { const ins = document.querySelectorAll<HTMLInputElement>(".hs-acc .spane .srow input.in"); ins[ins.length - 1]?.select(); }, 30);
const AddBtn = ({ onClick }: { onClick: () => void }) => <div><button className="btn outline" title="Thêm" onClick={onClick}><Ico n="plus" sz={16} /></button></div>;

/* ───────── bộ chọn tab / bộ phận trong pane ───────── */
function TabSel() {
  return <div className="tsel">{S.meta.tabs.map((t) => <button key={t.id} className={`chip ${SET.tab === t.id ? "on" : ""}`} onClick={() => { SET.tab = t.id; redraw(); }}><Ico n={t.icon} sz={14} />{t.name}</button>)}</div>;
}
function DeptSel() {
  return <div className="tsel">{S.meta.depts.map((d) => <button key={d.id} className={`chip ${SET.dept === d.id ? "on" : ""}`} onClick={() => { SET.dept = d.id; redraw(); }}><i className="dot" style={{ background: d.color }} />{d.name}</button>)}</div>;
}

/* ───────── Bộ phận ───────── */
function DeptSec() {
  return <>
    {S.meta.depts.map((d: Dept) => <div key={d.id} className="srow">
      <ColorIn value={d.color} onCommit={(v) => save("dept", { id: d.id, color: v })} />
      <TxtIn value={d.name} onCommit={(v) => save("dept", { id: d.id, name: v })} />
      <MvBtns t="depts" id={d.id} />
    </div>)}
    <AddBtn onClick={() => void save("dept", { name: "Bộ phận mới", color: "#6366f1" }).then(selectLast)} />
  </>;
}

/* ───────── Owner (cây cha–con) ───────── */
function OwnerSec() {
  const dept = SET.dept; const tree = dept != null ? treeOrder(I, dept) : [];
  return <>
    <DeptSel />
    {tree.map(({ o, d }) => {
      const bad = desc(I, o.id);
      const opts: ComboOpt[] = [{ v: "", t: "{Không có cấp trên}" }, ...tree.filter((x) => !bad.has(x.o.id)).map((x) => ({ v: String(x.o.id), t: indent(x.d, x.o.name) }))];
      return <div key={o.id} className="srow" style={{ paddingLeft: d * 22 }}>
        {d ? <span className="kb" style={{ color: "#a1a1aa" }}><Ico n="sub" sz={14} /></span> : null}
        <ColorIn value={o.color} onCommit={(v) => save("owner", { id: o.id, color: v })} />
        <TxtIn value={o.name} onCommit={(v) => save("owner", { id: o.id, name: v })} />
        <Combo className="in w" title="Cấp trên" value={o.parent_id != null ? String(o.parent_id) : ""} opts={opts} onChange={(v) => void save("owner", { id: o.id, parent_id: v ? +v : null })} />
        <span className="hc">{I.ownN[o.id] || 0}</span>
        <MvBtns t="owners" id={o.id} />
      </div>;
    })}
    <AddBtn onClick={() => { if (dept == null) return; void save("owner", { dept_id: dept, name: "Owner mới", color: "#667085", parent_id: null }).then(selectLast); }} />
  </>;
}

/* ───────── Tab ───────── */
const grpIc = (g: string) => { const v = S.meta.grp_icons?.[g]; return v && IC[v] ? v : ""; };
function TabSec() {
  const grps = [...new Set(S.meta.tabs.map((t) => t.grp).filter(Boolean))];
  return <>
    {S.meta.tabs.map((x: Tab) => {
      const g = (x.grp || "").trim();
      return <div key={x.id} className="srow">
        <button className="icb" style={{ color: x.color }} title="Icon" onClick={(e) => openPop(e.currentTarget, <IconPicker cur={x.icon} onPick={(ic) => { closePop(); void save("tab", { id: x.id, icon: ic }); }} />, "icpop")}><Ico n={x.icon} sz={18} /></button>
        <ColorIn value={x.color} onCommit={(v) => save("tab", { id: x.id, color: v })} />
        <TxtIn value={x.name} onCommit={(v) => save("tab", { id: x.id, name: v })} />
        <label className="grpin" title="Nhóm tab: các tab cùng nhóm được gom vào 1 mục trên thanh tab">
          {g ? <button className="icb gic" title={`Icon nhóm ${g}`} onClick={(e) => openPop(e.currentTarget, <GrpIconPicker g={g} />, "icpop")}><Ico n={grpIc(g) || "folder"} sz={15} /></button> : <Ico n="folder" sz={14} />}
          <TxtIn value={x.grp || ""} placeholder="Nhóm" list="tabgrps" onCommit={(v) => save("tab", { id: x.id, grp: v })} />
        </label>
        <label className="lzs" title={"Tải riêng: không nạp dữ liệu tab này lúc mở app, chỉ nạp khi mở tab (dành cho tab rất nhiều dòng)" + (x.lazy_n ? " · " + x.lazy_n.toLocaleString("vi") + " dòng" : "")}>
          <Switch on={!!+x.lazy} onChange={(on) => { if (on) S.lz.delete(x.id); void save("tab", { id: x.id, lazy: on ? 1 : 0 }); }} /><span>Tải riêng</span>
        </label>
        <MvBtns t="tabs" id={x.id} />
      </div>;
    })}
    <datalist id="tabgrps">{grps.map((g) => <option key={g} value={g} />)}</datalist>
    <AddBtn onClick={() => void save<{ id: Id }>("tab", { name: "Tab mới", icon: "user", color: "#667085", _init: 1 }).then((r) => { SET.tab = r.id; redraw(); selectLast(); })} />
  </>;
}
function GrpIconPicker({ g }: { g: string }) {
  const cur = grpIc(g);
  const set = (ic: string) => { closePop(); void save("grp_icon", { g, icon: ic }); };
  return <IconPicker cur={cur} onPick={set} head={<div className="icgh"><span>Icon nhóm <b>{g}</b></span>{cur ? <button className="btn ghost sm" onClick={() => set("")}>Mặc định</button> : null}</div>} />;
}

/* ───────── bộ chọn icon có tìm kiếm, chia nhóm (r75) ───────── */
const icNorm = (s: string) => String(s || "").toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "");
function icSecs(): Array<[string, string[]]> {
  const used = new Set<string>();
  const secs: Array<[string, string[]]> = [["Thương hiệu", [...TABICONS.filter((n) => n.startsWith("b_")), ...ICSEC[0][1]]], ...ICSEC.slice(1)];
  for (const [, k] of secs) for (const n of k) used.add(n);
  secs.push(["Cơ bản", TABICONS.filter((n) => !used.has(n))]);
  return secs.filter((s) => s[1].length);
}
export function IconPicker({ cur, onPick, head }: { cur: string; onPick: (n: string) => void; head?: ReactNode }) {
  const [q, setQ] = useState(""); const box = useRef<HTMLDivElement>(null); const inp = useRef<HTMLInputElement>(null);
  const v = icNorm(q.trim());
  const secs = icSecs().map(([t, k]) => [t, k.filter((n) => IC[n]).map((n) => ({ n, l: ICVI[n] || n, q: icNorm((ICVI[n] || n) + " " + n.replace(/^[bls]_/, "").replace(/_/g, " ")) })).filter((x) => !v || x.q.includes(v))] as const).filter((s) => s[1].length);
  useEffect(() => { setTimeout(() => inp.current?.focus({ preventScroll: true }), 0); const on = box.current?.querySelector(".icsc button.on"); if (on) requestAnimationFrame(() => on.scrollIntoView({ block: "center" })); }, []);
  const first = secs[0]?.[1][0];
  return <>{head}<div className="icpk">
    <label className="icq"><Ico n="search" sz={14} /><input ref={inp} className="in" placeholder="Tìm icon: điện thoại, máy chủ, tiktok…" autoComplete="off" aria-label="Tìm icon" value={q} onChange={(e) => { setQ(e.target.value); if (box.current) box.current.scrollTop = 0; }} onKeyDown={(e) => { if (e.key === "Enter" && first) { e.preventDefault(); onPick(first.n); } }} /></label>
    <div className="icsc" ref={box}>
      {secs.map(([t, k]) => <section key={t} className="ics"><div className="ich">{t}</div><div className="icgrid">{k.map((x) => <button key={x.n} className={cur === x.n ? "on" : ""} title={x.l} aria-label={x.l} onClick={() => onPick(x.n)}><Ico n={x.n} sz={18} /></button>)}</div></section>)}
      {secs.length ? null : <div className="icnone">Không có icon phù hợp</div>}
    </div>
  </div></>;
}

/* ───────── Trường ───────── */
/** r72: đổi kiểu / tab liên kết áp dụng NGAY trên máy rồi mới gửi lên. */
function fieldMut(id: Id, body: Partial<Field>) {
  const f = I.field[id];
  if (f) {
    Object.assign(f, body);
    if ("type" in body && body.type !== "link") { f.link_tab = null; S.links = S.links.filter((l) => l.f !== id); }
    if ("link_tab" in body) S.links = S.links.filter((l) => l.f !== id || I.acc[l.dst]?.tab_id === body.link_tab);
    buildIndex(S, I); scopeCalc(S, I); emit();
  }
  return save("field", { id, ...body });
}
const tabKeys = (tid: Id): Id[] => { const v = S.meta.tab_keys?.[String(tid)]; return Array.isArray(v) ? v.filter((id) => I.field[id] && I.field[id].tab_id === tid) : []; };
function TabKeysRow({ t }: { t: Tab }) {
  const ks = tabKeys(t.id), k1 = ks[0] ?? t.fields[0]?.id, k2 = ks[1] ?? "", fs = t.fields.filter((f) => !["link", "lookup", "file"].includes(f.type));
  const setK = (a: string, b: string) => void save("tab_keys", { tab_id: t.id, keys: [a, b].filter(Boolean).map(Number) });
  const s1 = k1 != null ? String(k1) : "", s2 = String(k2);
  return <div className="srow tkrow" title="Nhập hàng loạt dùng khóa này để nhận diện dòng đã có (trùng cả 2 cột mới tính là trùng)">
    <span className="kb"><Ico n="key" sz={14} /></span><span className="tkl">Khóa trùng</span>
    <Combo className="in" value={s1} opts={fs.map((f) => ({ v: String(f.id), t: f.label }))} onChange={(v) => setK(v, s2)} /><span className="mut">+</span>
    <Combo className="in" value={s2} opts={[{ v: "", t: "{Không}" }, ...fs.filter((f) => String(f.id) !== s1).map((f) => ({ v: String(f.id), t: f.label }))]} onChange={(v) => setK(s1, v)} />
  </div>;
}
function FieldSec({ t }: { t: Tab }) {
  return <>
    <TabSel /><TabKeysRow t={t} />
    {t.fields.map((f, i) => <div key={f.id} className="srow">
      <span className="kb" title="Hiển thị làm tên">{i === 0 ? <Ico n="key" sz={14} /> : null}</span>
      <TxtIn value={f.label} onCommit={(v) => fieldMut(f.id, { label: v })} />
      <Combo className="in w" value={f.type} opts={TYPES.map((y) => ({ v: y[0], t: y[1] }))} onChange={(v) => void fieldMut(f.id, { type: v as FieldType })} />
      <FieldExtra t={t} f={f} />
      <MvBtns t="fields" id={f.id} />
    </div>)}
    <AddBtn onClick={() => void save("field", { tab_id: t.id, label: "Trường mới", type: "text" }).then(selectLast)} />
  </>;
}
function FieldExtra({ t, f }: { t: Tab; f: Field }) {
  if (f.type === "select") return <TxtIn value={f.opts || ""} placeholder="a, b, c" onCommit={(v) => fieldMut(f.id, { opts: v })} />;
  if (f.type === "link") return <>
    <Combo className="in" value={f.link_tab != null ? String(f.link_tab) : ""} opts={[{ v: "", t: "{Chưa chọn}" }, ...S.meta.tabs.map((x) => ({ v: String(x.id), t: x.name }))]} onChange={(v) => void fieldMut(f.id, { link_tab: v ? +v : null })} />
    <TxtIn value={f.opts || ""} placeholder="Nhãn chiều ngược, vd: Dùng để xác minh" title="Nhãn diễn giải khi xem từ phía dòng được liên kết (không đảo chiều dữ liệu)" onCommit={(v) => fieldMut(f.id, { opts: v })} />
  </>;
  if (f.type === "lookup") {
    const lo = lookupCfg(f), links = t.fields.filter((x) => x.type === "link"), via = lo.via ? I.field[lo.via] : undefined, tt = via && via.link_tab != null ? I.tab[via.link_tab] : undefined;
    const setLk = (v: string, k: string) => void fieldMut(f.id, { opts: JSON.stringify({ via: v ? +v : 0, take: k ? +k : 0 }) });
    return <>
      <Combo className="in w" title="Qua trường Liên kết nào" value={lo.via ? String(lo.via) : ""} opts={[{ v: "", t: "{Qua trường…}" }, ...links.map((x) => ({ v: String(x.id), t: `${x.label} → ${x.link_tab != null ? I.tab[x.link_tab]?.name || "" : ""}` }))]} onChange={(v) => setLk(v, lo.take ? String(lo.take) : "")} />
      <Combo className="in w" title="Lấy giá trị của trường nào ở tab đích" disabled={!tt} value={lo.take ? String(lo.take) : ""} opts={[{ v: "", t: "{Lấy trường…}" }, ...(tt ? tt.fields : []).filter((x) => x.type !== "link" && x.type !== "lookup").map((x) => ({ v: String(x.id), t: x.label }))]} onChange={(v) => setLk(lo.via ? String(lo.via) : "", v)} />
    </>;
  }
  return <div className="in ghosty" />;
}

/* ───────── Trạng thái ───────── */
function StatusSec({ t }: { t: Tab }) {
  return <>
    <TabSel />
    <div className="srow rtsw"><span className="grow"><Ico n="palette" sz={15} /><span>Tô màu dòng theo trạng thái</span><small className="mut">chỉ trong tab {t.name}</small></span>
      <Switch on={!!+t.tint} title="Bật / tắt" onChange={(on) => void save("tab", { id: t.id, tint: on ? 1 : 0 })} /></div>
    {t.statuses.map((s: Status) => <div key={s.id} className="srow">
      <ColorIn value={s.color} onCommit={(v) => save("status", { id: s.id, color: v })} />
      <TxtIn value={s.label} onCommit={(v) => save("status", { id: s.id, label: v })} />
      <MvBtns t="statuses" id={s.id} />
    </div>)}
    <AddBtn onClick={() => void save("status", { tab_id: t.id, label: "Trạng thái mới", color: PAL[t.statuses.length % PAL.length] }).then(selectLast)} />
  </>;
}

/* ───────── Liên kết: mũi tên + giải thích 2 chiều ───────── */
export const ARW = ["→", "⟶", "➜", "➔", "⇒", "▸", "»", "←", "⟵", "⇐", "◂", "«"], ARL = new Set(["←", "⟵", "⇐", "◂", "«"]);
export const ARH: Array<[string, string]> = [["tri", "Tam giác"], ["open", "Mũi nhọn"], ["dot", "Chấm tròn"], ["none", "Không"]];
export function aw() { if (!S.arw) S.arw = { o: "→", i: "←", h: "tri", v2: 1 }; else if (!S.arw.v2) { if (S.arw.i === S.arw.o) S.arw.i = "←"; S.arw.v2 = 1; } return S.arw; }
export const relPath = (from: string, mid: string, to: string, g: string) => ARL.has(g) ? `${to} ${g} ${mid} ${g} ${from}` : `${from} ${g} ${mid} ${g} ${to}`;
/** <marker> đầu mũi tên cho SVG (dùng trong <defs>). */
export function ArwMarker({ id, c, sz, h }: { id: string; c: string; sz: number; h?: string }) {
  const k = h || aw().h;
  return <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={sz} markerHeight={sz} markerUnits="userSpaceOnUse" orient="auto">
    {k === "open" ? <path d="M1.5 1.5 9 5 1.5 8.5" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /> : k === "dot" ? <circle cx="6" cy="5" r="3.2" fill={c} /> : k === "none" ? null : <path d="M1 1.5 9 5 1 8.5z" fill={c} />}
  </marker>;
}
function LinkSec() {
  const A = aw();
  const set = (k: "o" | "i" | "h", v: string) => { A[k] = v; savePref(); redraw(); emit(); };
  const card = (ic: string, t: string, d: ReactNode, ex: string) => <div className="lkc"><span className="lkc-i"><Ico n={ic} sz={16} /></span><div><b>{t}</b><p>{d}</p><em>{ex}</em></div></div>;
  const grp = (k: "o" | "i", lab: string, ic: string) => <div className="arwg"><div className="arwl"><Ico n={ic} sz={15} /><span>{lab}</span></div>
    <div className="tsel">{ARW.map((g) => <button key={g} className={`chip arwc ${A[k] === g ? "on" : ""}`} title={ARL.has(g) ? "Đọc ngược: từ dòng đang xem" : "Đọc xuôi"} onClick={() => set(k, g)}>{g}</button>)}</div></div>;
  return <>
    <div className="lkcs">{card("lkin", "Liên kết đến", <>Dòng này là <b>chủ</b> — các dòng khác <b>thuộc về</b> nó.</>, relPath("5 FB Page", "UID Admin", "Facebook", A.i))}{card("lkout", "Liên kết đi", <>Dòng này <b>dùng</b> các dòng khác.</>, relPath("Facebook", "SĐT xác minh", "0927…936", A.o))}</div>
    {grp("o", "Mũi tên liên kết đi", "lkout")}<div className="arwp">{relPath("Dòng A", "Email khôi phục", "Gmail", A.o)}</div>
    {grp("i", "Mũi tên liên kết đến", "lkin")}<div className="arwp">{relPath("FB Page", "Email khôi phục", "Dòng A", A.i)}</div>
    <div className="arwg"><div className="arwl"><Ico n="network" sz={15} /><span>Đầu mũi tên trên sơ đồ</span></div>
      <div className="tsel">{ARH.map(([k, l]) => <button key={k} className={`chip ${A.h === k ? "on" : ""}`} onClick={() => set("h", k)}><svg width="22" height="12" viewBox="0 0 22 12"><defs><ArwMarker id={"pv" + k} c="#667085" sz={8} h={k} /></defs><path d="M2 6H19" stroke="#8797AB" strokeWidth="1.5" markerEnd={`url(#pv${k})`} /></svg>{l}</button>)}</div></div>
    <div className="mut" style={{ fontSize: 12 }}>Mũi tên ←, ⟵, ⇐, ◂, « sẽ đảo cách đọc: bắt đầu từ dòng đang xem.</div>
  </>;
}

/* ───────── Giao diện (theme) ───────── */
export interface ThemeInfo { id: string; name: string; en: string; group: string; layout: string; scheme: string; frame: string; img: string }
const TH: { list: ThemeInfo[] | null; id: string; init: boolean; loading: Promise<ThemeInfo[]> | null; v: number } = { list: null, id: "base", init: false, loading: null, v: 0 };
const thLs = new Set<() => void>();
const thNotify = () => { TH.v++; for (const f of thLs) f(); };
const thSub = (f: () => void) => { thLs.add(f); return () => { thLs.delete(f); }; };
function thRead() { try { const t = localStorage.getItem("ahs_theme"); return t && /^[\w-]+$/.test(t) ? t : "base"; } catch { return "base"; } }
function thSave(id: string) { try { if (id === "base") localStorage.removeItem("ahs_theme"); else localStorage.setItem("ahs_theme", id); } catch { /* bộ nhớ trình duyệt bị khoá */ } }
/** đổi theme: tải CSS mới xong mới bật → không chớp; gỡ <link> khi về giao diện gốc. */
export function thApply(id: string): Promise<boolean> {
  return new Promise((res) => {
    const old = document.getElementById("ahs-theme");
    const done = () => { thSave(id); TH.id = id; thNotify(); dispatchEvent(new Event("resize")); dispatchEvent(new CustomEvent("ahs:theme", { detail: id })); res(true); };
    if (!id || id === "base") { old?.remove(); id = "base"; done(); return; }
    const l = document.createElement("link"); l.rel = "stylesheet"; l.id = "ahs-theme"; l.href = `${API}theme/${encodeURIComponent(id)}.css`;
    l.onload = () => { if (old && old !== l) old.remove(); done(); };
    l.onerror = () => { l.remove(); res(false); };
    if (old) { old.id = ""; old.after(l); } else document.head.appendChild(l);
  });
}
export function thList(): Promise<ThemeInfo[]> {
  if (TH.list) return Promise.resolve(TH.list);
  if (TH.loading) return TH.loading;
  TH.loading = (async () => {
    let L: ThemeInfo[] = [];
    try { L = (await api<{ themes: ThemeInfo[] }>("themes")).themes || []; } catch { L = []; }
    TH.list = L;
    document.querySelectorAll(".hs-acc").forEach((e) => e.classList.toggle("th-on", L.length > 1));
    if (TH.id !== "base" && !L.some((t) => t.id === TH.id)) void thApply("base");
    thNotify(); return L;
  })();
  return TH.loading;
}
/** useTheme(): id theme đang dùng ('base' = giao diện gốc); lần đầu đọc localStorage ahs_theme và nạp CSS. */
export function useTheme(): string {
  const id = useSyncExternalStore(thSub, () => TH.id, () => "base");
  useEffect(() => {
    if (TH.init) return; TH.init = true;
    const t = thRead(); if (t !== "base") void thApply(t);
    const idle = (f: () => void) => { if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => f()); else setTimeout(f, 800); };
    idle(() => { void thList(); });
  }, []);
  return id;
}
const useThemeList = () => { useSyncExternalStore(thSub, () => TH.v, () => 0); useEffect(() => { void thList(); }, []); return TH.list; };

function ThemeGrid() {
  const L = useThemeList();
  if (!L) return <div className="ph pad"><Ico n="clock" sz={20} /></div>;
  if (!L.length) return <div className="ph pad"><Ico n="palette" sz={20} /></div>;
  return <div className="thg">{L.map((t) => { const on = t.id === TH.id; return <button key={t.id} className={`thc ${on ? "on" : ""}`} aria-pressed={on} onClick={() => { if (!on) void thApply(t.id); }}>
    <span className="thi">{t.img ? <ThImg src={t.img} /> : null}</span>
    <span className="thn"><b>{t.name}</b>{on ? <i><Ico n="check" sz={13} /></i> : null}</span><span className="the">{t.en || ""}</span>
  </button>; })}</div>;
}
function ThImg({ src }: { src: string }) { const [ok, setOk] = useState(true); return ok ? <img src={src} alt="" loading="lazy" onError={() => setOk(false)} /> : null; }
/** Popover chọn nhanh giao diện (nút palette trên #top): nhóm theo group, ảnh xem trước, đánh dấu đang chọn. */
export function ThemePicker() {
  const L = useThemeList(); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const p = ref.current?.closest(".pop"); p?.classList.add("thpop"); ref.current?.querySelector(".mi.on")?.scrollIntoView({ block: "center" }); }, [L]);
  if (!L) return <div ref={ref} className="ph pad"><Ico n="clock" sz={20} /></div>;
  if (!L.length) return <div ref={ref} className="ph pad"><Ico n="palette" sz={20} /></div>;
  const groups: Array<[string, ThemeInfo[]]> = []; for (const t of L) { const g = t.group || ""; const x = groups.find((y) => y[0] === g); if (x) x[1].push(t); else groups.push([g, [t]]); }
  return <div ref={ref}>
    <div className="thpl">{groups.map(([g, ts]) => <div key={g}>{g ? <div className="mh">{g}</div> : null}{ts.map((t) => <button key={t.id} className={`mi ${t.id === TH.id ? "on" : ""}`} onClick={() => { if (t.id !== TH.id) void thApply(t.id); }}>
      <span className="thpi">{t.img ? <ThImg src={t.img} /> : null}</span><span className="t">{t.name}<em>{t.en || ""}</em></span>{t.id === TH.id ? <Ico n="check" sz={15} /> : null}</button>)}</div>)}</div>
    <div className="sep" /><button className="mi" onClick={() => { closePop(); openSettings("theme"); }}><Ico n="gear" sz={15} /><span className="t">Tất cả giao diện</span></button>
  </div>;
}

export { SET as SETTINGS_STATE, redraw as settingsRedraw, grpIc, tabKeys };
export type { Sec as SettingsSec };
