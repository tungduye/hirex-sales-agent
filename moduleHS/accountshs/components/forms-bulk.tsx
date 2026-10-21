"use client";

// Nhập hàng loạt (v2 của v7.py: cột con của dòng liên kết · bổ sung an toàn · kiểm tra trước · đoán cột) + các hàm "định dạng cột"
// dùng chung với Xuất/sao chép (tokLabel/tokIcon/tokVal/tokFrom/matchTok/parseFmt/FmtBar/tabKeys). Không import ./forms để tránh vòng.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BulkBody, BulkLinkItem, BulkReport, BulkRow, Id, Tab } from "../types";
import { TYPEIC, treeOrder } from "../core/model";
import { indent, nz, sepCh } from "../core/text";
import { Ico } from "./icons";
import { I, S, api, confirmBox, copyText, emit, load, mut, savePref, toast, useHs } from "./store";
import { Combo, Switch, bindHandle, closeModal, openModal, showMenu, type ComboOpt, type MenuItem } from "./ui-kit";

/* ───────── token cột (định dạng) ───────── */
export type TokKey = "note" | "status" | "owner" | "device" | "skip" | "dept" | "tab" | "label";
/** cột mới (tự tạo trường khi nhập) */
export type TokNew = { n: string };
/** cột con: trường tf của dòng được liên kết qua trường link lf */
export type TokSub = { lf: Id; tf: Id };
/** cột con mới (tự tạo trường ở tab được liên kết) */
export type TokSubNew = { lf: Id; n: string };
export type Tok = Id | TokKey | TokNew | TokSub | TokSubNew;
const TOK_KEYS: TokKey[] = ["note", "status", "owner", "device", "skip", "dept", "tab", "label"];
const isTokKey = (v: string): v is TokKey => (TOK_KEYS as string[]).includes(v);
const TOKL: Record<TokKey, string> = { note: "Ghi chú", status: "Trạng thái", owner: "Owner", skip: "Bỏ qua", dept: "Bộ phận", tab: "Loại", label: "Tên", device: "Thiết bị" };
const TOKI: Record<TokKey, string> = { note: "note", status: "tag", owner: "users", skip: "x", dept: "folder", tab: "layers", label: "key", device: "smartphone" };
export const isObjTok = (t: Tok): t is TokNew | TokSub | TokSubNew => typeof t === "object";
const isSub = (t: Tok): t is TokSub => typeof t === "object" && "lf" in t && "tf" in t;
const isSubNew = (t: Tok): t is TokSubNew => typeof t === "object" && "lf" in t && !("tf" in t);
const isNew = (t: Tok): t is TokNew => typeof t === "object" && !("lf" in t);

export function tokLabel(t: Tok): string {
  if (typeof t === "number") return I.field[t]?.label || "?";
  if (typeof t === "string") return TOKL[t] || t;
  if ("lf" in t) { const lf = I.field[t.lf]; return (lf ? lf.label : "?") + " › " + ("tf" in t ? I.field[t.tf]?.label || "?" : t.n); }
  return t.n;
}
export function tokIcon(t: Tok): string {
  if (typeof t === "number") { const f = I.field[t]; return f ? (f.type === "link" ? I.tab[f.link_tab ?? -1]?.icon || "link" : TYPEIC[f.type]) : "type"; }
  if (typeof t === "string") return TOKI[t] || "type";
  if ("lf" in t) return "tf" in t && I.field[t.tf] ? TYPEIC[I.field[t.tf].type] : "plus";
  return "plus";
}
export const tokVal = (t: Tok): string => typeof t === "number" ? "f:" + t : typeof t === "string" ? t : "lf" in t ? ("tf" in t ? `s:${t.lf}:${t.tf}` : `sn:${t.lf}:${t.n}`) : "n:" + t.n;
export function tokFrom(v: string): Tok {
  if (v.startsWith("f:")) return +v.slice(2);
  if (v.startsWith("s:")) { const a = v.split(":"); return { lf: +a[1], tf: +a[2] }; }
  if (v.startsWith("sn:")) { const a = v.split(":"); return { lf: +a[1], n: a.slice(2).join(":") }; }
  if (v.startsWith("n:")) return { n: v.slice(2) };
  return isTokKey(v) ? v : { n: v };
}
export const fmtText = (use: Tok[]) => use.map(tokLabel).join("|");

