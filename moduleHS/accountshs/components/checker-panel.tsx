"use client";

// Vọng gác (góc dưới trái #foot): check live Facebook / FB Page / Bài đăng FB · Telegram · Gmail · Proxy.
// Port renderFoot cyvBtn + cyvMenu + cyvDraw/cyvLive của v7.py sang React. Mở popover chọn checker → modal cấu hình + chạy.
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fold, nf } from "../core/text";
import { Ico } from "./icons";
import { API, S, api, useHs } from "./store";
import { Combo, Switch, closeModal, closePop, openModal, openPop, type ComboOpt } from "./ui-kit";

/* ───────── kiểu dữ liệu /cyv/state ───────── */
interface Meta { id: string; name: string; icon: string; value: string; hint_tab?: string[]; hint_field?: string[]; fields?: Array<{ k: string; label: string; secret?: boolean; ph?: string }>; extra?: Array<{ k: string; label: string; icon?: string; match?: string[]; hint?: string }>; parts?: Array<{ k: string; label: string; icon?: string; match?: string[] }>; results?: Array<[string, string]>; batch?: number; no_proxy?: boolean; url?: string; worker?: boolean }
interface Stats { total: number; today: number; live: number; die: number; error: number; runs_today: number }
interface Job { running?: boolean; total?: number; done?: number; live?: number; die?: number; error?: number; changed?: number; recent?: Array<{ id: number; v: string; res: string; info: string; ms?: number; ts?: number }>; err_msg?: string }
type Cfg = Record<string, unknown>;
interface Checker { id: string; info: Meta; cfg: Cfg; stats: Stats; meta: { credit?: number }; job: Job; next: number }
interface CyvState { checkers: Checker[]; now: number }

/** #foot của khung (có sau lần commit đầu) — đọc qua useSyncExternalStore để tự nhận khi phần tử xuất hiện */
const noSub = () => () => undefined;
const useFootHost = () => useSyncExternalStore(noSub, () => document.getElementById("foot"), () => null);
async function sj<T>(path: string): Promise<T> { const r = await fetch(API + path, { credentials: "same-origin" }); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; }
const fmtT = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "—");

/* ───────── nút ở #foot (portal, không sửa khung gốc) ───────── */
export function CheckerPanel() {
  useHs();
  const [st, setSt] = useState<CyvState | null>(null);
  const host = useFootHost();
  const tmr = useRef<number>(0);
  const openId = useRef<string | null>(null);

  const load = async () => {
    let s: CyvState | null = null;
    try { s = await sj<CyvState>("cyv/state"); setSt(s); }
    catch { setSt({ checkers: [], now: 0 }); }
    const running = (s?.checkers || []).some((c) => c.job?.running);
    clearTimeout(tmr.current); tmr.current = window.setTimeout(load, running ? 1000 : openId.current ? 4000 : 30000);
  };
  useEffect(() => { void load(); return () => clearTimeout(tmr.current); }, []);

  if (!host) return null;
  const cs = st?.checkers || []; const run = cs.filter((c) => c.job?.running); const today = cs.reduce((n, c) => n + (c.stats?.today || 0), 0);
  const openCfg = (id: string) => {
    openModal(<CyvModal id={id} onClose={() => { openId.current = null; }} />, true, "cyvm", undefined, () => { openId.current = null; });
  };
  const openMenu = (anchor: HTMLElement) => {
    openPop(anchor, <CyvMenu checkers={cs} onPick={(id) => { closePop(); openId.current = id; openCfg(id); void load(); }} />, "cyvp");
  };
  const btn = <button className={`btn sm ghost cyvb ${run.length ? "run" : ""} ${st ? "" : "wait"}`} title={`Vọng gác — check live${today ? " · hôm nay đã check " + nf(today) : ""}`}
    onClick={(e) => openMenu(e.currentTarget)}><Ico n="shield" sz={15} /><span>Vọng gác</span>
    {run.length ? <><i className="spin1" /><em>{run.map((c) => `${c.job.done}/${c.job.total}`).join(" · ")}</em></> : today ? <em>{nf(today)}</em> : null}</button>;
  return createPortal(btn, host);
}

