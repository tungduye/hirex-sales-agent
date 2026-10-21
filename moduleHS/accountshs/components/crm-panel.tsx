"use client";

// CRM (góc dưới trái #foot): kéo dữ liệu từ hệ thống chat-stats về, chuẩn hoá vào các tab (worker Python chạy nạp).
// Port khối CRM của v7.py (crmBtn/crmDraw/crmLoad) sang React. Polls /crm/state; cấu hình + đồng bộ + nhập file JSON.
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { nf } from "../core/text";
import { Ico } from "./icons";
import { API, S, api, reload, useHs } from "./store";
import { Switch, closeModal, openModal } from "./ui-kit";

interface Last { v?: number; rows?: number; created?: Record<string, number>; derived?: Record<string, number>; updated?: Record<string, number>; totals?: Record<string, number>; distinct?: Record<string, number>; kinds?: Record<string, number>; links?: number; devices?: number; cleaned?: { rows?: number }; warn?: string[] }
interface CrmState { cfg: { url: string; has_token: boolean }; job: { running: boolean; phase: string; done: number; total: number; err: string }; last: Last | null }
const CRMK: Record<string, string> = { fb: "Facebook", page: "FB Page", phone: "SIM", email: "Email", li: "LinkedIn", device: "Thiết bị" };

/** #foot của khung (có sau lần commit đầu) — đọc qua useSyncExternalStore để tự nhận khi phần tử xuất hiện */
const noSub = () => () => undefined;
const useFootHost = () => useSyncExternalStore(noSub, () => document.getElementById("foot"), () => null);
async function sj<T>(path: string): Promise<T> { const r = await fetch(API + path, { credentials: "same-origin" }); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; }

export function CrmPanel() {
  useHs();
  const [st, setSt] = useState<CrmState | null>(null);
  const host = useFootHost();
  const open = useRef(false); const was = useRef(false); const tmr = useRef<number>(0);

  const load = async () => {
    let s: CrmState | null = null; try { s = await sj<CrmState>("crm/state"); } catch { s = null; }
    setSt(s); const run = Boolean(s?.job?.running);
    if (was.current && !run) { was.current = false; await reload(); }
    was.current = run;
    clearTimeout(tmr.current); if (run || open.current) tmr.current = window.setTimeout(load, run ? 800 : 5000);
  };
  useEffect(() => { void load(); return () => clearTimeout(tmr.current); }, []);
  if (!host) return null;

  const run = Boolean(st?.job?.running);
  const btn = <button className={`btn sm ghost crmb ${run ? "run" : ""}`} title="CRM — đồng bộ dữ liệu" onClick={() => { open.current = true; openModal(<CrmModal onClose={() => { open.current = false; }} />, false, "crm"); void load(); }}>
    <Ico n="database" sz={15} /><span>CRM</span>{run ? <><i className="spin1" /><em>{st?.job.done || 0}/{st?.job.total || "…"}</em></> : null}</button>;
  return createPortal(btn, host);
}

