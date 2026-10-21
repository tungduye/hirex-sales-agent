"use client";

// Hộp xem ô (nhấp đúp ô / chuột phải › Ghi chú) — port openTV r-bản cuối (6277-6315) + cellTV (6324-6332) + tvTimes (6254-6256):
// mở ra là sửa được ngay (trừ chỉ đọc / mật khẩu đang che) · Lưu = lưu + đóng · Esc/X = đóng (hỏi nếu còn thay đổi) · Ctrl+Enter/Ctrl+S lưu ·
// ghi chú + trường chữ có thanh định dạng (định dạng ở data._fmt, giá trị vẫn text thuần) · kéo tiêu đề di chuyển · kéo góc đổi cỡ (nhớ S.tvs).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Account, Id } from "../types";
import { lookupSecret, lookupVal, TYPEIC } from "../core/model";
import { fmtFull, isRich } from "../core/text";
import { Ico } from "./icons";
import { I, S, confirmBox, copyText, savePref, useHs } from "./store";
import { closePop } from "./ui-kit";
import { NoteEditor, RteView, fmtData, fmtOf, rteClean, rteTextDom, saveAcc, type RteApi } from "./forms";
import { attList, dragByHeader, floatBox, openAttPreview, openFloat, useSizeMemo } from "./attachments";

export interface TvOpts { icon: string; title: string; acc?: Account; sub?: string; val: string; secret?: boolean; multi?: boolean; rich?: boolean; save?: (v: string) => Promise<void> }

/** thời điểm tạo / cập nhật của dòng (chân hộp xem) */
export function TvTimes({ acc }: { acc?: Account }) {
  const a = acc ? I.acc[acc.id] || acc : undefined; if (!a) return <span />;
  return <span className="tvtm" title="Thời điểm tạo và lần cập nhật gần nhất của dòng"><Ico n="clock" sz={12} /><span>Tạo</span><b>{fmtFull(a.created || a.updated)}</b><span className="tvsep" /><span>Cập nhật</span><b>{fmtFull(a.updated)}</b></span>;
}

const tvsGet = (): { w: number; h: number } => { const z = S.tvs as { w?: unknown; h?: unknown } | null; return z && typeof z.w === "number" && typeof z.h === "number" ? { w: z.w, h: z.h } : { w: 560, h: 360 }; };
const nrm = (v: string) => (isRich(v) ? rteClean(v) : String(v ?? "").replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/[ \t]+$/gm, "").replace(/\n+$/, ""));

/** mở hộp xem/sửa văn bản nổi */
export function openTV(o: TvOpts) { closePop(); openFloat("tv", (close) => <TvBox o={o} close={close} />); }