const ALIAS = [["pass", "password", "pw", "pwd", "mk", "matkhau"], ["mail", "email", "gmail"], ["sdt", "phone", "sodienthoai", "tel", "so", "dienthoai"], ["2fa", "totp", "otp", "fa", "twofa", "ma2fa"], ["note", "ghichu", "comment"], ["status", "trangthai", "tt"], ["owner", "chu", "nguoiquanly", "nguoidung", "user"], ["skip", "bo", "boqua", "x", "_", "-", "ignore"], ["device", "thietbi", "may", "serial", "seri", "machine"]];
function matchTok0(raw: string, t: Tab): Id | TokKey | null {
  const k = nz(raw), r = String(raw).trim();
  if (!k && !(r === "_" || r === "-")) return null;
  if (r === "_" || r === "-") return "skip";
  const grp = ALIAS.find((g) => g.includes(k) || g.includes(r.toLowerCase()));
  const fs = t.fields; let f = fs.find((x) => nz(x.label) === k);
  if (f) return f.id;
  if (grp) {
    const g0 = grp[0]; if (g0 === "note" || g0 === "status" || g0 === "owner" || g0 === "device" || g0 === "skip") return g0;
    f = fs.find((x) => grp.includes(nz(x.label))) || fs.find((x) => grp.some((g) => nz(x.label).includes(g) && g.length > 2)); if (f) return f.id;
  }
  f = fs.find((x) => nz(x.label).startsWith(k) && k.length >= 2); return f ? f.id : null;
}
/** "Email xác minh › Mật khẩu" = cột con: giá trị thuộc dòng Email được liên kết (không phải dòng hiện tại) */
export function matchTok(raw: string, t: Tab): Tok | null {
  const m = String(raw).split(/\s*[›>]\s*/);
  if (m.length === 2 && m[0] && m[1]) {
    const lf = matchTok0(m[0], t), f = typeof lf === "number" ? I.field[lf] : null;
    if (f && f.type === "link" && f.link_tab != null && I.tab[f.link_tab]) {
      const lt = I.tab[f.link_tab], tf = matchTok0(m[1], lt);
      if (typeof tf === "number") { const g = I.field[tf]; if (g && !["link", "lookup", "file"].includes(g.type) && tf !== lt.fields[0]?.id) return { lf: f.id, tf }; return null; }
      if (tf == null) return { lf: f.id, n: m[1].trim() };
    }
    return null;
  }
  return matchTok0(raw, t);
}
export const parseFmt = (text: string, t: Tab): Tok[] => text.split(/[|\t;,]+/).map((x) => x.trim()).filter(Boolean).map((x) => matchTok(x, t) ?? { n: x });
/** khoá nhận diện trùng của tab (Cài đặt › Trường) */
export const tabKeys = (tid: Id): Id[] => { const v = S.meta.tab_keys[String(tid)]; return Array.isArray(v) ? v.filter((id) => I.field[id] && I.field[id].tab_id === tid) : []; };
/** S.bp[tab] = { list: mẫu đã lưu, last: định dạng dùng gần nhất } */
export function bpOf(tab: Id, make = false): { list: string[]; last?: string } | undefined {
  const cur = S.bp[String(tab)];
  if (cur && typeof cur === "object") { const o = cur as { list?: unknown; last?: unknown }; if (!Array.isArray(o.list)) o.list = []; return o as { list: string[]; last?: string }; }
  if (!make) return undefined; const o = { list: [] as string[] }; S.bp[String(tab)] = o; return o;
}

/** thanh định dạng cột: chọn / dời / bỏ / thêm (fmtBar gốc; <select> → menu) */
export function FmtBar({ use, pool, onChange }: { use: Tok[]; pool: Tok[]; onChange: (u: Tok[]) => void }) {
  const nx = pool.find((x) => !use.some((u) => tokVal(u) === tokVal(x))) ?? pool[0];
  const mv = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= use.length) return; const u = use.slice(); [u[i], u[j]] = [u[j], u[i]]; onChange(u); };
  return <div className="fmtrow">
    {use.map((t, i) => {
      const cur = tokVal(t), opts = [t, ...pool.filter((x) => tokVal(x) !== cur)];
      const items: MenuItem[] = opts.map((x) => ({ icon: tokIcon(x), label: (isObjTok(x) && !isSub(x) ? "+ " : "") + tokLabel(x), check: tokVal(x) === cur, fn: () => { const u = use.slice(); u[i] = x; onChange(u); } }));
      return <span key={cur + ":" + i} className="fchip"><span className="ic"><Ico n={tokIcon(t)} sz={13} /></span>
        <button type="button" className="fsel" title="Chọn cột" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, items); }}>{tokLabel(t)}</button>
        <button type="button" title="Dời cột" onClick={() => mv(i, -1)}><Ico n="chevl" sz={13} /></button>
        <button type="button" title="Dời cột" onClick={() => mv(i, 1)}><Ico n="chevr" sz={13} /></button>
        <button type="button" title="Bỏ cột" onClick={() => onChange(use.filter((_, j) => j !== i))}><Ico n="x" sz={13} /></button></span>;
    })}
    {nx !== undefined ? <button className="btn icon sm outline" title="Thêm cột" onClick={() => onChange([...use, nx])}><Ico n="plus" sz={14} /></button> : null}
  </div>;
}
/** Combo chọn mẫu định dạng đã lưu */
export function PresetCombo({ list, onPick }: { list: string[]; onPick: (p: string) => void }) {
  const opts: ComboOpt[] = [{ v: "", t: list.length ? "" : "{Chưa có mẫu}" }, ...list.map((p, i) => ({ v: String(i), t: p }))];
  return <span style={{ width: "auto", maxWidth: 200, display: "inline-flex" }}><Combo value="" opts={opts} title="Mẫu đã lưu" onChange={(v) => { const p = list[+v]; if (p) onPick(p); }} /></span>;
}

