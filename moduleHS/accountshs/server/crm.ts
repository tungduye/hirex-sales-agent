import "server-only";

import { HsError, T, getJsonSetting, now, orMissing, run, sb } from "./db";
import { queuedNote } from "./checker";
import type { Id } from "../types";

/* CRM (crm/) — kéo dữ liệu từ hệ thống chat-stats về rồi chuẩn hóa vào các tab (Facebook / Email / SĐT / Zalo…).
   Việc lấy dữ liệu (HTTP có token) + bóc tách nhật ký + nạp vào DB rất nặng và dùng SQL kiểu SQLite của crm.py,
   nên chạy ở worker Python (worker/crm.py + crm_parse.py) qua ahs_jobs (kind 'crm'); Next chỉ giữ cấu hình + trạng thái.
   API giữ đúng crm.py: GET /state · POST /cfg · /sync · /fetch · /reset. */

// địa chỉ chat-stats: cấu hình trong CRM › Cài đặt (ahs_settings "crm.cfg") hoặc biến môi trường HS_CRM_URL — không ghi cứng trong code.
const DEFAULT_URL = process.env.HS_CRM_URL?.trim() ?? "";
interface CrmCfg { url?: string; token?: string }

async function cfgGet(): Promise<CrmCfg> { const c = await getJsonSetting<CrmCfg>("crm.cfg", {}); if (!c.url) c.url = DEFAULT_URL; return c; }
async function cfgSave(c: CrmCfg) { await run(sb().from(T.settings).upsert({ k: "crm.cfg", v: JSON.stringify(c) }, { onConflict: "k" })); }

async function activeJob() {
  return orMissing(run<{ id: Id; status: string; progress: Record<string, unknown>; result: unknown } | null>(
    sb().from("ahs_jobs").select("id,status,progress,result").eq("kind", "crm").order("id", { ascending: false }).limit(1).maybeSingle()), () => null);
}
async function state() {
  const c = await cfgGet();
  const j = await activeJob();
  const p = (j?.progress || {}) as Record<string, unknown>;
  const running = Boolean(j && (j.status === "queued" || j.status === "running"));
  const note = j ? await queuedNote(j.status) : "";                                 // queued mà chưa có worker → báo rõ, giao diện không treo
  const job = { running, phase: String(p.phase || (note ? "Chờ worker" : running ? "Đang chạy" : "")), done: Number(p.done || 0), total: Number(p.total || 0), err: j?.status === "failed" ? String(p.err || "Lỗi") : String(p.err || note || "") };
  return { cfg: { url: c.url, has_token: Boolean((c.token || "").trim()) }, job, last: await getJsonSetting<unknown>("crm.last", null) };
}
async function enqueue(payload: Record<string, unknown>) {
  const j = await activeJob();
  if (j && (j.status === "queued" || j.status === "running")) throw new HsError("Đang đồng bộ");
  await run(sb().from("ahs_jobs").insert({ kind: "crm", payload, status: "queued", progress: { phase: "Chờ worker…", done: 0, total: 0 }, created: now(), by: "crm" }));
  return { ok: 1 };
}

export async function crmHandle(method: "GET" | "POST", path: string, _qs: URLSearchParams, raw: Buffer | null): Promise<[unknown, number?]> {
  try {
    if (method === "GET" && path === "state") return [await state()];
    const b = raw && raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
    if (path === "cfg") {
      const c = await cfgGet();
      if ("url" in b) c.url = String(b.url ?? "").trim() || DEFAULT_URL;
      if (b.token) c.token = String(b.token).trim().replace(/^Bearer\s+/i, "");
      await cfgSave(c);
      return [{ ok: 1 }];
    }
    if (path === "sync") {
      let rows = b.rows as unknown;
      if (rows && typeof rows === "object" && !Array.isArray(rows)) rows = (rows as { data?: unknown[] }).data ?? [];
      return [await enqueue({ force: Boolean(b.force), rows: rows ?? null })];
    }
    if (path === "fetch") return [await enqueue({ fetch_only: true })];
    if (path === "reset") { await run(sb().from(T.settings).upsert({ k: "crm.seen", v: "{}" }, { onConflict: "k" })); return [{ ok: 1 }]; }
    return [{ error: "not found" }, 404];
  } catch (e) { if (e instanceof HsError) return [{ error: e.message }, e.status]; return [{ error: e instanceof Error ? e.message : String(e) }, 500]; }
}
