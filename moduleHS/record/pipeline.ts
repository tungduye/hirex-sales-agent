import "server-only";

// Xử lý của Cuộc họp: FFmpeg (ghép / nén / cắt audio) → OpenAI (phiên âm, biên bản, dịch, giọng đọc, phụ đề trực tiếp) → Word/Excel → Zalo.
// Gọi Responses API qua src/lib/openai/responses.ts (key OPENAI_API_KEY của HireX); audio/realtime gọi thẳng api.openai.com.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { postOpenAIResponse, responseOutputText } from "@/lib/openai/responses";
import { docx, xlsx, cleanHtml, xlsxText, normText, docxOutline, fillDocx, docxHtml, fillXlsx, xlsxSheets, type Sheet } from "./office";
import {
  C, LANGS, TPL, err, cleanTitle, safeId, fmtT, fmtDur, esc, slugBase, slugify, lang, langs, isLang, st, nextId, dir, fp, save, upd, chunks, has, jobSet, rename,
  styles, topics, glossary, settings, type Gloss, type HsErr, type Lang, type Meta, type Style,
} from "./data";
import { zaloSend } from "./zalo";

const OPENAI = "https://api.openai.com/v1";

/* ============ FFmpeg ============ */
export const ff = (args: string[], ms = 900000) => new Promise<[number, string]>((res) => {
  const p = spawn(C.ffmpeg, ["-hide_banner", ...args], { windowsHide: true }); let out = ""; const t = setTimeout(() => p.kill("SIGKILL"), ms);
  p.stderr.on("data", (d) => { out = (out + d).slice(-4000); }); p.on("error", (e) => { clearTimeout(t); res([1, String(e)]); }); p.on("close", (c) => { clearTimeout(t); res([c ?? 1, out]); });
});
const toMp3 = (src: string, dst: string) => ff(["-y", "-loglevel", "error", "-err_detect", "ignore_err", "-fflags", "+discardcorrupt+genpts", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", C.br, dst]);
const seconds = async (f: string) => { const [, o] = await ff(["-i", f]); const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(o); return m ? Math.round(+m[1] * 3600 + +m[2] * 60 + +m[3]) : 0; };
/** Phiên bản FFmpeg trên máy chủ ("" = không chạy được). */
export const ffmpegVersion = () => new Promise<string>((res) => {
  const p = spawn(C.ffmpeg, ["-version"], { windowsHide: true }); let out = "";
  p.stdout.on("data", (d) => { out += d; }); p.on("error", () => res("")); p.on("close", (c) => res(c ? "" : /ffmpeg version (\S+)/.exec(out)?.[1] || "?"));
});

/* ============ OpenAI ============ */
async function openai(p: string, init: RequestInit & { headers?: Record<string, string> }) {
  if (!C.key) throw err("no_ai_key", 501);
  const r = await fetch(OPENAI + p, { method: "POST", signal: AbortSignal.timeout(900000), ...init, headers: { Authorization: "Bearer " + C.key, ...init.headers } });
  if (!r.ok) throw err("openai", 502, `OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`); return r;
}
async function ai(instructions: string, input: string, extra: Record<string, unknown> = {}, ms = 900000, model = C.text) {
  if (!C.key) throw err("no_ai_key", 501);
  const r = await postOpenAIResponse({ apiKey: C.key, timeoutMs: ms, body: { model, instructions, input, ...extra } });
  if (!r.ok) throw err("openai", 502, `OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return responseOutputText(await r.json()).trim();
}
export const aiTitle = async (text: string) => {
  const fb = cleanTitle(text.replace(/\s+/g, " ").slice(0, 40)) || "Audio";
  try { return cleanTitle(await ai("Đặt tên file ngắn gọn bằng tiếng Việt (3 đến 8 từ) cho nội dung người dùng gửi. Chỉ trả về đúng tên, không dấu ngoặc kép, không đuôi file, không ký tự đặc biệt.", text.slice(0, 6000)), 80) || fb; } catch { return fb; }
};

/* ============ prompt biên bản (giữ nguyên từ bản gốc) ============ */
function summaryPrompt(m: Meta, transcript: string, tpl = "") {
  const gl = (m.glossary || []).filter((g) => g.heard && g.text), mode = m.fmt === "excel" ? (tpl ? "xfill" : "excel") : tpl ? "wfill" : "word";
  const ctx = [m.topic_name && "Chủ đề họp: " + m.topic_name, m.topic_context && "Ngữ cảnh:\n" + m.topic_context, m.topic_content && "Bộ content cần đối chiếu:\n" + m.topic_content, m.topic_main && "Nội dung chính cần bám sát:\n" + m.topic_main].filter(Boolean).join("\n\n");
  const common = "Viết bằng tiếng Việt (transcript có thể là tiếng Việt, tiếng Anh hoặc tiếng Nhật; giữ nguyên tên riêng, thuật ngữ). NGỮ CẢNH CHỦ ĐỀ chỉ giúp hiểu đúng thuật ngữ, tên riêng và phạm vi; không chép nguyên văn ngữ cảnh vào kết quả và không coi đó là điều đã được nói trong cuộc họp. TỪ VỰNG: nếu transcript có cách nói/viết ở vế trái thì ghi theo vế phải. Không bịa tên, số liệu, deadline, người phụ trách hay quyết định. ";
  const titleRule = (json: boolean) => m.auto ? (json ? 'Trường "title" là tên cuộc họp ngắn gọn 3 đến 8 từ, tiếng Việt, không ký tự đặc biệt. ' : "Dòng đầu tiên của kết quả phải là đúng một comment HTML dạng <!--TITLE: tên cuộc họp ngắn gọn 3 đến 8 từ, tiếng Việt, không ký tự đặc biệt--> rồi mới đến HTML. ") : json ? 'Trường "title" để chuỗi rỗng. ' : "";
  const I = {
    word: "Bạn là thư ký cuộc họp doanh nghiệp, viết BIÊN BẢN CUỘC HỌP theo văn phong hành chính: khách quan, đúng diễn biến, câu hoàn chỉnh, ngắn gọn. Chỉ dùng thông tin trong transcript. " + common
      + (m.style_prompt ? 'MẪU BÁO CÁO (STYLE_PROMPT) là KHUNG BẮT BUỘC: tạo ĐÚNG và ĐỦ tất cả các mục mà mẫu yêu cầu, đúng thứ tự, giữ đúng tên mục của mẫu, mỗi mục chính là một h2; làm đúng mọi yêu cầu trình bày của mẫu (bảng, cột, in đậm, gạch bỏ...). Mục nào transcript không có thông tin thì VẪN GIỮ mục và ghi một câu "Chưa ghi nhận trong cuộc họp."; bảng bắt buộc vẫn giữ đủ tiêu đề cột và một dòng "Chưa nêu". Không thêm mục ngoài mẫu. '
        : 'Theo thứ tự của một biên bản: h2 Thành phần tham dự; h2 Nội dung cuộc họp (mỗi vấn đề một h3, ghi ý kiến theo từng người phát biểu khi xác định được); h2 Kết luận của cuộc họp; h2 Phân công thực hiện (table: Nội dung công việc, Người thực hiện, Thời hạn, Ghi chú). Mục không có thông tin ghi "Chưa ghi nhận trong cuộc họp." ')
      + 'Tiêu đề tài liệu, tên cuộc họp, ngày giờ do hệ thống tự thêm: không viết tiêu đề tài liệu, không viết "BIÊN BẢN CUỘC HỌP" (kể cả khi mẫu yêu cầu mở đầu bằng tiêu đề). Bắt đầu trực tiếp từ mục đầu tiên. '
      + "Dùng h2 cho mục chính, h3 cho mục con, p cho nội dung, ul/ol cho danh sách, table khi dữ liệu có cấu trúc. Không tự đánh số mục vì hệ thống tự đánh số I, II, 1, 2. "
      + "Dùng strong để in đậm tên người, số liệu, mốc thời gian và quyết định quan trọng; không in đậm cả đoạn. Không lặp lại cùng một nội dung ở nhiều mục. Kết quả không bao giờ được rỗng. "
      + titleRule(false) + "Trả về duy nhất HTML fragment, không markdown/code fence. Chỉ dùng h2,h3,p,strong,em,s,ul,ol,li,table,thead,tbody,tr,th,td,blockquote,hr.",
    wfill: "Bạn là thư ký cuộc họp doanh nghiệp. Nhiệm vụ: ĐIỀN biên bản vào FILE MẪU WORD có sẵn, giữ nguyên bố cục mẫu. Chỉ dùng thông tin trong transcript. " + common
      + 'FILE MẪU được liệt kê từng đoạn dạng [số] (bảng · dòng · ô nếu đoạn nằm trong bảng) nội dung. Trả về DUY NHẤT một JSON hợp lệ {"title":"...","edits":[{"p":số,"text":"..."},{"p":số,"after":"<html>"}]}. '
      + '"text" thay toàn bộ chữ của đoạn: giữ nguyên nhãn của mẫu (ví dụ "Thời gian:") và điền giá trị vào chỗ trống, dấu chấm "....", gạch "____", ngoặc [ ] hoặc {{...}}; có thể dùng <strong>. Đặt "text":"" để xóa câu hướng dẫn hoặc ví dụ trong mẫu. '
      + '"after" chèn khối nội dung ngay sau đoạn (cho phần cần viết dài như Nội dung, Ý kiến, Kết luận, Phân công) bằng HTML chỉ gồm h3,p,strong,ul,ol,li,table,tr,th,td. '
      + 'Không sửa quốc hiệu, tiêu ngữ, tên đơn vị, tiêu đề mẫu, đoạn [hình] và khối chữ ký trừ chỗ trống cần điền. Bám đúng thứ tự và các mục của mẫu; chỗ trống không có thông tin ghi "Chưa nêu". Số "p" phải lấy đúng từ danh sách. STYLE_PROMPT là ghi chú thêm của người dùng. ' + titleRule(true),
    excel: 'Bạn là thư ký cuộc họp doanh nghiệp kiêm chuyên viên báo cáo số liệu. Chỉ dùng thông tin trong transcript; ô thiếu thông tin ghi "Chưa nêu". ' + common
      + 'Trả về DUY NHẤT một JSON hợp lệ (không markdown, không code fence) dạng {"title":"...","sheets":[{"name":"...","col_widths":[số,...],"rows":[[ô,...],...]}]}. Mỗi ô là chuỗi, số hoặc null. rows[0] là dòng 1 của sheet, phần tử đầu mỗi dòng là cột A, ô trống để null. Công thức Excel viết thành chuỗi bắt đầu bằng "=" (ví dụ "=SUM(B2:B6)"). '
      + "Tự thiết kế bảng hợp lý theo STYLE_PROMPT và chủ đề, dòng 1 là tiêu đề cột. Tự ghi dữ liệu và tự thống kê (đếm, tổng, tỷ lệ, theo người phụ trách, theo trạng thái...) từ transcript; ưu tiên công thức khi có thể. Tên sheet tối đa 31 ký tự, không chứa : \\ / ? * [ ]. " + titleRule(true),
    xfill: "Bạn là thư ký cuộc họp kiêm chuyên viên báo cáo. Nhiệm vụ: ĐIỀN dữ liệu từ transcript vào FILE MẪU EXCEL có sẵn, giữ nguyên bố cục mẫu. " + common
      + 'FILE MẪU liệt kê theo dạng [Sheet: tên] rồi mỗi dòng là các ô "A1=giá trị" (công thức trong ngoặc). Trả về DUY NHẤT một JSON hợp lệ {"title":"...","cells":[{"sheet":"tên sheet","ref":"B5","v":giá trị}]}. '
      + 'Giữ nguyên tiêu đề, nhãn và công thức sẵn có; chỉ ghi vào ô trống hoặc ô chờ điền. Khi bảng có dòng tiêu đề cột thì ghi từng dòng dữ liệu ngay bên dưới, đúng cột, liên tiếp. "v" là chuỗi, số, hoặc công thức bắt đầu bằng "=". Tự thống kê (đếm, tổng, tỷ lệ) khi mẫu có chỗ cho số liệu, ưu tiên công thức. Ô cần điền mà không có thông tin ghi "Chưa nêu". STYLE_PROMPT là ghi chú thêm của người dùng. ' + titleRule(true),
  }[mode];
  const input = `TÊN CUỘC HỌP:\n${m.title}\n\nSTYLE: ${m.style_name}\n\nSTYLE_PROMPT:\n${m.style_prompt || "(không có)"}` + (ctx ? `\n\nNGỮ CẢNH CHỦ ĐỀ:\n${ctx}` : "") + (gl.length ? "\n\nTỪ VỰNG:\n" + gl.map((g) => `- "${g.heard}" => ${g.text}`).join("\n") : "")
    + (tpl ? `\n\nFILE MẪU (${m.fmt === "excel" ? "Excel" : "Word"}):\n${tpl}` : "") + `\n\nTRANSCRIPT:\n${transcript}` + (mode === "word" ? "" : "\n\nĐỊNH DẠNG ĐẦU RA: trả về một đối tượng JSON hợp lệ theo cấu trúc đã nêu, không kèm chữ nào khác ngoài JSON.");
  return { instructions: I, input, extra: mode === "word" ? { reasoning: { effort: "medium" } } : { reasoning: { effort: "medium" }, text: { format: { type: "json_object" } } } };
}
export const fixGloss = (t: string, gl: Gloss[] | undefined) => { for (const g of gl || []) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(g.heard)}(?![\\p{L}\\p{N}])`, "giu"), () => g.text); return t; };
export async function transcribe(file: string, lng: unknown, prompt: string, type = "audio/mpeg") {
  const fd = new FormData(); fd.append("file", new Blob([new Uint8Array(await fsp.readFile(file))], { type }), path.basename(file));
  fd.append("model", C.stt); fd.append("response_format", "json"); for (const l of langs(Array.isArray(lng) ? lng.join(",") : lng)) fd.append("languages[]", l); if (prompt) fd.append("prompt", prompt.slice(0, 900));
  return String(((await (await openai("/audio/transcriptions", { body: fd })).json()) as { text?: string }).text || "").replace(/\s+/g, " ").trim();
}

/* ============ phụ đề / dịch trực tiếp ============ */
const LIVE_JUNK = /^\s*(thuật ngữ|用語|term(s)?|terminology)\s*[:：]/i;
/** Model phiên âm hay "đọc lại" prompt/thuật ngữ khi im lặng hoặc nhiễu (vd "BrSE, Trang"). Câu chỉ gồm từ trong danh sách thuật ngữ, hoặc nằm sẵn trong prompt → coi là rác. */
const NORM = (t: string) => String(t || "").toLowerCase().normalize("NFC").replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
export function isEcho(text: string, gl: Gloss[] | undefined, prompt = "") {
  const t = NORM(text); if (!t) return true; if (LIVE_JUNK.test(text)) return true;
  const terms = new Set((gl || []).flatMap((g) => NORM(g.text + " " + g.heard).split(" ")).filter(Boolean));
  if (terms.size && t.split(" ").every((w) => terms.has(w))) return true;
  const p = NORM(prompt); return t.length >= 4 && p.includes(t);
}
const kwClean = (s: string) => String(s || "").replace(/[<>\r\n]/g, " ").replace(/\s+/g, " ").trim();
const glTerms = (gl: Gloss[]) => [...new Set((gl || []).map((g) => kwClean(g.text)).filter(Boolean))].slice(0, 60);
/** Ngữ cảnh ngắn cho model nhận dạng (theo ngôn ngữ đang nói); KHÔNG liệt kê thuật ngữ ở đây (đã gửi qua keywords) để model không đọc lại. */
function livePrompt(m: Meta, l: string = "vi") {
  const tp = m.topic_name ? kwClean(m.topic_name) : "", ctx = kwClean(m.topic_context || "").slice(0, 260);
  if (l === "en") return (tp ? `Business meeting: ${tp}. ${ctx}` : "Business meeting.").trim().slice(0, 400);
  if (l === "ja") return (tp ? `会議「${tp}」。${ctx}` : "ビジネス会議。").trim().slice(0, 400);
  return (tp ? `Cuộc họp "${tp}". ${ctx}` : "Cuộc họp doanh nghiệp.").trim().slice(0, 400);
}
/** Bỏ ký tự thuộc hệ chữ không có trong ngôn ngữ đang nói (model đôi khi lẫn Hangul/Thái vào tiếng Việt); dòng không còn chữ thì bỏ. */
const SCRIPTS: Record<Lang, string[]> = { vi: ["Latin"], en: ["Latin"], ja: ["Latin", "Han", "Hiragana", "Katakana"] };
export function scriptClean(text: string, hint: unknown) {
  const hs = langs(hint); if (!hs.length || !text) return text;
  const ok = new RegExp("[" + [...new Set(hs.flatMap((h) => SCRIPTS[h]))].map((x) => `\\p{Script=${x}}`).join("") + "]", "u");
  const out = text.replace(/\p{L}/gu, (ch) => (ok.test(ch) ? ch : "")).replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  return /\p{L}{2,}/u.test(out) ? out : "";
}
export const dropEcho = (text: string, gl: Gloss[] | undefined, prompt = "") => String(text || "").split(/(?<=[.!?。！？])\s+/).filter((x) => !isEcho(x, gl, prompt)).join(" ").trim();
/** Dịch trực tiếp: model nhanh không suy luận, stream từng chữ. Thử lần lượt các model/tham số, nhớ cấu hình chạy được. */
const QA = { model: "", variant: -1, bad: new Set<string>() }, RTLOG = { last: "" };
const QA_MODELS = () => [...new Set([C.liveModel, "gpt-5.4-mini", "gpt-5-mini", "gpt-4.1-mini", C.text].filter(Boolean))];
const QA_VARIANTS: Record<string, unknown>[] = [{ reasoning: { effort: "none" } }, { reasoning: { effort: "minimal" } }, {}];
async function sseText(r: Response, onDelta?: (d: string) => void) {
  const rd = r.body!.getReader(), dec = new TextDecoder(); let buf = "", out = "", fin = "";
  for (;;) {
    const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2); const d = ev.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join(""); if (!d || d === "[DONE]") continue;
      let j: { type?: string; delta?: string; text?: string; error?: { message?: string }; response?: { error?: { message?: string } } }; try { j = JSON.parse(d); } catch { continue; }
      if (j.type === "response.output_text.delta" && j.delta) { out += j.delta; onDelta?.(j.delta); }
      else if (j.type === "response.output_text.done" && j.text) fin = j.text;
      else if (j.type === "error" || j.type === "response.failed") throw err("openai", 502, j.error?.message || j.response?.error?.message || "stream_error");
    }
  }
  return (out || fin).trim();
}
export async function quickStream(ins: string, input: string, onDelta?: (d: string) => void, ms = 20000) {
  if (!C.key) throw err("no_ai_key", 501);
  const models = QA_MODELS(), order = QA.model ? [QA.model, ...models.filter((m) => m !== QA.model)] : models; let last = "";
  for (const model of order) {
    if (QA.bad.has(model)) continue;
    const vs = QA.model === model && QA.variant >= 0 ? [QA.variant] : [0, 1, 2];
    for (const vi of vs) {
      let r: Response; try { r = await postOpenAIResponse({ apiKey: C.key, timeoutMs: ms, body: { model, instructions: ins, input, stream: true, ...QA_VARIANTS[vi] } }); }
      catch (e) { last = e instanceof Error ? e.message : String(e); continue; }
      if (r.ok) { if (QA.model !== model || QA.variant !== vi) { QA.model = model; QA.variant = vi; console.log(`[Cuộc họp] Dịch trực tiếp: ${model}${vi < 2 ? " · reasoning " + ["none", "minimal"][vi] : ""}`); } return sseText(r, onDelta); }
      const t = (await r.text().catch(() => "")).slice(0, 300); last = `OpenAI ${r.status}: ${t}`;
      if (r.status === 404 || /model_not_found|does not exist|not found|deprecated|invalid model/i.test(t)) { QA.bad.add(model); break; }
      if (r.status === 400 && /reasoning|effort|unsupported|not supported|unknown parameter/i.test(t)) continue;
      if (r.status === 401 || r.status === 403) throw err("openai", 502, last);
    }
  }
  throw err("openai", 502, last || "no_model");
}
export const liveIns = (to: Lang, gl: Gloss[] = []) => { const L = LANGS[to].name, terms = glTerms(gl); return `You are a simultaneous interpreter at a business meeting. Translate the given sentence into ${L}. Output ONLY the translation: no quotes, no notes, no alternatives. Natural, concise, faithful; keep names, numbers, codes${terms.length ? ` and these terms exactly: ${terms.join(", ")}` : ""}. If the sentence is already in ${L}, output it unchanged (only fix obvious speech-recognition slips). Sentences before it are given for context only.`; };
export const liveInput = (text: string, ctx: unknown) => (ctx ? `Previous lines (context):\n${String(ctx).slice(-400)}\n\n` : "") + `Sentence:\n${text}`;

