"use client";

// Đính kèm (trường kiểu "file") — port khối "Đính kèm" của v7.py (6054-6174): ô tải lên trong form (kéo thả · dán ảnh · tiến độ · gỡ),
// chip file ở bảng/chi tiết, cửa sổ xem nhanh (ảnh / PDF / video / audio / Word / Excel·CSV / text) kéo tiêu đề để di chuyển,
// kéo góc để đổi cỡ (nhớ cỡ), ←/→ chuyển file, Esc đóng. Kèm openFloat(): cửa sổ nổi tự do (tvbox) dùng chung với detail-text.
import { createRoot } from "react-dom/client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Attachment, FieldValue } from "../types";
import { attExt, attIcon, attKind, attSize, fmtFull } from "../core/text";
import { Ico } from "./icons";
import { API, toast } from "./store";

/* ───────── cửa sổ nổi (tvbox / attwin) — vẽ trong lớp .hs-acc.hs-layer để ăn CSS + theme ───────── */
const FLOATS = new Map<string, () => void>();
/** mở 1 cửa sổ nổi theo khoá (mở lại cùng khoá = thay cái cũ). Trả về hàm đóng. */
export function openFloat(key: string, render: (close: () => void) => ReactNode): () => void {
  FLOATS.get(key)?.();
  let host = document.querySelector<HTMLElement>(".hs-acc.hs-layer"); let own = false;
  if (!host) { host = document.createElement("div"); host.className = "hs-acc hs-layer"; document.body.appendChild(host); own = true; }
  const box = document.createElement("div"); box.style.display = "contents";
  host.prepend(box); // đứng trước các lớp của LayerHost → hộp xác nhận (confirmBox) luôn nằm trên
  const root = createRoot(box); let done = false; const h = host;
  const close = () => {
    if (done) return; done = true; if (FLOATS.get(key) === close) FLOATS.delete(key);
    setTimeout(() => { root.unmount(); box.remove(); if (own && !h.childElementCount) h.remove(); }, 0);
  };
  FLOATS.set(key, close); root.render(render(close)); return close;
}
export const closeFloat = (key: string) => FLOATS.get(key)?.();
/** kéo tiêu đề (.tvh) để di chuyển cửa sổ nổi */
export function dragByHeader(e: React.PointerEvent<HTMLElement>, el: HTMLElement | null) {
  const t = e.target as HTMLElement;
  if (!el || !t.closest(".tvh") || t.closest("button") || e.button !== 0) return;
  e.preventDefault();
  const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
  const mv = (ev: PointerEvent) => { el.style.left = Math.min(innerWidth - 80, Math.max(0, ev.clientX - dx)) + "px"; el.style.top = Math.min(innerHeight - 44, Math.max(0, ev.clientY - dy)) + "px"; };
  addEventListener("pointermove", mv); addEventListener("pointerup", () => removeEventListener("pointermove", mv), { once: true });
}
/** vị trí/cỡ ban đầu: giữa màn hình, không vượt khung */
export function floatBox(z: { w: number; h: number }): React.CSSProperties {
  const W = Math.min(z.w, innerWidth - 24), H = Math.min(z.h, innerHeight - 24);
  return { width: W, height: H, left: Math.max(12, (innerWidth - W) / 2), top: Math.max(12, (innerHeight - H) / 2) };
}
/** nhớ cỡ cửa sổ khi người dùng kéo góc (ResizeObserver, trễ 250ms) */
export function useSizeMemo(ref: React.RefObject<HTMLElement | null>, save: (z: { w: number; h: number }) => void) {
  const cb = useRef(save); useLayoutEffect(() => { cb.current = save; });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let t = 0, first = true;
    const ro = new ResizeObserver(() => { if (first) { first = false; return; } clearTimeout(t); t = window.setTimeout(() => { if (el.isConnected) cb.current({ w: Math.round(el.offsetWidth), h: Math.round(el.offsetHeight) }); }, 250); });
    ro.observe(el); return () => { clearTimeout(t); ro.disconnect(); };
  }, [ref]);
}

/* ───────── tiện ích ───────── */
export const attList = (v: FieldValue | unknown): Attachment[] => (Array.isArray(v) ? (v as Attachment[]).filter((x) => x && typeof x === "object" && x.id) : []);
export const attUrl = (f: Attachment, dl = false) => `${API}att?id=${encodeURIComponent(f.id)}&n=${encodeURIComponent(f.n || "")}${dl ? "&dl=1" : ""}`;
export function attDl(f: Attachment) { const a = document.createElement("a"); a.href = attUrl(f, true); a.download = f.n || "file"; document.body.appendChild(a); a.click(); a.remove(); }
/** tải 1 file lên (POST nhị phân) → bản ghi đính kèm {id,n,s,m,t} */
export async function attUploadOne(file: File): Promise<Attachment> {
  if (file.size > 100 * 1048576) throw new Error(file.name + ": quá 100 MB");
  const r = await fetch(API + "att_upload?name=" + encodeURIComponent(file.name), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file, credentials: "same-origin" });
  let j: unknown = {}; try { j = await r.json(); } catch { /* không phải JSON */ }
  if (!r.ok) throw new Error((j as { error?: string }).error || "Lỗi tải lên");
  return j as Attachment;
}