function CrmModal({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<CrmState | null>(null);
  const [force, setForce] = useState(false);
  const [url, setUrl] = useState(""); const [token, setToken] = useState("");
  const tmr = useRef<number>(0); const fileRef = useRef<HTMLInputElement>(null); const seeded = useRef(false);

  const load = async () => { try { const s = await sj<CrmState>("crm/state"); setSt(s); if (!seeded.current) { setUrl(s.cfg.url || ""); seeded.current = true; } } catch { /* */ }
    clearTimeout(tmr.current); tmr.current = window.setTimeout(load, st?.job?.running ? 800 : 5000); };
  useEffect(() => { void load(); return () => { clearTimeout(tmr.current); onClose(); }; }, []);

  const saveCfg = async () => { const o: Record<string, unknown> = { url }; if (token) o.token = token; try { await api("crm/cfg", o); setToken(""); } catch { /* */ } };
  const sync = async (rows?: unknown) => { await saveCfg(); try { await api("crm/sync", { force, ...(rows !== undefined ? { rows } : {}) }); } catch { /* */ } void load(); };
  const onFile = async (f: File | null) => { if (!f) return; let d: unknown; try { d = JSON.parse(await f.text()); } catch { return; } await sync(d); };

  const st0 = st || { cfg: { url: "", has_token: false }, job: { running: false, phase: "", done: 0, total: 0, err: "" }, last: null };
  const j = st0.job, run = j.running, L = st0.last;
  const pct = j.total ? Math.min(100, Math.round(j.done * 100 / j.total)) : 0;
  const sum = (o?: Record<string, number>) => Object.values(o || {}).reduce((x, y) => x + y, 0);
  const names = L ? [...new Set([...Object.keys(L.created || {}), ...Object.keys(L.derived || {}), ...Object.keys(L.updated || {}), ...Object.keys(L.distinct || {})])].filter((n) => S.meta.tabs.some((x) => x.name === n)) : [];

  return <>
    <header><span className="ti" style={{ "--c": "#0284c7" } as React.CSSProperties}><Ico n="database" sz={16} /></span><h3>CRM</h3><div className="grow" />
      <button className="btn icon ghost" onClick={closeModal}><Ico n="x" sz={16} /></button></header>
    <div className="mbody crm-b">
      <div className="fld"><label><Ico n="link" sz={13} /></label><input className="in" value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} /></div>
      <div className="fld"><label><Ico n="key" sz={13} /></label><input className="in" type="password" placeholder={st0.cfg.has_token ? "•••••••• (đã lưu)" : "Bearer token"} autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></div>
      <div className="crm-a">
        <button className="btn pri" disabled={run} onClick={() => sync()}><Ico n="refresh" sz={15} /><span>Đồng bộ</span></button>
        <button className="btn outline icon" title="Nhập từ file JSON" disabled={run} onClick={() => fileRef.current?.click()}><Ico n="upload" sz={15} /></button>
        <input ref={fileRef} type="file" accept=".json,.txt,application/json" hidden onChange={(e) => { const f = e.target.files?.[0] || null; e.target.value = ""; void onFile(f); }} />
        <div className="grow" /><label className="crm-f" title="Bỏ qua bản ghi chưa đổi: tắt. Bật để nạp lại toàn bộ"><Switch on={force} onChange={setForce} /><span>Nạp lại tất cả</span></label>
      </div>
      {run ? <div className="crm-p"><div className="crm-bar"><i style={{ width: `${pct}%` }} /></div><span>{j.phase} · {nf(j.done)}/{j.total ? nf(j.total) : "…"}</span></div> : null}
      {j.err ? <div className="crm-e"><Ico n="alert" sz={14} /><span>{j.err}</span></div> : null}
      {L ? <><div className="crm-t">
        <div><b>{nf(L.rows || 0)}</b><span>Bản ghi CRM</span></div>
        <div><b>{nf(sum(L.created) + sum(L.derived))}</b><span>Tài khoản mới</span></div>
        <div><b>{nf(L.links || 0)}</b><span>Liên kết</span></div>
        <div><b>{nf(L.devices || 0)}</b><span>Thiết bị</span></div>
      </div>
        <div className="crm-k">{Object.entries(L.kinds || {}).map(([k, v]) => <span key={k}>{nf(v)} {CRMK[k] || k}</span>)}</div>
        {L.cleaned?.rows ? <div className="crm-i"><Ico n="refresh" sz={14} /><span>Đã dọn {nf(L.cleaned.rows)} dòng của bản nhập cũ rồi nạp lại theo cấu trúc mới</span></div> : null}
        <div className="crm-l">{names.map((n) => { const t = S.meta.tabs.find((x) => x.name === n); const C = L.created || {}, D = L.derived || {}, U = L.updated || {}, Tt = L.totals || {};
          return <div className="crm-r" key={n}><span className="ci" style={{ "--c": t?.color || "#667085" } as React.CSSProperties}><Ico n={t?.icon || "layers"} sz={13} /></span><span className="crm-n">{n}</span><b title="Tài khoản của tab sau khi nạp">{nf(Tt[n] || 0)}</b>
            <em>{[C[n] ? "+" + C[n] + " từ bản ghi" : "", D[n] ? "+" + D[n] + " suy ra" : "", U[n] ? U[n] + " cập nhật" : ""].filter(Boolean).join(" · ")}</em></div>; })}</div>
        {(L.warn || []).length ? <details className="crm-w"><summary><Ico n="alert" sz={14} /><span>{(L.warn || []).length} điểm cần xem lại</span></summary><div>{(L.warn || []).map((w, i) => <div key={i}>{w}</div>)}</div></details> : null}
      </> : <div className="empty crm-em"><Ico n="database" sz={22} /><div>Chưa đồng bộ lần nào</div></div>}
    </div>
  </>;
}
