import "server-only";

import { gunzipSync, gzipSync } from "node:zlib";
import JSZip from "jszip";
import { BUCKET, HsError, T, chunks, hasLogUser, getJsonSetting, getSetting, j, log, now, pages, run, sb, setSetting } from "./db";
import { dbSize, loadAccounts, maintain } from "./accounts-data";
import type { Account, BackupCfg, BackupFile, BackupsInfo, Field, Id } from "../types";

/* Sao lưu: trước đây là thư mục backup/data_backup trên máy; giờ là Supabase Storage (bucket hs-accountshs, thư mục backup/).
   Định dạng .ahs.gz giữ nguyên (JSON từng dòng, gzip) → bản sao lưu cũ của bản Python khôi phục được ở đây và ngược lại. */

export { BUCKET };
const DIR = "backup";
export const BK_EXT = ".ahs.gz";
const TABLES = ["depts", "owners", "tabs", "fields", "statuses", "devices", "accounts", "links", "settings", "logs", "tomb", "acc_hist", "cyv_checks"] as const;
const IDTAB = new Set(["depts", "owners", "tabs", "fields", "statuses", "devices", "accounts", "links", "logs", "acc_hist", "cyv_checks"]);
const COLS: Record<(typeof TABLES)[number], string[]> = {
  depts: ["id", "name", "color", "pos"], owners: ["id", "dept_id", "parent_id", "name", "color", "pos"], tabs: ["id", "name", "icon", "color", "pos", "grp", "lazy", "tint"],
  fields: ["id", "tab_id", "label", "type", "opts", "link_tab", "pos"], statuses: ["id", "tab_id", "label", "color", "pos"],
  devices: ["id", "dept_id", "owner_id", "name", "kind", "serial", "caps", "note", "pos", "created"],
  accounts: ["id", "tab_id", "dept_id", "owner_id", "status_id", "note", "data", "created", "updated", "device_id"],
  links: ["id", "src", "dst", "field_id"], settings: ["k", "v"], logs: ["id", "ts", "act", "n", "detail", "user_id", "user_name"], tomb: ["id", "ts", "tab_id", "dept_id", "owner_id"],
  acc_hist: ["id", "acc_id", "ts", "k", "m", "data", "status_id", "owner_id", "dept_id", "note", "device_id"], cyv_checks: ["id", "ck", "acc_id", "ts", "res", "info"],
};
const DEFAULT_CFG: BackupCfg = { dir: "", enabled: 1, every_h: 24, keep: 14, formats: ["ahs", "xlsx"] };
const storage = () => sb().storage.from(BUCKET);
const stamp = () => { const d = new Date(Date.now() + 7 * 3600_000); return d.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15); };

export async function cfgGet(): Promise<BackupCfg> {
  const c = { ...DEFAULT_CFG, ...(await getJsonSetting<Partial<BackupCfg>>("backup", {})) };
  c.formats = ["ahs", ...(c.formats ?? []).filter((f) => f === "xlsx")];
  return c;
}
export async function cfgSet(b: Record<string, unknown>): Promise<BackupCfg> {
  const c = await cfgGet();
  if ("dir" in b) c.dir = String(b.dir ?? "").trim();
  if ("enabled" in b) c.enabled = b.enabled ? 1 : 0;
  const num = (v: unknown) => { const n = typeof v === "number" ? v : String(v ?? "").trim() ? Number(v) : NaN; if (!Number.isFinite(n)) throw new HsError("Giá trị không hợp lệ: " + String(v)); return n; };
  if ("every_h" in b) c.every_h = Math.max(0.1, num(b.every_h));
  if ("keep" in b) c.keep = Math.max(1, Math.trunc(num(b.keep)));
  if ("formats" in b) c.formats = ["ahs", ...(Array.isArray(b.formats) ? b.formats : []).filter((f) => f === "xlsx")];
  await setSetting("backup", j(c));
  return c;
}

/* ───────── dump / restore .ahs.gz ───────── */
/** jsonb → chữ đúng như Postgres in ra (bản Python đọc jsonb dạng chuỗi): ", " và ": " giữa các phần tử */
const pgJson = (v: unknown): string => Array.isArray(v) ? "[" + v.map(pgJson).join(", ") + "]"
  : v && typeof v === "object" ? "{" + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ": " + pgJson(x)).join(", ") + "}" : JSON.stringify(v ?? null);
