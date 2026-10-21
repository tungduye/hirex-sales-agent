"use client";

// Cú vọ tự động: chuột phải → Tự động hoá › Cú vọ (openOwlAuto(ids)). Thu thập dữ liệu ngoài (bài đăng Page…)
// bằng worker Python rồi xem/đồng bộ vào tab. Port owl/owl.py (trang /owl) sang một modal trong app.
import { useEffect, useRef, useState } from "react";
import { fold } from "../core/text";
import type { Id } from "../types";
import { Ico } from "./icons";
import { API, S, api, dlXlsx, toast } from "./store";
import { Chk, Combo, Empty, closeModal, openModal, type ComboOpt } from "./ui-kit";

interface Col { k: string; label: string; main?: boolean; wide?: boolean; type?: string; key?: boolean }
interface Param { k: string; label: string; type?: string; default?: unknown; min?: number; max?: number }
interface Script { id: string; name: string; desc?: string; tabs: string[]; params: Param[]; columns: Col[]; export?: string[]; sync?: { tab: string; key: string } }
interface Source { id: Id; label: string; uid?: string; name?: string; cookie_ok?: boolean; cookie_via?: string }
interface Boot { scripts: Script[]; tabs: Array<{ id: Id; name: string }> }
type Row = Record<string, unknown>;

