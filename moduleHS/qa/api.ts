import "server-only";

// Một cửa cho /api/hs/qa?action=… (Tiện ích › Kiểm thử phần mềm), cần đăng nhập HireX.
// Mỗi lượt test = 1 thư mục runtime/hs-qa/runs/<id> + 1 tiến trình qa-worker.mjs chạy riêng (Playwright + OpenAI).
// Web chỉ đọc / ghi file trong thư mục đó (state.json, frame.jpg, cmd.jsonl…) nên bản thật (3000) và bản xem trước (3005) dùng chung được.
// Hình trực tiếp: action=stream phát frame.jpg như video (multipart/x-mixed-replace) — thẻ <img> hiện liền mạch, không phải hỏi từng ảnh.
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
/** Key OpenAI của Kiểm thử: key riêng moduleHS (HS_OPENAI_API_KEY) để biết dự án nào tốn token; chưa đặt thì dùng key chung. */
const KEY = () => (process.env.HS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
const ID = /^[a-z0-9]{8,40}$/;
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: { "Cache-Control": "no-store" } });
type Run = { id: string; url: string; goal: string; images: string[]; by: string; by_name: string; created: number; max_steps: number; minutes?: number | "auto"; use_auth: boolean; pid?: number; name?: string };
type State = { status: string; step: number; title?: string; score?: number; verdict?: string; ended?: number; error?: string; [k: string]: unknown };
const rj = <T>(f: string, fb: T): T => { try { return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ f, "utf8")) as T; } catch { return fb; } };
const dir = (id: string) => { if (!ID.test(id)) throw Object.assign(new Error("bad_id"), { status: 400 }); return path.join(RUNS, id); };
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
const LIVE = new Set(["starting", "running", "waiting", "paused", "reporting", "idle"]);

/** Trạng thái lượt test; tiến trình đã chết mà trạng thái vẫn "đang chạy" → đang chờ (idle) thì coi như xong, còn lại báo lỗi. */
function state(id: string): State {
  const d = dir(id), s = rj<State>(path.join(d, "state.json"), { status: "starting", step: 0 }), run = rj<Run | null>(path.join(d, "run.json"), null);
  if (LIVE.has(s.status) && run && !alive(run.pid) && Date.now() - (run.created || 0) > 20000) {
    if (s.status === "idle") s.status = "done"; else { s.status = "error"; s.error = s.error || "Tiến trình kiểm thử đã dừng giữa chừng"; }
    s.ended = s.ended || Date.now(); s.phase = null;
  }
  return s;
}
function list() {
  fs.mkdirSync(RUNS, { recursive: true });
  sweep();
  const ids = fs.readdirSync(RUNS).filter((x) => ID.test(x)).sort().reverse();
  for (const old of ids.slice(KEEP)) fs.rmSync(path.join(RUNS, old), { recursive: true, force: true });
  return ids.slice(0, KEEP).map((id) => { const run = rj<Partial<Run>>(path.join(RUNS, id, "run.json"), {}), s = state(id); return { id, url: run.url, goal: (run.goal || "").slice(0, 160), by_name: run.by_name || "", created: run.created || 0, status: s.status, step: s.step, title: run.name || s.title || "", score: s.score ?? null, verdict: s.verdict || "", ended: s.ended || 0, error: s.error || "" }; });
}
function cmd(id: string, c: Record<string, unknown>) { fs.appendFileSync(path.join(dir(id), "cmd.jsonl"), JSON.stringify({ ...c, at: Date.now() }) + "\n"); }
const liveCount = () => list().filter((r) => LIVE.has(r.status) && r.status !== "idle").length;

/** Chạy tiến trình agent cho thư mục d (resume = mở lại lượt cũ, giữ nhật ký + trò chuyện). */
function spawnWorker(d: string, run: Run, resume: boolean, secret: { user?: string; pass?: string } = {}) {
  const out = fs.openSync(path.join(d, "worker.log"), "a");
  const p = spawn(process.execPath, [WORKER, d, ...(resume ? ["--resume"] : [])], { cwd: process.cwd(), detached: true, windowsHide: true, stdio: ["ignore", out, out],
    env: { ...process.env, OPENAI_API_KEY: KEY(), HS_QA_AUTH_DIR: AUTH, HS_QA_USER: secret.user || "", HS_QA_PASS: secret.pass || "" } });
  p.unref(); fs.closeSync(out);
  run.pid = p.pid; run.created = run.created || Date.now(); fs.writeFileSync(path.join(d, "run.json"), JSON.stringify(run));
}

