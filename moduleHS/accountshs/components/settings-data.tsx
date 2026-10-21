"use client";

// Tùy chỉnh › Sao lưu · Nhật ký (+ Lịch sử thay đổi từng dòng – hist_cfg) · Kiểm tra.
// Port của bkHtml/logHtml/logRows/hcHtml/loadSec + ACT bkcsw/bkfmt/bknow/bkdel/bkrest/lqexp/hccheck/hcfix (v3, 5705-5748),
// đổi tên/tải lên bản sao lưu (5155-5157), ô tìm nhật ký (5171), r56 logclear (6850-6852), r60b histCfgHtml/hSave/hkeep/hclear (6915-6931).
import { useCallback, useEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import type { BackupsInfo, DbCheck, HistInfo, LogRow } from "../types";
import { Ico } from "./icons";
import { API, api, confirmBox, dlXlsx, mut, toast } from "./store";
import { Combo, Switch } from "./ui-kit";

/* ───────── định dạng ───────── */
export const fmtSize = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : n > 1024 ? Math.round(n / 1024) + " KB" : n + " B");
export const fmtT = (ts: number | null | undefined) => (ts ? new Date(ts * 1000).toLocaleString("vi-VN") : "");
const cvar = (c: string) => ({ "--c": c } as CSSProperties);
const Wait = () => <div className="ph pad"><Ico n="clock" sz={20} /></div>;

/** ô nhập ghi khi đổi xong (blur / Enter) — như sự kiện change của bản gốc */
function CommitIn({ value, onCommit, className = "in", style, type, min, step, title, placeholder, inputRef }: { value: string; onCommit: (v: string) => void; className?: string; style?: CSSProperties; type?: string; min?: number; step?: number; title?: string; placeholder?: string; inputRef?: Ref<HTMLInputElement> }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setV(value); }
  const commit = () => { if (v !== value) onCommit(v); };
  return <input ref={inputRef} className={className} style={style} type={type} min={min} step={step} title={title} placeholder={placeholder} value={v} autoComplete="off"
    onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} />;
}

