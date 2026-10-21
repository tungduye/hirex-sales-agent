import "server-only";

import { gunzipSync, gzipSync } from "node:zlib";
import ExcelJS from "exceljs";
import { HsError, T, chunks, getJsonSetting, getSetting, j, now, run, sb, setSetting } from "./db";
import { dbSize, ensureMaintained } from "./accounts-data";
import type { Account, BackupCfg, BackupFile, BackupsInfo, Device, Field, Id } from "../types";

/* Sao lưu: trước đây là thư mục backup/data_backup trên máy; giờ là Supabase Storage (bucket hs-accountshs, thư mục backup/).
   Định dạng .ahs.gz giữ nguyên (JSON từng dòng, gzip) → bản sao lưu cũ của bản Python khôi phục được ở đây và ngược lại. */

export const BUCKET = "hs-accountshs";
const DIR = "backup";
export const BK_EXT = ".ahs.gz";
const TABLES = ["depts", "owners", "tabs", "fields", "statuses", "devices", "accounts", "links", "settings", "logs", "tomb", "acc_hist", "cyv_checks"] as const;
const IDTAB = new Set(["depts", "owners", "tabs", "fields", "statuses", "devices", "accounts", "links", "logs", "acc_hist", "cyv_checks"]);
const COLS: Record<(typeof TABLES)[number], string[]> = {
  depts: ["id", "name", "color", "pos"], owners: ["id", "dept_id", "parent_id", "name", "color", "pos"], tabs: ["id", "name", "icon", "color", "pos", "grp", "lazy", "tint"],
  fields: ["id", "tab_id", "label", "type", "opts", "link_tab", "pos"], statuses: ["id", "tab_id", "label", "color", "pos"],
  devices: ["id", "dept_id", "owner_id", "name", "kind", "serial", "caps", "note", "pos", "created"],
  accounts: ["id", "tab_id", "dept_id", "owner_id", "status_id", "note", "data", "created", "updated", "device_id"],
  links: ["id", "src", "dst", "field_id"], settings: ["k", "v"], logs: ["id", "ts", "act", "n", "detail"], tomb: ["id", "ts", "tab_id", "dept_id", "owner_id"],
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
  if ("every_h" in b) c.every_h = Math.max(0.1, Number(b.every_h) || 24);
  if ("keep" in b) c.keep = Math.max(1, Math.trunc(Number(b.keep) || 1));
  if ("formats" in b) c.formats = ["ahs", ...((b.formats as string[]) ?? []).filter((f) => f === "xlsx")];
  await setSetting("backup", j(c));
  return c;
}

/* ───────── dump / restore .ahs.gz ───────── */
async function dumpFull(): Promise<Buffer> {
  const lines: string[] = [JSON.stringify({ ahs: "backup", v: 4, ts: now(), tables: TABLES })];
  const cnt: Record<string, number> = {};
  for (const t of TABLES) {
    const cols = COLS[t];
    lines.push(JSON.stringify({ t, cols }));
    let n = 0;
    if (IDTAB.has(t)) {
      let last = -1;
      for (;;) {
        const rows = await run<Record<string, unknown>[]>(sb().from(T[t]).select(cols.join(",")).gt("id", last).order("id").limit(20000));
        if (!rows.length) break;
        for (const r of rows) lines.push(JSON.stringify(cols.map((c) => (c === "data" && r[c] && typeof r[c] === "object" ? JSON.stringify(r[c]) : r[c] ?? null))));
        n += rows.length; last = Number(rows[rows.length - 1].id);
      }
    } else {
      for (const r of await run<Record<string, unknown>[]>(sb().from(T[t]).select(cols.join(",")))) { lines.push(JSON.stringify(cols.map((c) => r[c] ?? null))); n++; }
    }
    cnt[t] = n;
  }
  lines.push(JSON.stringify({ end: cnt }));
  return gzipSync(Buffer.from(lines.join("\n") + "\n", "utf8"), { level: 5 });
}

