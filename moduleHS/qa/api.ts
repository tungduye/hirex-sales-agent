import "server-only";

// Một cửa cho /api/hs/qa?action=… (Tiện ích › Kiểm thử phần mềm), cần đăng nhập HireX.
// Mỗi lượt test = 1 thư mục runtime/hs-qa/runs/<id> + 1 tiến trình qa-worker.mjs chạy riêng (Playwright + OpenAI).
// Web chỉ đọc / ghi file trong thư mục đó (state.json, frame.jpg, cmd.jsonl…) nên bản thật (3000) và bản xem trước (3005) dùng chung được.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { qaDocx, type QaReport } from "./report";

const DATA = path.resolve(process.env.HS_QA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "runtime", "hs-qa"));
const RUNS = path.join(DATA, "runs"), AUTH = path.join(DATA, "auth");
const WORKER = path.join(/*turbopackIgnore: true*/ process.cwd(), "moduleHS", "qa", "qa-worker.mjs");
const MAX_LIVE = 3, KEEP = 60;
const ID = /^[a-z0-9]{8,40}$/;
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: { "Cache-Control": "no-store" } });
type Run = { id: string; url: string; goal: string; images: string[]; by: string; by_name: string; created: number; max_steps: number; use_auth: boolean; pid?: number };
type State = { status: string; step: number; title?: string; score?: number; verdict?: string; ended?: number; error?: string; [k: string]: unknown };
const rj = <T>(f: string, fb: T): T => { try { return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ f, "utf8")) as T; } catch { return fb; } };
const dir = (id: string) => { if (!ID.test(id)) throw Object.assign(new Error("bad_id"), { status: 400 }); return path.join(RUNS, id); };
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
const LIVE = new Set(["starting", "running", "waiting", "reporting"]);

/** Trạng thái lượt test; tiến trình đã chết mà trạng thái vẫn "đang chạy" → báo lỗi (máy chủ khởi động lại giữa chừng…). */
function state(id: string): State {
  const d = dir(id), s = rj<State>(path.join(d, "state.json"), { status: "starting", step: 0 }), run = rj<Run | null>(path.join(d, "run.json"), null);
  if (LIVE.has(s.status) && run && !alive(run.pid) && Date.now() - (run.created || 0) > 20000) { s.status = "error"; s.error = s.error || "Tiến trình kiểm thử đã dừng giữa chừng"; s.ended = s.ended || Date.now(); }
  return s;
}
function list() {
  fs.mkdirSync(RUNS, { recursive: true });
  const ids = fs.readdirSync(RUNS).filter((x) => ID.test(x)).sort().reverse();
  for (const old of ids.slice(KEEP)) fs.rmSync(path.join(RUNS, old), { recursive: true, force: true });
  return ids.slice(0, KEEP).map((id) => { const run = rj<Partial<Run>>(path.join(RUNS, id, "run.json"), {}), s = state(id); return { id, url: run.url, goal: (run.goal || "").slice(0, 160), by_name: run.by_name || "", created: run.created || 0, status: s.status, step: s.step, title: s.title || "", score: s.score ?? null, verdict: s.verdict || "", ended: s.ended || 0, error: s.error || "" }; });
}
function cmd(id: string, c: Record<string, unknown>) { fs.appendFileSync(path.join(dir(id), "cmd.jsonl"), JSON.stringify({ ...c, at: Date.now() }) + "\n"); }

async function start(req: Request, by: string, byName: string) {
  const fd = await req.formData(), s = (k: string) => String(fd.get(k) ?? "").trim();
  let url = s("url"); if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { return json({ ok: false, stage: "Link không hợp lệ" }, 400); }
  if (!process.env.OPENAI_API_KEY) return json({ ok: false, stage: "Máy chủ chưa cấu hình OpenAI" }, 501);
  if (list().filter((r) => LIVE.has(r.status)).length >= MAX_LIVE) return json({ ok: false, stage: `Đang chạy ${MAX_LIVE} lượt test, chờ một lượt xong` }, 429);
  const id = Date.now().toString(36) + crypto.randomBytes(4).toString("hex"), d = path.join(RUNS, id); fs.mkdirSync(d, { recursive: true });
  const images: string[] = [];
  for (const v of fd.getAll("img").slice(0, 6)) {
    if (typeof v === "string" || !v.size || v.size > 8 * 1048576 || !/^image\/(png|jpe?g|webp)$/.test(v.type)) continue;
    const n = `upl-${images.length + 1}.${v.type === "image/png" ? "png" : "jpg"}`; fs.writeFileSync(path.join(d, n), Buffer.from(await v.arrayBuffer())); images.push(n);
  }
  const run: Run = { id, url, goal: s("goal").slice(0, 4000), images, by, by_name: byName, created: Date.now(), max_steps: Math.min(80, Math.max(5, +s("max_steps") || 40)), use_auth: s("use_auth") !== "0" };
  fs.writeFileSync(path.join(d, "run.json"), JSON.stringify(run));
  const out = fs.openSync(path.join(d, "worker.log"), "a");
  const p = spawn(process.execPath, [WORKER, d], { cwd: process.cwd(), detached: true, windowsHide: true, stdio: ["ignore", out, out],
    env: { ...process.env, HS_QA_AUTH_DIR: AUTH, HS_QA_USER: s("user").slice(0, 200), HS_QA_PASS: s("pass").slice(0, 200) } });
  p.unref(); fs.closeSync(out);
  run.pid = p.pid; fs.writeFileSync(path.join(d, "run.json"), JSON.stringify(run));
  return json({ ok: true, id });
}