/* ═════════ Sao lưu ═════════ */
export function BackupPane() {
  const [bk, setBk] = useState<BackupsInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const reload = useCallback(() => api<BackupsInfo>("backups").then((b) => { if (alive.current) setBk(b); }, () => { /* api đã báo lỗi */ }), []);
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; }; }, [reload]);
  if (!bk) return <Wait />;
  const c = bk.cfg;
  const cfg = async (b: Record<string, unknown>) => { try { await api("backup_cfg", b); } catch { /* đã báo */ } await reload(); };
  const now = async () => { setBusy(true); try { await api("backup_now", {}); toast("Đã sao lưu"); } catch { /* đã báo */ } setBusy(false); await reload(); };
  const rename = async (name: string, nw: string) => { try { await api("backup_rename", { name, new: nw }); } catch { /* đã báo */ } await reload(); };
  const del = async (name: string) => { if (await confirmBox(name)) { try { await api("backup_delete", { name }); } catch { /* đã báo */ } await reload(); } };
  const rest = async (name: string) => {
    if (!(await confirmBox(name, "Khôi phục", "undo", "pri"))) return;
    try { await mut("backup_restore", { name }); toast("Đã khôi phục"); } catch { /* đã báo */ }
    await reload();
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await fetch(API + "backup_upload?name=" + encodeURIComponent(f.name), { method: "POST", body: f, credentials: "same-origin" });
      const j = (await r.json().catch(() => ({}))) as { error?: string; name?: string };
      if (!r.ok) toast(j.error || "Lỗi", "err"); else toast(j.name || "");
    } catch { toast("Lỗi", "err"); }
    if (file.current) file.current.value = "";
    await reload();
  };
  const xlsxOn = c.formats.includes("xlsx");
  return <>
    <div className="srow"><span className="kb2"><Ico n="clock" sz={15} /></span>
      <Switch on={!!c.enabled} onChange={() => void cfg({ enabled: c.enabled ? 0 : 1 })} />
      <CommitIn className="in w" style={{ width: 84, flex: "none" }} type="number" min={0.25} step={0.25} value={String(c.every_h)} title="giờ / lần" onCommit={(v) => void cfg({ every_h: v })} /><span className="bk-note">h</span>
      <span className="kb2"><Ico n="layers" sz={15} /></span>
      <CommitIn className="in w" style={{ width: 70, flex: "none" }} type="number" min={1} value={String(c.keep)} title="Giữ N bản tự động" onCommit={(v) => void cfg({ keep: v })} />
      <div className="grow" /><span className="bk-note">{bk.last ? fmtT(bk.last) : ""}</span></div>
    <div className="srow"><span className="kb2"><Ico n="folder" sz={15} /></span><CommitIn value={c.dir} placeholder={bk.dir} onCommit={(v) => void cfg({ dir: v })} /></div>
    <div className="srow"><span className="chip on" title="Bản đầy đủ mọi bảng (.ahs.gz) - luôn có, khôi phục được"><Ico n="server" sz={14} />Đầy đủ</span>
      <button className={`chip ${xlsxOn ? "on" : ""}`} title="Kèm bản Excel để xem" onClick={() => { const cur = new Set(c.formats); if (cur.has("xlsx")) cur.delete("xlsx"); else cur.add("xlsx"); void cfg({ formats: [...cur] }); }}><Ico n="grid" sz={14} />XLSX</button>
      <div className="grow" /><span className="bk-note" title="Dung lượng dữ liệu ahs_* trên Supabase">Supabase {fmtSize(bk.db_size)}</span></div>
    <div className="srow">
      <button className="btn pri" disabled={busy} onClick={() => void now()}><Ico n="save" sz={16} /><span>Sao lưu ngay</span></button>
      <label className="btn outline" title="Tải lên bản sao lưu (.ahs.gz)"><Ico n="upload" sz={16} /><input ref={file} type="file" accept=".gz,.json" hidden onChange={(e) => void upload(e.target.files?.[0])} /></label>
      <a className="btn outline" href={API + "export_all?fmt=xlsx"} download><Ico n="grid" sz={16} /><span>XLSX</span></a>
      <a className="btn outline" href={API + "export_all?fmt=json"} download><Ico n="file" sz={16} /><span>JSON</span></a>
    </div>
    <div className="sep" />
    {bk.files.length ? bk.files.map((f) => <div key={f.name} className="srow bkf">
      <span className="ci" style={cvar(f.ext === "ahs" ? "#0284c7" : f.ext === "xlsx" ? "#059669" : "#f59e0b")}><Ico n={f.ext === "ahs" ? "server" : f.ext === "xlsx" ? "grid" : "file"} sz={13} /></span>
      <CommitIn value={f.name} onCommit={(v) => void rename(f.name, v)} />
      <span className="bs">{f.kind}</span>
      <span className="bk-note" style={{ width: 62, textAlign: "right" }}>{fmtSize(f.size)}</span>
      <span className="bk-note" style={{ width: 130 }}>{fmtT(f.mtime)}</span>
      <a className="btn icon sm ghost" href={API + "backup_file?name=" + encodeURIComponent(f.name)} download title="Tải về"><Ico n="download" sz={15} /></a>
      {f.ext !== "xlsx" ? <button className="btn icon sm ghost" title="Khôi phục" onClick={() => void rest(f.name)}><Ico n="undo" sz={15} /></button> : <span style={{ width: 28 }} />}
      <button className="btn icon sm ghost" title="Xóa" onClick={() => void del(f.name)}><Ico n="trash" sz={15} /></button>
    </div>) : <div className="ph pad"><Ico n="inbox" sz={20} /></div>}
  </>;
}

