import "server-only";

// Một cửa cho /api/hs/record: ?action=… (giữ tên + JSON y như bản gốc) cần đăng nhập HireX;
// /api/hs/record/f/<slug>/data và /api/hs/record/d/<slug>/<loại> là link công khai (trang xem /m/<slug> gửi qua Zalo).
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { docxText, normText, xlsxText } from "./office";
import {
  C, LANGS, VOICES, err, refresh, cleanTitle, safeId, fmtT, slugify, lang, st, nextId, dir, fp, save, upd, bySid, need, chunks, has, prune, rj,
  voiceStyles, saveVoiceStyles, settings, saveSettings, type HsErr, type Meta, type Settings,
} from "./data";
import { fixText, getLex, phrases, protect } from "./lexicon";
import {
  FILES, deepText, dropEcho, fail, ffmpegVersion, finalize, meetingOpts, newSession, prepare, processMeeting, runTts, scriptClean, gTranslate,
} from "./pipeline";
import { zaloSend, zaloTargets } from "./zalo";
import { openRoom, put as roomPut, roomByToken, roomRoute, roomStart } from "./room";

type Fields = Record<string, string>;
type Up = { name: string; size: number; buf: Buffer };
interface Ctx { req: Request; q: URLSearchParams; f: Fields; files: Record<string, Up>; base: string; userId: string; workspaceId: string; permissions: string[] }
const ok = (x: Record<string, unknown> = {}) => ({ ok: true, ...x });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const origin = (req: Request) => C.pub || `${req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "")}://${req.headers.get("x-forwarded-host") || req.headers.get("host")}`;
const when = (m: Meta) => fmtT(m.started || m.created * 1000);

/** Dữ liệu khởi động cho giao diện (trước đây nhúng vào index.html). */
export const bootData = () => ({ slice: C.slice, uploadMax: C.maxMB * 1048576, seg: C.seg, ttsMax: C.ttsMax, voices: VOICES, langs: Object.fromEntries(Object.entries(LANGS).map(([k, v]) => [k, v.name])), liveMs: C.liveMs, ai: !!C.key });

/* ============ GET ============ */
const GET: Record<string, (c: Ctx) => unknown> = {
  /** Cụm từ để trình duyệt nghe đúng hơn (contextual biasing): thuật ngữ HireX, tên người, khách hàng… từ điển học từ dữ liệu HireX. */
  lex_phrases: async ({ q, workspaceId }) => { const m = q.get("session_id") ? bySid(String(q.get("session_id"))) : null; return ok({ phrases: phrases(await getLex(m?.ws || workspaceId || "")) }); },
  styles: () => ok({ config: voiceStyles() }),   // giọng đọc (tab Đọc văn bản); biên bản không còn mẫu
  archive: () => {
    prune(); const s = st();
    const f = (m: Meta, k: string) => (m.files?.[k as keyof Meta["files"]] ? { id: m.slug + ":" + k, slug: m.slug, k, name: `${m.slug}_${FILES[k](m)[2]}`, mime: FILES[k](m)[1] } : null);
    const items: Record<string, unknown>[] = [];
    for (const m of s.meta.values()) {
      const cs = chunks(m.slug), audio = has(m.slug, "audio.mp3");
      if (m.status === "recording" && !cs.length) continue; // vừa tạo, chưa có dữ liệu
      if (m.status !== "done" && m.kind === "meeting" && !cs.length && !audio && m.status !== "processing") continue; // không còn gì để xử lý lại
      let bytes = 0, last = 0; for (const c of cs) { const x = fs.statSync(fp(m.slug, "chunks/" + c)); bytes += x.size; last = Math.max(last, x.mtimeMs); }
      if (!cs.length) bytes = m.size || 0;
      items.push({ id: m.slug, sid: m.sid, slug: m.slug, kind: m.kind, title: m.title, created: new Date(m.started || m.created * 1000).toISOString(), status: m.status, stage: m.stage || "", error: m.error || m.job?.error || "", busy: s.run.has(m.id),
        chunks: cs.length, bytes, est_seconds: cs.length ? Math.round((cs.length * C.slice) / 1000) : m.dur || 0, has_audio: audio, active: m.status === "recording" && Date.now() - last < C.slice * 2 + 10000,
        fmt: m.v2 ? "word" : m.fmt || "", tpl: !m.v2 && !!m.template_file, v2: m.v2 ? 1 : 0, live_lang: m.live_lang || "", auto: !!m.auto, dur: m.dur || 0, ended: m.ended || 0, notify: m.notify || "",
        started_at: when(m), audio: f(m, "audio"), transcript: f(m, "transcript"), summary: f(m, "summary"), translation: f(m, "translation") });
    }
    return ok({ items, at: Math.floor(Date.now() / 1000) });
  },
  zalo_state: async () => { const s = settings(); return { ok: true, notify: s.zaloNotify, meeting: s.zaloMeeting, tts: s.zaloTts, account_id: s.account_id, account_name: s.account_name, conversation_id: s.conversation_id, group_name: s.group_name, logged: !!(s.account_id && s.conversation_id), admin: await isWorkspaceAdmin() }; },
  zalo_targets: async ({ q, userId, workspaceId, permissions }) => ok(await zaloTargets({ workspaceId, userId, permissions, isAdmin: await isWorkspaceAdmin() }, safeId(q.get("account_id")))),
  health: async () => ok({ ffmpeg: await ffmpegVersion(), ai: !!C.key, data: C.data }),
};

