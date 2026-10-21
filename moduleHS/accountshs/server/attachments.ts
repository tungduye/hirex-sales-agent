import "server-only";

import { createHash } from "node:crypto";
import JSZip from "jszip";
import { HsError, now, sb } from "./db";
import { BUCKET } from "./backup";
import { children, docxHtml, find, iter, parseXml, rels, text as xmlText, type El } from "./docx-html";
import type { Attachment } from "../types";

/* Đính kèm (trường kiểu "file"): trước đây là thư mục attachments/ trên máy (tên = băm nội dung + đuôi, trùng nội dung chỉ lưu 1 lần);
   giờ là Supabase Storage bucket hs-accountshs, thư mục att/. Giá trị trường vẫn là [{id, n, s, m, t}] nên dữ liệu cũ không đổi. */

const DIR = "att";
const ATT_MAX = 100 * 1024 * 1024;
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon", avif: "image/avif",
  pdf: "application/pdf", txt: "text/plain; charset=utf-8", log: "text/plain; charset=utf-8", csv: "text/plain; charset=utf-8", json: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12", doc: "application/msword", xls: "application/vnd.ms-excel",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", zip: "application/zip",
};
const TEXT = new Set(["txt", "log", "json", "md", "xml", "ini", "cfg", "conf", "yaml", "yml", "html", "htm", "js", "css", "py", "sql", "bat", "sh", "ps1", "env"]);
const storage = () => sb().storage.from(BUCKET);

/** _att_ext: đuôi theo os.path.splitext (bỏ dấu chấm đầu tên như ".env"), chữ thường, 1–8 ký tự [a-z0-9] */
export const attExt = (name: string) => {
  const b = String(name || "").split(/[\\/]/).pop()!, i = b.lastIndexOf(".");
  const e = i > 0 && /[^.]/.test(b.slice(0, i)) ? b.slice(i + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,8}$/.test(e) ? e : "";
};
export const attMime = (name: string) => MIME[attExt(name)] ?? "application/octet-stream";
const checkId = (fid: string) => { if (!/^[0-9a-f]{24}(\.[a-z0-9]{1,8})?$/.test(fid || "")) throw new HsError("Mã file không hợp lệ"); return fid; };

export async function attSave(name0: string, raw: Buffer): Promise<Attachment> {
  const name = String(name0 || "file").replace(/\\/g, "/").split("/").pop()!.trim().slice(0, 200) || "file";
  if (!raw.length) throw new HsError("File rỗng");
  if (raw.length > ATT_MAX) throw new HsError(`File quá lớn (tối đa ${ATT_MAX / 1048576} MB)`);
  const ext = attExt(name);
  const fid = createHash("sha256").update(raw).digest("hex").slice(0, 24) + (ext ? "." + ext : "");
  const { error } = await storage().upload(`${DIR}/${fid}`, raw, { contentType: attMime(name).split(";")[0], upsert: false });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new HsError("Không lưu được đính kèm: " + error.message, 500);
  return { id: fid, n: name, s: raw.length, m: attMime(name), t: now() };
}

export async function attRead(fid: string): Promise<Buffer> {
  const { data, error } = await storage().download(`${DIR}/${checkId(fid)}`);
  if (error || !data) throw new HsError("Không tìm thấy file đính kèm (có thể đã bị xóa khỏi Storage)");
  return Buffer.from(await data.arrayBuffer());
}

function attText(raw: Buffer, limit = 2 * 1024 * 1024): [string, boolean] {
  const cut = raw.length > limit; raw = raw.subarray(0, limit);
  if (raw[0] === 0xff && raw[1] === 0xfe) return [new TextDecoder("utf-16le").decode(raw.subarray(2)), cut];
  if (raw[0] === 0xfe && raw[1] === 0xff) return [new TextDecoder("utf-16be").decode(raw.subarray(2)), cut];
  try { return [new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(raw), cut]; }
  catch { return [/[\x81\x8a\x8d-\x90\x9a\x9d\x9e]/.test(raw.toString("latin1")) ? raw.toString("latin1") : new TextDecoder("windows-1258").decode(raw), cut]; }   // cp1258 thiếu các byte này → latin-1
}