/** Realtime: cấp khoá tạm để trình duyệt nối thẳng WebSocket OpenAI.
 *  Ưu tiên gpt-live-transcribe (chữ hiện ngay khi đang nói, trình duyệt tự cắt câu rồi commit);
 *  không được thì gpt-4o-transcribe với VAD phía máy chủ (+ logprobs để lọc câu bịa). */
export async function liveToken(m: Meta, src: unknown) {
  if (!C.key) throw err("no_ai_key", 501); if (!C.realtime) throw err("realtime_off", 409);
  const hint = langs(src), kw = glTerms(glossary().items), prompt = livePrompt(m, hint[0]); m.src_hint = hint.join(","); m.live_prompt = prompt;
  const fmt = { type: "audio/pcm", rate: 24000 }, nr = { type: C.liveNoise };
  const delay = ["minimal", "low", "medium", "high", "xhigh"].includes(C.liveDelay) ? C.liveDelay : "medium";
  const hold = Math.min(2000, Math.max(300, C.liveSilence)), maxTurn = Math.min(30000, Math.max(5000, C.liveMaxTurn));
  const vad = { type: "server_vad", threshold: Math.min(0.95, Math.max(0.1, C.liveVad)), prefix_padding_ms: 300, silence_duration_ms: hold };
  type Cand = { mode: "live" | "vad"; model: string; session: { audio: { input: { transcription: Record<string, unknown> } & Record<string, unknown> }; include?: string[] } & Record<string, unknown> };
  const liveOf = (model: string, extra = true): Cand => ({ mode: "live", model, session: { type: "transcription", audio: { input: { format: fmt, ...(extra && { noise_reduction: nr }), transcription: { model, delay, ...(hint.length && { languages: hint }), ...(extra && kw.length && { keywords: kw }), ...(extra && prompt && { prompt }) }, turn_detection: null } } } });
  const vadOf = (model: string): Cand => ({ mode: "vad", model, session: { type: "transcription", audio: { input: { format: fmt, noise_reduction: nr, transcription: { model, ...(hint[0] && { language: hint[0] }) }, turn_detection: vad } }, include: ["item.input_audio_transcription.logprobs"] } });
  const pref = C.liveTranscribe, cands: Cand[] = [];
  if (pref && !/live/.test(pref)) cands.push(vadOf(pref)); else { const lm = pref || "gpt-live-transcribe"; cands.push(liveOf(lm, true), liveOf(lm, false)); }
  for (const x of [...new Set(["gpt-4o-transcribe", C.stt])]) if (!cands.some((c) => c.model === x)) cands.push(vadOf(x));
  const url = OPENAI.replace(/^http/, "ws") + "/realtime?intent=transcription", H = { Authorization: "Bearer " + C.key, "Content-Type": "application/json" };
  const base = { hold, maxTurn, minLp: C.liveMinLp };
  let last = "";
  for (const c of cands) {
    try {
      const r = await fetch(OPENAI + "/realtime/client_secrets", { method: "POST", headers: H, signal: AbortSignal.timeout(15000), body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 600 }, session: c.session }) });
      const j = (await r.json().catch(() => ({}))) as { value?: string; client_secret?: { value?: string }; error?: { message?: string } }, tok = j.value || j.client_secret?.value;
      if (r.ok && tok) { if (RTLOG.last !== c.model + c.mode) { RTLOG.last = c.model + c.mode; console.log(`[Cuộc họp] Phụ đề trực tiếp: ${c.model} (${c.mode === "live" ? "streaming, cắt câu phía trình duyệt" : "VAD máy chủ"})${hint.length ? " · " + hint.join("+") : " · tự nhận ngôn ngữ"}`); } return { token: tok, url, beta: false, ...c, ...base }; }
      last = j.error?.message || "HTTP " + r.status;
      if (c.mode === "vad") {
        const tr = c.session.audio.input.transcription, r2 = await fetch(OPENAI + "/realtime/transcription_sessions", { method: "POST", headers: { ...H, "OpenAI-Beta": "realtime=v1" }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ input_audio_format: "pcm16", input_audio_transcription: tr, turn_detection: vad, input_audio_noise_reduction: nr, include: c.session.include }) });
        const j2 = (await r2.json().catch(() => ({}))) as { client_secret?: { value?: string }; error?: { message?: string } }, t2 = j2.client_secret?.value; if (r2.ok && t2) return { token: t2, url, beta: true, ...c, ...base };
        last = j2.error?.message || "HTTP " + r2.status;
      }
    } catch (e) { last = e instanceof Error ? e.message : String(e); }
  }
  console.error("[Cuộc họp] Realtime không dùng được:", last); throw err("realtime", 502, String(last).slice(0, 300));
}