/* ───────── nhập hàng loạt ───────── */
type BulkMode = NonNullable<BulkBody["mode"]>;
interface BState { tab: Id; sep: string; autosep: boolean; use: Tok[]; dest: string; status: Id | null; mode: BulkMode; key: Id | "k2" | null; create: boolean; hdr: boolean; text: string; scope: Id[] | null }
interface PRow { data: Record<string, string>; links: Record<string, Array<string | BulkLinkItem>>; sub: Record<string, Record<string, string>>; note: string; status: string; owner: string; device: string; parts: string[]; ln: number }
type Rep = Partial<Omit<BulkReport, "conflicts" | "bad" | "dry">> & { conflicts?: BulkReport["conflicts"]; bad?: BulkReport["bad"] };

const bulkLines = (text: string) => text.split(/\r?\n/).filter((l) => l.trim());
const detectSep = (l: string) => (l.includes("\t") ? "\\t" : l.includes("|") ? "|" : l.includes(";") ? ";" : l.includes(",") ? "," : "|");
const effUse = (B: BState, lines: string[], t: Tab): Tok[] => { if (!B.hdr || !lines.length) return B.use; const sp = sepCh(B.sep); return lines[0].split(sp).map((h) => matchTok(h, t) ?? "skip"); };
function parseBulk(B: BState, t: Tab): { rows: PRow[]; use: Tok[] } {
  const lines = bulkLines(B.text), use = effUse(B, lines, t), sp = sepCh(B.sep), out: PRow[] = [];
  for (let li = B.hdr ? 1 : 0; li < lines.length; li++) {
    const parts = sp ? lines[li].split(sp).map((x) => x.trim()) : [lines[li].trim()];
    const r: PRow = { data: {}, links: {}, sub: {}, note: "", status: "", owner: "", device: "", parts, ln: li + 1 };
    use.forEach((tk, i) => {
      const v = parts[i]; if (v === undefined || v === "") return;
      if (typeof tk === "number") { const f = I.field[tk]; if (!f) return; if (f.type === "link") r.links[tk] = v.split(/[,;]/).map((x) => x.trim()).filter(Boolean); else if (f.type !== "lookup" && f.type !== "file") r.data[tk] = v; }
      else if (isSub(tk)) (r.sub[tk.lf] ??= {})[tk.tf] = v;
      else if (tk === "note") r.note = v; else if (tk === "status") r.status = v; else if (tk === "owner") r.owner = v; else if (tk === "device") r.device = v;
    });
    for (const lf in r.sub) {
      const ks = r.links[lf]; if (!ks) continue;
      r.links[lf] = ks.map((k, i) => { if (typeof k !== "string") return k; const a: Record<string, string> = {}; for (const tf in r.sub[lf]) { const raw = r.sub[lf][tf]; a[tf] = ks.length === 1 ? raw : (raw.split(/[,;]/).map((x) => x.trim())[i] || ""); } return { k, a }; });
    }
    out.push(r);
  }
  return { rows: out, use };
}
const bkKof = (kfs: Id[]) => (d: Record<string, unknown>) => { const p = kfs.map((f) => String(d[String(f)] ?? "").trim().toLowerCase()); return p.some(Boolean) ? p.join("\u001f") : ""; };
const bkKfs = (B: BState): Id[] => B.key === "k2" ? tabKeys(B.tab) : B.key != null ? [B.key] : [];
const bkSubs = (t: Tab): TokSub[] => { const o: TokSub[] = []; for (const f of t.fields) { if (f.type !== "link" || f.link_tab == null || !I.tab[f.link_tab]) continue; I.tab[f.link_tab].fields.forEach((g, i) => { if (i && !["link", "lookup", "file"].includes(g.type)) o.push({ lf: f.id, tf: g.id }); }); } return o; };
function bulkAvail(B: BState, t: Tab): Tok[] {
  const used = new Set(B.use.map(tokVal));
  return [...t.fields.filter((f) => !B.use.includes(f.id)).map((f) => f.id), ...(["note", "status", "owner", "device"] as TokKey[]).filter((k) => !B.use.includes(k)), ...bkSubs(t).filter((s) => !used.has(tokVal(s))), "skip"];
}
const bkType = (n: string) => (/pass|token|2fa|mật khẩu|secret/i.test(n || "") ? "secret" : "text");
const bkPay = (rows: PRow[]): BulkRow[] => rows.map((r) => ({ ln: r.ln, data: r.data, links: r.links, note: r.note, status: r.status, owner: r.owner, device: r.device }));
function bkBase(B: BState, m?: BulkMode): Omit<BulkBody, "rows"> {
  let dept: Id, owner: Id | null = null;
  if (B.dest.startsWith("o:")) { owner = +B.dest.slice(2); dept = I.own[owner]?.dept_id ?? 0; } else dept = +B.dest.slice(2);
  return { tab_id: B.tab, dept_id: dept, owner_id: owner, status_id: B.status, mode: m || B.mode, no_new: !!B.scope, key_field: B.key === "k2" ? undefined : B.key ?? undefined, key_fields: bkKfs(B), create: B.create };
}
const NUMK = ["created", "updated", "skipped", "same", "invalid", "dup_in", "filled", "changed", "kept", "l_created", "l_updated", "l_links", "l_missing"] as const;
const bkAdd = (t: Rep, r: Rep) => { for (const k of NUMK) { const v = r[k]; if (typeof v === "number") t[k] = (t[k] || 0) + v; } t.conflicts = [...(t.conflicts || []), ...(r.conflicts || [])].slice(0, 60); t.bad = [...(t.bad || []), ...(r.bad || [])].slice(0, 60); return t; };
let BKLAST: { lines: string[]; bad: BulkReport["bad"] } | null = null;
const N = (v?: number) => (v || 0).toLocaleString("vi");