/* ═════════ Nhật ký ═════════ */
const LG: Record<string, [string, string]> = {
  account_add: ["plus", "Thêm"], account_edit: ["edit", "Sửa"], delete_accounts: ["trash", "Xóa"], bulk: ["usersplus", "Nhập"], rows_set: ["sliders", "Sửa cột"], mass_set: ["sliders", "Sửa nhiều"],
  status_set: ["tag", "Trạng thái"], owner_set: ["users", "Owner"], device_set: ["smartphone", "Thiết bị"], device: ["smartphone", "Máy"], device_bulk: ["tableplus", "Máy +"], quick: ["plus", "Thêm nhanh"],
  delete: ["trash", "Xóa mục"], backup_now: ["save", "Sao lưu"], backup_auto: ["save", "Tự sao lưu"], backup_restore: ["undo", "Khôi phục"], backup_delete: ["trash", "Xóa backup"], backup_rename: ["edit", "Đổi tên"],
  backup_upload: ["upload", "Tải lên"], backup_cfg: ["gear", "Cấu hình"], repair: ["shield", "Sửa lỗi"], ai_apply: ["bot", "Trợ lý AI"], log_clear: ["trash", "Xóa nhật ký"],
  hist_cfg: ["clock", "Cài lịch sử"], tab: ["layers", "Tab"], field: ["columns", "Trường"], status: ["tag", "Sửa trạng thái"], dept: ["folder", "Bộ phận"], owner: ["users", "Sửa owner"], reorder: ["sliders", "Sắp xếp"],
};
export const logLabel = (act: string): [string, string] => LG[act] || ["activity", act];
/** từ khoá tìm nhật ký — nhớ giữa các lần mở Tùy chỉnh (SET.lq gốc) */
let LQ = "";

export function LogPane() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [q, setQ] = useState(LQ);
  const alive = useRef(true);
  const reload = useCallback((s: string) => api<{ rows: LogRow[] }>("logs?limit=300&q=" + encodeURIComponent(s)).then((r) => { if (alive.current) setLogs(r.rows || []); }, () => { /* đã báo */ }), []);
  useEffect(() => { alive.current = true; void reload(LQ); return () => { alive.current = false; }; }, [reload]);
  useEffect(() => { if (q === LQ) return; const t = setTimeout(() => { LQ = q; void reload(q); }, 250); return () => clearTimeout(t); }, [q, reload]);
  const clear = async () => {
    if (!logs.length) return;
    if (!(await confirmBox("Xóa toàn bộ nhật ký?", "Xóa"))) return;
    try { await api("log_clear", {}); setLogs([]); } catch { /* đã báo */ }
    await reload(LQ);
  };
  const exp = () => void dlXlsx("logs", [["Thời gian", "Hành động", "SL", "Chi tiết"], ...logs.map((r) => [fmtT(r.ts), r.act, r.n, r.detail])]).catch(() => undefined);
  return <>
    <HistCfg />
    <div className="srow">
      <div className="search" style={{ flex: 1, width: "auto" }}><Ico n="search" sz={15} /><input className="in" value={q} placeholder="Tìm" autoComplete="off" onChange={(e) => setQ(e.target.value)} /></div>
      <button className="btn outline" title="Xóa toàn bộ nhật ký" onClick={() => void clear()}><Ico n="trash" sz={16} /><span>Xóa</span></button>
      <button className="btn outline" onClick={exp}><Ico n="grid" sz={16} /><span>XLSX</span></button>
    </div>
    <div className="bprev"><table><thead><tr><th><Ico n="clock" sz={13} /></th><th><Ico n="activity" sz={13} /></th><th>#</th><th><Ico n="info" sz={13} /></th></tr></thead>
      <tbody id="logbody">{logs.map((r) => { const l = logLabel(r.act); return <tr key={r.id}>
        <td>{fmtT(r.ts)}</td>
        <td><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Ico n={l[0]} sz={14} />{l[1]}</span></td>
        <td>{r.n}</td>
        <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }} title={r.detail}>{r.detail}</td>
      </tr>; })}</tbody></table></div>
  </>;
}