function readFull(raw: Buffer) {
  const text = gunzipSync(raw).toString("utf8");
  const out: Record<string, { cols: string[]; rows: unknown[][] }> = {};
  let cur: { cols: string[]; rows: unknown[][] } | null = null, end: Record<string, number> | null = null, head: Record<string, unknown> | null = null;
  const ls = text.split("\n");
  for (let i = 0; i < ls.length; i++) {
    const ln = ls[i]; if (!ln.trim()) continue;
    const o = JSON.parse(ln);
    if (!head) { if (!o || typeof o !== "object" || o.ahs !== "backup") throw new HsError("Không phải file sao lưu AccountsHS"); head = o; }
    else if (o && typeof o === "object" && !Array.isArray(o) && "t" in o) cur = out[o.t] = { cols: o.cols, rows: [] };
    else if (o && typeof o === "object" && !Array.isArray(o) && "end" in o) end = o.end;
    else cur?.rows.push(o);
  }
  if (!end || Object.entries(end).some(([t, n]) => (out[t]?.rows.length ?? 0) !== n)) throw new HsError("File sao lưu bị thiếu/hỏng (không đủ dữ liệu)");
  return { head, data: out };
}

const INTC = new Set(["id", "tab_id", "dept_id", "owner_id", "status_id", "device_id", "parent_id", "link_tab", "src", "dst", "field_id", "acc_id", "pos", "lazy", "tint", "n", "m"]);
function cleanVal(col: string, v: unknown, t: string): unknown {
  if (v === null || v === undefined) return null;
  if (INTC.has(col)) { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; }
  if (col === "data" && t === "accounts") { if (typeof v === "string") { try { return JSON.parse(v || "{}"); } catch { return {}; } } return v; }
  if (col === "created" || col === "updated" || col === "ts") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return typeof v === "object" ? JSON.stringify(v) : v;
}

export async function restoreFull(raw: Buffer): Promise<Record<string, number>> {
  const { data } = readFull(raw);                                         // đọc + kiểm tra hết trước khi xoá gì
  await run(sb().rpc("ahs_restore_begin"));
  const cnt: Record<string, number> = {};
  try {
    for (const t of TABLES) {
      const d = data[t]; if (!d) continue;
      const cols = d.cols.filter((c) => COLS[t].includes(c));
      const ix = cols.map((c) => d.cols.indexOf(c));
      const rows = d.rows.map((r) => Object.fromEntries(cols.map((c, k) => [c, cleanVal(c, r[ix[k]], t)])));
      for (const ch of chunks(rows, 2000)) await run(sb().from(T[t]).insert(ch));
      cnt[t] = rows.length;
    }
  } finally {
    await run(sb().rpc("ahs_restore_end"));
  }
  return cnt;
}

/* ───────── xlsx (exceljs thay write_xlsx tự dựng) ───────── */
const noteTxt = (v: string | null) => {
  v = v || "";
  if (!/^\s*<(p|h[1-6]|ol|ul|div|blockquote|pre)[\s>]/i.test(v)) return v;
  return v.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|h[1-6]|div|blockquote|pre)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/ /g, " ").trim();
};
const fmtTs = (ts: number | null, sec = false) => {
  if (!ts) return "";
  const d = new Date(ts * 1000 + 7 * 3600_000).toISOString();
  return d.slice(0, 10) + " " + d.slice(11, sec ? 19 : 16);
};
export type Sheets = Record<string, unknown[][]>;