/* ───────── chip file (bảng + chi tiết): bấm = xem ───────── */
export function AttList({ list, compact = true, max }: { list: Attachment[]; compact?: boolean; max?: number }) {
  const L = attList(list); if (!L.length) return null;
  const mx = max ?? (compact ? 2 : L.length), sh = L.slice(0, mx);
  return <span className="attl">
    {sh.map((f, i) => <button key={f.id + ":" + i} type="button" className={`attc ft-${attKind(f.n) || "none"}`} title={`${f.n} · ${attSize(f.s)} — bấm để xem`} onClick={(e) => { e.stopPropagation(); openAttPreview(L, i); }}><span className="atti"><Ico n={attIcon(f.n)} sz={12} /></span><span className="attnm">{f.n}</span></button>)}
    {L.length > mx ? <button type="button" className="attm" title={`Xem tất cả ${L.length} file`} onClick={(e) => { e.stopPropagation(); openAttPreview(L, mx); }}><Ico n="clip" sz={12} />+{L.length - mx}</button> : null}
  </span>;
}

/* ───────── ô đính kèm trong form Thêm/Sửa ───────── */
/** paste=true: dán ảnh (Ctrl+V) khi form chỉ có đúng 1 trường đính kèm */
export function FileField({ value, onChange, paste = false }: { value: Attachment[] | FieldValue | undefined; onChange: (v: Attachment[]) => void; paste?: boolean }) {
  const L = attList(value);
  const [up, setUp] = useState(0); const [over, setOver] = useState(false);
  const cur = useRef(L); useLayoutEffect(() => { cur.current = L; });
  const cb = useRef(onChange); useLayoutEffect(() => { cb.current = onChange; });
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const upload = async (files: File[]) => {
    if (!files.length) return; setUp((n) => n + files.length);
    for (const file of files) {
      try { const j = await attUploadOne(file); if (alive.current && !cur.current.some((x) => x.id === j.id)) { const nl = [...cur.current, j]; cur.current = nl; cb.current(nl); } }
      catch (e) { toast(e instanceof Error ? e.message : "Lỗi tải lên", "err"); }
      finally { if (alive.current) setUp((n) => Math.max(0, n - 1)); }
    }
  };
  const upRef = useRef(upload); useLayoutEffect(() => { upRef.current = upload; });
  useEffect(() => {
    if (!paste) return;
    const h = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files || [])]; if (!files.length) return; e.preventDefault();
      void upRef.current(files.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `anh_dan_${Date.now()}_${i}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }))));
    };
    document.addEventListener("paste", h); return () => document.removeEventListener("paste", h);
  }, [paste]);
  const rm = (i: number) => { const nl = L.filter((_, j) => j !== i); cur.current = nl; onChange(nl); };
  return <div className={`attbox ${over ? "over" : ""}`}
    onDragOver={(e) => { e.preventDefault(); setOver(true); }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
    onDrop={(e) => { e.preventDefault(); setOver(false); void upload([...e.dataTransfer.files]); }}>
    {L.map((x, i) => <div key={x.id + ":" + i} className="attr"><span className="atti"><Ico n={attIcon(x.n)} sz={15} /></span>
      <button type="button" className="attn" title="Xem" onClick={() => openAttPreview(L, i)}>{x.n}</button><em>{attSize(x.s)}</em>
      <button type="button" className="btn icon sm ghost" title="Xem" onClick={() => openAttPreview(L, i)}><Ico n="eye" sz={14} /></button>
      <button type="button" className="btn icon sm ghost" title="Tải xuống" onClick={() => attDl(x)}><Ico n="download" sz={14} /></button>
      <button type="button" className="btn icon sm ghost" title="Gỡ file" onClick={() => rm(i)}><Ico n="x" sz={14} /></button></div>)}
    {up ? <div className="attr up"><span className="spin1" /><span>Đang tải lên {up} file…</span></div> : null}
    <label className="attadd" title="Chọn file hoặc kéo thả vào đây"><Ico n="upload" sz={15} /><span>Thêm file</span><em>hoặc kéo thả · ảnh, Word, Excel, PDF, text…</em>
      <input type="file" multiple hidden onChange={(e) => { const fs = [...(e.target.files || [])]; e.target.value = ""; void upload(fs); }} /></label>
  </div>;
}

/* ───────── cửa sổ xem file ───────── */
type Preview =
  | { kind: "docx"; html: string }
  | { kind: "xlsx"; sheets: Array<{ name: string; rows: string[][]; cols: number; cut: boolean }> }
  | { kind: "text"; text: string; cut: boolean }
  | { kind: "none" };
const AVS_KEY = "accountshs.avs";
const avsGet = (): { w: number; h: number } => { try { const v = JSON.parse(localStorage.getItem(AVS_KEY) || "null") as { w?: unknown; h?: unknown } | null; if (v && typeof v.w === "number" && typeof v.h === "number") return { w: v.w, h: v.h }; } catch { /* */ } return { w: 900, h: 640 }; };
const avsSet = (z: { w: number; h: number }) => { try { localStorage.setItem(AVS_KEY, JSON.stringify(z)); } catch { /* */ } };
const colName = (i: number) => { let r = ""; i++; while (i > 0) { const m = (i - 1) % 26; r = String.fromCharCode(65 + m) + r; i = Math.floor((i - 1) / 26); } return r; };

/** mở cửa sổ xem: 1 file hoặc danh sách (bắt đầu ở file thứ i) */
export function openAttPreview(att: Attachment | Attachment[], i = 0) {
  const L = attList(Array.isArray(att) ? att : [att]); if (!L.length) return;
  openFloat("attv", (close) => <AttViewer L={L} i0={Math.max(0, Math.min(i, L.length - 1))} close={close} />);
}

function AttNone({ f, msg }: { f: Attachment; msg?: string }) {
  return <div className="attno"><Ico n={attIcon(f.n)} sz={40} /><p>{msg || "Định dạng này chưa hỗ trợ xem trước"}</p><button className="btn icon pri" title="Tải xuống" onClick={() => attDl(f)}><Ico n="download" sz={16} /></button></div>;
}

function AttViewer({ L, i0, close }: { L: Attachment[]; i0: number; close: () => void }) {
  const [i, setI] = useState(i0); const [z, setZ] = useState(0); const [sh, setSh] = useState(0);
  const [bad, setBad] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, Preview | { err: string }>>({});
  const [cache, setCache] = useState<Record<string, Preview | { err: string }>>({});
  const el = useRef<HTMLDivElement>(null);
  const [box] = useState(() => floatBox(avsGet()));
  useSizeMemo(el, avsSet);
  const f = L[i], k = attKind(f.n), n = L.length, url = attUrl(f);
  const go = (j: number) => { if (j < 0 || j >= n) return; setI(j); setZ(0); setSh(0); setBad(null); };
  const nav = useRef((d: number) => go(i + d)); useLayoutEffect(() => { nav.current = (d: number) => go(i + d); });
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (!el.current?.isConnected) return;
      if (document.querySelector(".hs-layer .overlay.top")) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { const t = e.target as HTMLElement; if (/INPUT|TEXTAREA/.test(t.tagName) || t.isContentEditable) return; e.preventDefault(); e.stopImmediatePropagation(); nav.current(e.key === "ArrowLeft" ? -1 : 1); }
    };
    window.addEventListener("keydown", kd, true); return () => window.removeEventListener("keydown", kd, true);
  }, [close]);
  /* docx / xlsx / text → GET att_preview (nhớ theo file) */
  useEffect(() => {
    if (!["docx", "xlsx", "text"].includes(k) || cacheRef.current[f.id]) return;
    (async () => {
      try { const r = await fetch(`${API}att_preview?id=${encodeURIComponent(f.id)}&n=${encodeURIComponent(f.n)}`, { credentials: "same-origin" }); const d = await r.json() as Preview & { error?: string }; if (!r.ok) throw new Error(d.error || "Lỗi"); cacheRef.current[f.id] = d; }
      catch (e) { cacheRef.current[f.id] = { err: e instanceof Error ? e.message : "" }; }
      const v = cacheRef.current[f.id]; setCache((c) => ({ ...c, [f.id]: v }));
    })();
  }, [f.id, f.n, k]);
  const zoom = (d: number) => setZ((v) => (d === 0 ? (v ? 0 : 2) : Math.max(-2, Math.min(6, v + d))));

  let body: ReactNode;
  if (k === "img") body = bad ? <AttNone f={f} msg={bad} /> : <div className={`attimg ${z ? "zoom" : ""}`}><img src={url} alt={f.n} style={z ? { width: Math.round(100 * Math.pow(1.4, z)) + "%", maxWidth: "none", maxHeight: "none" } : undefined} onClick={() => zoom(0)} onError={() => setBad("Không mở được ảnh")} /></div>;
  else if (k === "pdf") body = <iframe src={url} title={f.n} />;
  else if (k === "video") body = <div className="attimg"><video src={url} controls /></div>;
  else if (k === "audio") body = <div className="attno"><Ico n="music" sz={40} /><audio src={url} controls /></div>;
  else if (!["docx", "xlsx", "text"].includes(k)) body = <AttNone f={f} msg={attExt(f.n) === "doc" || attExt(f.n) === "xls" ? "File Word/Excel đời cũ (.doc/.xls) chưa xem trước được — hãy tải xuống, hoặc lưu lại thành .docx/.xlsx" : ""} />;
  else {
    const d = cache[f.id];
    if (!d) body = <div className="attno"><span className="spin1" /><p>Đang mở…</p></div>;
    else if ("err" in d) body = <AttNone f={f} msg={"Không đọc được file: " + d.err} />;
    else if (d.kind === "docx") body = <div className="attdoc">{d.html ? <article className="attpaper" dangerouslySetInnerHTML={{ __html: d.html }} /> : <article className="attpaper"><p className="mut">(Tài liệu trống)</p></article>}</div>;
    else if (d.kind === "text") body = <><pre className="atttxt">{d.text}</pre>{d.cut ? <div className="attcut">Chỉ hiển thị 2 MB đầu — tải xuống để xem đầy đủ</div> : null}</>;
    else if (d.kind === "xlsx") {
      const shs = d.sheets || [], si = Math.min(sh, Math.max(0, shs.length - 1)), s = shs[si] || { rows: [], cols: 0, cut: false, name: "" }, nc = Math.max(s.cols, 1), cols = Array.from({ length: nc }, (_, x) => x);
      body = <>
        {shs.length > 1 ? <div className="attsh" role="tablist">{shs.map((x, j) => <button key={j} className={`chip ${j === si ? "on" : ""}`} onClick={() => setSh(j)}><Ico n="fxls" sz={13} /><span>{x.name}</span><em>{x.rows.length}</em></button>)}</div> : null}
        <div className="attxl">{s.rows.length ? <table><thead><tr><th />{cols.map((c) => <th key={c}>{colName(c)}</th>)}</tr></thead><tbody>{s.rows.map((r, ri) => <tr key={ri}><th>{ri + 1}</th>{cols.map((c) => <td key={c}>{r[c] ?? ""}</td>)}</tr>)}</tbody></table> : <div className="attno"><p>Sheet trống</p></div>}</div>
        {s.cut ? <div className="attcut">File lớn — chỉ hiển thị 3.000 dòng / 80 cột đầu. Tải xuống để xem đầy đủ</div> : null}
      </>;
    } else body = <AttNone f={f} />;
  }

  return <div ref={el} id="attv" className="tvbox attwin" role="dialog" aria-label={f.n} style={box} onPointerDown={(e) => dragByHeader(e, el.current)}>
    <header className="tvh"><Ico n={attIcon(f.n)} sz={15} /><b className="attnm" title={f.n}>{f.n}</b><span className="mut">{attSize(f.s)}</span><div className="grow" />
      {k === "img" ? <><button className="btn icon sm ghost" title="Thu nhỏ" onClick={() => zoom(-1)}><Ico n="zoomout" sz={15} /></button><button className="btn icon sm ghost" title="Vừa khung / kích thước thật" onClick={() => zoom(0)}><Ico n="fit" sz={15} /></button><button className="btn icon sm ghost" title="Phóng to" onClick={() => zoom(1)}><Ico n="zoomin" sz={15} /></button><span className="tsep" /></> : null}
      {n > 1 ? <><button className="btn icon sm ghost" title="File trước (←)" disabled={!i} onClick={() => go(i - 1)}><Ico n="chevl" sz={15} /></button><span className="attpg">{i + 1}/{n}</span><button className="btn icon sm ghost" title="File sau (→)" disabled={i >= n - 1} onClick={() => go(i + 1)}><Ico n="chevr" sz={15} /></button><span className="tsep" /></> : null}
      <button className="btn icon sm ghost" title="Tải xuống" onClick={() => attDl(f)}><Ico n="download" sz={15} /></button><button className="btn icon sm ghost" title="Đóng (Esc)" onClick={close}><Ico n="x" sz={15} /></button></header>
    <div className={`attbody k-${k || "none"}`} id="attbody">{body}</div>
    {n > 1 ? <div className="attstrip">{L.map((x, j) => <button key={x.id + ":" + j} className={`attth ${j === i ? "on" : ""}`} title={x.n} onClick={() => go(j)}>{attKind(x.n) === "img" ? <img src={attUrl(x)} alt="" loading="lazy" /> : <Ico n={attIcon(x.n)} sz={16} />}<span>{x.n}</span></button>)}</div> : null}
    <footer className="tvf"><span className="attmeta">{(attExt(f.n).toUpperCase() || "FILE") + " · " + attSize(f.s)}</span>{f.t ? <span className="tvtm"><Ico n="upload" sz={12} /><span>Tải lên</span><b>{fmtFull(f.t)}</b></span> : null}</footer>
  </div>;
}