function CyvMenu({ checkers, onPick }: { checkers: Checker[]; onPick: (id: string) => void }) {
  return <div><div className="mh">Vọng gác</div>
    {!checkers.length ? <div className="ph pad"><Ico n="inbox" sz={18} /><span>Chưa nạp được checker</span></div> :
      checkers.map((c) => { const s = c.stats || { today: 0, total: 0 }; const j = c.job || {};
        return <button key={c.id} className="mi cyvi" onClick={() => onPick(c.id)}><Ico n={c.info.icon || "shield"} sz={16} />
          <span className="t">{c.info.name}<small>{j.running ? `Đang chạy ${j.done}/${j.total}` : `Hôm nay ${nf(s.today || 0)}/${nf(s.total || 0)}${c.cfg.auto ? " · định kỳ" : ""}`}</small></span>
          {j.running ? <i className="spin1" /> : <Ico n="chevr" sz={14} cls="r" />}</button>; })}
  </div>;
}

/* ───────── modal cấu hình + chạy 1 checker ───────── */
function CyvModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [c, setC] = useState<Checker | null>(null);
  const [draft, setDraft] = useState<Cfg>({});
  const tmr = useRef<number>(0);
  const dirty = useRef(false);

  const pull = async () => {
    try { const s = await sj<CyvState>("cyv/state"); const cc = s.checkers.find((x) => x.id === id) || null; setC(cc);
      if (cc && !dirty.current) setDraft((d) => (Object.keys(d).length ? d : seedDraft(cc))); }
    catch { /* giữ nguyên */ }
    const running = c?.job?.running; clearTimeout(tmr.current); tmr.current = window.setTimeout(pull, running ? 1000 : 4000);
  };
  useEffect(() => { void pull(); return () => { clearTimeout(tmr.current); onClose(); }; }, []);

  if (!c) return <div className="mbody" id="cyv"><div className="ph pad"><i className="spin1" /><span>Đang tải…</span></div></div>;
  const meta = c.info, t = S.meta.tabs.find((x) => x.id === Number(draft.tab_id));
  const run = Boolean(c.job?.running);
  const set = (k: string, v: unknown) => { dirty.current = true; setDraft((d) => ({ ...d, [k]: v })); };
  const save = async (quiet = true) => { try { await api("cyv/cfg", { id, cfg: draft }); dirty.current = false; if (!quiet) void pull(); } catch { /* lỗi đã toast */ } };
  const doRun = async () => { await save(); const sc = String(draft.scope || "all"); try { await api("cyv/run", { id, scope: sc, ids: sc === "selected" ? [...S.sel] : null }); } catch { /* */ } void pull(); };
  const doStop = async () => { try { await api("cyv/stop", { id }); } catch { /* */ } void pull(); };

  const tabOpts: ComboOpt[] = [{ v: "", t: "{Chọn tab}" }, ...S.meta.tabs.map((x) => ({ v: String(x.id), t: x.name }))];
  const fieldOpts: ComboOpt[] = [{ v: "", t: "{Chọn trường}" }, ...((t?.fields || []).filter((f) => !["link", "lookup", "file"].includes(f.type)).map((f) => ({ v: String(f.id), t: f.label })))];
  const vals = cyvVals(draft, t);
  const tgtOpts: ComboOpt[] = t ? [{ v: "status", t: "Trạng thái" }, ...t.fields.filter((f) => f.type === "select").map((f) => ({ v: String(f.id), t: f.label }))] : [{ v: "status", t: "Trạng thái" }];
  const valOpts = (cur: unknown): ComboOpt[] => [{ v: "", t: "{Không đổi}" }, ...vals.map((v) => ({ v: String(v.v), t: v.l })).filter(() => true)].concat(cur ? [] : []);
  const total = cyvTotal(draft);

  return <>
    <header><span className="ti"><Ico n={meta.icon || "shield"} sz={16} /></span><h3>{meta.name}</h3><div className="grow" />
      <button className="btn icon ghost" title="Đóng" onClick={closeModal}><Ico n="x" sz={16} /></button></header>
    <div className="mbody" id="cyv">
      <div className="cyk" id="cyk">
        <div className="cykp wide"><span className="cyl">Đã check hôm nay</span><b>{nf(c.stats.today)}<i> / {nf(total || c.stats.total)}</i></b><div className="cybar"><i style={{ width: `${(total || c.stats.total) ? Math.min(100, Math.round(c.stats.today / (total || c.stats.total) * 100)) : 0}%` }} /></div></div>
        <div className="cykp ok"><span className="cyl">Live</span><b>{nf(c.stats.live)}</b></div>
        <div className="cykp bad"><span className="cyl">Die</span><b>{nf(c.stats.die)}</b></div>
        <div className="cykp warn"><span className="cyl">Lỗi</span><b>{nf(c.stats.error)}</b></div>
        <div className="cykp"><span className="cyl">Lần chạy cuối</span><b>{fmtT(Number(c.cfg.last) || 0)}</b></div>
        <div className="cykp"><span className="cyl">Lần tới</span><b>{c.cfg.auto ? fmtT(c.next) : "Tắt"}</b></div>
        {run ? <div className="cyprog"><div className="cypb"><i style={{ width: `${c.job.total ? Math.round((c.job.done || 0) / c.job.total * 100) : 0}%` }} /></div><span>{nf(c.job.done || 0)} / {nf(c.job.total || 0)}</span></div> : null}
      </div>
      <div className="cyg">
        <section><h4>Nguồn dữ liệu</h4>
          <Fld ic="layers" l="Tab"><Combo value={String(draft.tab_id ?? "")} opts={tabOpts} onChange={(v) => { set("tab_id", v ? Number(v) : null); const nt = S.meta.tabs.find((x) => x.id === Number(v)); set("field_id", nt?.fields.find((f) => !["link", "lookup", "file"].includes(f.type))?.id ?? null); set("target", "status"); set("live", null); set("die", null); }} /></Fld>
          <Fld ic="key" l={meta.value || "Trường giá trị"}><Combo value={String(draft.field_id ?? "")} opts={fieldOpts} onChange={(v) => set("field_id", v ? Number(v) : null)} /></Fld>
          {(meta.parts || []).map((p) => { const fs = (t?.fields || []).filter((f) => !["link", "lookup", "file"].includes(f.type) && f.id !== draft.field_id); const cur = draft["pf_" + p.k]; return <Fld key={p.k} ic={p.icon || "type"} l={p.label}><Combo value={cur == null ? "" : String(cur)} opts={[{ v: "", t: "{Không dùng}" }, ...fs.map((f) => ({ v: String(f.id), t: f.label }))]} onChange={(v) => set("pf_" + p.k, v === "" ? "" : Number(v))} /></Fld>; })}
          <Fld ic="filter" l="Phạm vi"><Combo value={String(draft.scope || "all")} opts={[{ v: "all", t: "Tất cả trong tab" }, { v: "unchecked", t: "Chưa check hôm nay" }, { v: "selected", t: `Dòng đang chọn (${S.sel.size})` }]} onChange={(v) => set("scope", v)} /></Fld>
        </section>
        <section><h4>Ghi kết quả</h4>
          <Fld ic="tag" l="Ghi vào cột"><Combo value={String(draft.target ?? "status")} opts={tgtOpts} onChange={(v) => { set("target", v === "status" ? "status" : Number(v)); set("live", null); set("die", null); }} /></Fld>
          <Fld ic="check" l="Khi Live"><Combo value={draft.live == null ? "" : String(draft.live)} opts={valOpts(draft.live)} onChange={(v) => set("live", v === "" ? null : draft.target === "status" ? Number(v) : v)} /></Fld>
          <Fld ic="x" l="Khi Die"><Combo value={draft.die == null ? "" : String(draft.die)} opts={valOpts(draft.die)} onChange={(v) => set("die", v === "" ? null : draft.target === "status" ? Number(v) : v)} /></Fld>
          {(meta.extra || []).map((x) => { const fs = (t?.fields || []).filter((f) => ["text", "number"].includes(f.type)); const hit = fs.find((f) => [fold(x.label)].concat((x.match || [])).map((s) => fold(s)).includes(fold(f.label))); const cur = draft["xf_" + x.k] == null || draft["xf_" + x.k] === "auto" ? (hit ? hit.id : "auto") : draft["xf_" + x.k];
            return <Fld key={x.k} ic={x.icon || "plus"} l={x.label}><Combo value={String(cur)} opts={[{ v: "", t: "{Không ghi}" }, ...(hit ? [] : [{ v: "auto", t: `{Tự tạo cột "${x.label}"}` }]), ...fs.map((f) => ({ v: String(f.id), t: f.label }))]} onChange={(v) => set("xf_" + x.k, v === "" || v === "auto" ? v : Number(v))} /></Fld>; })}
          <div className="cyn"><Ico n="info" sz={13} /><span>Lỗi mạng / không xác định: giữ nguyên, không đổi.</span></div>
        </section>
        <section><h4>Chạy</h4>
          <div className="cy2"><Fld ic="zap" l="Số luồng"><input className="in" type="number" min={1} max={64} value={String(draft.threads ?? 10)} onChange={(e) => set("threads", Number(e.target.value))} /></Fld>
            <Fld ic="clock" l="Timeout (giây)"><input className="in" type="number" min={2} max={60} value={String(draft.timeout ?? 10)} onChange={(e) => set("timeout", Number(e.target.value))} /></Fld></div>
          {(meta.fields || []).map((x) => <Fld key={x.k} ic={x.secret ? "key" : "type"} l={x.label}><SecretIn secret={x.secret} ph={x.ph} value={String((draft.x as Record<string, string>)?.[x.k] || "")} onChange={(v) => set("x", { ...(draft.x as Record<string, string> || {}), [x.k]: v })} />{x.k === "api_key" && c.meta?.credit != null ? <span className="cycr">Còn <b>{nf(Number(c.meta.credit))}</b> lượt</span> : null}</Fld>)}
          {meta.url ? <Fld ic="external" l="Trang kiểm tra"><input className="in" placeholder={meta.url} value={String(draft.url || "")} onChange={(e) => set("url", e.target.value)} /></Fld> : null}
          {meta.no_proxy ? null : <Fld ic="globe" l="Proxy (tùy chọn)"><input className="in" placeholder="ip:port hoặc user:pass@ip:port" value={String(draft.proxy || "")} onChange={(e) => set("proxy", e.target.value)} /></Fld>}
          <div className="cyf"><label><Ico n="refresh" sz={13} /><span>Check định kỳ</span></label><div className="cyauto"><Switch on={Boolean(draft.auto)} onChange={(v) => set("auto", v)} /><span>mỗi</span><input className="in" type="number" min={5} value={String(draft.every ?? 60)} onChange={(e) => set("every", Number(e.target.value))} /><span>phút</span></div></div>
          {meta.worker ? <div className="cyn"><Ico n="info" sz={13} /><span>Checker này chạy bằng worker Python (curl_cffi). Bấm Chạy sẽ tạo việc cho worker; kết quả hiện dần.</span></div> : null}
        </section>
      </div>
      {c.job?.err_msg ? <div className="cyerr"><Ico n="alert" sz={14} /><span>{c.job.err_msg}</span></div> : null}
      <div className="cyr"><div className="cyrh"><b>Kết quả gần đây</b><span className="mut">{(c.job?.recent || []).length ? `${(c.job.recent || []).length} dòng mới nhất` : ""}</span></div>
        <div className="cyrl">{(c.job?.recent || []).length ? (c.job.recent || []).map((r, i) => { const a = S.accs.find((x) => x.id === r.id); return <div className="cyrr" key={i}><span className={`cyst ${r.res}`}>{r.res === "live" ? "Live" : r.res === "die" ? "Die" : r.res === "error" ? "Lỗi" : r.res}</span><b>{r.v || String(r.id)}</b><span className="mut">{a ? "" : ""}</span><div className="grow" /><em>{r.info}</em>{r.ms ? <em>{r.ms}ms</em> : null}</div>; }) : <div className="ph pad"><Ico n="inbox" sz={18} /><span>Chưa có lần chạy nào trong phiên này</span></div>}</div></div>
    </div>
    <footer><button className="btn outline" title="Lưu cấu hình" onClick={() => save(false)}><Ico n="save" sz={16} /><span>Lưu</span></button><div className="grow" />
      {run ? <button className="btn danger" onClick={doStop}><Ico n="x" sz={16} /><span>Dừng</span></button>
        : <button className="btn pri" title="Lưu cấu hình và chạy ngay" onClick={doRun}><Ico n="zap" sz={16} /><span>Chạy ngay</span></button>}</footer>
  </>;
}