function file(id: string, name: string, type: string, dl = "") {
  if (!/^(frame\.jpg|step-\d{3}\.jpg|upl-\d\.(png|jpg))$/.test(name)) return json({ ok: false }, 400);
  const f = path.join(dir(id), name); if (!fs.existsSync(/*turbopackIgnore: true*/ f)) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(/*turbopackIgnore: true*/ f)), { headers: { "Content-Type": type, "Cache-Control": name === "frame.jpg" ? "no-store" : "private, max-age=86400", ...(dl && { "Content-Disposition": `attachment; filename="${dl}"` }) } });
}
const fmt = (ms: number) => { const d = new Date(ms + 7 * 3600e3), p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };

export async function handle(req: Request) {
  try {
    const account = await getAccountContext();
    if (!account?.workspaceId) return json({ ok: false, stage: "Chưa đăng nhập" }, 401);
    const q = new URL(req.url).searchParams, a = q.get("action") || "", id = q.get("id") || "";
    if (req.method === "GET") {
      if (a === "list") return json({ ok: true, runs: list() });
      if (a === "state") { const d = dir(id), run = rj<Partial<Run>>(path.join(d, "run.json"), {}); return json({ ok: true, run: { url: run.url, goal: run.goal, images: run.images || [], created: run.created, by_name: run.by_name }, state: state(id), report: rj(path.join(d, "report.json"), null) }); }
      if (a === "frame") return file(id, "frame.jpg", "image/jpeg");
      if (a === "img") { const n = q.get("n") || ""; return file(id, n, /png$/.test(n) ? "image/png" : "image/jpeg"); }
      if (a === "docx") {
        const d = dir(id), R = rj<QaReport | null>(path.join(d, "report.json"), null), run = rj<Partial<Run>>(path.join(d, "run.json"), {}), s = state(id); if (!R) return json({ ok: false }, 404);
        const secs = Math.round(((s.ended || Date.now()) - (run.created || Date.now())) / 1000);
        const b = qaDocx(R, { url: run.url || "", goal: run.goal || "", date: fmt(run.created || Date.now()), dur: `${Math.floor(secs / 60)} phút ${secs % 60} giây`, steps: s.step || 0 });
        return new Response(new Uint8Array(b), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="Bao-cao-kiem-thu-${id}.docx"`, "Cache-Control": "no-store" } });
      }
      return json({ ok: false }, 404);
    }
    const o = req.headers.get("origin"); if (o) { try { if (new URL(o).host !== (req.headers.get("x-forwarded-host") || req.headers.get("host"))) return json({ ok: false, stage: "csrf" }, 403); } catch { return json({ ok: false }, 403); } }
    if (a === "start") return await start(req, account.userId, account.fullName || account.email || "");
    if (a === "cmd") { const b = (await req.json().catch(() => ({}))) as Record<string, unknown>; const t = String(b.type || ""); if (!["continue", "answer", "say", "stop", "pause", "click", "type", "key", "scroll", "goto"].includes(t)) return json({ ok: false }, 400); cmd(id, b); return json({ ok: true }); }
    if (a === "delete") { const d = dir(id), run = rj<Run | null>(path.join(d, "run.json"), null); if (run && alive(run.pid)) { cmd(id, { type: "stop" }); try { process.kill(run.pid!); } catch { /* đã dừng */ } } fs.rmSync(d, { recursive: true, force: true }); return json({ ok: true }); }
    return json({ ok: false }, 404);
  } catch (e) {
    const x = e as { status?: number; message?: string };
    if (!x.status) console.error("[Kiểm thử]", e);
    return json({ ok: false, stage: x.message || "server" }, x.status || 500);
  }
}