async function start(req: Request, by: string, byName: string) {
  const fd = await req.formData(), s = (k: string) => String(fd.get(k) ?? "").trim();
  let url = s("url"); if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { return json({ ok: false, stage: "Link không hợp lệ" }, 400); }
  if (!KEY()) return json({ ok: false, stage: "Máy chủ chưa cấu hình OpenAI" }, 501);
  if (liveCount() >= MAX_LIVE) return json({ ok: false, stage: `Đang chạy ${MAX_LIVE} lượt test, chờ một lượt xong` }, 429);
  const id = Date.now().toString(36) + crypto.randomBytes(4).toString("hex"), d = path.join(RUNS, id); fs.mkdirSync(d, { recursive: true });
  const images: string[] = [];
  for (const v of fd.getAll("img").slice(0, 6)) {
    if (typeof v === "string" || !v.size || v.size > 8 * 1048576 || !/^image\/(png|jpe?g|webp)$/.test(v.type)) continue;
    const n = `upl-${images.length + 1}.${v.type === "image/png" ? "png" : "jpg"}`; fs.writeFileSync(path.join(d, n), Buffer.from(await v.arrayBuffer())); images.push(n);
  }
  const run: Run = { id, url, goal: s("goal").slice(0, 4000), images, by, by_name: byName, created: Date.now(), max_steps: Math.min(80, Math.max(5, +s("max_steps") || 40)), minutes: +s("minutes") ? Math.min(30, Math.max(2, +s("minutes"))) : "auto", use_auth: s("use_auth") !== "0" };
  fs.writeFileSync(path.join(d, "run.json"), JSON.stringify(run));
  spawnWorker(d, run, false, { user: s("user").slice(0, 200), pass: s("pass").slice(0, 200) });
  return json({ ok: true, id });
}

/** Nhắn agent: đang chạy → chuyển tin; trình duyệt đã đóng → mở lại lượt test (giữ nhật ký) và làm theo tin nhắn. */
function say(id: string, text: string, cid: string) {
  const d = dir(id), run = rj<Run | null>(path.join(d, "run.json"), null); if (!run) return json({ ok: false, stage: "Không thấy lượt test" }, 404);
  if (!text.trim()) return json({ ok: false }, 400);
  if (alive(run.pid)) { cmd(id, { type: "say", text: text.slice(0, 2000), cid }); return json({ ok: true }); }
  if (!KEY()) return json({ ok: false, stage: "Máy chủ chưa cấu hình OpenAI" }, 501);
  if (liveCount() >= MAX_LIVE) return json({ ok: false, stage: `Đang chạy ${MAX_LIVE} lượt test, chờ một lượt xong` }, 429);
  cmd(id, { type: "say", text: text.slice(0, 2000), cid });
  const s = rj<Record<string, unknown>>(path.join(d, "state.json"), {}); s.status = "starting"; s.phase = { k: "open", label: "Mở lại trình duyệt", at: Date.now() }; s.ended = 0;
  try { fs.writeFileSync(path.join(d, "state.json"), JSON.stringify(s)); } catch { /* worker sẽ ghi */ }
  run.created = Date.now();   // mốc "vừa chạy" để không bị coi là tiến trình chết trong 20 giây đầu
  spawnWorker(d, run, true);
  return json({ ok: true, resumed: true });
}