/** Toàn bộ dữ liệu → các sheet (1 tab = 1 sheet + Thiết bị + Nhật ký) — xlsx_all() của v7.py. */
export async function xlsxAll(): Promise<Sheets> {
  const [tabs, fields, sts, own, dep, dev, accs, links, logs] = await Promise.all([
    run<{ id: Id; name: string }[]>(sb().from(T.tabs).select("id,name").order("pos").order("id")),
    run<Field[]>(sb().from(T.fields).select("*").order("pos").order("id")),
    run<{ id: Id; label: string }[]>(sb().from(T.statuses).select("id,label")),
    run<{ id: Id; name: string }[]>(sb().from(T.owners).select("id,name")),
    run<{ id: Id; name: string }[]>(sb().from(T.depts).select("id,name")),
    run<Device[]>(sb().from(T.devices).select("*")),
    run<Account[]>(sb().from(T.accounts).select("*").order("id")),
    run<{ src: Id; dst: Id; field_id: Id }[]>(sb().from(T.links).select("src,dst,field_id")),
    run<{ ts: number; act: string; n: number; detail: string }[]>(sb().from(T.logs).select("ts,act,n,detail").order("id", { ascending: false }).limit(5000)),
  ]);
  const fs = new Map<Id, Field[]>(); for (const f of fields) (fs.get(f.tab_id) ?? fs.set(f.tab_id, []).get(f.tab_id)!).push(f);
  const name = (xs: { id: Id; name?: string; label?: string }[]) => new Map(xs.map((x) => [x.id, x.name ?? x.label ?? ""]));
  const S = name(sts), O = name(own), D = name(dep), V = name(dev);
  const byId = new Map(accs.map((a) => [a.id, a]));
  const lab = new Map(accs.map((a) => { const f = fs.get(a.tab_id); return [a.id, f?.length ? String(a.data[String(f[0].id)] ?? "") : ""]; }));
  const lk = new Map<string, string[]>(), lkIds = new Map<string, Id[]>();
  for (const l of links) { const k = `${l.src}:${l.field_id}`; (lk.get(k) ?? lk.set(k, []).get(k)!).push(lab.get(l.dst) ?? ""); (lkIds.get(k) ?? lkIds.set(k, []).get(k)!).push(l.dst); }
  const cell = (a: Account, f: Field): unknown => {
    if (f.type === "link") return (lk.get(`${a.id}:${f.id}`) ?? []).join(",");
    if (f.type === "lookup") {
      let via = 0, take = 0; try { const o = JSON.parse(f.opts || "{}"); via = +o.via || 0; take = +o.take || 0; } catch { return ""; }
      if (!via || !take) return "";
      const dsts = lkIds.get(`${a.id}:${via}`) ?? []; const b = dsts.length ? byId.get(dsts[0]) : null;
      return b ? b.data[String(take)] ?? "" : "";
    }
    if (f.type === "file") { const v = a.data[String(f.id)]; return Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? x.n : "")).join(", ") : ""; }
    return a.data[String(f.id)] ?? "";
  };
  const sheets: Sheets = {};
  for (const t of tabs) {
    const cols = fs.get(t.id) ?? [];
    const rows: unknown[][] = [["ID", "Trạng thái", "Owner", "Bộ phận", "Thiết bị", ...cols.map((f) => f.label), "Ghi chú", "Tạo", "Cập nhật"]];
    for (const a of accs) if (a.tab_id === t.id) rows.push([a.id, S.get(a.status_id!) ?? "", O.get(a.owner_id!) ?? "", D.get(a.dept_id) ?? "", V.get(a.device_id!) ?? "", ...cols.map((f) => cell(a, f)), noteTxt(a.note), fmtTs(a.created), fmtTs(a.updated)]);
    sheets[t.name] = rows;
  }
  sheets["Thiết bị"] = [["ID", "Tên", "Serial", "Loại", "Bộ phận", "Owner", "Giới hạn"], ...dev.map((d) => [d.id, d.name, d.serial, d.kind, D.get(d.dept_id!) ?? "", O.get(d.owner_id!) ?? "", typeof d.caps === "string" ? d.caps : JSON.stringify(d.caps)])];
  sheets["Nhật ký"] = [["Thời gian", "Hành động", "SL", "Chi tiết"], ...logs.map((r) => [fmtTs(r.ts, true), r.act, r.n, r.detail])];
  return sheets;
}

