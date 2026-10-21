import "server-only";

import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { HsError, now, sb } from "./db";
import { BUCKET } from "./backup";
import { docxHtml } from "./docx-html";
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

export const attExt = (name: string) => { const e = (String(name || "").match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? "").toLowerCase(); return /^[a-z0-9]{1,8}$/.test(e) ? e : ""; };
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
  if (raw[0] === 0xff && raw[1] === 0xfe) return [raw.subarray(2).toString("utf16le"), cut];
  if (raw[0] === 0xfe && raw[1] === 0xff) { const b = Buffer.from(raw.subarray(2)); b.swap16(); return [b.toString("utf16le"), cut]; }
  try { return [new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(raw), cut]; }
  catch { try { return [new TextDecoder("windows-1258").decode(raw), cut]; } catch { return [raw.toString("latin1"), cut]; } }
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
    return { kind: "xlsx", sheets: [{ name: (name || fid).split("/").pop()!, rows, cols: Math.max(0, ...rows.map((r) => r.length)), cut }] };
  }
  if (TEXT.has(ext) || (raw.length < 512 * 1024 && ext === "")) { const [text, cut] = attText(raw); return { kind: "text", text, cut }; }
  return { kind: "none" };
}


/** Excel → bảng chuỗi (ngày tháng về dd/mm/yyyy như bản Python), tối đa 3000 dòng × 80 cột / sheet. */
async function xlsxSheets(raw: Buffer, maxRows = 3000, maxCols = 80) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(raw as unknown as ArrayBuffer);
  const out: Array<{ name: string; rows: string[][]; cols: number; cut: boolean }> = [];
  const fmtDate = (d: Date) => { const p = (n: number) => String(n).padStart(2, "0"); const s = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; return d.getUTCHours() || d.getUTCMinutes() ? `${s} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : s; };
  const cellText = (v: ExcelJS.CellValue): string => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return fmtDate(v);
    if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : v.toPrecision(10).replace(/\.?0+$/, "");
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "object") {
      if ("richText" in v) return v.richText.map((x) => x.text).join("");
      if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
      if ("text" in v) return String(v.text);
      if ("error" in v) return String(v.error);
    }
    return String(v);
  };
  wb.eachSheet((ws) => {
    const rows: string[][] = []; let cut = false, ncol = 0;
    ws.eachRow((row, r) => {
      if (r > maxRows) { cut = true; return; }
      while (rows.length < r - 1) rows.push([]);
      const cur: string[] = [];
      row.eachCell({ includeEmpty: false }, (c, ci) => { if (ci > maxCols) { cut = true; return; } while (cur.length < ci - 1) cur.push(""); cur.push(cellText(c.value)); });
      while (cur.length && cur[cur.length - 1] === "") cur.pop();
      ncol = Math.max(ncol, cur.length); rows.push(cur);
    });
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    out.push({ name: ws.name || "Sheet", rows, cols: ncol, cut });
  });
  return out;
}

function parseCsv(t: string, dl: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === dl) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