/** báo cáo (bkRepHtml): sau Kiểm tra (dry) hoặc sau nhập có lỗi */
function BulkReportView({ r, dry, sample }: { r: Rep; dry: boolean; sample?: number }) {
  const chip = (l: string, v: number | undefined, c = "", t = "") => <span className={`bs ${c}`} title={t}>{l} <b>{N(v)}</b></span>;
  const cf = (r.conflicts || []).length ? <details className="bkd"><summary><Ico n="alert" sz={14} /><span>{N((r.kept || 0) + (r.changed || 0))} ô khác dữ liệu hiện có</span></summary><div className="bkl"><table><thead><tr><th>Dòng</th><th>Tab</th><th>Khóa</th><th>Trường</th><th></th></tr></thead><tbody>{(r.conflicts || []).map((c, i) => <tr key={i}><td>{c.ln ?? ""}</td><td>{c.tab}</td><td>{c.key}</td><td>{c.f}</td><td>{c.kind === "kept" ? "giữ nguyên" : "đã ghi đè"}</td></tr>)}</tbody></table></div></details> : null;
  const bd = (r.bad || []).length ? <details className="bkd" open><summary><Ico n="alert" sz={14} /><span>{N(r.invalid)} lỗi</span><button className="btn sm ghost" title="Chép các dòng lỗi để sửa rồi nhập lại" onClick={(e) => { e.preventDefault(); if (!BKLAST) return; const set = new Set(BKLAST.bad.map((x) => x.ln)); const tx = [...set].filter((x): x is number => x != null).sort((a, b) => a - b).map((i) => BKLAST!.lines[i - 1]).filter(Boolean).join("\n"); void copyText(tx); }}><Ico n="copy" sz={14} /></button></summary><div className="bkl"><table><tbody>{(r.bad || []).map((c, i) => <tr key={i}><td>{c.ln ?? ""}</td><td>{c.why}</td></tr>)}</tbody></table></div></details> : null;
  return <div className="bkr">
    {dry ? <div className="bkh"><Ico n="shield" sz={14} /><span>Chạy thử{sample ? ` ${N(sample)} dòng đầu` : ""} — chưa ghi gì</span></div> : null}
    <div className="bstat">{chip("Thêm mới", r.created, "n")}{chip("Cập nhật", r.updated)}{chip("Không đổi", r.same)}{r.skipped ? chip("Bỏ qua", r.skipped, "d") : null}{r.invalid ? chip("Lỗi", r.invalid, "w") : null}{r.dup_in ? chip("Trùng trong dữ liệu", r.dup_in, "", "Cùng khóa xuất hiện nhiều lần — gộp vào 1 dòng") : null}</div>
    <div className="bstat">{chip("Ô điền", r.filled, "n", "Ô trống được điền")}{r.changed ? chip("Ô ghi đè", r.changed, "w") : null}{r.kept ? chip("Ô giữ nguyên", r.kept, "d", "Đã có dữ liệu khác — giữ nguyên (chọn Ghi đè nếu muốn thay)") : null}{chip("Dòng liên kết mới", r.l_created)}{chip("Bổ sung liên kết", r.l_updated, "", "Dòng liên kết đã có được điền thêm dữ liệu")}{chip("Liên kết mới", r.l_links)}{r.l_missing ? chip("Chưa có (không tự tạo)", r.l_missing, "w") : null}</div>
    {bd}{cf}
  </div>;
}

