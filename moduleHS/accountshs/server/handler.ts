import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { HsError, bumpVer, log, requireHs, type Level } from "./db";
import * as D from "./accounts-data";
import * as R from "./accounts-routes";
import * as B from "./backup";
import * as A from "./attachments";
import * as AI from "./owl";
import { checkerHandle } from "./checker";
import { owlAutoHandle } from "./owl-auto";
import { crmHandle } from "./crm";
import { themeCss, themePreview, themesList } from "./themes";
import { eventsResponse } from "./feed";
import { cyvTick } from "./checker";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Giao diện gốc của v7.py (ui/index.html, ui/owl.html — dựng bằng ui/build_ui.py), bản chạy thật nạp 1 lần rồi giữ trong bộ nhớ; bản xem trước đọc lại mỗi lần. */
const UI = new Map<string, Promise<string>>();
const ETAG = new Map<string, string>();
const etagOf = (s: string) => { let t = ETAG.get(s); if (!t) { if (ETAG.size > 4) ETAG.clear(); t = `"${createHash("sha1").update(s).digest("base64url").slice(0, 20)}"`; ETAG.set(s, t); } return t; };
const uiPage = (f: string) => { if (process.env.NODE_ENV !== "production") UI.delete(f); if (!UI.has(f)) UI.set(f, readFile(path.join(process.cwd(), "moduleHS", "accountshs", "ui", f), "utf8").catch((e) => { UI.delete(f); throw e; })); return UI.get(f)!; };

/* Một cửa cho mọi /api/hs/accountshs/<name> — giữ đúng tên đường dẫn + hình dạng JSON của v7.py (do_GET / do_POST / ROUTES):
   giao diện là trang gốc của v7 (GET ui), chỉ đổi tiền tố URL /api/ → /api/hs/accountshs/. Quyền: GET = view · ghi = edit · cài đặt/sao lưu/khôi phục/Cú vọ = manage. */

type Body = Record<string, unknown>;
type Fn = (b: Body) => Promise<unknown>;

const ROUTES: Record<string, [Level, Fn]> = {
  ov_trend: ["view", (b) => D.ovTrend(Number(b.since))],
  ov_lazy: ["view", (b) => D.ovLazy((Array.isArray(b.tabs) ? b.tabs : []).map(Number).filter((x) => Number.isInteger(x) && x > 0), Number(b.since) || 0, Number(b.until) || 0)],
  account: ["edit", R.saveAccount], status_set: ["edit", R.statusSet], owner_set: ["edit", R.ownerSet], mass_set: ["edit", R.massSet],
  delete_accounts: ["edit", R.deleteAccounts], quick: ["edit", R.quick], bulk: ["edit", R.bulk2], bulk_check: ["edit", (b) => R.bulk2({ ...b, dry: true })],
  delete: ["manage", R.del], reorder: ["manage", R.reorder],
  dept: ["manage", (b) => R.upsert("dept", b)], owner: ["manage", (b) => R.upsert("owner", b)], tab: ["manage", (b) => R.upsert("tab", b)],
  field: ["manage", (b) => R.upsert("field", b)], status: ["manage", (b) => R.upsert("status", b)],
  device: ["edit", (b) => R.upsert("device", b)], device_set: ["edit", R.deviceSet], rows_set: ["edit", R.rowsSet], device_bulk: ["edit", R.deviceBulk],
  backup_now: ["manage", async () => ({ names: await B.doBackup("manual") })], backup_delete: ["manage", B.backupDelete], backup_rename: ["manage", B.backupRename],
  log_clear: ["manage", R.logClear], hist_cfg: ["manage", R.histCfg], grp_icon: ["manage", R.grpIcon], tab_keys: ["manage", R.tabKeys],
  backup_restore: ["manage", B.backupRestore], backup_cfg: ["manage", B.cfgSet], repair: ["manage", R.repair],
  ...AI.routes,
};
const NO_LOG = new Set(["reorder", "bulk_check", "ov_trend", "ov_lazy", ...AI.noLog]);
const READ_ONLY = new Set(["bulk_check", "ov_trend", "ov_lazy", "ai_chat", "ai_rows", "ai_models", "ai_test", "ai_backup", "ai_feedback", "ai_drop", "ai_cfg_set", "ai_learn", "ai_logic_import"]);

/** Giờ Việt Nam dạng %Y%m%d_%H%M%S (tên file tải về như Python). */
const stamp = () => new Date(Date.now() + 7 * 3600_000).toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const file = (body: Buffer | string, type: string, name?: string, dl = true) =>
  new NextResponse(body as BodyInit, { headers: { "Content-Type": type, "Cache-Control": "no-store", ...(name ? { "Content-Disposition": `${dl ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}` } : {}) } });