async function dumpFull(): Promise<Buffer> {
  const lines: string[] = [JSON.stringify({ ahs: "backup", v: 4, ts: now(), tables: TABLES })];
  const cnt: Record<string, number> = {};
  const lu = await hasLogUser();
  for (const t of TABLES) {
    const cols = t === "logs" && !lu ? COLS.logs.filter((c) => !c.startsWith("user_")) : COLS[t];   // DB của bản Python chưa có cột user_*
    lines.push(JSON.stringify({ t, cols }));
    let n = 0;
    if (IDTAB.has(t)) {
      let last = -1;
      for (;;) {
        const rows = await run<Record<string, unknown>[]>(sb().from(T[t]).select(cols.join(",")).gt("id", last).order("id").limit(1000));                 // max_rows của PostgREST
        if (!rows.length) break;
        for (const r of rows) lines.push(JSON.stringify(cols.map((c) => (c === "data" && r[c] && typeof r[c] === "object" ? pgJson(r[c]) : r[c] ?? null))));
        n += rows.length; last = Number(rows[rows.length - 1].id);
      }
    } else {
      const all = await pages<Record<string, unknown>>((a, b) => cols.reduce((q, c) => q.order(c), sb().from(T[t]).select(cols.join(","))).range(a, b));
      for (const r of all) { lines.push(JSON.stringify(cols.map((c) => r[c] ?? null))); n++; }
    }
    cnt[t] = n;
  }
  lines.push(JSON.stringify({ end: cnt }));
  return gzipSync(Buffer.from(lines.join("\n") + "\n", "utf8"), { level: 5 });
}

function readFull(raw: Buffer) {
  let text: string;
  try { text = gunzipSync(raw).toString("utf8"); } catch { throw new HsError("Không phải file sao lưu AccountsHS"); }
  const out: Record<string, { cols: string[]; rows: unknown[][] }> = {};
  let cur: { cols: string[]; rows: unknown[][] } | null = null, end: Record<string, number> | null = null, head: Record<string, unknown> | null = null;
  const ls = text.split("\n");
  for (let i = 0; i < ls.length; i++) {
    const ln = ls[i]; if (!ln.trim()) continue;
    let o; try { o = JSON.parse(ln); } catch { if (!head) throw new HsError("Không phải file sao lưu AccountsHS"); throw new HsError("File sao lưu bị thiếu/hỏng (không đủ dữ liệu)"); }
    if (!head) { if (!o || typeof o !== "object" || o.ahs !== "backup") throw new HsError("Không phải file sao lưu AccountsHS"); head = o; }
    else if (o && typeof o === "object" && !Array.isArray(o) && "t" in o) cur = out[o.t] = { cols: o.cols, rows: [] };
    else if (o && typeof o === "object" && !Array.isArray(o) && "end" in o) end = o.end;
    else cur?.rows.push(o);
  }
  if (!end || Object.entries(end).some(([t, n]) => (out[t]?.rows.length ?? 0) !== n)) throw new HsError("File sao lưu bị thiếu/hỏng (không đủ dữ liệu)");
  return { head, data: out };
}

const INTC = new Set(["id", "tab_id", "dept_id", "owner_id", "status_id", "device_id", "parent_id", "link_tab", "src", "dst", "field_id", "acc_id", "pos", "lazy", "tint", "n", "m"]);
/** _clean_val của ahs_pg.py: số nguyên / số thực / chuỗi (bỏ \x00 — Postgres không nhận); accounts.data phải là object JSON. */
const num = (v: unknown) => { if (typeof v === "number") return v; const s = String(v).trim(); const n = s ? Number(s) : NaN; return Number.isFinite(n) ? n : null; };
function cleanVal(col: string, v: unknown, t: string): unknown {
  if (v === null || v === undefined) return null;
  if (INTC.has(col)) { const n = num(v); return n === null ? null : Math.trunc(n); }
  if (col === "created" || col === "updated" || col === "ts") return num(v);
  if (col === "data" && t === "accounts") {
    let d = v;
    if (typeof v === "string") { try { d = JSON.parse(v.replace(/\\u0000/g, "") || "{}"); } catch { return {}; } }
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  }
  if (col === "user_id") return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.includes("\0") ? s.replaceAll("\0", "") : s;
}