/* ============ POST ============ */
const extOf = (name: string) => (/\.([A-Za-z0-9]{1,8})$/.exec(name) || [, "bin"])[1]!.toLowerCase();
const POST: Record<string, (c: Ctx) => unknown> = {
  create: ({ base, userId, workspaceId, f }) => ok({ session_id: newSession(base, userId, workspaceId, f).sid }),
  chunk: async ({ f, files }) => {
    const m = need(f.session_id), i = +f.index, c = files.chunk; if (!(i >= 0) || !c) throw err("bad_request");
    fs.mkdirSync(fp(m.slug, "chunks"), { recursive: true }); await fsp.writeFile(fp(m.slug, `chunks/${String(i).padStart(6, "0")}.part`), c.buf); fs.utimesSync(dir(m.slug), new Date(), new Date()); return ok();
  },
  status: ({ f }) => { const m = bySid(safeId(f.session_id)); return m ? ok({ exists: true, chunks: chunks(m.slug).map((c) => parseInt(c, 10)) }) : ok({ exists: false, chunks: [] }); },
  job: ({ f }) => {
    const m = bySid(safeId(f.session_id)); if (!m) return ok({ exists: false });
    const j = m.job || {}, active = ["queued", "merging", "encoding", "sending"].includes(j.stage || ""), busy = active && st().run.has(m.id);
    return ok({ exists: true, stage: active && !busy ? "stale" : j.stage || "", busy, error: j.error || "", detail: j.detail || "", parts: j.parts || 0, age: Math.round(Date.now() / 1000 - (j.ts || Date.now() / 1000)) });
  },
  finalize: ({ f }) => {
    const m = need(f.session_id); if (st().run.has(m.id)) throw err("busy", 409);
    meetingOpts(m, f); if (!m.v2) Object.assign(m, { v2: 1, fmt: "word" }); save(m);
    const cs = chunks(m.slug), count = Math.max(0, +f.chunk_count | 0);
    for (let i = 0; i < count; i++) if (!cs.includes(`${String(i).padStart(6, "0")}.part`)) throw err("missing_chunk", 500);
    if (!cs.length && !has(m.slug, "audio.mp3") && !fs.readdirSync(dir(m.slug)).some((x) => x.startsWith("source."))) throw err("no_chunks");
    upd(m, { ended: count ? Date.now() : 0 }); void finalize(m, count < 1); return ok({ accepted: true, chunks: cs.length });
  },
  /** Tải file ghi âm lên. Trình duyệt gửi từng phần (up_id, part, parts) vì HireX giới hạn mỗi request ~26 MB; phần cuối thì xử lý. */
  upload: async ({ base, userId, workspaceId, f, files }) => {
    const a = files.audio; if (!a || !a.size) throw err("upload_file");
    const part = Math.max(0, +f.part | 0), total = Math.max(1, +f.parts | 0), up = safeId(f.up_id), orig = cleanTitle(f.name || a.name, 120);
    let m: Meta | undefined = part ? [...st().meta.values()].find((x) => x.up === up && x.by === userId) : undefined;
    if (part && !m) throw err("upload_file");
    if (!m) {
      prune(); if (+f.size > C.maxMB * 1048576) throw err("file_too_big", 413);
      const name = orig.replace(/\.[^.]+$/, "") || "Audio", now = Date.now(), mt = +f.file_mtime * 1000;
      m = newSession(base, userId, workspaceId, { ...f, title: f.title || name });
      upd(m, { up, upload: 1, ended: mt > 0 && mt <= now && mt > now - 3153e8 ? mt : now, status: total > 1 ? "recording" : "processing", stage: total > 1 ? "" : "Xử lý âm thanh" });
    }
    await fsp.appendFile(fp(m.slug, "source." + extOf(orig)), a.buf); fs.utimesSync(dir(m.slug), new Date(), new Date());
    if (part < total - 1) return ok({ part });
    const run = st().run; upd(m, { status: "processing", stage: "Xử lý âm thanh" }); run.add(m.id);
    try { await prepare(m, false); } catch (e) { run.delete(m.id); fail(m, e); throw err((e as Partial<HsErr>).stage || "ffmpeg_mp3", 500); }
    const mm = m; processMeeting(mm).catch((e) => fail(mm, e)).finally(() => run.delete(mm.id)); return ok({ parts: m.parts, duration: m.dur });
  },
  /** Giọng đọc (Cài đặt › Giọng đọc). */
  style_save: ({ f }) => {
    const cfg = voiceStyles(), name = cleanTitle(f.name, 80), prompt = String(f.prompt || "").trim(); let id = safeId(f.id);
    if (!name || !prompt || prompt.length > 16000) throw err("bad_request", 422);
    const extra = { prefix: String(f.prefix || "").trim().slice(0, 300), suffix: String(f.suffix || "").trim().slice(0, 300) };
    if (!id) id = "custom_" + crypto.randomBytes(5).toString("hex");
    const row = cfg.styles.find((s) => s.id === id); if (row) Object.assign(row, { name, prompt }, extra); else cfg.styles.push({ id, name, description: "", builtin: false, prompt, ...extra });
    saveVoiceStyles(cfg); return ok({ id, config: cfg });
  },
  style_delete: ({ f }) => {
    const cfg = voiceStyles(), id = safeId(f.id), t = cfg.styles.find((s) => s.id === id); if (!t || t.builtin) throw err("bad_request", 422);
    cfg.styles = cfg.styles.filter((s) => s.id !== id); saveVoiceStyles(cfg); return ok({ config: cfg });
  },
  extract_text: ({ files }) => {
    const d = files.doc; if (!d?.size) throw err("upload_file"); if (d.size > 8 * 1048576) throw err("file_too_big", 413);
    const ext = (/\.(\w+)$/.exec(d.name) || [, ""])[1]!.toLowerCase(); let t: string;
    if (ext === "docx") t = docxText(d.buf); else if (ext === "xlsx") { t = xlsxText(d.buf, 2000); if (!t) throw err("bad_xlsx", 422); }
    else if (["txt", "md", "markdown", "csv", "srt", "vtt", "log", ""].includes(ext)) { const b = d.buf; t = b[0] === 0xff && b[1] === 0xfe ? b.toString("utf16le") : b.toString("utf8"); }
    else throw err("unsupported", 415);
    t = normText(t); if (!t) throw err("empty_text", 422); return ok({ text: t, chars: [...t].length });
  },
  deep_text: async ({ f }) => {
    if (!C.key) throw err("no_ai_key", 501); const t = normText(f.text || ""), len = [...t].length; if (!len) throw err("empty_text", 422); if (len > C.ttsMax * 2) throw err("text_too_long", 422);
    const res = await deepText(t, f.mode === "summary"); return ok({ text: res, chars: [...res].length });
  },
  tts_send: ({ base, userId, f }) => {
    const t = normText(f.text || ""); const len = [...t].length; if (!len) throw err("empty_text", 422); if (len > C.ttsMax) throw err("text_too_long", 422);
    const g = Object.entries(VOICES).find(([, l]) => l.some((v) => v.id === safeId(f.voice))); if (!g) throw err("bad_voice", 422);
    const cfg = voiceStyles(), sx = cfg.styles.find((s) => s.id === (safeId(f.style_id) || cfg.default_style_id)); if (!sx) throw err("bad_style", 422);
    let speed = +f.speed || 1; if (speed < 0.5 || speed > 2) speed = 1; speed = Math.round(speed * 100) / 100;
    const plain = t, aiMode = f.title_mode === "ai"; let title = cleanTitle(f.title); if (!title && !aiMode) title = cleanTitle(t.replace(/\s+/g, " ").slice(0, 40)) || "Audio";
    const slug = slugify(title || "Audio"); fs.mkdirSync(dir(slug), { recursive: true });
    const m = save({ id: nextId(), sid: crypto.randomBytes(12).toString("hex"), slug, kind: "tts", title: title || "Audio", auto: aiMode, status: "processing", stage: "Đang xếp hàng", created: Date.now() / 1000, base, by: userId, files: {}, voice: safeId(f.voice), voice_label: (g[0] === "male" ? "Nam" : "Nữ") + " - " + safeId(f.voice), style_name: sx.name, style_prompt: sx.prompt || "", speed, char_count: len, plain: plain.slice(0, 6000) });
    fs.writeFileSync(fp(slug, "text.txt"), [sx.prefix, t, sx.suffix].filter(Boolean).join("\n\n")); void runTts(m); return ok({ chars: len, title: m.title });
  },
  /** Phụ đề (miễn phí): một câu trình duyệt vừa nghe xong → sửa tên / thuật ngữ theo từ điển học từ dữ liệu HireX → lọc câu rác → dịch bằng Google (miễn phí).
   *  Trả về: dòng đầu JSON {text} (câu đã sửa), phần sau là bản dịch. Không gọi OpenAI. */
  /** Mời người nói tiếng Nhật / tiếng Anh dùng điện thoại riêng: mở (hoặc dùng lại) phòng dịch → link công khai. */
  live_join: ({ f, base, userId, workspaceId }) => {
    const pair = String(f.pair || "vi,ja").split(",").map((x) => lang(x)).filter(Boolean) as string[];
    const r = openRoom(userId + ":" + workspaceId, workspaceId, pair.length === 2 ? pair : ["vi", "ja"]);
    if (f.session_id) { const m = bySid(safeId(f.session_id)); if (m) roomStart(r, m.slug); }     // đang ghi cuộc họp mới → phòng sang hội thoại mới
    return ok({ token: r.token, url: `${base}/api/hs/record/j/${r.token}` });
  },
  live_tr: ({ f }) => {
    const m = need(f.session_id), to = lang(f.lang), src = lang(f.src) || "vi", raw = scriptClean(normText(f.text || "").slice(0, 4000)), enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(ctl) {
        // từ điển chỉ áp cho tiếng Việt (người Việt nói tên / thuật ngữ HireX); tiếng Nhật / Anh giữ nguyên lời trình duyệt nghe
        const lex = await getLex(m.ws || "").catch(() => null), fx = lex && src === "vi" ? fixText(raw, lex) : { text: raw, hits: new Map<string, number>() };
        const t = dropEcho(fx.text, [], "");
        ctl.enqueue(enc.encode(JSON.stringify({ text: t }) + "\n"));
        let tr = "";
        if (t && to) {
          const pr = lex ? protect(t, fx.hits, lex) : { text: t, back: (x: string) => x };
          try { tr = pr.back(await gTranslate(pr.text, to, src)); if (tr) ctl.enqueue(enc.encode(tr)); } catch (e) { console.warn("[Cuộc họp] Google Dịch lỗi:", e instanceof Error ? e.message : e); }
        }
        if (t) { fs.mkdirSync(dir(m.slug), { recursive: true }); fs.appendFileSync(fp(m.slug, "live.jsonl"), JSON.stringify({ t: Date.now(), k: +f.k || 0, fin: f.fin !== "0", src, raw, text: t, tr, lang: to }) + "\n"); }
        const room = roomByToken(f.room || "");                                         // có khách vào phòng dịch: gửi dòng này sang điện thoại của họ
        if (room && room.ws === (m.ws || room.ws)) {
          roomStart(room, m.slug); const dev = String(f.dev || "host").replace(/[^\w-]/g, "").slice(0, 24) || "host";
          roomPut(room, { dev, k: +f.k || 0, lang: src, text: t, tr: to && tr ? { [to]: tr } : {}, fin: f.fin !== "0", conf: Math.min(1, Math.max(0, +f.conf || 0)), ts: +f.ts || 0, drop: !t && f.fin !== "0" });
        }
        ctl.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  },
  zalo_config: async ({ f, userId, workspaceId }) => {
    if (!(await isWorkspaceAdmin())) throw err("admin_only", 403);
    const cur = settings(), s: Settings = { ...cur, zaloNotify: f.notify === "1", zaloMeeting: f.meeting === "1", zaloTts: f.tts === "1", account_id: safeId(f.account_id), account_name: cleanTitle(f.account_name, 120), conversation_id: safeId(f.conversation_id), group_name: cleanTitle(f.group_name, 200), workspace_id: workspaceId, by: userId };
    saveSettings(s); return ok();
  },
  zalo_test: async () => ok({ result: await zaloSend("Cuộc họp (HireX): kết nối Zalo hoạt động.", "Gửi thử", 45000) }),
  delete: ({ f }) => {
    const m = bySid(safeId(f.session_id)); if (!m) throw err("no_chunks", 404); if (st().run.has(m.id)) throw err("busy", 409);
    fs.rmSync(dir(m.slug), { recursive: true, force: true }); st().meta.delete(m.slug); return ok();
  },
};

/* ============ file công khai ============ */
function sendFile(req: Request, file: string, name: string, type: string, dl: boolean) {
  const size = fs.statSync(file).size; let s = 0, e = size - 1, code = 200; const r = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  if (r && (r[1] || r[2])) { code = 206; if (r[1]) { s = +r[1]; if (r[2]) e = Math.min(e, +r[2]); } else s = Math.max(0, size - +r[2]); }
  if (s > e) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const body = Readable.toWeb(fs.createReadStream(file, { start: s, end: e })) as ReadableStream<Uint8Array>;
  return new Response(body, { status: code, headers: { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": String(e - s + 1), "Cache-Control": "no-store", ...(code === 206 && { "Content-Range": `bytes ${s}-${e}/${size}` }), "Content-Disposition": `${dl ? "attachment" : "inline"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}` } });
}
function publicRoute(req: Request, seg: string[]) {
  const s = st(), m = /^[\w-]{1,100}$/.test(seg[1] || "") ? s.meta.get(seg[1]) : undefined; if (!m || m.status !== "done") return text("Không tìm thấy", 404);
  if (seg[0] === "d") {
    const k = seg[2] || "", f = FILES[k]?.(m); if (!f || !m.files?.[k as keyof Meta["files"]] || !has(m.slug, f[0])) return text("Không tìm thấy", 404);
    return sendFile(req, fp(m.slug, f[0]), `${m.slug}_${f[2]}`, f[1], new URL(req.url).searchParams.has("dl"));
  }
  const rd = (f: string) => { try { return fs.readFileSync(fp(m.slug, f), "utf8"); } catch { return ""; } }, k = new URL(req.url).searchParams.get("k");
  return json({ title: m.title, kind: m.kind, fmt: m.v2 ? "word" : m.fmt || "", tpl: !m.v2 && !!m.tpl_html, mm: m.v2 && has(m.slug, "minutes.json") ? 1 : 0, live_lang: m.live_lang || "", created: m.created, started: m.started || 0, ended: m.ended || 0, dur: m.dur || 0, files: m.files,
    ...(k === "transcript" && { text: rd("transcript.txt") }), ...(k === "translation" && { text: rd("translation.txt") }),
    ...(k === "summary" && (m.fmt === "excel" && !m.v2 ? { sheets: rj<{ sheets: unknown[] }>(fp(m.slug, "report.json"), { sheets: [] }).sheets } : { html: rd("summary.html") })) });
}
/** Trang xem công khai /m/<slug>: tiêu đề cho thẻ link (Zalo, trình duyệt). */
export function publicTitle(slug: string) { refresh(); const m = /^[\w-]{1,100}$/.test(slug) ? st().meta.get(slug) : undefined; return m?.status === "done" ? m.title : ""; }

/* ============ cửa vào ============ */
async function form(req: Request) {
  const f: Fields = {}, files: Record<string, Up> = {}, ct = req.headers.get("content-type") || "";
  if (!/multipart\/form-data|x-www-form-urlencoded/.test(ct)) return { f, files };
  const fd = await req.formData();
  for (const [k, v] of fd) if (typeof v === "string") f[k] = v; else files[k] = { name: v.name, size: v.size, buf: Buffer.from(await v.arrayBuffer()) };
  return { f, files };
}
/** Chặn POST từ trang khác (cookie đăng nhập đi kèm): Origin phải trùng host. */
const sameOrigin = (req: Request) => { const o = req.headers.get("origin"); if (!o) return true; try { return new URL(o).host === (req.headers.get("x-forwarded-host") || req.headers.get("host")); } catch { return false; } };

export async function handle(req: Request, seg: string[]) {
  try {
    refresh();
    if (seg[0] === "f" || seg[0] === "d") return publicRoute(req, seg);
    if (seg[0] === "j") { if (req.method === "POST" && !sameOrigin(req)) return json({ ok: false, stage: "csrf" }, 403); return roomRoute(req, seg); }
    if (seg.length) return text("Không tìm thấy", 404);
    const account = await getAccountContext();
    if (!account?.workspaceId) return json({ ok: false, stage: "Chưa đăng nhập" }, 401);
    const q = new URL(req.url).searchParams, action = q.get("action") || "", base = origin(req);
    const ctx = { req, q, base, userId: account.userId, workspaceId: account.workspaceId, permissions: account.permissions };
    if (req.method === "GET") { const h = GET[action]; return h ? json(await h({ ...ctx, f: {}, files: {} })) : json({ ok: false }, 404); }
    const h = POST[action]; if (!h) return json({ ok: false }, 404);
    if (!sameOrigin(req)) return json({ ok: false, stage: "csrf" }, 403);
    const { f, files } = await form(req);
    const out = await h({ ...ctx, f, files });
    return out instanceof Response ? out : json(out);
  } catch (e) {
    const x = e as Partial<HsErr>; if (!x.status) console.error("[Cuộc họp]", e);
    return json({ ok: false, stage: x.stage || "server", detail: e instanceof Error ? e.message : String(e) }, x.status || 500);
  }
}