/** sheets = {tên: [[ô,…],…]} → xlsx. header=true: hàng đầu in đậm + đóng băng (write_xlsx của v7.py). */
export async function writeXlsx(sheets: Sheets, header = false): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  for (const [nm, rows0] of Object.entries(sheets)) {
    const base = String(nm).replace(/[[\]:*?/\\]/g, "_").slice(0, 31) || "Sheet";
    let k = base, c = 1; while (used.has(k.toLowerCase())) { c++; k = base.slice(0, 28) + "_" + c; }
    used.add(k.toLowerCase());
    const ws = wb.addWorksheet(k, header && rows0?.length ? { views: [{ state: "frozen", ySplit: 1 }] } : undefined);
    const rows = rows0 ?? [];
    const wd = new Map<number, number>();
    for (const row of rows.slice(0, 300)) row.forEach((v, ci) => { if (v === null || v === undefined || v === "") return; wd.set(ci, Math.max(wd.get(ci) ?? 0, Math.min(60, String(v).split("\n")[0].length))); });
    for (const [ci, w] of wd) ws.getColumn(ci + 1).width = Math.max(8, w * 1.15 + 2);
    for (const row of rows) ws.addRow(row.map((v) => (v === null || v === undefined ? null : typeof v === "number" && Number.isFinite(v) ? v : String(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""))));
    if (header && rows.length) { const r = ws.getRow(1); r.font = { bold: true }; r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF3FC" } }; }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ───────── danh sách / tạo / xoá / đổi tên / khôi phục ───────── */
const bext = (name: string): BackupFile["ext"] | "" => { const n = name.toLowerCase(); return n.endsWith(BK_EXT) ? "ahs" : n.endsWith(".xlsx") ? "xlsx" : n.endsWith(".json") ? "json" : ""; };
const safeName = (name: string) => String(name).split(/[\\/]/).pop()!.replace(/[^\w.\- ]/g, "_").trim();

export async function listBackups(): Promise<BackupFile[]> {
  const { data, error } = await storage().list(DIR, { limit: 1000, sortBy: { column: "name", order: "desc" } });
  if (error) { if (/not found|bucket/i.test(error.message)) return []; throw new HsError(error.message, 500); }
  return (data ?? []).filter((f) => f.name && bext(f.name)).map((f) => {
    const k = f.name.split("_")[0];
    return { name: f.name, size: Number((f.metadata as { size?: number } | null)?.size ?? 0), mtime: f.updated_at ? Date.parse(f.updated_at) / 1000 : 0,
      kind: (["auto", "manual", "safe", "import"].includes(k) ? k : "other") as BackupFile["kind"], ext: bext(f.name) as BackupFile["ext"] };
  }).sort((a, b) => b.mtime - a.mtime);
}
export async function backupsInfo(): Promise<BackupsInfo> {
  const [cfg, files, last, size] = await Promise.all([cfgGet(), listBackups(), getSetting("last_backup", "0"), dbSize()]);
  return { cfg, dir: `${BUCKET}/${DIR}`, last: parseFloat(last) || 0, files, db_size: size };
}
async function put(name: string, body: Buffer, contentType: string) {
  const { error } = await storage().upload(`${DIR}/${name}`, body, { contentType, upsert: true });
  if (error) throw new HsError("Không ghi được bản sao lưu vào Storage: " + error.message, 500);
}
async function prune(kind: string, keep: number) {
  const g = new Map<string, string[]>();
  for (const f of await listBackups()) if (f.name.startsWith(kind + "_")) { const b = f.name.split(".")[0]; (g.get(b) ?? g.set(b, []).get(b)!).push(f.name); }
  const bases = [...g.keys()].sort();
  const drop = bases.length > keep ? bases.slice(0, bases.length - keep) : [];
  const names = drop.flatMap((b) => g.get(b)!.map((n) => `${DIR}/${n}`));
  if (names.length) await storage().remove(names);
}
/** dấu vân tay nội dung (rẻ): giống bản trước → không tạo bản trùng. */
async function dbFp(): Promise<string> {
  const c = async (t: keyof typeof T) => (await sb().from(T[t]).select("id", { count: "exact", head: true })).count ?? 0;
  const mx = async (t: keyof typeof T, col: string) => (await run<Record<string, number> | null>(sb().from(T[t]).select(col).order(col, { ascending: false }).limit(1).maybeSingle()))?.[col] ?? 0;
  return [await c("accounts"), await mx("accounts", "updated"), await c("links"), await mx("tomb", "ts"), await c("fields"), await c("statuses"), await c("owners")].join("|");
}
const lastFp: Record<string, string> = {};
let lastSafe = 0;

export async function doBackup(kind: "manual" | "auto" | "safe" = "manual"): Promise<string[]> {
  const c = await cfgGet(), fp = await dbFp();
  if ((kind === "safe" || kind === "auto") && lastFp[kind] === fp) { if (kind === "auto") await setSetting("last_backup", now()); return []; }
  if (kind === "safe" && ((await sb().from(T.accounts).select("id", { count: "exact", head: true })).count ?? 0) > 200000) return [];
  lastFp[kind] = fp;
  const base = `${kind}_${stamp()}`;
  await put(base + BK_EXT, await dumpFull(), "application/gzip");
  const out = [base + BK_EXT];
  if (kind !== "safe" && c.formats.includes("xlsx")) { await put(base + ".xlsx", await writeXlsx(await xlsxAll()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); out.push(base + ".xlsx"); }
  if (kind !== "safe") await setSetting("last_backup", now());
  await prune("auto", c.keep);
  await prune("safe", 5);
  return out;
}
/** bản an toàn trước thao tác lớn: tối đa 1 bản / 10 phút; force luôn chụp. */
export async function snapshot(force = false) {
  if (!force && Date.now() - lastSafe < 600_000) return;
  lastSafe = Date.now();
  await doBackup("safe");
}
/** Sao lưu tự động (bk_loop): gọi từ /api/internal (Windows Task Scheduler) hoặc sau một thao tác ghi. */
export async function autoBackupIfDue(): Promise<string[]> {
  const c = await cfgGet();
  if (c.enabled && now() - (parseFloat(await getSetting("last_backup", "0")) || 0) >= c.every_h * 3600) return doBackup("auto");
  return [];
}

export async function backupFile(name: string): Promise<{ name: string; body: Buffer }> {
  const n = safeName(name); if (!n || !bext(n)) throw new HsError("Không tìm thấy file backup");
  const { data, error } = await storage().download(`${DIR}/${n}`);
  if (error || !data) throw new HsError("Không tìm thấy file backup");
  return { name: n, body: Buffer.from(await data.arrayBuffer()) };
}
export async function backupDelete(b: Record<string, unknown>) {
  const n = safeName(String(b.name ?? "")); if (!n) throw new HsError("Không tìm thấy file backup");
  const { error } = await storage().remove([`${DIR}/${n}`]); if (error) throw new HsError(error.message, 500);
  return { ok: 1 };
}
export async function backupRename(b: Record<string, unknown>) {
  const n = safeName(String(b.name ?? "")), ext = bext(n) === "ahs" ? BK_EXT : "." + n.split(".").pop();
  let nw = safeName(String(b.new ?? "")); if (!nw) throw new HsError("Tên trống");
  if (!nw.toLowerCase().endsWith(ext.toLowerCase())) nw += ext;
  if (nw !== n) {
    if ((await listBackups()).some((f) => f.name === nw)) throw new HsError("Tên đã tồn tại");
    const { error } = await storage().move(`${DIR}/${n}`, `${DIR}/${nw}`); if (error) throw new HsError(error.message, 500);
  }
  return { name: nw };
}
export async function backupRestore(b: Record<string, unknown>) {
  const { name, body } = await backupFile(String(b.name ?? ""));
  const ext = bext(name);
  const c = await cfgGet(), aiCfg = await getSetting("ai_cfg", "");
  await snapshot(true);
  if (ext === "ahs") await restoreFull(body);
  else if (ext === "json") await loadJson(JSON.parse(body.toString("utf8").replace(/^﻿/, "")));
  else throw new HsError("Chỉ khôi phục từ bản sao lưu .ahs.gz (hoặc .json cũ)");
  await ensureMaintained();
  await setSetting("backup", j(c));
  if (aiCfg) await setSetting("ai_cfg", aiCfg);
  return { ok: 1 };
}
/** bản .json cũ (v3): chỉ 8 bảng JT. */
async function loadJson(o: Record<string, unknown[]>) {
  if (!o || typeof o !== "object" || !("accounts" in o) || !("tabs" in o)) throw new HsError("JSON không hợp lệ");
  const JT = ["depts", "owners", "tabs", "fields", "statuses", "accounts", "links", "devices"] as const;
  await run(sb().rpc("ahs_restore_begin"));
  try {
    for (const t of JT) {
      const rows = ((o[t] ?? []) as Record<string, unknown>[]).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => COLS[t].includes(k)).map(([k, v]) => [k, cleanVal(k, v, t)])));
      for (const ch of chunks(rows, 2000)) await run(sb().from(T[t]).insert(ch));
    }
  } finally { await run(sb().rpc("ahs_restore_end")); }
}
export async function backupUpload(name: string, raw: Buffer) {
  const n = safeName(name), ext = bext(n);
  if (ext === "ahs") { readFull(raw); }
  else if (ext === "json") { const o = JSON.parse(raw.toString("utf8").replace(/^﻿/, "")); if (!o || typeof o !== "object" || !("accounts" in o)) throw new HsError("JSON không hợp lệ"); }
  else throw new HsError("Chỉ nhận file sao lưu .ahs.gz / .json");
  const fn = `import_${stamp()}_${n}`;
  await put(fn, raw, ext === "ahs" ? "application/gzip" : "application/json");
  return { name: fn };
}
/** export_all: json = dump 8 bảng (v3) · xlsx = toàn bộ. */
export async function dumpJson() {
  const JT = ["depts", "owners", "tabs", "fields", "statuses", "accounts", "links", "devices"] as const;
  const out: Record<string, unknown> = { v: 3, ts: now() };
  for (const t of JT) out[t] = await run(sb().from(T[t]).select("*").order("id"));
  return out;
}