type Rows = Partial<Record<(typeof TABLES)[number], Record<string, unknown>[]>>;
/** xoá sạch 13 bảng rồi nạp lại. Qua REST không có giao dịch như COPY của bản Python → hỏng giữa chừng thì nạp lại bản đang có (`before`). */
async function reload(rows: Rows, before: Rows | null): Promise<Record<string, number>> {
  const cnt: Record<string, number> = {};
  await run(sb().rpc("ahs_restore_begin"));
  if (rows.logs && !(await hasLogUser())) rows = { ...rows, logs: rows.logs.map(({ user_id: _u, user_name: _n, ...r }) => r) };
  try {
    for (const t of TABLES) { const rs = rows[t]; if (!rs) continue; for (const ch of chunks(rs, 1000)) await run(sb().from(T[t]).insert(ch)); cnt[t] = rs.length; }
  } catch (e) {
    if (before) { await run(sb().rpc("ahs_restore_end")).catch(() => undefined); await reload(before, null).catch((e2) => console.error("[accountshs] rollback", e2)); }
    throw e;
  } finally {
    await run(sb().rpc("ahs_restore_end")).catch(() => undefined);
  }
  return cnt;
}
function fullRows(data: ReturnType<typeof readFull>["data"]): Rows {
  const out: Rows = {};
  for (const t of TABLES) {
    const d = data[t]; if (!d) continue;
    const cols = d.cols.filter((c) => COLS[t].includes(c));
    const ix = cols.map((c) => d.cols.indexOf(c));
    out[t] = d.rows.map((r) => Object.fromEntries(cols.map((c, k) => [c, cleanVal(c, r[ix[k]], t)])));
  }
  return out;
}
export async function restoreFull(raw: Buffer): Promise<Record<string, number>> {
  const rows = fullRows(readFull(raw).data);                              // đọc + kiểm tra hết trước khi xoá gì
  const before = fullRows(readFull(await dumpFull()).data);
  return reload(rows, before);
}

/* ───────── xlsx: port đúng write_xlsx / xlsx_all của v7.py (tự dựng zip, không qua thư viện bảng tính) ───────── */
const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] !== "#") return ENT[e.toLowerCase()] ?? m;
  const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
});
/** ghi chú dạng HTML (Quill) → chữ thường (_note_txt) */
const noteTxt = (v: string | null) => {
  v = v || "";
  if (!/^\s*<(p|h[1-6]|ol|ul|div|blockquote|pre)[\s>]/i.test(v)) return v;
  v = v.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|h[1-6]|div|blockquote|pre)>/gi, "\n");
  return unescape(v.replace(/<[^>]+>/g, "")).replaceAll(" ", " ").trim();
};
/** time.strftime theo giờ VN (máy chạy bản Python đặt giờ VN); None → 0 như bản gốc */
const fmtTs = (ts: number | null, sec = false) => {
  const d = new Date((Number(ts) || 0) * 1000 + 7 * 3600_000).toISOString();
  return d.slice(0, 10) + " " + d.slice(11, sec ? 19 : 16);
};
/** str() / repr() của Python cho giá trị JSON (danh sách, dict in kiểu Python) */
const pyNum = (v: number) => (Number.isFinite(v) ? String(v) : Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf");
const pyQuote = (s: string) => {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  return q + s.replace(/[\\\n\r\t\x00-\x1f\x7f]/g, (c) => ({ "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t" })[c] ?? "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0")).replaceAll(q, "\\" + q) + q;
};
const pyRepr = (v: unknown): string => typeof v === "string" ? pyQuote(v) : Array.isArray(v) ? "[" + v.map(pyRepr).join(", ") + "]"
  : v && typeof v === "object" ? "{" + Object.entries(v).map(([k, x]) => pyQuote(k) + ": " + pyRepr(x)).join(", ") + "}" : pyStr(v);
