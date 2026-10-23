import "server-only";

// Xử lý của Cuộc họp: FFmpeg (ghép / nén / cắt audio) → OpenAI (phiên âm, biên bản, dịch, giọng đọc, phụ đề trực tiếp) → Word/Excel → Zalo.
// Gọi Responses API qua src/lib/openai/responses.ts (key OPENAI_API_KEY của HireX); audio/realtime gọi thẳng api.openai.com.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { postOpenAIResponse, responseOutputText } from "@/lib/openai/responses";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { forgetHirexDocuments, saveHirexDocument } from "@/modules/human-documents/server/hirex-documents";
import { normText } from "./office";
import { cleanMinutes, hasMinutes, minutesDocx, minutesHtml, minutesText, textDocx, type Minutes, type MinutesHead } from "./minutes";
import { contextTerms, contextText, meetContext, sttPrompt, type MeetContext } from "./context";
import { fixText, getLex, topHits, KIND_VI, type Lex } from "./lexicon";
import {
  C, LANGS, err, cleanTitle, fmtT, fmtDur, slugBase, slugify, lang, isLang, st, nextId, dir, fp, save, upd, chunks, has, jobSet, rename, settings, type HsErr, type Lang, type Meta,
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
  for (const md of [...new Set([model, C.text])]) {
    const r = await postOpenAIResponse({ apiKey: C.key, timeoutMs: ms, body: { model: md, instructions, input, ...extra } });
    if (r.ok) return responseOutputText(await r.json()).trim();
    const t = (await r.text()).slice(0, 300);
    if (md !== C.text && (r.status === 404 || /model_not_found|does not exist|invalid model/i.test(t))) { console.warn(`[Cuộc họp] model ${md} không dùng được, chuyển ${C.text}`); continue; }
    throw err("openai", 502, `OpenAI ${r.status}: ${t}`);
  }
  throw err("openai", 502, "no_model");
}
export const aiTitle = async (text: string) => {
  const fb = cleanTitle(text.replace(/\s+/g, " ").slice(0, 40)) || "Audio";
  try { return cleanTitle(await ai("Đặt tên file ngắn gọn bằng tiếng Việt (3 đến 8 từ) cho nội dung người dùng gửi. Chỉ trả về đúng tên, không dấu ngoặc kép, không đuôi file, không ký tự đặc biệt.", text.slice(0, 6000)), 80) || fb; } catch { return fb; }
};

/* ============ phiên âm ============ */
/** gpt-transcribe tự nhận ngôn ngữ (Việt / Anh / Nhật, đổi qua lại giữa câu); prompt = ngữ cảnh HireX + tên người + thuật ngữ. */
export async function transcribe(file: string, prompt: string, type = "audio/mpeg", model = C.stt) {
  const fd = new FormData(); fd.append("file", new Blob([new Uint8Array(await fsp.readFile(file))], { type }), path.basename(file));
  fd.append("model", model); fd.append("response_format", "json"); if (prompt) fd.append("prompt", prompt.slice(0, 1000));
  return String(((await (await openai("/audio/transcriptions", { body: fd })).json()) as { text?: string }).text || "").replace(/\s+/g, " ").trim();
}