const thSt: React.CSSProperties = { position: "sticky", top: 0, background: "var(--pn, #fff)", textAlign: "left", fontSize: 12, fontWeight: 500, color: "var(--mu, #64748b)", padding: "0 10px", height: 34, borderBottom: "1px solid var(--bd, #e2e8f0)", whiteSpace: "nowrap" };
const tdSt: React.CSSProperties = { padding: "0 10px", height: 34, borderBottom: "1px solid var(--bd, #e2e8f0)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

async function sj<T>(path: string): Promise<T> { const r = await fetch(API + path, { credentials: "same-origin" }); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; }

export function openOwlAuto(ids: Id[]) {
  const a = ids.length ? S.accs.find((x) => x.id === ids[0]) : null;
  const tab = a ? S.meta.tabs.find((t) => t.id === a.tab_id) : null;
  const same = a ? ids.filter((i) => S.accs.find((x) => x.id === i && x.tab_id === a.tab_id)) : ids;
  openModal(<OwlAuto ids={same} tabName={tab?.name || ""} />, true, "owlm");
}

function OwlAuto({ ids, tabName }: { ids: Id[]; tabName: string }) {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [err, setErr] = useState("");
  const [sid, setSid] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [excl, setExcl] = useState<Set<Id>>(new Set());
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const job = useRef<string>(""); const from = useRef(0); const tmr = useRef<number>(0); const stop = useRef(false);

  const script = boot?.scripts.find((s) => s.id === sid) || null;

  function pickScript(s: Script) {
    setSid(s.id); const pr: Record<string, unknown> = {}; for (const p of s.params) pr[p.k] = p.default ?? (p.type === "number" ? 25 : "");
    setParams(pr); setRows([]); job.current = ""; setRunning(false);
    void loadSources(s.id, s.tabs[0] || tabName);
  }
  async function loadSources(scriptId: string, tab: string) {
    try { const d = await api<{ sources: Source[] }>("owl/sources", { script: scriptId, tab, ids }); setSources(d.sources || []); } catch { setSources([]); }
  }

  async function run() {
    if (!script) return; const sel = sources.filter((x) => !excl.has(x.id)).map((x) => x.id);
    if (!sel.length) { toast("Chưa có nguồn để chạy", "err"); return; }
    try { const d = await api<{ job: string }>("owl/run", { script: script.id, tab: script.tabs[0] || tabName, ids: sel, params }); job.current = d.job; from.current = 0; setRows([]); setRunning(true); stop.current = false; poll(); }
    catch { /* toast rồi */ }
  }
  async function poll() {
    if (!job.current) return;
    try {
      const d = await sj<{ status: string; done: boolean; total: number; rows: Row[]; logs: unknown[] }>(`owl/job?id=${job.current}&from=${from.current}`);
      if (d.rows?.length) { from.current += d.rows.length; setRows((r) => [...r, ...d.rows]); }
      setStatus(d.status || "");
      if (d.done) { setRunning(false); job.current = ""; return; }
    } catch { setRunning(false); job.current = ""; return; }
    if (!stop.current) tmr.current = window.setTimeout(poll, 500);
  }
  async function doStop() { if (job.current) { try { await api("owl/stop", { job: job.current }); } catch { /* */ } } }
  async function sync() {
    if (!script || !rows.length) return;
    try { const r = await api<{ created: number; updated: number; dup?: number; skipped?: number }>("owl/sync", { script: script.id, rows, tab: script.sync?.tab, owner: "src" });
      toast(`Đã thêm ${r.created} · cập nhật ${r.updated}${r.dup ? " · trùng " + r.dup : ""}`, "ok"); } catch { /* */ }
  }
  async function exportX() {
    if (!script || !rows.length) return; const ks = (script.export && script.export.length ? script.export : script.columns.filter((c) => c.main).map((c) => c.k));
    const lab = (k: string) => (script.columns.find((c) => c.k === k)?.label || k);
    await dlXlsx("owl_" + fold(script.name).replace(/[^a-z0-9]/g, "_"), [ks.map(lab), ...rows.map((x) => ks.map((k) => String(x[k] ?? "")))], true);
  }

  useEffect(() => {
    (async () => {
      try {
        const b = await sj<Boot>("owl/boot"); setBoot(b);
        if (!b.scripts.length) { setErr("Chưa có kịch bản Cú vọ"); return; }
        const p = b.scripts.find((s) => (s.tabs || []).some((t) => fold(t).replace(/\s+/g, "") === fold(tabName).replace(/\s+/g, ""))) || b.scripts[0];
        pickScript(p);
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { clearTimeout(tmr.current); stop.current = true; };
  }, []);

  if (err) return <div className="mbody"><Empty icon="alert">{err}</Empty></div>;
  if (!boot) return <div className="mbody"><div className="ph pad"><i className="spin1" /><span>Đang tải…</span></div></div>;
  const scriptOpts: ComboOpt[] = boot.scripts.map((s) => ({ v: s.id, t: s.name }));
  const on = sources.filter((x) => !excl.has(x.id));
  const cols = (script?.columns || []).filter((c) => c.main);
  const linkSt: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--pri, #2563eb)", textDecoration: "none", maxWidth: "100%" };

  return <>
    <header><span className="ti" style={{ "--c": "#2563eb" } as React.CSSProperties}><Ico n="network" sz={16} /></span><h3>Cú vọ</h3>
      <div className="grow" /><span className="mut" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{running ? <i className="spin1" /> : null}{status}</span>
      {running ? <button className="btn danger sm" onClick={doStop}><Ico n="x" sz={14} />Dừng</button> : <button className="btn pri sm" title="Chạy (Ctrl+Enter)" onClick={run}><Ico n="zap" sz={14} />Chạy</button>}
      <button className="btn icon ghost" title="Đóng" onClick={closeModal}><Ico n="x" sz={16} /></button></header>
    <div style={{ display: "grid", gridTemplateColumns: "296px minmax(0,1fr)", minHeight: 0, height: "70vh" }}>
      <aside style={{ overflow: "auto", borderRight: "1px solid var(--bd, #e2e8f0)" }}>
        <div className="sec"><h4>Kịch bản</h4><Combo value={sid} opts={scriptOpts} onChange={(v) => { const s = boot.scripts.find((x) => x.id === v); if (s) pickScript(s); }} />
          {script?.desc ? <p className="mut" style={{ fontSize: 11, marginTop: 6 }}>{script.desc}</p> : null}</div>
        <div className="sec"><h4>Tham số</h4>{(script?.params || []).map((p) => <div className="fld" key={p.k}><label>{p.label}</label>
          <input className="in" type={p.type === "number" ? "number" : "text"} value={String(params[p.k] ?? "")} placeholder={p.type === "datetime" ? "yyyy-mm-dd" : ""} onChange={(e) => setParams((pr) => ({ ...pr, [p.k]: p.type === "number" ? Number(e.target.value) : e.target.value }))} /></div>)}</div>
        <div className="sec"><h4><Chk on={on.length === sources.length && sources.length > 0} part={on.length > 0 && on.length < sources.length} onClick={() => setExcl(on.length ? new Set(sources.map((s) => s.id)) : new Set())} />Nguồn<span className="cn">{on.length}/{sources.length}</span></h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{sources.length ? sources.map((x) => { const a = !excl.has(x.id); return <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", cursor: "pointer" }} onClick={() => setExcl((s) => { const n = new Set(s); if (a) n.delete(x.id); else n.add(x.id); return n; })}><Chk on={a} /><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.label}</span><span style={{ display: "flex", color: x.cookie_ok ? "var(--ok, #16a34a)" : "var(--er, #dc2626)" }} title={x.cookie_ok ? x.cookie_via || "" : "Thiếu cookie"}><Ico n={x.cookie_ok ? "key" : "alert"} sz={14} /></span></div>; }) : <div className="ph pad">Chưa có nguồn.</div>}</div></div>
      </aside>
      <main style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}><span className="mut" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Ico n="list" sz={14} /> {rows.length}</span><div className="grow" />
          <button className="btn sm" disabled={!rows.length} onClick={exportX}><Ico n="download" sz={14} />Excel</button>
          <button className="btn sm" disabled={!rows.length} onClick={sync}><Ico n="refresh" sz={14} />Đồng bộ</button></div>
        <div style={{ flex: 1, overflow: "auto", margin: "0 12px 12px", border: "1px solid var(--bd, #e2e8f0)", borderRadius: 10 }}>{rows.length ? <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}><thead><tr><th style={thSt}>#</th>{cols.map((c) => <th key={c.k} style={thSt}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.slice(0, 500).map((r, i) => <tr key={i}><td style={tdSt}>{i + 1}</td>{cols.map((c) => { const v = String(r[c.k] ?? ""); return c.type === "url" && v ? <td key={c.k} style={tdSt}><a style={linkSt} href={v} target="_blank" rel="noopener"><Ico n="external" sz={14} /><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{v.replace(/^https?:\/\/(www\.)?/, "")}</span></a></td> : <td key={c.k} style={tdSt} title={v.slice(0, 300)}>{v.slice(0, 200)}</td>; })}</tr>)}</tbody></table>
          : <Empty icon="inbox"><b>Chưa có dữ liệu</b><span>Chọn nguồn rồi bấm Chạy</span></Empty>}</div>
      </main>
    </div>
  </>;
}