/** Dịch văn bản dài theo từng phần ~6000 ký tự, giữ thuật ngữ. */
async function translateLong(text: string, to: Lang, gl: Gloss[] = []) {
  const parts: string[] = []; let cur = "";
  for (const s of text.split(/(?<=[.!?。？！…])\s+/)) { if (cur && cur.length + s.length > 6000) { parts.push(cur); cur = ""; } cur += (cur ? " " : "") + s; }
  if (cur) parts.push(cur);
  const ins = `Bạn là phiên dịch viên cuộc họp doanh nghiệp. Dịch toàn bộ nội dung sang ${LANGS[to].ai}, sát nghĩa, tự nhiên, đúng thuật ngữ; giữ nguyên tên riêng, mã, số liệu. Chia đoạn hợp lý. Chỉ trả về bản dịch.` + (gl.length ? ` Thuật ngữ cần giữ: ${gl.map((g) => g.text).join(", ")}.` : "");
  const out: string[] = []; for (const [i, p] of parts.entries()) out.push(await ai(ins + (parts.length > 1 ? ` Đây là phần ${i + 1}/${parts.length}, dịch liền mạch, không mở đầu hay kết thúc lại.` : ""), p, {}, 600000));
  return normText(out.join("\n\n"));
}

/** AI đọc hiểu văn bản rồi viết lại / tóm tắt thành lời đọc (tab Đọc văn bản). */
export async function deepText(text: string, summary: boolean) {
  const gl = glossary().items.map((i) => `${i.text} đọc là ${i.heard}`);
  const ins = (summary ? "Bạn là biên tập viên bản tin audio. Hãy đọc hiểu toàn bộ nội dung (văn bản, bảng Excel, ghi chú...) rồi TỔNG HỢP thành một bản tin ngắn gọn để đọc: mở đầu bằng 1 câu nêu chủ đề, sau đó các ý chính theo thứ tự quan trọng, giữ đúng các số liệu, tên, mốc thời gian quan trọng, kết bằng 1 câu tóm lại. Bỏ chi tiết lặp, phụ. Viết thành lời đọc tiếng Việt tự nhiên; số, ngày tháng, đơn vị, phần trăm viết dạng dễ nghe. Không bịa, không thêm bình luận. Không dùng markdown, gạch đầu dòng, emoji, đường dẫn. Chia đoạn ngắn. "
    : "Bạn là biên tập viên kịch bản audio. Hãy đọc hiểu toàn bộ nội dung (văn bản, bảng Excel, ghi chú...) rồi diễn đạt lại thành lời đọc tiếng Việt tự nhiên, mạch lạc, như một người đang trình bày bằng miệng. Bảng và số liệu: nêu ý chính và các số quan trọng bằng lời, không đọc từng ô; viết số, ngày tháng, đơn vị, phần trăm thành dạng dễ nghe. Giữ đúng số liệu và ý của nguồn, không bịa, không thêm bình luận. Không dùng ký hiệu markdown, gạch đầu dòng, emoji, đường dẫn. Chia đoạn ngắn, câu vừa phải. ")
    + (gl.length ? `Thuật ngữ cần giữ nguyên chữ viết: ${gl.join("; ")}. ` : "") + "Chỉ trả về nội dung lời đọc, không lời dẫn, không tiêu đề.";
  const parts: string[] = []; let cur = "";
  for (let p of text.split(/\n{2,}/)) { while (p.length > 9000) { parts.push(p.slice(0, 9000)); p = p.slice(9000); } if (cur && (cur + p).length > 9000) { parts.push(cur); cur = ""; } cur += (cur ? "\n\n" : "") + p; }
  if (cur.trim()) parts.push(cur); const out: string[] = [];
  for (const [i, c] of parts.entries()) { try { out.push(await ai(ins + (parts.length > 1 ? ` Đây là phần ${i + 1}/${parts.length} của một tài liệu dài, viết liền mạch, không mở đầu hay kết thúc lại.` : ""), c, {}, 300000)); } catch { throw err("ai_failed", 502); } }
  return normText(out.join("\n\n"));
}

