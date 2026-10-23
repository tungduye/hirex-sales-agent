import "server-only";

// Lưu trữ của Cuộc họp: mỗi cuộc họp / audio = 1 thư mục <DATA>/m/<slug>/ (meta.json + audio, tài liệu).
// Cấu hình (giọng đọc, Zalo) nằm ở <DATA>/cfg. Ngữ cảnh cuộc họp (thành viên, thuật ngữ…) lấy tự động từ dữ liệu HireX: context.ts.
// <DATA> = HS_RECORD_DIR hoặc runtime/hs-record (đã gitignore, không vào bản build, giữ nguyên qua mỗi lần deploy).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const LANGS = { vi: { name: "Tiếng Việt", ai: "tiếng Việt" }, en: { name: "English", ai: "tiếng Anh (English)" }, ja: { name: "日本語", ai: "tiếng Nhật (日本語)" } } as const;
export type Lang = keyof typeof LANGS;
export const isLang = (v: string): v is Lang => v in LANGS;
/** "vi,en" → "vi" (ngôn ngữ chính), không hợp lệ → "". */
export const lang = (v: unknown): Lang | "" => { const x = String(v || "").split(",")[0]; return isLang(x) ? x : ""; };
/** Danh sách ngôn ngữ gợi ý "vi,en" → ['vi','en'] (rỗng = tự nhận). */
export const langs = (v: unknown): Lang[] => [...new Set(String(v || "").split(",").map((x) => x.trim()).filter(isLang))];

const E = (k: string, d = "") => process.env[k] || d;
export const C = {
  data: path.resolve(E("HS_RECORD_DIR", path.join(/*turbopackIgnore: true*/ process.cwd(), "runtime", "hs-record"))),
  pub: (E("HS_RECORD_PUBLIC_URL") || E("APP_BASE_URL")).replace(/\/+$/, ""),
  get ffmpeg() { return ffmpegPath(); },
  // key riêng của các dự án moduleHS (HS_OPENAI_API_KEY) để theo dõi token tách khỏi Soda; chưa đặt thì dùng key chung
  get key() { return (process.env.HS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim(); },
  text: E("HS_RECORD_TEXT_MODEL", "gpt-5.6-luna"), minutes: E("HS_RECORD_MINUTES_MODEL", "gpt-5.6-sol"), stt: E("HS_RECORD_TRANSCRIBE_MODEL", "gpt-transcribe"), tts: E("HS_RECORD_TTS_MODEL", "gpt-4o-mini-tts"),
  seg: Math.max(300, +E("TRANSCRIBE_SEGMENT_SECONDS", "1800")), br: E("AUDIO_BITRATE", "24k"), slice: Math.max(5000, +E("RECORD_SLICE_MS", "5000")),
  ttsMax: Math.max(500, +E("TTS_MAX_CHARS", "60000")), cmin: +E("CODE_MIN", "3"), cmax: +E("CODE_MAX", "6"), maxMB: +E("MAX_UPLOAD_MB", "512"),
  keep: Math.max(1, +E("PENDING_RETENTION_HOURS", "168")), liveMs: Math.min(15000, Math.max(2000, +E("LIVE_SEGMENT_MS", "3000"))),
};
/** FFmpeg: FFMPEG_PATH, rồi bản cài bằng winget / choco / runtime\ffmpeg (tìm thấy là dùng ngay, không cần khởi động lại web), cuối cùng "ffmpeg" trong PATH. */
function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const la = process.env.LOCALAPPDATA || "";
  for (const p of [la && path.join(la, "Microsoft", "WinGet", "Links", "ffmpeg.exe"), "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe", path.join(process.cwd(), "runtime", "ffmpeg", "ffmpeg.exe")]) if (p && fs.existsSync(/*turbopackIgnore: true*/ p)) return p;   // đường dẫn lúc chạy: không cho Turbopack quét cả dự án
  return "ffmpeg";
}
const M = path.join(C.data, "m"), CF = path.join(C.data, "cfg");