const Fld = ({ ic, l, children }: { ic: string; l: string; children: React.ReactNode }) => <div className="cyf"><label><Ico n={ic} sz={13} /><span>{l}</span></label>{children}</div>;
function SecretIn({ secret, ph, value, onChange }: { secret?: boolean; ph?: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return <div className="cysec"><input className="in" type={secret && !show ? "password" : "text"} placeholder={ph || ""} value={value} autoComplete="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    {secret ? <button type="button" className="btn icon sm ghost" title="Hiện / ẩn" onClick={() => setShow((s) => !s)}><Ico n={show ? "eyeoff" : "eye"} sz={14} /></button> : null}</div>;
}
function cyvVals(d: Cfg, t?: { statuses: Array<{ id: number; label: string; color: string }>; fields: Array<{ id: number; label: string; opts: string; type: string }> }): Array<{ v: string | number; l: string }> {
  if (!t) return [];
  if ((d.target ?? "status") === "status") return t.statuses.map((s) => ({ v: s.id, l: s.label }));
  const f = t.fields.find((x) => x.id === Number(d.target));
  return f ? (f.opts || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => ({ v: x, l: x })) : [];
}
function cyvTotal(d: Cfg): number { if (!d.tab_id || !d.field_id) return 0; let n = 0; for (const a of S.accs) if (a.tab_id === Number(d.tab_id) && String((a.data as Record<string, unknown>)[String(d.field_id)] ?? "").trim()) n++; return n; }
function seedDraft(c: Checker): Cfg {
  const d: Cfg = { ...c.cfg }; const nz = (s: unknown) => fold(s).replace(/\s+/g, " ").trim();
  if (!d.tab_id) { const t = S.meta.tabs.find((x) => (c.info.hint_tab || []).some((h) => nz(x.name) === h)) || S.meta.tabs.find((x) => (c.info.hint_tab || []).some((h) => nz(x.name).includes(h))); if (t) d.tab_id = t.id; }
  const t = S.meta.tabs.find((x) => x.id === Number(d.tab_id));
  if (t && !d.field_id) { const f = t.fields.find((f) => (c.info.hint_field || []).some((h) => nz(f.label) === h)) || t.fields[0]; if (f) d.field_id = f.id; }
  if (t && (d.target ?? "status") === "status" && d.live == null) { const L = t.statuses.find((s) => /live|song|hoat/.test(nz(s.label))); const D = t.statuses.find((s) => /die|chet|khoa|disable/.test(nz(s.label))); if (L) d.live = L.id; if (D) d.die = D.id; }
  return d;
}