/* ============ pipeline ============ */
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const FILES: Record<string, (m: Meta) => [string, string, string]> = {
  audio: () => ["audio.mp3", "audio/mpeg", "Audio.mp3"], transcript: () => ["transcript.docx", DOCX, "Transcript.docx"],
  translation: () => ["translation.docx", DOCX, "Translation.docx"],
  summary: (m) => (m.fmt === "excel" ? ["report.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Report.xlsx"] : ["summary.docx", DOCX, "Summary.docx"]),
};
const link = (m: Meta, kind = "") => `${C.pub || m.base}/m/${m.slug}${kind ? "/" + kind : ""}`;
async function notify(m: Meta, rows: [string, string][]) {
  const s = settings(); if (!s.zaloNotify || !(m.kind === "tts" ? s.zaloTts : s.zaloMeeting) || !s.conversation_id) return;
  try { await zaloSend(rows.map(([k, v]) => `${k}: ${v}`).join("\n"), `record:${m.id}:${m.slug}`); upd(m, { notify: "ok" }); }
  catch (e) { const msg = e instanceof Error ? e.message : String(e); console.error("[Cuộc họp] Zalo:", msg); upd(m, { notify: "Lỗi Zalo: " + msg }); }
}
/** useFile=false: bỏ qua file định dạng, AI viết biên bản Word theo mô tả của mẫu. */
export const applyStyle = (m: Meta, s: Style, useFile = true) => Object.assign(m, { style_id: s.id, style_name: s.name, style_prompt: s.prompt || "", fmt: useFile && s.format === "excel" ? "excel" : "word", template_structure: useFile ? s.structure || "" : "", template_file: useFile ? s.file || "" : "", use_file: useFile ? 1 : 0 } satisfies Partial<Meta>);
type Fields = Record<string, string>;
/** Cập nhật tên / chủ đề / ngôn ngữ khi người dùng chốt lúc dừng ghi hoặc xử lý lại. */
export function meetingOpts(m: Meta, f: Fields) {
  if ("title" in f || "auto_title" in f) { const t = cleanTitle(f.title); m.auto = f.auto_title === "1" || !t; if (t) m.title = t; }
  if ("topic_id" in f) { const tp = topics().topics.find((t) => t.id === safeId(f.topic_id)); Object.assign(m, { topic_id: tp?.id || "", topic_name: tp?.name || "", topic_context: tp?.context || "", topic_content: tp?.content || "", topic_main: tp?.main || "" }); }
  if ("src_lang" in f) { m.src_lang = lang(f.src_lang); m.src_hint = langs(f.src_lang).join(","); }
  if ("live_lang" in f) m.live_lang = lang(f.live_lang);
  m.glossary = glossary().items; return m;
}

