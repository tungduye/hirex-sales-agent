// Hàm chuỗi / ngày / định dạng thuần (không DOM, không React) — port từ phần JS của v7.py.
import type { Attachment, FieldValue } from "../types.ts";

export const COLL = new Intl.Collator("vi", { numeric: true });

/** bỏ dấu + thường hoá, nhớ kết quả cho chuỗi ngắn (dùng cho tìm kiếm). */
const FOLDM = new Map<string, string>();
export function fold(x: unknown): string {
  const s = String(x ?? ""), sh = s.length < 48;
  if (sh) { const c = FOLDM.get(s); if (c !== undefined) return c; }
  let r = s.toLowerCase();
  if (/[^\x00-\x7f]/.test(r)) r = r.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
  if (sh) { if (FOLDM.size > 200000) FOLDM.clear(); FOLDM.set(s, r); }
  return r;
}
/** chỉ a-z0-9 không dấu (so khớp tên trường/tab) */
export const nz = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]/g, "");

/** màu trạng thái → nhóm: g (xanh/ok) · w (vàng/cảnh báo) · b (đỏ/die) · n (xám) */
export type Hue = "g" | "w" | "b" | "n";
export function hcls(c: string | null | undefined): Hue {
  const m = /^#?([0-9a-f]{6})$/i.exec(c || ""); if (!m) return "w";
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 24) return "n";
  let h: number; if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60;
  return h >= 75 && h <= 175 ? "g" : h <= 20 || h >= 335 ? "b" : "w";
}
export const HC: Record<Hue, string> = { g: "#10b981", w: "#f59e0b", b: "#ef4444", n: "#d4d4d8" };
export const GREY = "#a1a1aa";
export const PAL = ["#10b981", "#ef4444", "#f59e0b", "#8b5cf6", "#0ea5e9", "#ec4899", "#64748b", "#14b8a6"];
export const TAB_NEUTRAL = "#667085";

/* ───── ngày (DP) ───── */
const P2 = (n: number) => String(n).padStart(2, "0");
export const DP = {
  ymd: (d: Date) => `${d.getFullYear()}-${P2(d.getMonth() + 1)}-${P2(d.getDate())}`,
  pd: (s: string | null | undefined): Date | null => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; },
  today: () => DP.ymd(new Date()),
  /** yyyy-mm-dd → dd/mm/yyyy */
  fmt: (s: string | null | undefined) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; },
  /** chuỗi bất kỳ → yyyy-mm-dd (nhận yyyy-m-d, d/m/yyyy, d.m.yyyy, d-m-yyyy) hoặc null */
  parse: (v: unknown): string | null => {
    const s = String(v ?? "").trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return `${m[1]}-${P2(+m[2])}-${P2(+m[3])}`;
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s); if (m) return `${m[3]}-${P2(+m[2])}-${P2(+m[1])}`;
    return null;
  },
  num: (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5,
  day: (n: number) => new Date(Math.round(n) * 864e5).toISOString().slice(0, 10),
};
export const parseDay = DP.parse;
export const tsDay = (ts: number) => DP.ymd(new Date(ts * 1000));
/** giá trị ngày của trường → dd/mm/yyyy, chuỗi khác giữ nguyên */
export const fmtD = (v: unknown) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(v ?? "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v ?? ""); };
export const fmtFull = (ts: number) => new Date(ts * 1000).toLocaleString("vi-VN");
export function rel(ts: number) {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "vừa xong"; if (s < 3600) return Math.floor(s / 60) + "p"; if (s < 86400) return Math.floor(s / 3600) + "g"; return Math.floor(s / 86400) + "n";
}
export const initials = (s: unknown) => (String(s).trim().split(/\s+/).slice(-2).map((w) => w[0] || "").join("") || "?").toUpperCase();
export function linkHref(v: unknown) { const u = String(v).trim(); return /^https?:\/\//i.test(u) ? u : /^[a-z][a-z0-9+.-]*:/i.test(u) ? "#" : "https://" + u; }
export const sepCh = (s: string) => (s === "\\t" || /^tab$/i.test(s) ? "\t" : s);
export const indent = (n: number, s: string) => (n ? "  ".repeat(n) + "└ " : "") + s;
export const EMP = "∅";

/* ───── đính kèm ───── */
export function attStr(v: FieldValue | undefined): string {
  if (v && typeof v === "object" && !Array.isArray(v)) return "";
  return Array.isArray(v) ? v.map((x) => (x && x.n) || "").filter(Boolean).join(", ") : String(v ?? "");
}
export const attExt = (n: string) => { const m = /\.([a-z0-9]{1,8})$/i.exec(n || ""); return m ? m[1].toLowerCase() : ""; };
const ATT_K: Record<string, string> = { img: "png jpg jpeg gif webp bmp svg ico avif", docx: "docx", xlsx: "xlsx xlsm csv tsv", pdf: "pdf", text: "txt log json md xml ini cfg conf yaml yml html htm js css py sql bat sh ps1 env", video: "mp4 webm", audio: "mp3 wav ogg m4a" };
const ATT_MAP: Record<string, string> = {}; for (const [k, v] of Object.entries(ATT_K)) for (const e of v.split(" ")) ATT_MAP[e] = k;
export const attKind = (n: string) => ATT_MAP[attExt(n)] || "";
export const attIcon = (n: string) => ({ img: "image", docx: "fdoc", xlsx: "fxls", pdf: "fpdf", text: "note", video: "youtube", audio: "music" } as Record<string, string>)[attKind(n)] || "file";
export function attSize(b: number) { b = +b || 0; return b < 1024 ? b + " B" : b < 1048576 ? Math.round(b / 1024) + " KB" : (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + " MB"; }
export const isAttList = (v: unknown): v is Attachment[] => Array.isArray(v);

/* ───── ghi chú (rich text của Quill) → văn bản ───── */
export const isRich = (v: unknown) => /^\s*<(p|h[1-6]|ol|ul|div|blockquote|pre)[\s>]/i.test(String(v ?? ""));
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unent = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => e[0] === "#" ? String.fromCodePoint(parseInt(e[1] === "x" || e[1] === "X" ? e.slice(2) : e.slice(1), e[1] === "x" || e[1] === "X" ? 16 : 10)) : ENT[e.toLowerCase()] ?? m);
/** HTML → text, mỗi khối 1 dòng (không cần DOM nên dùng được ở cả server/worker). */
export function rteText(v: unknown): string {
  if (!isRich(v)) return String(v ?? "");
  let s = String(v).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, "");
  s = unent(s).replace(/ /g, " ");
  return s.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}
export const noteFirstLine = (v: unknown) => rteText(v).split("\n")[0] ?? "";

/** sắp xếp giá trị facet: n = nhiều→ít, az, za; dữ liệu lớn chỉ sắp phần đầu. */
export function topSort(ents: Array<[string, number]>, vs: "n" | "az" | "za", n: number) {
  if (ents.length <= 3000) return ents.sort((a, b) => vs === "az" ? COLL.compare(a[0], b[0]) : vs === "za" ? COLL.compare(b[0], a[0]) : (b[1] - a[1]) || COLL.compare(a[0], b[0]));
  if (vs === "az" || vs === "za") { const d = vs === "az" ? 1 : -1; return ents.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) * d); }
  ents.sort((a, b) => b[1] - a[1]);
  const head = ents.slice(0, n).sort((a, b) => (b[1] - a[1]) || COLL.compare(a[0], b[0]));
  for (let i = 0; i < head.length; i++) ents[i] = head[i];
  return ents;
}
export const nf = (n: number) => n.toLocaleString("vi");