const fail = (e: unknown) => {
  const err = e instanceof HsError ? e : new HsError(e instanceof Error ? e.message : String(e), 500);
  if (err.status >= 500) console.error("[accountshs]", e);
  return json({ error: err.message }, err.status);
};

export async function handleGet(name: string, qs: URLSearchParams, req?: Request): Promise<Response> {
  try {
    const q = (k: string, d = "") => qs.get(k) ?? d;
    if (name.startsWith("cyv/")) { await requireHs("view"); return json(...(await checkerHandle("GET", name.slice(4), qs, null))); }
    if (name.startsWith("owl/")) { await requireHs("view"); return json(...(await owlAutoHandle("GET", name.slice(4), qs, null))); }
    if (name.startsWith("crm/")) { await requireHs("view"); return json(...(await crmHandle("GET", name.slice(4), qs, null))); }
    if (name === "ui" || name === "owl-page") {
      // trang ~850 KB: trình duyệt giữ bản đã tải, mỗi lần mở chỉ hỏi lại (ETag) → không đổi thì 304, khỏi tải lại
      await requireHs("view");
      const html = await uiPage(name === "ui" ? "index.html" : "owl.html"), tag = etagOf(html);
      const h = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-cache", ETag: tag };
      if (req?.headers.get("if-none-match") === tag) return new NextResponse(null, { status: 304, headers: h });
      return new NextResponse(html, { headers: h });
    }
    if (name === "crm-sdt") {   // trang đối soát 1 lần: tab SĐT = danh sách SĐT kéo từ CRM (ui/crm-sdt.html), chỉ Quản trị
      await requireHs("manage");
      return new NextResponse(await uiPage("crm-sdt.html"), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    if (name === "themes") { await requireHs("view"); return json({ themes: await themesList() }); }
    if (name.startsWith("theme-preview/")) { await requireHs("view"); const img = await themePreview(name.slice(14).replace(/\.jpg$/, "")); return img ? new NextResponse(img as BodyInit, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=86400" } }) : json({ error: "not found" }, 404); }
    if (name.startsWith("theme/")) { await requireHs("view"); const c = await themeCss(name.slice(6).replace(/\.css$/, "")); return c === null ? json({ error: "not found" }, 404) : file(c, "text/css; charset=utf-8"); }
    await requireHs("view");
    await D.ensureMaintained().catch(() => undefined);
    switch (name) {
      case "meta": return json({ meta: await D.getMeta(), devices: await D.getDevices(), ts: 0 });
      case "data": return json(await D.getData(q("lz")));
      case "delta": return json(await D.getDelta(parseFloat(q("since", "0")) || 0, q("lz")));
      case "tab_chunk": return json(await D.tabChunk(Number(q("tab", "0")), Number(q("before", "0")), Number(q("n", "5000"))));
      case "tab_rows": return json(await D.getTabRows(Number(q("tab", "0")), q("skip")));
      case "ver": return json({ ver: await D.dataVersion() });
      case "events": return eventsResponse();
      case "backups": await requireHs("manage"); return json(await B.backupsInfo());
      case "logs": return json(await D.getLogs(q("q"), q("limit", "300")));
      case "hist": return json(await D.histGet(Number(q("id", "0")) || 0));
      case "hist_info": return json(await D.histInfo());
      case "hist_last": return json(await D.histLast(q("ids").split(",")));
      case "check": return json(await D.checkDb());
      case "backup_file": { await requireHs("manage"); const f = await B.backupFile(q("name")); return file(f.body, "application/octet-stream", f.name); }
      case "export_all": {
        const st = stamp();
        if (q("fmt", "xlsx") === "json") return file(JSON.stringify(await B.dumpJson()), "application/json", `accountshs_${st}.json`);
        return file(await B.writeXlsx(await B.xlsxAll(), true), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `accountshs_${st}.xlsx`);
      }
      case "att": { const id = q("id"); const nm = (q("n") || id).split(/[\\/]/).pop()!; return file(await A.attRead(id), A.attMime(nm), nm, Boolean(q("dl"))); }
      case "att_preview": return json(await A.attPreview(q("id"), q("n")));
    }
    if (name in AI.gets) return json(await AI.gets[name](qs));
    return json({ error: "not found" }, 404);
  } catch (e) { return fail(e); }
}

/** Việc định kỳ (thay bk_loop / _sched của v7.py): worker gọi POST /api/hs/accountshs/internal/tick 5 phút/lần,
 *  Authorization: Bearer AUTOMATION_CRON_SECRET → dọn lịch sử, sao lưu tự động khi đến hạn, Vọng gác định kỳ. */
async function internalTick(req: Request): Promise<Response> {
  const expected = process.env.AUTOMATION_CRON_SECRET?.trim(), supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
  const a = Buffer.from(supplied), b = Buffer.from(expected ?? "");
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) return json({ error: "Unauthorized" }, 401);
  await D.maintain();
  const backups = await B.autoBackupIfDue();
  const checks = await cyvTick();
  return json({ ok: true, backups, checks });
}

export async function handlePost(name: string, qs: URLSearchParams, req: Request): Promise<Response> {
  try {
    if (name === "internal/tick") return await internalTick(req);
    if (name.startsWith("cyv/")) { await requireHs("edit"); const r = await checkerHandle("POST", name.slice(4), qs, Buffer.from(await req.arrayBuffer())); await bumpVer(); return json(...r); }
    if (name === "owl/export") {
      // owl.py write_xlsx(headers, rows, sheet): 1 sheet, dòng 1 là tiêu đề
      await requireHs("view");
      const b = ((await req.json().catch(() => ({}))) ?? {}) as Body;
      const sheet = String(b.sheet || "Owl").slice(0, 31) || "Owl", rows = [(b.headers as unknown[]) ?? [], ...((b.rows as unknown[][]) ?? [])];
      return file(await B.writeXlsx({ [sheet]: rows }, true), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `owl_${stamp()}.xlsx`);
    }
    if (name.startsWith("owl/")) { await requireHs("edit"); const r = await owlAutoHandle("POST", name.slice(4), qs, Buffer.from(await req.arrayBuffer())); await bumpVer(); return json(...r); }
    if (name.startsWith("crm/")) { await requireHs("edit"); const r = await crmHandle("POST", name.slice(4), qs, Buffer.from(await req.arrayBuffer())); await bumpVer(); return json(...r); }
    if (name === "att_upload") { await requireHs("edit"); return json(await A.attSave(qs.get("name") ?? "file", Buffer.from(await req.arrayBuffer()))); }
    if (name === "backup_upload") {
      await requireHs("manage");
      const r = await B.backupUpload(qs.get("name") ?? "upload.ahs.gz", Buffer.from(await req.arrayBuffer()));
      await log("backup_upload", 1, r.name);
      return json(r);
    }
    const b = ((await req.json().catch(() => ({}))) ?? {}) as Body;
    if (name === "xlsx") {
      await requireHs("view");
      let sh = b.sheets as B.Sheets | undefined;
      if (!sh || typeof sh !== "object" || !Object.keys(sh).length) sh = { [String(b.name || "Sheet1")]: (b.rows as unknown[][]) ?? [] };
      return file(await B.writeXlsx(sh, Boolean(b.hdr)), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }
    const route = ROUTES[name];
    if (!route) return json({ error: "not found" }, 404);
    const [level, fn] = route;
    await requireHs(level);
    // thao tác hàng loạt rất lớn được trình duyệt chia lô (hx_batch = {i, of, n}): chụp bản an toàn ở lô đầu, ghi nhật ký 1 lần ở lô cuối (đủ số dòng)
    const hb = b.hx_batch && typeof b.hx_batch === "object" ? (b.hx_batch as { i: number; of: number; n: number }) : null;
    delete b.hx_batch;
    const detail = hb ? `${Number(hb.n) || 0} dòng` : await R.auditDetail(name, b);
    if ((!hb || Number(hb.i) === 0) && R.needsSnap(name, b)) await B.snapshot(!!hb);
    const r = (await fn(b)) as Record<string, unknown> | undefined;
    const act = name === "account" ? (b.id ? "account_edit" : "account_add") : name;
    const n = (x: unknown) => (Array.isArray(x) ? x.length : 0);
    const ln = n(b.ids) || n(b.items) || ((name === "bulk" || name === "device_bulk") && r ? Number(r.created ?? 0) + Number(r.updated ?? 0) : 1);
    if (!NO_LOG.has(name) && (!hb || Number(hb.i) === Number(hb.of) - 1)) await log(act, hb ? Number(hb.n) || ln : ln, detail);
    if (!READ_ONLY.has(name)) await bumpVer();   // Python tăng ahs_ver sau mỗi lần ghi (DB của bản Python không có trigger tăng)
    B.autoBackupIfDue().catch((e) => console.error("[accountshs] auto backup", e));
    return json(r ?? { ok: 1 });
  } catch (e) { return fail(e); }
}