/** Giai đoạn 1: ghép chunk / đổi mp3 → audio.mp3 + thời lượng (client chờ giai đoạn này). */
export async function prepare(m: Meta, auto: boolean) {
  const s = () => m.slug, audio = () => fp(s(), "audio.mp3"), parts = chunks(s()), src = fs.readdirSync(dir(s())).find((f) => f.startsWith("source."));
  let ended = m.ended || Date.now();
  if (parts.length) {
    jobSet(m, "merging"); const raw = fp(s(), "recording.webm"), out = fs.createWriteStream(raw);
    for (const f of parts) await new Promise<void>((ok, no) => { const i = fs.createReadStream(fp(s(), "chunks/" + f)); i.on("end", ok).on("error", no); i.pipe(out, { end: false }); });
    await new Promise<void>((r) => out.end(r)); jobSet(m, "encoding");
    if (auto || !m.ended) ended = Math.max(...parts.map((f) => fs.statSync(fp(s(), "chunks/" + f)).mtimeMs));
    const [c, o] = await toMp3(raw, audio()); if (c || !has(s(), "audio.mp3") || fs.statSync(audio()).size < 1024) throw err("ffmpeg_mp3", 400, o.slice(-300));
  } else if (src) { jobSet(m, "encoding"); const [c, o] = await toMp3(fp(s(), src), audio()); if (c || !has(s(), "audio.mp3")) throw err("ffmpeg_mp3", 400, o.slice(-300)); }
  else if (has(s(), "audio.mp3")) { ended = m.ended || fs.statSync(audio()).mtimeMs; }
  else throw err("no_chunks");
  const dur = await seconds(audio()), started = m.upload || auto ? ended - dur * 1000 : m.started;
  upd(m, { dur, started, ended, size: fs.statSync(audio()).size, parts: Math.max(1, Math.ceil(dur / C.seg)) });
  return m;
}
/** Giai đoạn 2: phiên âm → tóm tắt → dựng Word/Excel → lưu → Zalo (chạy nền). */
export async function processMeeting(m: Meta) {
  const s = () => m.slug, set = (p: Partial<Meta>) => upd(m, { status: "processing", error: "", ...p }), audio = fp(s(), "audio.mp3");
  set({ stage: "Phiên âm" });
  const pd = fp(s(), "parts"); fs.rmSync(pd, { recursive: true, force: true }); fs.mkdirSync(pd);
  const [c2, o2] = await ff(["-y", "-loglevel", "error", "-i", audio, "-map", "0:a:0", "-c", "copy", "-f", "segment", "-segment_time", String(C.seg), "-reset_timestamps", "1", path.join(pd, "part_%03d.mp3")]);
  const pf = fs.readdirSync(pd).sort(); if (c2 || !pf.length) throw err("ffmpeg_split", 400, o2.slice(-300));
  const gl = m.glossary || [], prompt = [`Cuộc họp doanh nghiệp${m.src_lang && isLang(m.src_lang) ? " bằng " + LANGS[m.src_lang].ai : ""}.`, m.topic_name && `Chủ đề: ${m.topic_name}.`, m.topic_context && m.topic_context.replace(/\s+/g, " ").slice(0, 400), gl.length && `Thuật ngữ thường gặp: ${gl.map((g) => g.text).join(", ")}.`].filter(Boolean).join(" ");
  const texts: string[] = [];
  for (const f of pf) { const t = dropEcho(await transcribe(path.join(pd, f), m.src_hint ?? m.src_lang, prompt), gl, prompt); if (t) texts.push(t); }
  if (!texts.length) throw err("no_transcript");
  const transcript = fixGloss(texts.join(" "), gl);
  fs.writeFileSync(fp(s(), "transcript.txt"), transcript);

  set({ stage: "Tóm tắt" });
  const tf = m.template_file && path.join(TPL, path.basename(m.template_file)), tpl = tf && fs.existsSync(tf) ? fs.readFileSync(tf) : null;
  const outline = tpl ? (m.fmt === "excel" ? xlsxText(tpl) : docxOutline(tpl)).slice(0, 14000) : "";
  const q = summaryPrompt(m, transcript, outline), raw = await ai(q.instructions, q.input, q.extra); if (!raw) throw err("ai_empty");
  const J = (): Record<string, unknown> => { try { const t = raw.replace(/```(?:json)?/gi, ""); return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); } catch { throw err(m.fmt === "excel" ? "excel_json" : "word_json"); } };
  let aiT = "", html = "", tplHtml = 0;
  if (m.fmt === "excel" && outline && tpl) { const j = J(); aiT = String(j.title || ""); const out = fillXlsx(tpl, Array.isArray(j.cells) ? j.cells : []); fs.writeFileSync(fp(s(), "report.xlsx"), out); fs.writeFileSync(fp(s(), "report.json"), JSON.stringify({ sheets: xlsxSheets(out) })); }
  else if (m.fmt === "excel") {
    const j = J(); if (!Array.isArray(j.sheets) || !j.sheets.length) throw err("excel_json"); aiT = String(j.title || "");
    fs.writeFileSync(fp(s(), "report.json"), JSON.stringify({ sheets: j.sheets })); fs.writeFileSync(fp(s(), "report.xlsx"), xlsx(j.sheets as Sheet[]));
  } else if (outline && tpl) { const j = J(); aiT = String(j.title || ""); const out = fillDocx(tpl, Array.isArray(j.edits) ? j.edits : []); fs.writeFileSync(fp(s(), "summary.docx"), out); fs.writeFileSync(fp(s(), "summary.html"), docxHtml(out)); tplHtml = 1; }
  else { html = raw; const tm = html.match(/<!--\s*TITLE\s*:\s*([\s\S]*?)-->/i); if (tm) { aiT = tm[1]; html = html.replace(tm[0], ""); } html = cleanHtml(html); if (!html.replace(/<[^>]+>/g, "").trim()) html = "<p>Chưa ghi nhận nội dung trong cuộc họp.</p>"; fs.writeFileSync(fp(s(), "summary.html"), html); }
  const started = m.started || m.created * 1000, ended = m.ended || started, dur = m.dur || 0;
  const title = m.auto && cleanTitle(aiT, 80) ? cleanTitle(aiT, 80) : m.title, lines = [`Ngày họp: ${fmtT(started).slice(6)}`, `Thời gian: ${fmtT(started)} - ${fmtT(ended)}`, `Thời lượng: ${fmtDur(dur)}`];
  if (m.fmt !== "excel" && !outline) fs.writeFileSync(fp(s(), "summary.docx"), docx({ title: "Biên bản cuộc họp", sub: title, lines, html }));
  fs.writeFileSync(fp(s(), "transcript.docx"), docx({ title: "Bản gốc ghi âm", sub: title, lines, text: transcript }));
  const files: Meta["files"] = { audio: 1, transcript: 1, summary: 1 };
  if (m.live_lang && isLang(m.live_lang) && m.live_lang !== m.src_lang) {
    set({ stage: "Dịch" });
    try { const tr = await translateLong(transcript, m.live_lang, gl); fs.writeFileSync(fp(s(), "translation.txt"), tr); fs.writeFileSync(fp(s(), "translation.docx"), docx({ title: "Bản dịch · " + LANGS[m.live_lang].name, sub: title, lines, text: tr })); files.translation = 1; }
    catch (e) { console.error(`[Cuộc họp ${m.slug}] dịch:`, e instanceof Error ? e.message : e); }
  }
  for (const x of ["chunks", "parts", "live"]) fs.rmSync(fp(s(), x), { recursive: true, force: true });
  for (const f of fs.readdirSync(dir(s()))) if (f === "recording.webm" || f.startsWith("source.")) fs.rmSync(fp(s(), f), { force: true });
  if (slugBase(title) !== m.slug.replace(/-[A-Z0-9]+$/, "")) rename(m, title);
  upd(m, { status: "done", stage: "", error: "", title, tpl_html: tplHtml, files });
  await notify(m, [["Tên cuộc họp", title], ["Thời gian diễn ra", `${fmtT(started)} - ${fmtT(ended)} (${fmtDur(dur)})`], ["Bản gốc", link(m, "transcript")], ["Biên bản", link(m, "summary")], ...(files.translation ? [["Bản dịch", link(m, "translation")] as [string, string]] : []), ["Lưu trữ", link(m)]]);
}
export const fail = (m: Meta, e: unknown) => {
  const x = e as Partial<HsErr>, msg = e instanceof Error ? e.message : String(e);
  console.error(`[Cuộc họp ${m.slug}]`, msg, x.detail || ""); upd(m, { status: "error", stage: "", error: x.stage || msg.slice(0, 200), detail: String(x.detail || msg).slice(0, 400) });
};
/** finalize: client theo dõi qua action=job; hết giai đoạn 1 → job done, AI chạy tiếp nền. */
export async function finalize(m: Meta, auto: boolean) {
  const run = st().run; if (run.has(m.id)) return; run.add(m.id);
  try {
    jobSet(m, "queued", { error: "", detail: "" }); upd(m, { status: "processing", stage: "Xử lý âm thanh", error: "" }); await prepare(m, auto);
    jobSet(m, "sending"); jobSet(m, "done", { parts: m.parts });
  } catch (e) { const x = e as Partial<HsErr>; jobSet(m, "error", { error: x.stage || (e instanceof Error ? e.message : String(e)), detail: x.detail || "" }); fail(m, e); run.delete(m.id); return; }
  try { await processMeeting(m); } catch (e) { fail(m, e); } finally { run.delete(m.id); }
}

/* ============ Đọc văn bản → audio ============ */
function ttsChunks(text: string, MAX = 1500) {
  const units: string[] = [];
  for (const para of text.split(/\n+/)) {
    if (!para.trim()) continue;
    for (let s of para.trim().split(/(?<=[.!?…])\s+/)) {
      s = s.trim();
      while (s.length > MAX) { let cut = Math.max(s.lastIndexOf(", ", MAX), s.lastIndexOf("; ", MAX), s.lastIndexOf(" ", MAX)); if (cut < MAX * 0.5) cut = MAX; units.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1).trim(); }
      if (s) units.push(s);
    }
    units.push("\n");
  }
  const out: string[] = []; let cur = "";
  for (const u of units) { if (u === "\n") { if (cur && !cur.endsWith("\n")) cur += "\n"; continue; } if (cur && cur.length + u.length + 1 > MAX) { out.push(cur.trim()); cur = ""; } cur += (cur && !cur.endsWith("\n") ? " " : "") + u; }
  if (cur.trim()) out.push(cur.trim()); return out;
}
const stripId3 = (b: Buffer) => { let s = 0, e = b.length; if (b.length > 10 && b.toString("latin1", 0, 3) === "ID3") s = 10 + (((b[6] & 127) << 21) | ((b[7] & 127) << 14) | ((b[8] & 127) << 7) | (b[9] & 127)) + (b[5] & 16 ? 10 : 0); if (e - s > 128 && b.toString("latin1", e - 128, e - 125) === "TAG") e -= 128; return b.subarray(s, e); };
export async function runTts(m: Meta) {
  const run = st().run; run.add(m.id);
  try {
    const text = fs.readFileSync(fp(m.slug, "text.txt"), "utf8"); upd(m, { stage: "Tạo giọng đọc" });
    const title = m.auto ? await aiTitle(m.plain || text) : m.title, ins = ["Ngôn ngữ: tiếng Việt. Đọc đúng nguyên văn, không thêm, bớt hay thay đổi từ nào.", "Giữ giọng đọc, tốc độ và cảm xúc nhất quán từ đầu đến cuối.", m.style_prompt && "Phong cách đọc: " + m.style_prompt.trim()].filter(Boolean).join("\n");
    const bufs: Buffer[] = [];
    for (const input of ttsChunks(text)) {
      const b = Buffer.from(await (await openai("/audio/speech", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: C.tts, voice: m.voice, input, instructions: ins, speed: m.speed, response_format: "mp3" }) })).arrayBuffer());
      if (b.length < 256) throw err("tts_empty"); bufs.push(stripId3(b));
    }
    fs.writeFileSync(fp(m.slug, "audio.mp3"), Buffer.concat(bufs)); const dur = await seconds(fp(m.slug, "audio.mp3"));
    if (title !== m.title) rename(m, title);
    upd(m, { status: "done", stage: "", error: "", title, dur, size: fs.statSync(fp(m.slug, "audio.mp3")).size, files: { audio: 1 } });
    await notify(m, [["Tên nội dung", title], ["Giọng đọc", m.voice_label || ""], ["Phong cách", m.style_name || "Mặc định"], ["Tốc độ", m.speed + "x"], ["Độ dài văn bản", (m.char_count || 0).toLocaleString("vi-VN") + " ký tự"], ["Audio", link(m, "audio")]]);
  } catch (e) { fail(m, e); } finally { run.delete(m.id); }
}

/* ============ tạo bản ghi ============ */
export function newSession(base: string, by: string, f: Fields) {
  const auto = f.auto_title === "1"; let title = cleanTitle(f.title); if (!title) title = auto ? "Cuộc họp" : "";
  const cfg = styles(false), sx = cfg.styles.find((x) => x.id === (safeId(f.style_id) || cfg.default_style_id)), tp = topics().topics.find((t) => t.id === safeId(f.topic_id));
  if (!title || !sx) throw err("bad_request", 422);
  const slug = slugify(title), now = Date.now(); fs.mkdirSync(fp(slug, "chunks"), { recursive: true });
  const m: Meta = { id: nextId(), sid: crypto.randomBytes(12).toString("hex"), slug, kind: "meeting", title, auto, status: "recording", created: now / 1000, started: now, base, by, files: {},
    topic_id: tp?.id || "", topic_name: tp?.name || "", topic_context: tp?.context || "", topic_content: tp?.content || "", topic_main: tp?.main || "", glossary: glossary().items,
    src_lang: "src_lang" in f ? lang(f.src_lang) : "vi", src_hint: "src_lang" in f ? langs(f.src_lang).join(",") : "vi", live_lang: lang(f.live_lang) };
  return save(applyStyle(m, sx, f.use_file !== "0"));
}