/* đoán cột từ nội dung: UID · mật khẩu · 2FA · email (+ mật khẩu email) · cookie · token … */
function bkCls(v0: string) {
  const v = String(v0 || "").trim(); if (!v) return "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return "uuid";
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return "email";
  if (/c_user=|\bdatr=|\bxs=\d/.test(v)) return "cookie";
  if (/^EAA[A-Za-z0-9]{20,}/.test(v)) return "fbtoken";
  if (/^(M\.C\d|0\.A|1\.A)/.test(v) || /^[A-Za-z0-9._!*$%\-]{140,}$/.test(v)) return "rtoken";
  if (/^[A-Z2-7 ]{16,72}$/.test(v) && v.replace(/ /g, "").length >= 16) return "b32";
  if (/^(0|\+?84)\d{8,10}$/.test(v.replace(/[\s.]/g, ""))) return "phone";
  if (/^\d{8,20}$/.test(v)) return "uid";
  if (/^https?:\/\//i.test(v)) return "url";
  return "text";
}
function bkGuess(B: BState, t: Tab): Partial<BState> | null {
  const lines = bulkLines(B.text); if (!lines.length) return null;
  const sep = B.autosep ? detectSep(lines[0]) : B.sep, sp = sepCh(sep), smp = lines.slice(B.hdr ? 1 : 0, (B.hdr ? 1 : 0) + 30).map((l) => l.split(sp).map((x) => x.trim()));
  const n = Math.max(...smp.map((p) => p.length)), cls: string[] = [];
  for (let i = 0; i < n; i++) { const c: Record<string, number> = {}; smp.forEach((p) => { const k = bkCls(p[i]); if (k) c[k] = (c[k] || 0) + 1; }); const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; cls.push(top ? top[0] : ""); }
  const links = t.fields.filter((f) => f.type === "link" && f.link_tab != null && I.tab[f.link_tab]);
  const mailF = links.find((f) => /mail/i.test(I.tab[f.link_tab!].name + " " + (I.tab[f.link_tab!].fields[0]?.label || "")));
  const phoneF = links.find((f) => /sđt|sdt|phone|sim|số/i.test(I.tab[f.link_tab!].name));
  const sub = (lf: Id, re: RegExp, nm: string): TokSub | TokSubNew => { const lt = I.tab[I.field[lf].link_tab!], g = lt.fields.find((x, i) => i && re.test(nz(x.label))); return g ? { lf, tf: g.id } : { lf, n: nm }; };
  const use: Tok[] = []; let prev = "", hasPass = false, mailUsed = false;
  cls.forEach((c) => {
    let tk: Tok = "skip";
    if (c === "uid") { const m = matchTok("uid", t); tk = typeof m === "number" ? m : { n: "UID" }; }
    else if (c === "email") { if (mailF && !mailUsed) { tk = mailF.id; mailUsed = true; } }
    else if (c === "text") { if (prev === "email" && mailF && mailUsed) tk = sub(mailF.id, /matkhau|pass|pw/, "Mật khẩu"); else if (!hasPass) { const m = matchTok("pass", t); if (typeof m !== "number") tk = { n: "Mật khẩu" }; else { tk = m; hasPass = true; } } }
    else if (c === "b32") { const m = matchTok("2fa", t); tk = typeof m === "number" ? m : { n: "2FA" }; }
    else if (c === "cookie") { const m = matchTok("cookie", t); tk = typeof m === "number" ? m : { n: "Cookie" }; }
    else if (c === "fbtoken") { const f = t.fields.find((x) => /token/.test(nz(x.label))); tk = f ? f.id : { n: "Token" }; }
    else if (c === "rtoken") { if (mailF) tk = sub(mailF.id, /refresh/, "Refresh token"); }
    else if (c === "uuid") { if (mailF) tk = sub(mailF.id, /clientid/, "Client ID"); }
    else if (c === "phone") { tk = phoneF ? phoneF.id : (matchTok("sdt", t) ?? "skip"); }
    else if (c === "url") { tk = matchTok("link", t) ?? "skip"; }
    use.push(tk); prev = c;
  });
  const uidF = use.find((x): x is Id => typeof x === "number" && /uid/.test(nz(I.field[x].label)));
  return { use, sep, ...(uidF != null ? { key: uidF } : {}) };
}

function BulkModal({ init, h }: { init: BState; h: { dirty: () => boolean } }) {
  useHs();
  const [B, setB] = useState<BState>(init);
  const up = (p: Partial<BState>) => setB((b) => ({ ...b, ...p }));
  const [busy, setBusy] = useState(false); const [prog, setProg] = useState<string | null>(null);
  const [rep, setRep] = useState<{ r: Rep; sample: number } | "busy" | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const t = I.tab[B.tab];
  useLayoutEffect(() => { bindHandle(h, { dirty: () => B.text.trim() !== "" }); });
  const presets = bpOf(B.tab)?.list || [], ft = fmtText(B.use);
  const parsed = useMemo(() => (t ? parseBulk(B, t) : { rows: [], use: [] }), [B, t]);
  const bkey = B.key, btab = B.tab;
  const kOf = useMemo(() => bkKof(bkey === "k2" ? tabKeys(btab) : bkey != null ? [bkey] : []), [bkey, btab]);
  const rows = useMemo(() => { if (!B.scope) return parsed.rows; const set = new Set(B.scope.map((id) => kOf(I.acc[id]?.data || {})).filter(Boolean)); return parsed.rows.filter((r) => set.has(kOf(r.data))); }, [parsed, B.scope, kOf]);
  if (!t) return null;
  const { rows: all, use } = parsed;
  /* thống kê (updBulk v2) */
  let nw = 0, dp = 0, nk = 0; const ex = new Set(S.accs.filter((a) => a.tab_id === B.tab).map((a) => kOf(a.data)).filter(Boolean)), seen = new Set<string>();
  rows.forEach((r) => { const k = kOf(r.data); if (!k) nk++; if (k && B.mode !== "add" && (ex.has(k) || seen.has(k))) dp++; else { nw++; if (k) seen.add(k); } });
  const modeT = B.mode === "add" ? "vẫn thêm mới" : "sẽ cập nhật";
  const miss = [...new Set(use.filter((u): u is TokSub | TokSubNew => isObjTok(u) && "lf" in u && !use.includes(u.lf)).map((u) => I.field[u.lf]?.label || ""))].filter(Boolean);
  const nf = use.filter((u) => isObjTok(u) && !isSub(u)).length;
  const extra = Math.max(0, ...all.slice(0, 200).map((r) => r.parts.length - use.length));
  const setText = (text: string, fromFile = false) => { const p: Partial<BState> = { text }; if (B.autosep) { const s = detectSep(bulkLines(text)[0] || ""); if (s !== B.sep || fromFile) p.sep = s; } up(p); };
  const readFile = (f?: File | null) => { if (!f) return; const r = new FileReader(); r.onload = () => setText(String(r.result), true); r.readAsText(f); };
  const tryClose = async () => { if (h.dirty() && !(await confirmBox("Bỏ nội dung đang nhập?", "Bỏ", "x", "danger"))) return; closeModal(); };
  /* tạo các cột chưa có trường (cột chính / cột con ở tab được liên kết) */
  const bkMake = async (): Promise<Tok[]> => {
    const u = B.use.slice(); let made = false;
    for (let i = 0; i < u.length; i++) {
      const tk = u[i]; if (!isObjTok(tk) || isSub(tk)) continue;
      if (isSubNew(tk)) { const lt = I.field[tk.lf].link_tab; const r = await api<{ id: Id }>("field", { tab_id: lt, label: tk.n, type: bkType(tk.n) }); u[i] = { lf: tk.lf, tf: r.id }; }
      else if (isNew(tk)) { const r = await api<{ id: Id }>("field", { tab_id: B.tab, label: tk.n, type: bkType(tk.n) }); u[i] = r.id; }
      made = true;
    }
    if (made) { await load(); emit(); }
    return u;
  };
  const bulkImport = async () => {
    if (!rows.length || busy) return; setBusy(true);
    try {
      let B2 = B; if (!B.hdr) { const u = await bkMake(); B2 = { ...B, use: u }; up({ use: u }); }
      const rows2 = B.hdr ? rows : (() => { const p = parseBulk(B2, I.tab[B2.tab] ?? t); if (!B2.scope) return p.rows; const set = new Set(B2.scope.map((id) => kOf(I.acc[id]?.data || {})).filter(Boolean)); return p.rows.filter((r) => set.has(kOf(r.data))); })();
      const base = bkBase(B2), tabId = B2.tab, lines = bulkLines(B2.text), fmt = fmtText(B2.use), tot: Rep = {}, CH = 5000;
      if (rows2.length <= 20000) { setProg(String(rows2.length)); bkAdd(tot, await mut<Rep>("bulk", { ...base, rows: bkPay(rows2) })); }
      else { const sid = Date.now() + ""; for (let i = 0; i < rows2.length; i += CH) { setProg(`${Math.min(i + CH, rows2.length)}/${rows2.length}`); bkAdd(tot, await mut<Rep>("bulk", { ...base, sid, last: i + CH >= rows2.length, rows: bkPay(rows2.slice(i, i + CH)) })); } }
      const bp = bpOf(tabId, true)!; bp.last = fmt; savePref();
      closeModal();
      if (tot.invalid) {
        BKLAST = { lines, bad: tot.bad || [] };
        openModal(<><header><span className="ti" style={{ "--c": "#0284c7" } as React.CSSProperties}><Ico n="bulkadd" sz={16} /></span><h3>{I.tab[tabId]?.name}</h3><div className="grow" /><button className="btn icon ghost" title="Đóng" onClick={() => closeModal()}><Ico n="x" sz={16} /></button></header><div className="mbody"><BulkReportView r={tot} dry={false} /></div><footer><button className="btn pri" onClick={() => closeModal()}><Ico n="check" sz={16} /><span>OK</span></button></footer></>, true, "bk");
      } else toast(`+${tot.created || 0}  ↻${tot.updated || 0}  ⤼${tot.skipped || 0}${tot.l_created ? "  ·  liên kết +" + tot.l_created : ""}`);
    } catch { setBusy(false); setProg(null); }
  };
  const bcheck = async () => {
    if (!rows.length || busy) return; setRep("busy");
    try { const NN = 20000, part = rows.slice(0, NN); const r = await api<BulkReport>("bulk_check", { ...bkBase(B), rows: bkPay(part) }); BKLAST = { lines: bulkLines(B.text), bad: r.bad || [] }; setRep({ r, sample: rows.length > NN ? NN : 0 }); }
    catch { setRep(null); }
  };
  const bsave = () => { const bp = bpOf(B.tab, true)!; bp.list = [ft, ...bp.list.filter((x) => x !== ft)].slice(0, 20); bp.last = ft; savePref(); emit(); };
  const bdelp = () => { const bp = bpOf(B.tab); if (!bp) return; bp.list = bp.list.filter((x) => x !== ft); savePref(); emit(); };
  const destOpts: ComboOpt[] = S.meta.depts.flatMap((d) => [{ v: "d:" + d.id, t: d.name }, ...treeOrder(I, d.id).map(({ o, d: dp2 }) => ({ v: "o:" + o.id, t: "  " + indent(dp2, o.name) }))]);
  const keyFields = t.fields.filter((f) => f.type !== "link" && f.type !== "lookup" && f.type !== "file");
  const keyOpts: ComboOpt[] = [...keyFields.map((f) => ({ v: String(f.id), t: f.label })), ...(tabKeys(t.id).length > 1 ? [{ v: "k2", t: tabKeys(t.id).map((id) => I.field[id]?.label).join(" + ") }] : [])];
  const modeOpts: ComboOpt[] = [{ v: "update", t: "Trùng khóa → cập nhật" }, { v: "fill", t: "Trùng khóa → chỉ điền ô trống" }, { v: "skip", t: "Trùng khóa → bỏ qua" }, { v: "add", t: "Thêm trùng" }];
  const canGo = rows.length > 0 && !busy;
  return <div onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canGo) { e.preventDefault(); void bulkImport(); } }}>
    <header><span className="ti" style={{ "--c": t.color } as React.CSSProperties}><Ico n={t.icon} sz={16} /></span><h3>{t.name}</h3><div className="grow" />
      <label className="btn outline sm" title=".txt / .csv"><Ico n="upload" sz={15} /><input type="file" accept=".txt,.csv,.tsv,text/plain" hidden onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
      <button className="btn icon ghost" title="Đóng" onClick={() => void tryClose()}><Ico n="x" sz={16} /></button></header>
    <div className="mbody">
      <div className="bctl">
        <input key={ft} className="in fmt" id="bfmt" defaultValue={ft} placeholder="uid|pass|2fa|email" spellCheck={false} title="Định dạng cột" onBlur={(e) => { if (e.target.value !== ft) up({ use: parseFmt(e.target.value, t) }); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); up({ use: parseFmt(e.currentTarget.value, t) }); } }} />
        <PresetCombo list={presets} onPick={(p) => up({ use: parseFmt(p, t) })} />
        <button className="btn icon outline" title="Tự đoán cột từ dữ liệu dán" onClick={() => { const g = bkGuess(B, t); if (g) up(g); }}><Ico n="columns" sz={16} /></button>
        <button className="btn icon outline" title="Lưu định dạng" onClick={bsave}><Ico n="save" sz={16} /></button>
        <button className="btn icon outline" title="Xóa định dạng đã lưu" onClick={bdelp}><Ico n="trash" sz={16} /></button>
      </div>
      <div className="bctl">
        <label className="lab" title="Phân cách"><Ico n="hash" sz={15} /><input className="in sepin" value={B.sep} onChange={(e) => up({ sep: e.target.value, autosep: false })} /></label>
        <label className="lab" title="Dòng đầu là tiêu đề (tự map cột)"><Ico n="list" sz={15} /><Switch on={B.hdr} onChange={(v) => up({ hdr: v })} /></label>
        <label className="lab" title="Đích"><Ico n="users" sz={15} /><Combo value={B.dest} opts={destOpts} onChange={(v) => up({ dest: v })} /></label>
        <label className="lab" title="Trạng thái mặc định"><Ico n="tag" sz={15} /><Combo value={B.status != null ? String(B.status) : ""} opts={t.statuses.map((s) => ({ v: String(s.id), t: s.label }))} onChange={(v) => up({ status: v ? +v : null })} /></label>
        <label className="lab" title="Khi trùng"><Ico n="copy" sz={15} /><Combo value={B.mode} opts={modeOpts} onChange={(v) => up({ mode: v as BulkMode })} /></label>
        <label className="lab" title="Trường để nhận diện trùng"><Ico n="key" sz={15} /><Combo value={B.key === "k2" ? "k2" : B.key != null ? String(B.key) : ""} opts={keyOpts} onChange={(v) => up({ key: v === "k2" ? "k2" : v ? +v : null })} /></label>
        <label className="lab" title="Tự tạo dòng liên kết nếu chưa có"><Ico n="link" sz={15} /><Switch on={B.create} onChange={(v) => up({ create: v })} /></label>
      </div>
      {B.hdr ? null : <FmtBar use={B.use} pool={bulkAvail(B, t)} onChange={(u) => up({ use: u })} />}
      <textarea ref={ta} className="in" id="btext" spellCheck={false} placeholder={ft + "\n..."} value={B.text} onChange={(e) => setText(e.target.value)}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); readFile(e.dataTransfer.files[0]); }} />
      <div className="bstat" id="bstat">
        <span className="bs" title="Tổng số dòng đọc được từ dữ liệu dán">Tổng dòng <b>{all.length}</b></span>
        {B.scope ? <><span className="bs n" title="Dòng khớp khóa với phần đang chọn">Khớp phần chọn <b>{rows.length}</b></span>{all.length > rows.length ? <span className="bs d" title="Không thuộc phần đang chọn — bỏ qua">Ngoài phần chọn <b>{all.length - rows.length}</b></span> : null}</>
          : <><span className="bs n" title="Dòng chưa có trong hệ thống">Thêm mới <b>{nw}</b></span><span className="bs d" title="Dòng trùng khóa với dòng đã có">Đã tồn tại <b>{dp}</b> · {modeT}</span></>}
        {extra ? <span className="bs" title="Cột vượt quá định dạng — bị bỏ, không ghi vào đâu cả">Bỏ {extra} cột cuối</span> : null}
        {nf ? <span className="bs" title="Cột chưa có trường — sẽ tự tạo khi nhập">Cột mới <b>{nf}</b></span> : null}
        {miss.length ? <span className="bs w" title="Cột con cần có cột liên kết tương ứng">Thiếu cột {miss.join(", ")}</span> : null}
        {nk && B.scope ? <span className="bs w" title="Không có giá trị khóa nên không biết dòng nào để cập nhật — bỏ qua">Thiếu khóa <b>{nk}</b></span> : null}
      </div>
      <div className="bprev" id="bprev">{rows.length ? <table><thead><tr>{use.map((u, i) => <th key={i}>{tokLabel(u)}</th>)}</tr></thead><tbody>{rows.slice(0, 5).map((r) => <tr key={r.ln}>{use.map((_u, i) => <td key={i}>{(r.parts[i] || "").slice(0, 60)}</td>)}</tr>)}</tbody></table> : null}</div>
      <div className="brep" id="brep">{rep === "busy" ? <div className="bkh"><i className="spin1" /><span>…</span></div> : rep ? <BulkReportView r={rep.r} dry sample={rep.sample} /> : null}</div>
    </div>
    <footer><button className="btn outline" onClick={() => void tryClose()}>Hủy</button>
      <button className="btn outline" id="bchk" disabled={!rows.length || busy || rep === "busy"} title="Chạy thử toàn bộ rồi hoàn tác — chỉ xem báo cáo, không ghi dữ liệu" onClick={() => void bcheck()}><Ico n="shield" sz={16} /><span>Kiểm tra</span></button>
      <button className="btn pri" id="bgo" disabled={!canGo} onClick={() => void bulkImport()}><Ico n="usersplus" sz={16} /><span id="bcnt">{prog ?? rows.length}</span></button></footer>
  </div>;
}