/* ============ phụ đề / dịch trực tiếp ============ */
/** Dịch nhanh miễn phí qua Google Dịch (endpoint công khai của Google Translate, không cần key). Lỗi → ném lỗi để nơi gọi tự chuyển sang OpenAI. */
export async function gTranslate(text: string, to: string): Promise<string> {
  const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text.slice(0, 4500))}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error("google_translate " + r.status);
  const j = (await r.json()) as unknown[];
  return (Array.isArray(j?.[0]) ? (j[0] as unknown[][]).map((x) => (Array.isArray(x) ? String(x[0] ?? "") : "")).join("") : "").replace(/\s+/g, " ").trim();
}
const LIVE_JUNK = /^\s*(thuật ngữ|用語|term(s)?|terminology|người tham gia|cuộc họp nội bộ)\s*[:：]/i;
/** Model phiên âm hay "đọc lại" prompt / thuật ngữ khi im lặng hoặc nhiễu (vd "BrSE, Trang"). Câu chỉ gồm từ trong danh sách thuật ngữ, hoặc nằm sẵn trong prompt → coi là rác. */
const NORM = (t: string) => String(t || "").toLowerCase().normalize("NFC").replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
export function isEcho(text: string, terms: string[] = [], prompt = "") {
  const t = NORM(text); if (!t) return true; if (LIVE_JUNK.test(text)) return true;
  const set = new Set(terms.flatMap((g) => NORM(g).split(" ")).filter(Boolean));
  if (set.size && t.split(" ").every((w) => set.has(w))) return true;
  const p = NORM(prompt); return t.length >= 4 && p.includes(t);
}
/** Bỏ ký tự thuộc hệ chữ không có trong ngôn ngữ đang nói (model đôi khi lẫn Hangul/Thái vào tiếng Việt); dòng không còn chữ thì bỏ. */
/** Chỉ giữ chữ Latin (Việt / Anh) và Hán / Kana (Nhật): người nói đổi qua lại 3 thứ tiếng này. */
export function scriptClean(text: string) {
  if (!text) return text;
  const ok = /[\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const out = text.replace(/\p{L}/gu, (ch) => (ok.test(ch) ? ch : "")).replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  return /\p{L}{2,}/u.test(out) ? out : "";
}
export const dropEcho = (text: string, terms: string[] = [], prompt = "") => String(text || "").split(/(?<=[.!?。！？])\s+/).filter((x) => !isEcho(x, terms, prompt)).join(" ").trim();

/** Dịch văn bản dài theo từng phần ~6000 ký tự, giữ thuật ngữ. */
async function translateLong(text: string, to: Lang, terms: string[] = []) {
  const parts: string[] = []; let cur = "";
  for (const s of text.split(/(?<=[.!?。？！…])\s+/)) { if (cur && cur.length + s.length > 6000) { parts.push(cur); cur = ""; } cur += (cur ? " " : "") + s; }
  if (cur) parts.push(cur);
  const ins = `Bạn là phiên dịch viên cuộc họp doanh nghiệp. Dịch toàn bộ nội dung sang ${LANGS[to].ai}, sát nghĩa, tự nhiên, đúng thuật ngữ; giữ nguyên tên riêng, mã, số liệu. Chia đoạn hợp lý. Chỉ trả về bản dịch.` + (terms.length ? ` Thuật ngữ, tên riêng cần giữ: ${terms.slice(0, 60).join(", ")}.` : "");
  const out: string[] = []; for (const [i, p] of parts.entries()) out.push(await ai(ins + (parts.length > 1 ? ` Đây là phần ${i + 1}/${parts.length}, dịch liền mạch, không mở đầu hay kết thúc lại.` : ""), p, {}, 600000));
  return normText(out.join("\n\n"));
}

/** AI đọc hiểu văn bản rồi viết lại / tóm tắt thành lời đọc (tab Đọc văn bản). */
export async function deepText(text: string, summary: boolean) {
  const ins = (summary ? "Bạn là biên tập viên bản tin audio. Hãy đọc hiểu toàn bộ nội dung (văn bản, bảng Excel, ghi chú...) rồi TỔNG HỢP thành một bản tin ngắn gọn để đọc: mở đầu bằng 1 câu nêu chủ đề, sau đó các ý chính theo thứ tự quan trọng, giữ đúng các số liệu, tên, mốc thời gian quan trọng, kết bằng 1 câu tóm lại. Bỏ chi tiết lặp, phụ. Viết thành lời đọc tiếng Việt tự nhiên; số, ngày tháng, đơn vị, phần trăm viết dạng dễ nghe. Không bịa, không thêm bình luận. Không dùng markdown, gạch đầu dòng, emoji, đường dẫn. Chia đoạn ngắn. "
    : "Bạn là biên tập viên kịch bản audio. Hãy đọc hiểu toàn bộ nội dung (văn bản, bảng Excel, ghi chú...) rồi diễn đạt lại thành lời đọc tiếng Việt tự nhiên, mạch lạc, như một người đang trình bày bằng miệng. Bảng và số liệu: nêu ý chính và các số quan trọng bằng lời, không đọc từng ô; viết số, ngày tháng, đơn vị, phần trăm thành dạng dễ nghe. Giữ đúng số liệu và ý của nguồn, không bịa, không thêm bình luận. Không dùng ký hiệu markdown, gạch đầu dòng, emoji, đường dẫn. Chia đoạn ngắn, câu vừa phải. ")
    + "Chỉ trả về nội dung lời đọc, không lời dẫn, không tiêu đề.";
  const parts: string[] = []; let cur = "";
  for (let p of text.split(/\n{2,}/)) { while (p.length > 9000) { parts.push(p.slice(0, 9000)); p = p.slice(9000); } if (cur && (cur + p).length > 9000) { parts.push(cur); cur = ""; } cur += (cur ? "\n\n" : "") + p; }
  if (cur.trim()) parts.push(cur); const out: string[] = [];
  for (const [i, c] of parts.entries()) { try { out.push(await ai(ins + (parts.length > 1 ? ` Đây là phần ${i + 1}/${parts.length} của một tài liệu dài, viết liền mạch, không mở đầu hay kết thúc lại.` : ""), c, {}, 300000)); } catch { throw err("ai_failed", 502); } }
  return normText(out.join("\n\n"));
}

/* ============ biên bản ============ */
/** Biên bản kiểu CEO tự ghi chú, trình bày theo mẫu đã chọn (minutes.ts). Ngữ cảnh lấy tự động từ dữ liệu HireX (context.ts). */
const MINUTES_INS = [
  "Bạn là thư ký riêng của CEO, ghi biên bản cuộc họp nội bộ của Intalent. Người đọc là CEO và các thành viên: họ cần đọc lại nhanh để GIAO VIỆC và NGHIỆM THU, nên biên bản phải giống bản CEO tự ghi chú — ngắn, cụ thể, đủ chi tiết để làm theo được — và trình bày rõ ràng.",
  "",
  "CÁCH HIỂU TRANSCRIPT",
  "- Transcript là phiên âm tự động: không tách người nói, có câu đứt, lặp, nghe sai tên / thuật ngữ, có lẫn tiếng Anh / Nhật. Đọc hết toàn bộ rồi mới viết; gộp các đoạn nói đi nói lại cùng một ý.",
  "- Dùng BỐI CẢNH để sửa về đúng tên chuẩn: tên người theo danh sách thành viên (gọi tắt như \"anh Dũng\", \"Tùng\", \"Hải\", \"Toản\"), tên màn hình / chức năng HireX (Suối Nguồn, Soda, Hola, Hole, Tài nguyên, Vọng gác, Cú vọ, KIT, Human…), thuật ngữ (BrSE, AM1, AM2, CV, JD, Hạng 1–7, X1 / X2…), tên khách hàng. Ví dụ \"suối nguồn\" → Suối Nguồn, \"so đa\" → Soda, \"bờ rích\" → BrSE, \"hai rếch\" → HireX. Từ nghe sai mà không chắc thì bỏ, không đoán bừa.",
  "- Nếu có bảng THUẬT NGỮ / TÊN RIÊNG ĐÃ NHẬN RA: đó là các tên đã khớp tự động từ toàn bộ dữ liệu HireX (người, khách hàng, job, mã / hạng, địa điểm, màn hình) — luôn viết đúng tên chuẩn đó; gặp cách nghe nhầm ở cột phải thì sửa về tên chuẩn.",
  "- Nhận ra ai nói dựa vào nội dung: người chủ trì, đưa yêu cầu, chốt phương án (thường là CEO — anh Dũng); người báo cáo, giải thích, nhận việc. Chỉ ghi tên người khi transcript cho thấy rõ (có gọi tên, tự xưng, giao việc đích danh). Tuyệt đối không bịa người, số liệu, hạn chót, quyết định.",
  "- Bỏ phần không có giá trị: chào hỏi, kiểm tra mic / âm thanh, chia sẻ màn hình, câu đệm, nói lặp.",
  "",
  "CÁCH VIẾT (quan trọng nhất)",
  "- Viết NỘI DUNG, không viết lời dẫn. Cấm các câu chung chung kiểu \"Trao đổi về…\", \"Thảo luận về việc…\", \"Đã ghi nhận…\", \"Cần tiếp tục xử lý\", \"Các nội dung được thống nhất về giao diện\". Thay bằng chính điều đã nói: màn nào, nút nào, đổi gì thành gì, hoạt động ra sao, màu gì, vị trí nào, số lượng bao nhiêu, ai làm, ví dụ nào.",
  "- Mỗi ý (point) là 1 dòng ngắn kiểu ghi chú: \"Đổi tab Khác → Quan trọng\", \"Chưa trả lời = tin cá nhân chưa trả lời + tin nhóm có tag mình (nền đỏ, chữ trắng)\", \"Tùng tự thiết kế\". Dùng mũi tên \"→\" cho kết quả / đổi thành / bước tiếp theo, \"=\" cho định nghĩa. Câu không cần đầy đủ chủ vị; không dài quá 2 dòng.",
  "- Chi tiết của một ý (danh sách mục, các bước, các câu hỏi mẫu, các cột cần thêm) đưa vào \"sub\", mỗi phần tử một dòng ngắn. Khi CEO liệt kê ví dụ câu hỏi Soda phải trả lời được, danh sách cột, các bước quy trình… thì GIỮ ĐỦ từng mục. Không thêm sub chỉ để diễn giải lại ý chính.",
  "- Ghi rõ yêu cầu của CEO / người chủ trì, kể cả yêu cầu nói lướt. Quyết định đổi / bỏ: ghi \"Bỏ: …\", \"Giữ: …\", \"Đổi … → …\" (không dùng gạch ngang chữ).",
  "- Chủ đề (topics): chia theo màn hình / chức năng / việc cụ thể, theo thứ tự xuất hiện trong cuộc họp (ví dụ \"Suối Nguồn – các tab lọc tin nhắn\", \"Menu khi bấm vào avatar\", \"Soda – câu hỏi theo cơ cấu\", \"Màn Khách hàng + Job\"). Tên chủ đề ngắn, cụ thể, không đánh số. Thường 4–12 chủ đề, mỗi chủ đề 2–10 ý. Không lặp cùng một ý ở nhiều chủ đề. Cuộc họp ngắn thì ít chủ đề, không kéo dài.",
  "- In đậm bằng **…** cho tên người phụ trách, tên nút / tab mới, con số, hạn chót, quyết định chốt; không in đậm cả câu dài.",
  "- \"summary\": 2–4 câu nêu cuộc họp chốt những gì lớn nhất và việc trọng tâm tiếp theo (không liệt kê lại từng chủ đề, không dùng lời dẫn).",
  "- \"attendees\": chỉ người THỰC SỰ phát biểu trong cuộc họp (không tính người chỉ được nhắc tên), dạng tên gọi + (bộ phận / chức vụ) như \"Anh Dũng (CEO)\", \"Tùng (R&D)\", \"Hải (Rec)\"; không ghi chú khác; không chắc bộ phận thì chỉ ghi tên; không chắc người đó có mặt thì bỏ.",
  "- \"decisions\": các điều đã CHỐT (ngắn, mỗi điều 1 dòng, cụ thể).",
  "- \"tasks\": việc cần làm sau họp: task = việc cụ thể (động từ đầu câu); owner = người phụ trách theo tên chuẩn hoặc \"Chưa nêu\"; due = hạn nếu có nói (đổi \"mai\", \"thứ 5\" thành ngày cụ thể theo ngày họp), không thì \"Chưa nêu\"; note = ghi chú ngắn (phối hợp với ai, tiêu chí nghiệm thu) hoặc \"\".",
  "- \"open\": điều còn bỏ ngỏ, chưa chốt, cần hỏi lại (nếu không có thì mảng rỗng).",
  "- \"title\": tên cuộc họp ngắn gọn 3–8 từ, tiếng Việt, theo nội dung chính (ví dụ \"Họp R&D tối ưu HireX\").",
  "- Viết tiếng Việt (transcript có thể lẫn tiếng Anh / Nhật; giữ nguyên tên riêng, thuật ngữ). Không markdown nào khác ngoài **đậm**.",
].join("\n");
const STR = { type: "string" }, ARR = (items: unknown) => ({ type: "array", items });
const MINUTES_SCHEMA = { type: "object", additionalProperties: false, required: ["title", "attendees", "summary", "topics", "decisions", "tasks", "open"], properties: {
  title: STR, attendees: ARR(STR), summary: STR,
  topics: ARR({ type: "object", additionalProperties: false, required: ["title", "points"], properties: { title: STR, points: ARR({ type: "object", additionalProperties: false, required: ["text", "sub"], properties: { text: STR, sub: ARR(STR) } }) } }),
  decisions: ARR(STR), tasks: ARR({ type: "object", additionalProperties: false, required: ["task", "owner", "due", "note"], properties: { task: STR, owner: STR, due: STR, note: STR } }), open: ARR(STR),
} };
const WEEKDAY = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
/** Bảng thuật ngữ của riêng cuộc họp này (đã khớp tự động từ phụ đề + bản gốc): tên chuẩn · loại · cách hay nghe nhầm. */
function glossary(lex: Lex, hits: Map<string, number>) {
  const top = topHits(lex, hits, 80); if (!top.length) return "";
  return top.map(({ e, k }) => `- ${e.c} (${KIND_VI[e.k]}, ${k} lần)${e.a.length ? ` — hay nghe thành: ${e.a.slice(0, 4).join(", ")}` : ""}`).join("\n");
}
async function writeMinutes(m: Meta, ctx: MeetContext, transcript: string, h: MinutesHead, gloss = ""): Promise<Minutes> {
  const day = new Date((m.started || m.created * 1000) + 7 * 3600e3);
  const input = `BỐI CẢNH (dữ liệu HireX / Soda — chỉ để hiểu đúng người, màn hình, thuật ngữ; KHÔNG phải nội dung cuộc họp):\n${contextText(ctx)}\n\n`
    + (gloss ? `THUẬT NGỮ / TÊN RIÊNG ĐÃ NHẬN RA TRONG CUỘC HỌP NÀY (từ điển học từ toàn bộ dữ liệu HireX — dùng đúng tên chuẩn bên trái; transcript có thể còn sót cách nghe nhầm bên phải):\n${gloss}\n\n` : "")
    + `THÔNG TIN CUỘC HỌP: ${WEEKDAY[day.getUTCDay()]} ngày ${h.date}, ${h.time} (${h.dur}).${m.auto ? "" : ` Tên do người dùng đặt: "${m.title}".`}\n\n`
    + `TRANSCRIPT (tự động, có thể nghe sai tên / thuật ngữ, không tách người nói):\n${transcript.slice(0, 400000)}`;
  const raw = await ai(MINUTES_INS, input, { reasoning: { effort: "high" }, text: { format: { type: "json_schema", name: "bien_ban", schema: MINUTES_SCHEMA, strict: true } } }, 1500000, C.minutes);
  let j: unknown; try { j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { throw err("word_json"); }
  const x = cleanMinutes(j); if (!hasMinutes(x)) throw err("ai_empty"); return x;
}
/** Lưu biên bản vào Tài liệu (thư mục "Biên bản cuộc họp") để Soda đọc được ("gần nhất R&D họp gì"); tạo lại thì cập nhật bản cũ. */
const DOC_FOLDER = "Biên bản cuộc họp";
async function saveDoc(m: Meta, title: string, html: string, chars: number) {
  try {
    const db = createPrivilegedClient();
    let ws = m.ws || "";
    if (!ws && m.by) ws = String(((await db.from("profiles").select("workspace_id").eq("id", m.by).maybeSingle()).data as { workspace_id?: string } | null)?.workspace_id || "");
    if (!ws || !m.by) return;
    if (m.doc_id) {
      const { data } = await db.from("hirex_documents").update({ title, content_html: html, content_chars: chars, updated_at: new Date().toISOString() }).eq("id", m.doc_id).eq("workspace_id", ws).select("id");
      if (data?.length) { forgetHirexDocuments(ws); return; }
    }
    upd(m, { ws, doc_id: await saveHirexDocument({ workspaceId: ws, userId: m.by, title, folder: DOC_FOLDER, html, chars, source: "WEB" }) });
  } catch (e) { console.error(`[Cuộc họp ${m.slug}] lưu Tài liệu:`, e instanceof Error ? e.message : e); }
}

/* ============ pipeline ============ */
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const FILES: Record<string, (m: Meta) => [string, string, string]> = {
  audio: () => ["audio.mp3", "audio/mpeg", "Audio.mp3"], transcript: () => ["transcript.docx", DOCX, "Transcript.docx"],
  translation: () => ["translation.docx", DOCX, "Translation.docx"],
  summary: (m) => (m.fmt === "excel" && !m.v2 ? ["report.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Report.xlsx"] : ["summary.docx", DOCX, "Bien-ban.docx"]),
};
const link = (m: Meta, kind = "") => `${C.pub || m.base}/m/${m.slug}${kind ? "/" + kind : ""}`;
async function notify(m: Meta, rows: [string, string][]) {
  const s = settings(); if (!s.zaloNotify || !(m.kind === "tts" ? s.zaloTts : s.zaloMeeting) || !s.conversation_id) return;
  try { const r = await zaloSend(rows.map(([k, v]) => `${k}: ${v}`).join("\n"), m.title || m.slug, 30000); upd(m, { notify: r === "SENT" ? "ok" : "queued" }); }
  catch (e) { const msg = e instanceof Error ? e.message : String(e); console.error("[Cuộc họp] Zalo:", msg); upd(m, { notify: "Lỗi Zalo: " + msg }); }
}
type Fields = Record<string, string>;
/** Cập nhật tên / ngôn ngữ bản dịch khi người dùng chốt lúc dừng ghi hoặc tạo lại. */
export function meetingOpts(m: Meta, f: Fields) {
  if ("title" in f || "auto_title" in f) { const t = cleanTitle(f.title); m.auto = f.auto_title === "1" || !t; if (t) m.title = t; }
  if ("live_lang" in f) m.live_lang = lang(f.live_lang);
  return m;
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
/** Bản gốc dễ đọc: gom câu thành đoạn ~500 ký tự (phiên âm trả về một khối liền). */
const paras = (t: string) => { const out: string[] = []; let cur = ""; for (const x of t.split(/(?<=[.!?。！？])\s+/)) { cur += (cur ? " " : "") + x; if (cur.length >= 500) { out.push(cur); cur = ""; } } if (cur) out.push(cur); return out.join("\n"); };
/** Chạy fn cho từng phần tử, tối đa n việc cùng lúc, giữ thứ tự kết quả. */
async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>) {
  const out = new Array<R>(items.length); let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (k < items.length) { const i = k++; out[i] = await fn(items[i], i); } }));
  return out;
}
/** Giai đoạn 2: phiên âm (có ngữ cảnh HireX) → biên bản → Word / HTML → Tài liệu → Zalo (chạy nền). */
export async function processMeeting(m: Meta) {
  const s = () => m.slug, set = (p: Partial<Meta>) => upd(m, { status: "processing", error: "", ...p }), audio = fp(s(), "audio.mp3");
  set({ stage: "Phiên âm" });
  const ctx = await meetContext(m.ws, m.slug), terms = [...contextTerms(ctx).names, ...contextTerms(ctx).terms];
  // Từ điển học từ dữ liệu HireX: đếm thuật ngữ đã xuất hiện trong phụ đề trực tiếp của chính cuộc họp → ưu tiên trong prompt phiên âm
  const lex = await getLex(m.ws || "").catch(() => null), hits = new Map<string, number>();
  const addHits = (h: Map<string, number>) => { for (const [k, v] of h) hits.set(k, (hits.get(k) || 0) + v); };
  if (lex) { try { for (const l of fs.readFileSync(fp(s(), "live.jsonl"), "utf8").split("\n")) { if (!l) continue; try { addHits(fixText(String(JSON.parse(l).text || ""), lex).hits); } catch { /* dòng hỏng */ } } } catch { /* không bật phụ đề */ } }
  const prompt = sttPrompt(ctx, "", lex ? topHits(lex, hits, 30).map((x) => x.e.c) : []);
  let transcript = "";
  if (has(s(), "transcript.txt") && m.v2 && fs.statSync(fp(s(), "transcript.txt")).mtimeMs > fs.statSync(audio).mtimeMs) transcript = fs.readFileSync(fp(s(), "transcript.txt"), "utf8");   // tạo lại: không phiên âm lại
  if (!transcript) {
    const pd = fp(s(), "parts"); fs.rmSync(pd, { recursive: true, force: true }); fs.mkdirSync(pd);
    const [c2, o2] = await ff(["-y", "-loglevel", "error", "-i", audio, "-map", "0:a:0", "-c", "copy", "-f", "segment", "-segment_time", String(C.seg), "-reset_timestamps", "1", path.join(pd, "part_%03d.mp3")]);
    const pf = fs.readdirSync(pd).sort(); if (c2 || !pf.length) throw err("ffmpeg_split", 400, o2.slice(-300));
    const texts = (await pool(pf, 3, async (f) => dropEcho(scriptClean(await transcribe(path.join(pd, f), prompt)), terms, prompt))).filter(Boolean);
    if (!texts.length) throw err("no_transcript");
    transcript = texts.join(" ");
    // sửa tên / thuật ngữ theo từ điển (cùng thuật toán với phụ đề), từng câu
    if (lex) transcript = transcript.split(/(?<=[.!?。！？])\s+/).map((x) => { const r = fixText(x, lex); addHits(r.hits); return r.text; }).join(" ");
    fs.writeFileSync(fp(s(), "transcript.txt"), transcript);
  }

  set({ stage: "Viết biên bản" });
  const started = m.started || m.created * 1000, ended = m.ended || started, dur = m.dur || 0;
  const head = (title: string): MinutesHead => ({ title, date: fmtT(started).slice(6), time: `${fmtT(started).slice(0, 5)} – ${fmtT(ended).slice(0, 5)}`, dur: fmtDur(dur) });
  if (lex && !hits.size) for (const x of transcript.split(/(?<=[.!?。！？])\s+/)) addHits(fixText(x, lex).hits);
  const mm = await writeMinutes(m, ctx, transcript, head(m.title), lex ? glossary(lex, hits) : "");
  const title = m.auto && cleanTitle(mm.title, 80) ? cleanTitle(mm.title, 80) : m.title, h = head(title), html = minutesHtml(mm, h);
  fs.writeFileSync(fp(s(), "minutes.json"), JSON.stringify(mm));
  fs.writeFileSync(fp(s(), "summary.html"), html);
  fs.writeFileSync(fp(s(), "summary.docx"), minutesDocx(mm, h));
  fs.writeFileSync(fp(s(), "transcript.docx"), textDocx("BẢN GỐC GHI ÂM", h, paras(transcript)));
  for (const f of ["report.xlsx", "report.json"]) fs.rmSync(fp(s(), f), { force: true });
  const files: Meta["files"] = { audio: 1, transcript: 1, summary: 1 };
  if (m.live_lang && isLang(m.live_lang) && m.live_lang !== "vi") {
    set({ stage: "Dịch" });
    try { const tr = await translateLong(transcript, m.live_lang, terms); fs.writeFileSync(fp(s(), "translation.txt"), tr); fs.writeFileSync(fp(s(), "translation.docx"), textDocx("BẢN DỊCH · " + LANGS[m.live_lang].name.toLocaleUpperCase("vi-VN"), h, tr)); files.translation = 1; }
    catch (e) { console.error(`[Cuộc họp ${m.slug}] dịch:`, e instanceof Error ? e.message : e); }
  }
  for (const x of ["chunks", "parts", "live"]) fs.rmSync(fp(s(), x), { recursive: true, force: true });
  for (const f of fs.readdirSync(dir(s()))) if (f === "recording.webm" || f.startsWith("source.")) fs.rmSync(fp(s(), f), { force: true });
  if (slugBase(title) !== m.slug.replace(/-[A-Z0-9]+$/, "")) rename(m, title);
  upd(m, { status: "done", stage: "", error: "", title, tpl_html: 0, fmt: "word", v2: 1, files });
  await saveDoc(m, `${h.date} · ${title}`, html, minutesText(mm, h).length);
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
export function newSession(base: string, by: string, ws: string, f: Fields) {
  const auto = f.auto_title === "1"; let title = cleanTitle(f.title); if (!title) title = auto ? "Cuộc họp" : "";
  if (!title) throw err("bad_request", 422);
  const slug = slugify(title), now = Date.now(); fs.mkdirSync(fp(slug, "chunks"), { recursive: true });
  const m: Meta = { id: nextId(), sid: crypto.randomBytes(12).toString("hex"), slug, kind: "meeting", title, auto, status: "recording", created: now / 1000, started: now, base, by, ws, files: {}, fmt: "word", v2: 1, live_lang: lang(f.live_lang) };
  return save(m);
}