function TvBox({ o, close }: { o: TvOpts; close: () => void }) {
  useHs();
  const el = useRef<HTMLDivElement>(null), ta = useRef<HTMLTextAreaElement>(null), tvt = useRef<HTMLDivElement>(null), api = useRef<RteApi | null>(null), busy = useRef(false);
  const [box] = useState(() => floatBox(tvsGet()));
  useSizeMemo(el, (z) => { S.tvs = z; savePref(); });
  const [sh, setSh] = useState(!o.secret || S.reveal);
  const [ed, setEd] = useState(!!o.save && (!o.secret || S.reveal));
  const [live, setLive] = useState(o.val);
  const txt = (v: string) => (o.rich ? rteTextDom(v) : String(v ?? ""));
  const cnt = (v: string) => { const t = txt(v); return `${t ? t.split("\n").length : 0} dòng · ${t.length} ký tự`; };
  const cur = ed ? live : o.val, dirty = ed && nrm(cur) !== nrm(o.val);
  const closeX = async () => { if (dirty && !(await confirmBox("Bỏ thay đổi chưa lưu?", "Bỏ", "x", "danger"))) return; close(); };
  const save = async () => {
    if (busy.current || !o.save) return; if (!dirty) { close(); return; }
    let v = cur; if (!o.multi && !o.rich) v = v.replace(/\r?\n/g, " ");
    busy.current = true; try { await o.save(v); close(); } catch { busy.current = false; }
  };
  const st = useRef({ ed, closeX, save }); useLayoutEffect(() => { st.current = { ed, closeX, save }; });
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (!el.current?.isConnected || document.querySelector(".hs-layer .overlay.top")) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); if (api.current?.closeMenu()) return; void st.current.closeX(); }
      else if (st.current.ed && (e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key.toLowerCase() === "s")) { e.preventDefault(); e.stopImmediatePropagation(); void st.current.save(); }
    };
    document.addEventListener("keydown", kd, true); return () => document.removeEventListener("keydown", kd, true);
  }, []);
  useEffect(() => {
    if (ed && !o.rich) { const t = ta.current; if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
    else if (!ed) tvt.current?.focus();
  }, [ed, o.rich]);
  const v = o.val;
  return <div ref={el} id="tvbox" className={`tvbox${o.rich ? " rich" : ""}${dirty ? " dirty" : ""}`} role="dialog" aria-label={o.title} style={box} onPointerDown={(e) => dragByHeader(e, el.current)}>
    <header className="tvh"><Ico n={o.icon} sz={15} /><b>{o.title}</b>{o.sub ? <span className="mut">{o.sub}</span> : null}<i className="tvdot" title="Có thay đổi chưa lưu" /><div className="grow" />
      {o.secret ? <button type="button" className="btn icon sm ghost" title={sh ? "Ẩn" : "Hiện"} onClick={() => { const n = !sh; setSh(n); if (n && o.save && !ed) { setEd(true); setLive(o.val); } }}><Ico n={sh ? "eyeoff" : "eye"} sz={15} /></button> : null}
      {v ? <button type="button" className="btn icon sm ghost" title="Chép" onClick={() => void copyText(txt(cur))}><Ico n="copy" sz={15} /></button> : null}
      {ed ? <button type="button" className="btn sm pri" title="Lưu & đóng (Ctrl+Enter)" disabled={!dirty} onClick={() => void save()}><Ico n="check" sz={14} /><span>Lưu</span></button> : null}
      <button type="button" className="btn icon sm ghost" title="Đóng (Esc)" onClick={() => void closeX()}><Ico n="x" sz={15} /></button></header>
    <div className="tvb">{ed
      ? (o.rich ? <div className="tvrte"><NoteEditor value={v} autoFocus placeholder="Nhập nội dung…" onChange={setLive} apiRef={api} /></div>
        : <textarea ref={ta} className="tvta" spellCheck={false} value={live} onChange={(e) => setLive(e.target.value)} />)
      : <div ref={tvt} className={`tvt ${v ? "" : "mut"} ${o.rich && v ? "rt" : ""}`} tabIndex={0}>{v ? (sh ? (o.rich ? <RteView v={v} /> : v) : "••••••••") : "(trống)"}</div>}</div>
    <footer className="tvf"><span className="tvc">{cnt(cur)}</span><TvTimes acc={o.acc} /></footer>
  </div>;
}

/** nhấp đúp ô: key = "note" | "label" | id trường */
export function cellTV(a: Account, key: Id | string) {
  const t = I.tab[a.tab_id]; if (!t) return; const lb = I.acc[a.id]?.label ?? "#" + a.id;
  if (key === "note") { openTV({ icon: "note", title: "Ghi chú", rich: true, multi: true, acc: a, sub: lb, val: fmtOf(a, "note"), save: (v) => { const r = fmtData(a, "note", v); return saveAcc(a, { note: r.plain, data: { _fmt: r.fmt } }); } }); return; }
  const f = key === "label" ? t.fields[0] : I.field[+key];
  if (f && f.type === "file") { const L = attList(a.data[String(f.id)]); if (L.length) openAttPreview(L, 0); return; }
  if (!f || ["link", "select", "date"].includes(f.type)) return;
  if (f.type === "lookup") { openTV({ icon: "swap", title: f.label, acc: a, sub: lb + " · tự lấy, chỉ đọc", val: lookupVal(I, a, f) || "", secret: lookupSecret(I, f) }); return; }
  const rich = !["secret", "number"].includes(f.type), k = String(f.id);
  openTV({
    icon: TYPEIC[f.type] || "type", title: f.label, acc: a, sub: lb, rich, val: rich ? fmtOf(a, k) : String(a.data[k] ?? ""), secret: f.type === "secret", multi: f.type !== "number",
    save: (v) => { if (!rich) return saveAcc(a, { data: { [k]: f.type === "number" ? v.trim() : v } }); const r = fmtData(a, k, v); return saveAcc(a, { data: { [k]: r.plain, _fmt: r.fmt } }); },
  });
}