/** Nhập hàng loạt cho tab (mặc định tab đang xem); scope = chỉ cập nhật các dòng này (từ Sửa hàng loạt › "Nhập nhiều cột") */
export function openBulk(tabId?: Id, scope?: Id[]) {
  const tid = tabId ?? (typeof S.tab === "number" ? S.tab : null); const t = tid != null ? I.tab[tid] : undefined; if (!t) return;
  const last = bpOf(t.id)?.last, ks = tabKeys(t.id);
  const B: BState = { tab: t.id, sep: "|", autosep: true, use: t.fields.map((f) => f.id), dest: S.owner != null ? "o:" + S.owner : (S.dept === "all" ? "d:" + (S.meta.depts[0]?.id ?? 0) : "d:" + S.dept), status: t.statuses[0]?.id ?? null, mode: "update", key: ks.length > 1 ? "k2" : (ks[0] ?? t.fields[0]?.id ?? null), create: !scope, hdr: false, text: "", scope: scope && scope.length ? scope.slice() : null };
  if (last) B.use = parseFmt(last, t);
  const h = { dirty: () => false };
  openModal(<BulkModal init={B} h={h} />, true, "bk", async () => !h.dirty() || confirmBox("Bỏ nội dung đang nhập?", "Bỏ", "x", "danger"));
}
export { BulkReportView };
export type { Rep as BulkRep };