/* ============ tiện ích ============ */
export type HsErr = Error & { status: number; stage: string; detail?: string };
export const err = (stage: string, status = 400, detail?: string): HsErr => Object.assign(new Error(stage), { status, stage, ...(detail ? { detail } : {}) });
export const ascii = (s: string) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
export const cleanTitle = (v: unknown, max = 120) => String(v ?? "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, max);
export const safeId = (v: unknown) => String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100);
const pad = (n: number) => String(n).padStart(2, "0");
/** Giờ Việt Nam (máy chủ có thể chạy múi giờ khác). */
const vn = (ts: number) => new Date(ts + 7 * 3600e3);
export const fmtT = (ts: number) => { const d = vn(ts); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
export const fmtDur = (s: number) => `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`;
export const esc = (s: string) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CODE_CH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = () => Array.from({ length: crypto.randomInt(Math.min(C.cmin, C.cmax), Math.max(C.cmin, C.cmax) + 1) }, () => CODE_CH[crypto.randomInt(CODE_CH.length)]).join("");
/** "Tên cuộc họp" + "-" + 3–6 ký tự ngẫu nhiên viết hoa, vd Hop-giao-ban-tuan-K7QX */
export const slugBase = (t: string) => ascii(t).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "Cuoc-hop";
export const slugify = (t: string) => { const base = slugBase(t); let s; do s = `${base}-${code()}`; while (st().meta.has(s)); return s; };
export const rj = <T>(f: string, fb: T): T => { try { const x = JSON.parse(fs.readFileSync(f, "utf8")); return x && typeof x === "object" ? x : fb; } catch { return fb; } };
export const wj = (f: string, o: unknown) => { const t = f + ".tmp"; fs.writeFileSync(t, JSON.stringify(o, null, 2)); fs.renameSync(t, f); };

/* ============ bản ghi ============ */
export interface Job { stage?: string; ts?: number; error?: string; detail?: string; parts?: number }
export type FileKind = "audio" | "transcript" | "translation" | "summary";
export interface Meta {
  id: number; sid: string; slug: string; kind: "meeting" | "tts"; title: string; auto: boolean; status: string; created: number; base: string; files: Partial<Record<FileKind, 1>>;
  started?: number; ended?: number; dur?: number; size?: number; parts?: number; upload?: number; stage?: string; error?: string; detail?: string; job?: Job; notify?: string; tpl_html?: number;
  live_lang?: string; live_prompt?: string; ws?: string; v2?: number; doc_id?: number;
  /** bản ghi cũ (trước khi bỏ Mẫu / Chủ đề / Từ vựng): chỉ còn để hiển thị lại */
  topic_name?: string; style_id?: string; style_name?: string; style_prompt?: string; fmt?: "word" | "excel"; template_file?: string;
  voice?: string; voice_label?: string; speed?: number; char_count?: number; plain?: string; by?: string; up?: string;
}
interface State { meta: Map<string, Meta>; run: Set<number>; id: number; mt: Map<string, number> }
const G = globalThis as typeof globalThis & { __hsRecord?: State };
/** Bộ nhớ đệm của tiến trình (route handler, HMR). Thư mục trên đĩa là nguồn chung: bản thật (cổng 3000) và bản xem trước
 *  (cổng 3005) cùng đọc/ghi runtime/hs-record, nên mỗi request gọi refresh() để thấy bản ghi tiến trình kia vừa tạo / sửa. */
export function st(): State {
  if (G.__hsRecord) return G.__hsRecord;
  const s: State = { meta: new Map(), run: new Set(), id: Date.now(), mt: new Map() };
  G.__hsRecord = s;
  for (const d of [M, CF]) fs.mkdirSync(d, { recursive: true });
  refresh();
  return s;
}
const STUCK_MS = 3 * 3600e3;
/** Đồng bộ bộ nhớ với đĩa: nạp meta.json mới/đổi, bỏ bản ghi đã xoá. Bản đang ghi/xử lý mà quá 3 giờ không đổi
 *  (tiến trình xử lý đã tắt giữa chừng) thì về "chờ tạo" (audio đọc văn bản thì báo lỗi để tạo lại). */
export function refresh() {
  const s = st(), seen = new Set<string>(), now = Date.now();
  for (const slug of fs.readdirSync(M)) {
    const f = fp(slug, "meta.json"); let t: number; try { t = fs.statSync(f).mtimeMs; } catch { continue; }
    seen.add(slug);
    const cur = s.meta.get(slug); if (cur && s.run.has(cur.id)) continue; // tiến trình này đang xử lý: giữ bản trong bộ nhớ
    if (s.mt.get(slug) !== t) { const m = rj<Meta | null>(f, null); if (!m) continue; s.mt.set(slug, t); s.id = Math.max(s.id, m.id || 0); s.meta.set(slug, m); }
    const m = s.meta.get(slug)!;
    if ((m.status === "recording" || m.status === "processing") && now - t > STUCK_MS && now - dirAge(slug) > STUCK_MS) upd(m, { status: m.kind === "tts" ? "error" : "pending", error: m.kind === "tts" ? "Bị ngắt, hãy tạo lại" : "", stage: "" });
  }
  for (const slug of [...s.meta.keys()]) if (!seen.has(slug) && !s.run.has(s.meta.get(slug)!.id)) { s.meta.delete(slug); s.mt.delete(slug); }
}
const dirAge = (slug: string) => { try { return fs.statSync(dir(slug)).mtimeMs; } catch { return 0; } };
export const nextId = () => ++st().id;
export const dir = (s: string) => path.join(M, s);
export const fp = (s: string, f: string) => path.join(M, s, f);
export const save = (m: Meta) => { const f = fp(m.slug, "meta.json"), t = f + ".tmp"; fs.writeFileSync(t, JSON.stringify(m)); fs.renameSync(t, f); const s = st(); s.meta.set(m.slug, m); try { s.mt.set(m.slug, fs.statSync(f).mtimeMs); } catch { /* vừa bị xoá */ } return m; };
export const upd = (m: Meta, p: Partial<Meta>) => save(Object.assign(m, p));
export const bySid = (sid: string) => (sid ? [...st().meta.values()].find((m) => m.sid === sid) : undefined);
export const need = (sid: unknown) => { const m = bySid(safeId(sid)); if (!m) throw err("no_chunks", 404); return m; };
export const chunks = (s: string) => { try { return fs.readdirSync(fp(s, "chunks")).filter((f) => f.endsWith(".part")).sort(); } catch { return []; } };
export const has = (s: string, f: string) => fs.existsSync(fp(s, f));
export const jobSet = (m: Meta, stage: string, x: Partial<Job> = {}) => upd(m, { job: { ...m.job, stage, ts: Date.now() / 1000, ...x } });
/** Bản ghi chưa xong quá PENDING_RETENTION_HOURS thì tự dọn. */
export const prune = () => {
  const lim = Date.now() - C.keep * 3600e3, s = st();
  for (const m of [...s.meta.values()]) if (m.status !== "done" && !s.run.has(m.id) && m.created * 1000 < lim && dirAge(m.slug) < lim) { fs.rmSync(dir(m.slug), { recursive: true, force: true }); s.meta.delete(m.slug); }
};
export function rename(m: Meta, title: string) { const old = m.slug, slug = slugify(title); fs.renameSync(dir(old), dir(slug)); st().meta.delete(old); m.slug = slug; m.title = title; }

/* ============ cấu hình: giọng đọc (Đọc văn bản), Zalo ============ */
export interface Style { id: string; name: string; description?: string; builtin?: boolean; prompt?: string; prefix?: string; suffix?: string }
export interface Styles { version: number; default_style_id: string; styles: Style[] }
const F = { voice: path.join(CF, "voice-styles.json"), settings: path.join(C.data, "settings.json") };
const SEED_VOICE: Styles = { version: 1, default_style_id: "natural", styles: [{ id: "natural", name: "Tự nhiên", description: "Đọc rõ ràng, tốc độ vừa phải.", builtin: true, prompt: "Đọc tự nhiên, rõ ràng, tốc độ vừa phải như người Việt đang nói chuyện bình thường. Ngắt nghỉ đúng dấu câu.", prefix: "", suffix: "" }, { id: "news_mc", name: "Tin tức / MC", description: "Trang trọng, điềm tĩnh, nhịp đều.", builtin: true, prompt: "Giọng MC thời sự: trang trọng, rõ chữ, nhịp đều, điềm tĩnh. Nhấn nhẹ vào số liệu và tên riêng.", prefix: "", suffix: "" }, { id: "storyteller", name: "Kể chuyện", description: "Truyền cảm, chậm rãi, có cao trào.", builtin: true, prompt: "Giọng kể chuyện truyền cảm, chậm rãi. Thay đổi ngữ điệu theo cảm xúc của câu chuyện, ngắt nghỉ có chủ đích ở đoạn cao trào.", prefix: "", suffix: "" }, { id: "podcast", name: "Podcast thân mật", description: "Gần gũi, ấm áp như đang tâm sự.", builtin: true, prompt: "Giọng podcast gần gũi, ấm áp, thoải mái như đang tâm sự với một người bạn. Nhịp nói tự nhiên, thỉnh thoảng nhấn nhá.", prefix: "", suffix: "" }, { id: "ads", name: "Quảng cáo sôi nổi", description: "Năng lượng cao, nhiệt tình.", builtin: true, prompt: "Giọng quảng cáo năng lượng cao, nhiệt tình, nhanh vừa phải. Nhấn mạnh lợi ích sản phẩm, kết thúc dứt khoát.", prefix: "", suffix: "" }, { id: "streamer", name: "Streamer hài hước", description: "Tếu táo, trêu đùa, mở đầu bằng lời chào riêng.", builtin: false, prompt: "Giọng streamer/TikToker Việt Nam: năng lượng cao, tếu táo, trêu đùa thân mật với khán giả, nói nhanh, lên xuống giọng mạnh, thỉnh thoảng bật cười. Dùng khẩu ngữ đời thường.", prefix: "Hello các con vợ!", suffix: "" }] };
export const voiceStyles = (): Styles => { st(); const x = rj<Styles | null>(F.voice, null); return x && Array.isArray(x.styles) ? x : structuredClone(SEED_VOICE); };
export const saveVoiceStyles = (c: Styles) => wj(F.voice, c);
const vl = (s: string) => { const [id, label] = s.split("|"); return { id, label }; };
export const VOICES = {
  male: ["onyx|Onyx · trầm", "echo|Echo · mượt", "ash|Ash · nhẹ nhàng", "ballad|Ballad · biểu cảm", "verse|Verse · linh hoạt", "cedar|Cedar · ấm", "fable|Fable · kể chuyện"].map(vl),
  female: ["nova|Nova · tươi sáng", "shimmer|Shimmer · trong", "coral|Coral · thân thiện", "sage|Sage · điềm tĩnh", "marin|Marin · tự nhiên", "alloy|Alloy · trung tính"].map(vl),
};

/** Thông báo Zalo: gửi bằng một nick Zalo của HireX vào một nhóm Zalo (chọn trong Cài đặt › Zalo). */
export interface Settings { zaloNotify: boolean; zaloMeeting: boolean; zaloTts: boolean; workspace_id: string; account_id: string; account_name: string; conversation_id: string; group_name: string; by: string }
export const settings = (): Settings => ({ zaloNotify: false, zaloMeeting: true, zaloTts: true, workspace_id: "", account_id: "", account_name: "", conversation_id: "", group_name: "", by: "", ...rj<Partial<Settings>>(F.settings, {}) });
export const saveSettings = (s: Settings) => { st(); wj(F.settings, s); };