const pyStr = (v: unknown): string => typeof v === "string" ? v : typeof v === "boolean" ? (v ? "True" : "False") : typeof v === "number" ? pyNum(v) : v === null || v === undefined ? "None" : pyRepr(v);
export type Sheets = Record<string, unknown[][]>;

/** Toàn bộ dữ liệu → các sheet (1 tab = 1 sheet + Thiết bị + Nhật ký) — xlsx_all() của v7.py. */
export async function xlsxAll(): Promise<Sheets> {
  const [tabs, fields, sts, own, dep, dev, accs, links, logs] = await Promise.all([
    run<{ id: Id; name: string }[]>(sb().from(T.tabs).select("id,name").order("pos").order("id")),
    pages<Field>((a, b) => sb().from(T.fields).select("*").order("pos").order("id").range(a, b)),
    pages<{ id: Id; label: string }>((a, b) => sb().from(T.statuses).select("id,label").order("id").range(a, b)),
    pages<{ id: Id; name: string }>((a, b) => sb().from(T.owners).select("id,name").order("id").range(a, b)),
    run<{ id: Id; name: string }[]>(sb().from(T.depts).select("id,name")),
    pages<{ id: Id; name: string; serial: string; kind: string; dept_id: Id | null; owner_id: Id | null; caps: string }>((a, b) => sb().from(T.devices).select("*").order("id").range(a, b)),
    loadAccounts([], null),
    pages<{ src: Id; dst: Id; field_id: Id }>((a, b) => sb().from(T.links).select("src,dst,field_id").order("id").range(a, b)),
    pages<{ ts: number; act: string; n: number; detail: string }>((a, b) => sb().from(T.logs).select("ts,act,n,detail").order("id", { ascending: false }).range(a, b), 5000),
  ]);
  accs.sort((a, b) => a.id - b.id);
  const fs = new Map<Id, Field[]>(); for (const f of fields) (fs.get(f.tab_id) ?? fs.set(f.tab_id, []).get(f.tab_id)!).push(f);
  const name = (xs: { id: Id; name?: string; label?: string }[]) => new Map(xs.map((x) => [x.id, x.name ?? x.label ?? ""]));
  const S = name(sts), O = name(own), D = name(dep), V = name(dev);
  const byId = new Map(accs.map((a) => [a.id, a]));
  const lab = new Map(accs.map((a) => { const f = fs.get(a.tab_id); return [a.id, f?.length ? pyStr(a.data[String(f[0].id)] ?? "") : ""]; }));
  const lk = new Map<string, string[]>(), lkIds = new Map<string, Id[]>();
  for (const l of links) { const k = `${l.src}:${l.field_id}`; (lk.get(k) ?? lk.set(k, []).get(k)!).push(lab.get(l.dst) ?? ""); (lkIds.get(k) ?? lkIds.set(k, []).get(k)!).push(l.dst); }
  const cell = (a: Account, f: Field): unknown => {
    if (f.type === "link") return (lk.get(`${a.id}:${f.id}`) ?? []).join(",");
    if (f.type === "lookup") {
      let via = 0, take = 0; try { const o = JSON.parse(f.opts || "{}"); via = Math.trunc(+o.via || 0); take = Math.trunc(+o.take || 0); } catch { return ""; }
      if (!via || !take) return "";
      const dsts = lkIds.get(`${a.id}:${via}`) ?? []; const b = dsts.length ? byId.get(dsts[0]) : null;
      return b ? b.data[String(take)] ?? "" : "";
    }
    if (f.type === "file") { const v = a.data[String(f.id)]; return Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => pyStr(x.n ?? "")).join(", ") : ""; }
    return a.data[String(f.id)] ?? "";
  };
  const sheets: Sheets = {};
  for (const t of tabs) {
    const cols = fs.get(t.id) ?? [];
    const rows: unknown[][] = [["ID", "Trạng thái", "Owner", "Bộ phận", "Thiết bị", ...cols.map((f) => f.label), "Ghi chú", "Tạo", "Cập nhật"]];
    for (const a of accs) if (a.tab_id === t.id) rows.push([a.id, S.get(a.status_id!) ?? "", O.get(a.owner_id!) ?? "", D.get(a.dept_id) ?? "", V.get(a.device_id!) ?? "", ...cols.map((f) => cell(a, f)), noteTxt(a.note), fmtTs(a.created), fmtTs(a.updated)]);
    sheets[t.name] = rows;
  }
  sheets["Thiết bị"] = [["ID", "Tên", "Serial", "Loại", "Bộ phận", "Owner", "Giới hạn"], ...dev.map((d) => [d.id, d.name, d.serial, d.kind, D.get(d.dept_id!) ?? "", O.get(d.owner_id!) ?? "", d.caps])];
  sheets["Nhật ký"] = [["Thời gian", "Hành động", "SL", "Chi tiết"], ...logs.map((r) => [fmtTs(r.ts, true), r.act, r.n, r.detail])];
  return sheets;
}