/* ───────── r60b: thời gian giữ lịch sử thay đổi từng dòng ───────── */
const HPRE = [30, 90, 180, 365, 0];
const HLAB: Record<string, string> = { "30": "30 ngày", "90": "90 ngày", "180": "180 ngày", "365": "1 năm", "0": "Vĩnh viễn", c: "Tùy chỉnh…" };
/** phát khi xoá toàn bộ lịch sử → bảng xoá bộ đệm "thay đổi gần nhất" (HL.m.clear() gốc). */
export const HIST_CLEAR_EVENT = "ahs:hist-clear";
function HistCfg() {
  const [h, setH] = useState<HistInfo | null>(null);
  const [cu, setCu] = useState(false);
  const days = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; api<HistInfo>("hist_info").then((r) => { if (alive.current) setH(r); }, () => undefined); return () => { alive.current = false; }; }, []);
  useEffect(() => { if (cu) setTimeout(() => days.current?.focus(), 30); }, [cu]);
  if (!h) return null;
  const hSave = async (b: Record<string, unknown>) => { try { const r = await api<HistInfo>("hist_cfg", b); if (alive.current) setH(r); } catch { /* đã báo */ } setCu(false); };
  const cust = !HPRE.includes(h.days) || cu;
  const clear = async () => {
    if (!h.n) return;
    if (!(await confirmBox(`Xóa toàn bộ ${h.n.toLocaleString("vi")} mục lịch sử thay đổi?`, "Xóa"))) return;
    await hSave({ clear: 1 }); window.dispatchEvent(new Event(HIST_CLEAR_EVENT));
  };
  return <div className="hcfg">
    <div className="hcfg-h"><Ico n="clock" sz={15} /><b>Lịch sử thay đổi từng dòng</b><span className="mut">{(h.n || 0).toLocaleString("vi")} mục{h.oldest ? " · cũ nhất " + new Date(h.oldest * 1000).toLocaleDateString("vi-VN") : ""}</span></div>
    <div className="srow"><label className="lab">Giữ trong</label>
      <span style={{ width: 170, flex: "none", display: "flex" }}><Combo className="in" value={cust ? "c" : String(h.days)} opts={[...HPRE.map((d) => ({ v: String(d), t: HLAB[String(d)] })), { v: "c", t: HLAB.c }]} onChange={(v) => { if (v === "c") setCu(true); else void hSave({ days: +v }); }} /></span>
      {cust ? <><CommitIn inputRef={days} type="number" min={1} step={1} value={h.days ? String(h.days) : ""} placeholder="số ngày" style={{ width: 110 }} onCommit={(v) => { const n = Math.max(1, Math.round(+v || 0)); void hSave({ days: n }); }} /><span className="mut">ngày</span></> : null}
      <div className="grow" />
      <button className="btn outline sm" title="Xóa toàn bộ lịch sử thay đổi" onClick={() => void clear()}><Ico n="trash" sz={14} /><span>Xóa lịch sử</span></button>
    </div>
    <div className="srow"><span className="grow">Xóa dòng thì xóa luôn lịch sử của dòng đó</span><Switch on={!h.keepdel} title="Bật / tắt" onChange={() => void hSave({ keepdel: !h.keepdel })} /></div>
  </div>;
}

/* ═════════ Kiểm tra ═════════ */
const HCL: Record<string, string> = { integrity: "Kết nối Supabase", orphan_links: "Liên kết mồ côi", cross_links: "Liên kết sai tab", bad_tab: "Tab không tồn tại", bad_status: "Trạng thái không tồn tại", bad_owner: "Owner không tồn tại", bad_device: "Thiết bị không tồn tại" };
export function HealthPane() {
  const [hc, setHc] = useState<DbCheck | null>(null);
  const alive = useRef(true);
  const check = useCallback(() => api<DbCheck>("check").then((r) => { if (alive.current) setHc(r); }, () => { /* đã báo */ }), []);
  useEffect(() => { alive.current = true; void check(); return () => { alive.current = false; }; }, [check]);
  if (!hc) return <Wait />;
  let bad = 0;
  const rows = Object.entries(hc).map(([k, v]) => { const ok = v === "ok" || v === 0; if (!ok) bad++; return <div key={k} className={`hrow ${ok ? "okk" : "bad"}`}><Ico n={ok ? "check" : "alert"} sz={16} /><span>{HCL[k] || k}</span><span className="hv">{String(v)}</span></div>; });
  const fix = async () => {
    if (!(await confirmBox("Sửa các lỗi dữ liệu (đã tự sao lưu trước)?", "Sửa", "sliders", "pri"))) return;
    try { const r = await mut<DbCheck>("repair", {}); if (alive.current && r && typeof r === "object") setHc(r); } catch { /* đã báo */ }
  };
  return <>
    {rows}
    <div className="srow"><button className="btn outline" title="Kiểm tra lại" onClick={() => void check()}><Ico n="shield" sz={16} /></button>
      {bad ? <button className="btn pri" onClick={() => void fix()}><Ico n="sliders" sz={16} /><span>Sửa</span></button> : null}</div>
  </>;
}