export type Preview =
  | { kind: "docx"; html: string }
  | { kind: "xlsx"; sheets: Array<{ name: string; rows: string[][]; cols: number; cut: boolean }> }
  | { kind: "text"; text: string; cut: boolean }
  | { kind: "none" };

export async function attPreview(fid: string, name = ""): Promise<Preview> {
  const raw = await attRead(fid);
  const ext = attExt(name || fid) || attExt(fid);
  if (ext === "docx") return { kind: "docx", html: await docxHtml(raw) };
  if (ext === "xlsx" || ext === "xlsm") return { kind: "xlsx", sheets: await xlsxSheets(raw) };
  if (ext === "csv" || ext === "tsv") {
    const [t, cut] = attText(raw);
    const dl = ext === "tsv" ? "\t" : (t.slice(0, 2000).split(";").length > t.slice(0, 2000).split(",").length ? ";" : ",");
    const rows = parseCsv(t, dl).slice(0, 3000);
    return { kind: "xlsx", sheets: [{ name: (name || fid).split(/[\\/]/).pop()!, rows, cols: Math.max(0, ...rows.map((r) => r.length)), cut }] };
  }
  if (TEXT.has(ext) || (raw.length < 512 * 1024 && ext === "")) { const [text, cut] = attText(raw); return { kind: "text", text, cut }; }
  return { kind: "none" };
}



/* ───────── Excel → bảng chuỗi: port đúng xlsx_sheets() của v7.py (đọc thẳng XML; ô gộp không lặp giá trị, ngày → dd/mm/yyyy) ───────── */
const S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}";
const RL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}";
async function xml(z: JSZip, path: string): Promise<El | null> { const f = z.file(path); return f ? parseXml(await f.async("string")) : null; }
const colIdx = (ref: string) => { let n = 0; for (const ch of ref) { if (ch >= "A" && ch <= "Z") n = n * 26 + ch.charCodeAt(0) - 64; else break; } return Math.max(n - 1, 0); };
/** '%.10g' của Python */
function g10(x: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const [m, e] = x.toExponential(9).split("e"), ex = Number(e);
  if (ex < -4 || ex >= 10) return m.replace(/\.?0+$/, "") + "e" + (ex < 0 ? "-" : "+") + String(Math.abs(ex)).padStart(2, "0");
  return x.toFixed(9 - ex).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
const p2 = (n: number) => String(n).padStart(2, "0");

async function xlsxSheets(raw: Buffer, maxRows = 3000, maxCols = 80) {
  const z = await JSZip.loadAsync(raw);
  const ss: string[] = [];
  const sst = await xml(z, "xl/sharedStrings.xml");
  if (sst) for (const si of children(sst).filter((e) => e.tag === S + "si")) ss.push([...iter(si, S + "t")].map(xmlText).join(""));
  const dateXf = new Set<number>();                                       // style nào là ngày tháng
  const st = await xml(z, "xl/styles.xml");
  if (st) {
    const custom = new Map<number, string>();
    const nf = find(st, S + "numFmts");
    if (nf) for (const x of children(nf).filter((e) => e.tag === S + "numFmt")) custom.set(parseInt(x.attrs.numFmtId, 10), x.attrs.formatCode || "");
    const cx = find(st, S + "cellXfs");
    if (cx) children(cx).filter((e) => e.tag === S + "xf").forEach((xf, i) => {
      const fid = parseInt(xf.attrs.numFmtId || "0", 10) || 0;
      const code = (custom.get(fid) ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, "").toLowerCase();
      if ((fid >= 14 && fid <= 22) || (fid >= 45 && fid <= 47) || (code && /[dy]|h+:m/.test(code))) dateXf.add(i);
    });
  }
  const wb = await xml(z, "xl/workbook.xml");
  if (!wb) throw new HsError("Không đọc được file Excel");
  const rl = await rels(z, "xl/workbook.xml");
  const out: Array<{ name: string; rows: string[][]; cols: number; cut: boolean }> = [];
  for (const sh of iter(wb, S + "sheet")) {
    const p = rl[sh.attrs[RL + "id"] ?? ""];
    const root = p ? await xml(z, p) : null;
    const rows: string[][] = []; let cut = false, ncol = 0;
    if (root) for (const row of iter(root, S + "row")) {
      const r = (parseInt(row.attrs.r || "", 10) || rows.length + 1) - 1;
      if (r >= maxRows) { cut = true; break; }
      while (rows.length < r) rows.push([]);
      const cur: string[] = [];
      for (const c of children(row).filter((e) => e.tag === S + "c")) {
        const ci = c.attrs.r ? colIdx(c.attrs.r) : cur.length;
        if (ci >= maxCols) { cut = true; continue; }
        const t = c.attrs.t, v = find(c, S + "v"), vt = v ? xmlText(v) : null;
        let val = "";
        if (t === "s" && v) val = ss[parseInt(vt ?? "", 10)] ?? "";
        else if (t === "inlineStr") val = [...iter(c, S + "t")].map(xmlText).join("");
        else if (t === "b" && v) val = vt === "1" ? "TRUE" : "FALSE";
        else if (v && vt !== null) {
          val = vt;
          const num = vt.trim() ? Number(vt) : NaN;
          if ((t === undefined || t === "n") && !Number.isNaN(num)) {
            if (dateXf.has(parseInt(c.attrs.s || "0", 10) || 0) && num > 0 && num < 2958466) {
              const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Math.round(num * 86400e6) / 1000));
              const ds = `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
              val = Number.isInteger(num) ? ds : `${ds} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
            } else if (Number.isInteger(num) && Math.abs(num) < 1e15) val = String(Math.trunc(num) || 0);
            else val = g10(num);
          }
        }
        while (cur.length < ci) cur.push("");
        cur.push(val);
      }
      while (cur.length && cur[cur.length - 1] === "") cur.pop();
      ncol = Math.max(ncol, cur.length); rows.push(cur);
    }
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    out.push({ name: sh.attrs.name || "Sheet", rows, cols: ncol, cut });
  }
  return out;
}