const BAD = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
const xe = (v: unknown) => pyStr(v ?? "").replace(BAD, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colName = (n: number) => { let s = ""; n += 1; while (n) { const r = (n - 1) % 26; n = Math.floor((n - 1) / 26); s = String.fromCharCode(65 + r) + s; } return s; };
/** '%.1f' của Python: số đúng nửa (19.25) làm tròn về chẵn, toFixed thì làm tròn lên */
const f1 = (x: number) => { const q = x * 4; if (Number.isInteger(q) && q % 2 !== 0) { const fl = Math.floor(x * 10); return ((fl % 2 === 0 ? fl : fl + 1) / 10).toFixed(1); } return x.toFixed(1); };
const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SM = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";

/** sheets = {tên: [[ô,…],…]}. Số ghi dạng số; header=true → hàng đầu in đậm + nền + đóng băng (write_xlsx của v7.py). */
export async function writeXlsx(sheets: Sheets, header = false): Promise<Buffer> {
  const names: string[] = [], used = new Set<string>();
  for (const nm of Object.keys(sheets)) {
    const base = [...String(nm).replace(/[[\]:*?/\\]/g, "_")].slice(0, 31).join("") || "Sheet";
    let k = base, c = 1; while (used.has(k.toLowerCase())) { c++; k = [...base].slice(0, 28).join("") + "_" + c; }
    used.add(k.toLowerCase()); names.push(k);
  }
  const n = names.length, zip = new JSZip(), idx = names.map((_, i) => i + 1);
  const z = { file: (p: string, d: string) => zip.file(p, d, { createFolders: false }) };       // không thêm mục thư mục (giống zipfile của Python)
  z.file("[Content_Types].xml", X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + idx.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  z.file("_rels/.rels", X + `<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${RT}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.file("xl/workbook.xml", X + `<workbook xmlns="${SM}" xmlns:r="${RT}"><sheets>` + names.map((nm, i) => `<sheet name="${xe(nm).replace(/"/g, "&quot;")}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + "</sheets></workbook>");
  z.file("xl/_rels/workbook.xml.rels", X + `<Relationships xmlns="${PR}">` + idx.map((i) => `<Relationship Id="rId${i}" Type="${RT}/worksheet" Target="worksheets/sheet${i}.xml"/>`).join("")
    + `<Relationship Id="rId${n + 1}" Type="${RT}/styles" Target="styles.xml"/></Relationships>`);
  z.file("xl/styles.xml", X + `<styleSheet xmlns="${SM}">`
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF3FC"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  Object.values(sheets).forEach((rows0, i) => {
    const rows = Array.isArray(rows0) ? rows0 : [];
    const wd = new Map<number, number>();
    for (const row of rows.slice(0, 300)) (row ?? []).forEach((v, ci) => { if (v === null || v === undefined || v === "") return; wd.set(ci, Math.max(wd.get(ci) ?? 0, Math.min(60, [...pyStr(v).split("\n")[0]].length))); });
    const out = [X + `<worksheet xmlns="${SM}">`];
    if (header && rows.length) out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
    if (wd.size) out.push("<cols>" + [...wd].sort((a, b) => a[0] - b[0]).map(([c, w]) => `<col min="${c + 1}" max="${c + 1}" width="${f1(Math.max(8, w * 1.15 + 2))}" customWidth="1"/>`).join("") + "</cols>");
    out.push("<sheetData>");
    rows.forEach((row, ri) => {
      out.push(`<row r="${ri + 1}">`);
      const st = header && ri === 0 ? ' s="1"' : "";
      (row ?? []).forEach((v, ci) => {
        if (v === null || v === undefined || v === "") return;
        const ref = colName(ci) + (ri + 1);
        out.push(typeof v === "number" && Number.isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`);
      });
      out.push("</row>");
    });
    out.push("</sheetData></worksheet>");
    z.file(`xl/worksheets/sheet${i + 1}.xml`, out.join(""));
  });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/* ───────── danh sách / tạo / xoá / đổi tên / khôi phục ───────── */
const bext = (name: string): BackupFile["ext"] | "" => { const n = name.toLowerCase(); return n.endsWith(BK_EXT) ? "ahs" : n.endsWith(".xlsx") ? "xlsx" : n.endsWith(".json") ? "json" : ""; };
const base = (name: unknown) => String(name ?? "").split(/[\\/]/).pop()!;
/** re.sub(r'[^\w.\- ]', '_') — \w của Python là Unicode nên "Bản tốt" giữ nguyên dấu */
const safeName = (name: unknown) => base(name).replace(/[^\p{L}\p{M}\p{N}_.\- ]/gu, "_");
/** Khoá Storage chỉ nhận ASCII: ký tự khác đổi thành "(hex)" (tên sau safeName không bao giờ có ngoặc) */
const key = (name: string) => name.replace(/[^\w.\- ]/gu, (c) => `(${c.codePointAt(0)!.toString(16)})`);
const unkey = (k: string) => k.replace(/\(([0-9a-f]{1,6})\)/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));

async function rawList(search = "") {
  const { data, error } = await storage().list(DIR, { limit: 1000, search: key(search), sortBy: { column: "name", order: "desc" } });
  if (error) { if (/not found|bucket/i.test(error.message)) return []; throw new HsError(error.message, 500); }
  return (data ?? []).filter((f) => f.name && f.id);
}
/** bk_path(): tên file (basename) phải có trong thư mục sao lưu */
async function bkName(name: unknown): Promise<string> {
  const n = base(name);
  if (!n || !(await rawList(n)).some((f) => f.name === key(n))) throw new HsError("Không tìm thấy file backup");
  return n;
}
export async function listBackups(): Promise<BackupFile[]> {
  return (await rawList()).filter((f) => bext(f.name)).map((f) => {
    const k = f.name.split("_")[0];
    return { name: unkey(f.name), size: Number((f.metadata as { size?: number } | null)?.size ?? 0), mtime: f.updated_at ? Date.parse(f.updated_at) / 1000 : 0,
      kind: (["auto", "manual", "safe", "import"].includes(k) ? k : "other") as BackupFile["kind"], ext: bext(f.name) as BackupFile["ext"] };
  }).sort((a, b) => b.mtime - a.mtime);
}
export async function backupsInfo(): Promise<BackupsInfo> {
  const [cfg, files, last, size] = await Promise.all([cfgGet(), listBackups(), getSetting("last_backup", "0"), dbSize()]);
  return { cfg, dir: `${BUCKET}/${DIR}`, last: parseFloat(last) || 0, files, db_size: size };
}
async function put(name: string, body: Buffer, contentType: string) {
  const { error } = await storage().upload(`${DIR}/${key(name)}`, body, { contentType, upsert: true });
  if (error) throw new HsError("Không ghi được bản sao lưu vào Storage: " + error.message, 500);
}
async function prune(kind: string, keep: number) {
  const g = new Map<string, string[]>();
  for (const f of await rawList()) if (f.name.startsWith(kind + "_")) { const b = f.name.split(".")[0]; (g.get(b) ?? g.set(b, []).get(b)!).push(f.name); }
  const bases = [...g.keys()].sort();
  const drop = bases.length > keep ? bases.slice(0, bases.length - keep) : [];
  const names = drop.flatMap((b) => g.get(b)!.map((n) => `${DIR}/${n}`));
  if (names.length) await storage().remove(names);
}
/** dấu vân tay nội dung (rẻ) — db_fp(): giống bản trước → không tạo bản trùng. */
async function dbFp(): Promise<string> {
  const c = async (t: keyof typeof T) => (await sb().from(T[t]).select("id", { count: "exact", head: true })).count ?? 0;
  const mx = async (t: keyof typeof T, col: string) => (await run<Record<string, number> | null>(sb().from(T[t]).select(col).not(col, "is", null).order(col, { ascending: false }).limit(1).maybeSingle()))?.[col] ?? 0;
  const own = await pages<{ name: string | null }>((a, b) => sb().from(T.owners).select("name").order("id").range(a, b));
  return [await c("accounts"), await mx("accounts", "updated"), await c("links"), await mx("tomb", "ts"), await c("fields"), await c("statuses"),
    own.length + own.reduce((s, o) => s + [...(o.name ?? "")].length, 0)].join("|");
}
const lastFp: Record<string, string> = {};
let lastSafe = 0;
/** Python chạy mọi việc sao lưu dưới LOCK → ở đây xếp hàng trong tiến trình */
let queue: Promise<unknown> = Promise.resolve();
const locked = <R>(fn: () => Promise<R>): Promise<R> => { const p = queue.then(fn, fn); queue = p.catch(() => undefined); return p; };

export const doBackup = (kind: "manual" | "auto" | "safe" = "manual") => locked(() => backupNow(kind));
async function backupNow(kind: "manual" | "auto" | "safe"): Promise<string[]> {
  const c = await cfgGet(), fp = await dbFp();
  if ((kind === "safe" || kind === "auto") && lastFp[kind] === fp) { if (kind === "auto") await setSetting("last_backup", now()); return []; }
  if (kind === "safe" && ((await sb().from(T.accounts).select("id", { count: "exact", head: true })).count ?? 0) > 200000) return [];
  lastFp[kind] = fp;
  const b = `${kind}_${stamp()}`;
  await put(b + BK_EXT, await dumpFull(), "application/gzip");
  const out = [b + BK_EXT];
  if (kind !== "safe" && c.formats.includes("xlsx")) { await put(b + ".xlsx", await writeXlsx(await xlsxAll()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); out.push(b + ".xlsx"); }
  if (kind !== "safe") await setSetting("last_backup", now());
  await prune("auto", Math.trunc(c.keep));
  await prune("safe", 5);
  return out;
}
/** bản an toàn trước thao tác lớn: tối đa 1 bản / 10 phút; force (khôi phục, sửa lỗi DB) luôn chụp. */
export async function snapshot(force = false) {
  if (!force && Date.now() - lastSafe < 600_000) return;
  lastSafe = Date.now();
  await doBackup("safe");
}
/** Sao lưu tự động (bk_loop): gọi từ internal/tick (worker) và sau mỗi thao tác ghi; đến hạn thì sao lưu + ghi nhật ký backup_auto. */
let autoBusy = false;
export async function autoBackupIfDue(): Promise<string[]> {
  if (autoBusy) return [];
  autoBusy = true;
  try {
    const c = await cfgGet();
    if (!c.enabled || now() - (parseFloat(await getSetting("last_backup", "0")) || 0) < c.every_h * 3600) return [];
    const out = await doBackup("auto");
    await log("backup_auto", 1, "");
    return out;
  } finally { autoBusy = false; }
}

export async function backupFile(name: string): Promise<{ name: string; body: Buffer }> {
  const n = base(name);
  const { data, error } = n ? await storage().download(`${DIR}/${key(n)}`) : { data: null, error: null };
  if (error || !data) throw new HsError("Không tìm thấy file backup");
  return { name: n, body: Buffer.from(await data.arrayBuffer()) };
}
export async function backupDelete(b: Record<string, unknown>) {
  const n = base(b.name);
  const { data, error } = n ? await storage().remove([`${DIR}/${key(n)}`]) : { data: [], error: null };
  if (error) throw new HsError(error.message, 500);
  if (!data?.length) throw new HsError("Không tìm thấy file backup");
  return { ok: 1 };
}
export async function backupRename(b: Record<string, unknown>) {
  const n = await bkName(b.name);
  let nw = safeName(b.new).trim();
  const dot = n.lastIndexOf("."), ext = bext(n) === "ahs" ? BK_EXT : dot > 0 && /[^.]/.test(n.slice(0, dot)) ? n.slice(dot) : "";
  if (!nw) throw new HsError("Tên trống");
  if (!nw.toLowerCase().endsWith(ext.toLowerCase())) nw += ext;
  if (nw !== n) {
    if ((await rawList(nw)).some((f) => f.name === key(nw))) throw new HsError("Tên đã tồn tại");
    const { error } = await storage().move(`${DIR}/${key(n)}`, `${DIR}/${key(nw)}`); if (error) throw new HsError(error.message, 500);
  }
  return { name: nw };
}
export function backupRestore(b: Record<string, unknown>) {
  return locked(async () => {
    const { name, body } = await backupFile(await bkName(b.name));
    const ext = bext(name);
    const c = await cfgGet(), aiCfg = await getSetting("ai_cfg", "");
    lastSafe = Date.now();
    await backupNow("safe");                                              // snapshot(True) — đang giữ khoá nên gọi thẳng
    if (ext === "ahs") await restoreFull(body);
    else if (ext === "json") await loadJson(JSON.parse(body.toString("utf8").replace(/^﻿/, "")));
    else throw new HsError("Chỉ khôi phục từ bản sao lưu .ahs.gz (hoặc .json cũ)");
    await maintain();                                                     // migrate()
    await setSetting("backup", j(c));
    if (aiCfg) await setSetting("ai_cfg", aiCfg);
    return { ok: 1 };
  });
}
/** bản .json cũ (v3): chỉ 8 bảng JT — các bảng khác giữ nguyên như load_json() của v7.py. */
const JT = ["depts", "owners", "tabs", "fields", "statuses", "accounts", "links", "devices"] as const;
async function loadJson(o: Record<string, unknown>) {
  if (!o || typeof o !== "object" || Array.isArray(o) || !("accounts" in o) || !("tabs" in o)) throw new HsError("JSON không hợp lệ");
  const rows: Rows = {};
  for (const t of JT) rows[t] = ((Array.isArray(o[t]) ? o[t] : []) as Record<string, unknown>[]).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => COLS[t].includes(k)).map(([k, v]) => [k, cleanVal(k, v, t)])));
  const keep = fullRows(readFull(await dumpFull()).data);
  for (const t of TABLES) if (!(JT as readonly string[]).includes(t)) rows[t] = keep[t] ?? [];
  await reload(rows, keep);
}
export async function backupUpload(name: string, raw: Buffer) {
  const n = safeName(name), ext = bext(n);
  if (ext === "ahs") {
    let head: unknown = null;
    try { head = JSON.parse(gunzipSync(raw).subarray(0, 1 << 16).toString("utf8").split("\n", 1)[0]); } catch { head = null; }
    if (!head || typeof head !== "object" || (head as { ahs?: unknown }).ahs !== "backup") throw new HsError("Không phải file sao lưu AccountsHS");
  } else if (ext === "json") {
    const o = JSON.parse(raw.toString("utf8").replace(/^﻿/, ""));
    if (!o || typeof o !== "object" || Array.isArray(o) || !("accounts" in o)) throw new HsError("JSON không hợp lệ");
  } else throw new HsError("Chỉ nhận file sao lưu .ahs.gz / .json");
  const fn = `import_${stamp()}_${n}`;
  await put(fn, raw, ext === "ahs" ? "application/gzip" : "application/json");
  return { name: fn };
}
/** export_all?fmt=json — dump_json(): 8 bảng (v3), accounts.data là chuỗi JSON như bản Python. */
export async function dumpJson() {
  const out: Record<string, unknown> = { v: 3, ts: now() };
  for (const t of JT) {
    const rows = await pages<Record<string, unknown>>((a, b) => sb().from(T[t]).select("*").order("id").range(a, b));
    out[t] = t === "accounts" ? rows.map((r) => ({ ...r, data: typeof r.data === "string" ? r.data : pgJson(r.data ?? {}) })) : rows;
  }
  return out;
}