/** Hình trực tiếp dạng video MJPEG: mỗi khi frame.jpg đổi thì đẩy 1 ảnh; lượt test đã dừng thì gửi ảnh cuối rồi đóng. */
function stream(id: string, signal: AbortSignal) {
  const d = dir(id), fr = path.join(d, "frame.jpg"), B = "hsqaframe", enc = new TextEncoder();
  let last = "", tm: ReturnType<typeof setTimeout> | undefined, n = 0, checkAt = 0, ending = false, done = false;
  const end = Date.now() + 20 * 60e3;
  const body = new ReadableStream<Uint8Array>({
    start(ctl) {
      const close = () => { if (done) return; done = true; clearTimeout(tm); try { ctl.close(); } catch { /* đã đóng */ } };
      const tick = () => {
        if (done) return;
        if (signal.aborted || Date.now() > end) return close();
        try {
          const st = fs.statSync(/*turbopackIgnore: true*/ fr), k = `${st.mtimeMs}:${st.size}`;
          if (k !== last && st.size > 0) {
            const b = fs.readFileSync(/*turbopackIgnore: true*/ fr); last = k; n++;
            ctl.enqueue(enc.encode(`--${B}\r\nContent-Type: image/jpeg\r\nContent-Length: ${b.length}\r\n\r\n`)); ctl.enqueue(new Uint8Array(b)); ctl.enqueue(enc.encode("\r\n"));
          }
        } catch { /* chưa có hình / đang ghi */ }
        if (Date.now() > checkAt) { checkAt = Date.now() + 2000; if (!LIVE.has(state(id).status)) { if (ending && n) return close(); ending = true; } }
        tm = setTimeout(tick, 60);
      };
      signal.addEventListener("abort", close);
      tick();
    },
    cancel() { done = true; clearTimeout(tm); },
  });
  return new Response(body, { headers: { "Content-Type": `multipart/x-mixed-replace; boundary=${B}`, "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}

/** Xoá lượt test: dừng tiến trình (nếu còn chạy), xoá thư mục; Windows còn giữ file (trình duyệt chưa thoát hẳn) → thử lại, vẫn bận thì đổi tên
 *  thành _xoa-<id> (biến khỏi lịch sử ngay, dọn ở lần list sau). */
async function remove(id: string) {
  const d = dir(id), run = rj<Run | null>(path.join(d, "run.json"), null);
  if (run && alive(run.pid)) { try { cmd(id, { type: "stop" }); } catch { /* thư mục lạ */ } try { process.kill(run.pid!); } catch { /* đã dừng */ } for (let i = 0; i < 20 && alive(run.pid); i++) await new Promise((r) => setTimeout(r, 150)); }
  try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); return true; }
  catch { try { fs.renameSync(d, path.join(RUNS, `_xoa-${id}-${Date.now()}`)); return true; } catch { return false; } }
}
function sweep() { try { for (const x of fs.readdirSync(RUNS)) if (x.startsWith("_xoa-")) fs.rm(path.join(RUNS, x), { recursive: true, force: true }, () => {}); } catch { /* chưa có thư mục */ } }

function file(id: string, name: string, type: string, dl = "") {
  if (!/^(frame\.jpg|step-\d{3}\.jpg|upl-\d\.(png|jpg))$/.test(name)) return json({ ok: false }, 400);
  const f = path.join(dir(id), name); if (!fs.existsSync(/*turbopackIgnore: true*/ f)) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(/*turbopackIgnore: true*/ f)), { headers: { "Content-Type": type, "Cache-Control": name === "frame.jpg" ? "no-store" : "private, max-age=86400", ...(dl && { "Content-Disposition": `attachment; filename="${dl}"` }) } });
}
const fmt = (ms: number) => { const d = new Date(ms + 7 * 3600e3), p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };

/** Giao diện gốc phục vụ thẳng từ file (record/utilities.tsx nạp bằng link có số phiên bản) — không qua gói JS của Next mà Cloudflare giữ 4 giờ. */
const ROOT = path.join(/*turbopackIgnore: true*/ process.cwd(), "moduleHS");
const ASSETS: Record<string, [string, string]> = { "qa.js": ["qa/qa-ui.js", "text/javascript; charset=utf-8"], "qa.css": ["qa/qa.css", "text/css; charset=utf-8"], "meeting.js": ["record/meeting-ui.js", "text/javascript; charset=utf-8"], "meeting.css": ["record/meeting.css", "text/css; charset=utf-8"] };
function assetVer() { let m = 0; for (const [f] of Object.values(ASSETS)) { try { m = Math.max(m, fs.statSync(/*turbopackIgnore: true*/ path.join(ROOT, f)).mtimeMs); } catch { /* thiếu file */ } } return Math.round(m).toString(36); }
function asset(name: string, v: string | null) {
  const a = ASSETS[name]; if (!a) return new Response(null, { status: 404 });
  let body: Buffer; try { body = fs.readFileSync(/*turbopackIgnore: true*/ path.join(ROOT, a[0])); } catch { return new Response(null, { status: 404 }); }
  return new Response(new Uint8Array(body), { headers: { "Content-Type": a[1], "Cache-Control": v && v === assetVer() ? "public, max-age=31536000, immutable" : "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function handle(req: Request) {
  try {
    { const q0 = new URL(req.url).searchParams, a0 = q0.get("action");   // giao diện: không cần đăng nhập (trang xem biên bản công khai cũng dùng)
      if (req.method === "GET" && a0 === "ver") return json({ ok: true, v: assetVer() });
      if (req.method === "GET" && a0 === "asset") return asset(q0.get("f") || "", q0.get("v")); }
    const account = await getAccountContext();
    if (!account?.workspaceId) return json({ ok: false, stage: "Chưa đăng nhập" }, 401);
    const q = new URL(req.url).searchParams, a = q.get("action") || "", id = q.get("id") || "";
    if (req.method === "GET") {
      if (a === "list") return json({ ok: true, runs: list() });
      if (a === "state") { const d = dir(id), run = rj<Partial<Run>>(path.join(d, "run.json"), {}); return json({ ok: true, run: { url: run.url, goal: run.goal, images: run.images || [], created: run.created, by_name: run.by_name, max_steps: run.max_steps, minutes: run.minutes ?? "auto", name: run.name || "" }, state: state(id), report: rj(path.join(d, "report.json"), null) }); }
      if (a === "stream") return stream(id, req.signal);
      if (a === "frame") {   // ảnh trực tiếp: ?t=<mốc ảnh đã có> → 204 khi chưa có ảnh mới
        const f = path.join(dir(id), "frame.jpg"); let st: fs.Stats; try { st = fs.statSync(/*turbopackIgnore: true*/ f); } catch { return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); }
        const t = Math.floor(st.mtimeMs); if (+(q.get("t") || 0) >= t) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
        let b: Buffer; try { b = fs.readFileSync(/*turbopackIgnore: true*/ f); } catch { return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }); }
        return new Response(new Uint8Array(b), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Frame-T": String(t) } });
      }
      if (a === "img") { const n = q.get("n") || ""; return file(id, n, /png$/.test(n) ? "image/png" : "image/jpeg"); }
      if (a === "docx") {
        const d = dir(id), R = rj<QaReport | null>(path.join(d, "report.json"), null), run = rj<Partial<Run>>(path.join(d, "run.json"), {}), s = state(id); if (!R) return json({ ok: false }, 404);
        const t0 = Number(s.started || run.created || Date.now()), secs = Math.round(((s.ended || Date.now()) - t0) / 1000);
        if (run.name) R.title = run.name;
        const b = qaDocx(R, { url: run.url || "", goal: run.goal || "", date: fmt(t0), dur: `${Math.floor(secs / 60)} phút ${secs % 60} giây`, steps: s.step || 0 });
        return new Response(new Uint8Array(b), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="Bao-cao-kiem-thu-${id}.docx"`, "Cache-Control": "no-store" } });
      }
      return json({ ok: false }, 404);
    }
    const o = req.headers.get("origin"); if (o) { try { if (new URL(o).host !== (req.headers.get("x-forwarded-host") || req.headers.get("host"))) return json({ ok: false, stage: "csrf" }, 403); } catch { return json({ ok: false }, 403); } }
    if (a === "start") return await start(req, account.userId, account.fullName || account.email || "");
    if (a === "say") { const b = (await req.json().catch(() => ({}))) as Record<string, unknown>; return say(id, String(b.text || ""), String(b.cid || "").slice(0, 40)); }
    if (a === "cmd") { const b = (await req.json().catch(() => ({}))) as Record<string, unknown>; const t = String(b.type || ""); if (!["continue", "answer", "stop", "pause", "click", "type", "key", "scroll", "goto", "back", "zoom"].includes(t)) return json({ ok: false }, 400); cmd(id, b); return json({ ok: true }); }
    if (a === "delete") return json({ ok: await remove(id) });
    if (a === "rename") {   // đổi tên lượt test (lưu ở run.json — state.json do agent ghi liên tục nên không đụng)
      const b = (await req.json().catch(() => ({}))) as Record<string, unknown>, f = path.join(dir(id), "run.json"), run = rj<Run | null>(f, null);
      if (!run) return json({ ok: false, stage: "Không thấy lượt test" }, 404);
      const nm = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 120); if (nm) run.name = nm; else delete run.name;
      fs.writeFileSync(f, JSON.stringify(run)); return json({ ok: true, name: nm });
    }
    return json({ ok: false }, 404);
  } catch (e) {
    const x = e as { status?: number; message?: string };
    if (!x.status) console.error("[Kiểm thử]", e);
    return json({ ok: false, stage: x.message || "server" }, x.status || 500);
  }
}