/** csv.reader của Python (dialect excel, không strict): dòng trống → [], dấu " chỉ có nghĩa ở đầu ô. */
function parseCsv(t: string, dl: string): string[][] {
  const rows: string[][] = [];
  type St = "rec" | "fld" | "in" | "q" | "qq" | "crnl";
  let row: string[] = [], f = "", st = "rec" as St;
  const save = () => { row.push(f); f = ""; };
  const end = (c: string | null) => { save(); st = c === null ? "rec" : "crnl"; };
  const step = (c: string | null): void => {                              // c = null: hết dòng
    const nl = c === "\n" || c === "\r";
    if (st === "rec") { if (c === null) return; if (nl) { st = "crnl"; return; } st = "fld"; }
    switch (st) {
      case "fld": if (c === null || nl) end(c); else if (c === '"') st = "q"; else if (c === dl) save(); else { f += c; st = "in"; } return;
      case "in": if (c === null || nl) end(c); else if (c === dl) { save(); st = "fld"; } else f += c; return;
      case "q": if (c === null) return; if (c === '"') st = "qq"; else f += c; return;
      case "qq": if (c === '"') { f += c; st = "q"; } else if (c === dl) { save(); st = "fld"; } else if (c === null || nl) end(c); else { f += c; st = "in"; } return;
      case "crnl": if (c === null) st = "rec"; else if (!nl) { rows.push(row); row = []; st = "rec"; step(c); } return;   // \r lẻ: Python báo lỗi, ở đây coi như xuống dòng
    }
  };
  for (let i = 0; i < t.length;) {                                       // từng dòng như io.StringIO (tách ở \n)
    const k = t.indexOf("\n", i), ln = t.slice(i, k < 0 ? t.length : k + 1); i += ln.length;
    for (const c of ln) step(c);
    step(null);
    if (st === "rec") { rows.push(row); row = []; }
  }
  if (st === "q") { save(); rows.push(row); }                              // hết file giữa ô có ngoặc kép
  return rows;
}
