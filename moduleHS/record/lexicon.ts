import "server-only";

// Từ điển ngữ cảnh của Cuộc họp: học từ toàn bộ dữ liệu HireX để phụ đề / bản gốc / biên bản viết đúng tên người, khách hàng, thuật ngữ, địa điểm.
//
// 1) Nguồn (chỉ đọc lại khi HUẤN LUYỆN theo lệnh — train(), chạy bằng `node moduleHS/record/lexicon-train.mjs`; không tự chạy theo giờ):
//    - Có cấu trúc: thành viên (HireX / Tài nguyên / Human), khách hàng Human, bộ mã Human (vị trí, hạng, tình trạng CV…), job, nhãn Suối Nguồn,
//      nick kênh, nhóm Zalo của khách, chiến dịch, mẫu content, lịch hẹn, tab / trạng thái / trường của Tài nguyên, kỹ năng & vị trí CV, địa điểm.
//    - Văn bản tự do (khai thác thuật ngữ): toàn bộ Tài liệu (bản Human + Tài liệu HireX), hội thoại với Soda, biên bản + bản gốc các cuộc họp trước,
//      mô tả job, nội dung mẫu. Lấy từ tiếng Anh / viết tắt / cụm viết hoa xuất hiện lặp lại, xếp hạng theo tần suất × số nguồn (TF × độ phủ).
// 2) Cách nghe nhầm — học từ ÂM THANH THẬT, không đoán phiên âm: căn bản "nghe thô" (bộ nhận giọng không biết ngữ cảnh) với bản "chuẩn"
//    (phiên âm có ngữ cảnh HireX) của cùng đoạn âm thanh, lấy các chỗ lệch mà bản chuẩn là một mục từ điển (xem learnFromAudio).
//    Nguồn: cuộc họp đã bật phụ đề + file họp gửi vào (lexicon-train.mjs --audio). Ngoài ra chỉ thêm biến thể số ("AM1" → "AM 1").
// 3) Sửa câu (fixText): quy hoạch động trên đồ thị các cách tách câu (đường đi tốt nhất / Viterbi): mỗi đoạn 1–6 từ hoặc giữ nguyên, hoặc thay bằng
//    thuật ngữ khớp (khớp chính xác > khớp âm Việt > khớp gần đúng theo khoảng cách Levenshtein trên khoá âm). Có hàng rào chống thay nhầm từ thường.
import fs from "node:fs";
import path from "node:path";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { decryptCredential } from "@/modules/integrations/gmail/server/credential-encryption";
import { C, st, fp, rj } from "./data";
import { meetContext } from "./context";

export type Kind = "sys" | "term" | "person" | "customer" | "job" | "code" | "place" | "tag" | "doc" | "nick" | "tech" | "mined";
export interface Entry { c: string; k: Kind; w: number; a: string[] }
interface Cand { e: Entry; t: string[]; p: string[]; pj: string; exact: boolean; tt: string; weak: boolean }
export interface Lex { at: number; entries: Entry[]; idx: Map<string, Cand[]>; short: Map<string, string> }

/* ================= chuẩn hoá & khoá âm ================= */
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
export const nrm = (s: string) => strip(String(s || "").toLowerCase()).replace(/[^a-z0-9]+/g, " ").trim();
/** Khoá âm kiểu Việt (không dấu): gộp các âm đầu / âm cuối người Việt hay đọc lẫn — gi/d/r, tr/ch, s/x, c/k/q, ph/f, c/t/ch cuối, n/ng/nh cuối. */
function ph(t: string) {
  let x = t;
  const ON: [RegExp, string][] = [[/^ngh/, "ng"], [/^gh/, "g"], [/^ph/, "f"], [/^th/, "t"], [/^tr/, "c"], [/^ch/, "c"], [/^kh/, "k"], [/^qu/, "kw"], [/^gi/, "z"], [/^[dr]/, "z"], [/^j/, "z"], [/^x/, "s"], [/^k/, "c"], [/^w/, "u"]];
  for (const [r, v] of ON) if (r.test(x)) { x = x.replace(r, v); break; }
  x = x.replace(/(ch|ck|c|k|t)$/, "t").replace(/(ng|nh|n)$/, "n").replace(/y/g, "i").replace(/e(?=[ai]$)/, "e").replace(/([a-z])\1+/g, "$1");
  return x;
}
const VN_SYL = /^(ngh|ng|nh|ch|gh|gi|kh|ph|qu|th|tr|[bcdghklmnpqrstvx])?(uye|uya|oai|oay|oeo|uoi|uou|ieu|yeu|uay|[aeiouy]{1,2})(ch|ng|nh|[cmnpt]|[iouy])?$/;
/** Chữ "nước ngoài" (người Việt dễ đọc sai): có hoa giữa chữ, có số, hoặc không phải âm tiết tiếng Việt. */
const foreignWord = (w: string) => {
  if (/[^\x00-\x7F]/.test(w)) return false;                                              // có dấu tiếng Việt
  if (/\d/.test(w)) return /[A-Za-z]/.test(w);
  if (/^[A-Z]+$/.test(w)) return w.length <= 2 || !VN_SYL.test(w.toLowerCase());           // "CTO", "HSVN" — nhưng "NAM", "MAI" là chữ Việt viết hoa
  return /[a-z][A-Z]/.test(w) || (/^[A-Za-z]+$/.test(w) && !VN_SYL.test(w.toLowerCase()));
};
const foreign = (s: string) => s.split(/[\s/·-]+/).some((w) => w && foreignWord(w));
function lev(a: string, b: string) {
  if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
/** Từ rất thường gặp: không bao giờ bị thay khi đứng một mình. */
const STOP = new Set(("a anh ai bao ba bac ban bi bo bon cac cai can cho chi chu chua co con cu cua cung da dang danh day de den di do du duoc dau ga gi giua gio ha hai hay het ho hoi hon hom kia khi khac khong la lai lam len luc ma minh moi mot muon nam nao nay ne neu nghi ngay nhan nhe nhieu nhu nhung no noi nua o oi ong qua ra rat roi sang sao se so sau sang ta tai tam thay the thi tho thoi tien toi tot tra tren trong tu tuan ui va van ve vi vien viec vo voi vua xem xong y yes ok oke okay no the and for you this that with from have are not was").split(" "));

/* ================= nguồn cố định ================= */
/** Thuật ngữ cốt lõi của HireX (chỉ tên chuẩn — cách nghe nhầm học từ âm thanh thật, không viết tay). */
const CORE: [string, Kind][] = [
  ["Intalent", "sys"],
  ["Intalent Việt Nam", "sys"],
  ["HireX", "sys"],
  ["Soda", "sys"],
  ["Suối Nguồn", "sys"],
  ["Hola", "sys"],
  ["Hole", "sys"],
  ["Human", "sys"],
  ["Tài nguyên", "sys"], ["Vọng gác", "sys"], ["Cú vọ", "sys"],
  ["KIT", "sys"], ["AI Recruiter", "sys"],
  ["Kho content", "sys"], ["Kho mẫu", "sys"],
  ["Tài liệu", "sys"], ["Lịch hẹn", "sys"], ["Tiện ích", "sys"], ["Kiểm thử", "sys"],
  ["Gửi nhóm Zalo", "sys"], ["Chiến dịch", "sys"], ["Scan CV", "sys"],
  ["BrSE", "term"],
  ["Comtor", "term"],
  ["CV", "term"], ["JD", "term"], ["UV", "term"],
  ["AM1", "term"], ["AM2", "term"], ["AM", "term"],
  ["KPI", "term"], ["Rec", "term"], ["Sale", "term"],
  ["Recer", "term"], ["R&D", "term"], ["CTV", "term"],
  ["Parttime", "term"], ["Fulltime", "term"],
  ["owner", "term"], ["Hot Do", "term"], ["X1", "term"], ["X2", "term"],
  ["Zalo", "term"], ["Facebook", "term"], ["LinkedIn", "term"],
  ["Gmail", "term"], ["Telegram", "term"], ["WhatsApp", "term"],
  ["checklive", "term"], ["Live", "term"], ["Die", "term"], ["proxy", "term"],
  ["deploy", "term"], ["release", "term"], ["build", "term"], ["bug", "term"],
  ["fix", "term"], ["test", "term"], ["tester", "term"], ["Dev", "term"], ["PM", "term"],
  ["BA", "term"], ["QA", "term"], ["PMO", "term"], ["HR", "term"], ["HRD", "term"], ["HRM", "term"],
  ["offer", "term"], ["onboard", "term"], ["interview", "term"], ["deadline", "term"],
  ["meeting", "term"], ["report", "term"], ["feedback", "term"], ["data", "term"], ["dashboard", "term"],
  ["template", "term"], ["content", "term"], ["prompt", "term"], ["token", "term"],
  ["OpenAI", "term"], ["GPT", "term"], ["ChatGPT", "term"], ["API", "term"],
  ["UI", "term"], ["UX", "term"], ["UI/UX", "term"], ["web", "term"], ["app", "term"], ["link", "term"],
  ["Supabase", "tech"], ["Next.js", "tech"], ["Cloudflare", "tech"], ["n8n", "tech"],
  ["JLPT", "term"], ["N1", "term"], ["N2", "term"], ["N3", "term"], ["N4", "term"], ["N5", "term"],
  ["A3", "term"], ["mẫu A3", "term"], ["Hạng 1", "term"], ["Tình trạng CV", "term"], ["PV1", "term"], ["PV2", "term"],
  ["Lâu dài", "term"], ["Tạm thời", "term"], ["Không xác định", "term"],
];
/** Địa điểm hay nhắc (Việt Nam + Nhật). */
const PLACES = ["Hà Nội", "Hồ Chí Minh", "TP.HCM", "Sài Gòn", "Đà Nẵng", "Hải Phòng", "Cần Thơ", "Huế", "Nha Trang", "Đà Lạt", "Vũng Tàu", "Bắc Ninh", "Bắc Giang", "Hưng Yên", "Hải Dương", "Quảng Ninh", "Hạ Long", "Thái Nguyên", "Vĩnh Phúc", "Nam Định", "Thanh Hóa", "Nghệ An", "Vinh", "Hà Tĩnh", "Quảng Bình", "Quảng Trị", "Quảng Nam", "Quảng Ngãi", "Bình Định", "Quy Nhơn", "Phú Yên", "Khánh Hòa", "Ninh Thuận", "Bình Thuận", "Đắk Lắk", "Gia Lai", "Kon Tum", "Lâm Đồng", "Bình Dương", "Đồng Nai", "Biên Hòa", "Long An", "Tây Ninh", "Bình Phước", "Bà Rịa", "Tiền Giang", "Bến Tre", "Vĩnh Long", "Trà Vinh", "Sóc Trăng", "An Giang", "Kiên Giang", "Phú Quốc", "Cà Mau", "Bạc Liêu", "Hòa Bình", "Sơn La", "Lào Cai", "Sa Pa", "Yên Bái", "Hà Giang", "Cao Bằng", "Lạng Sơn", "Tuyên Quang", "Phú Thọ", "Ninh Bình", "Thái Bình", "Hà Nam", "Cầu Giấy", "Đống Đa", "Thanh Xuân", "Hoàn Kiếm", "Ba Đình", "Nam Từ Liêm", "Bắc Từ Liêm", "Hai Bà Trưng", "Long Biên", "Hoàng Mai", "Mỹ Đình", "Duy Tân", "Tokyo", "Osaka", "Nagoya", "Yokohama", "Kyoto", "Fukuoka", "Sapporo", "Kobe", "Sendai", "Hiroshima", "Saitama", "Chiba", "Okinawa", "Nhật Bản", "Việt Nam", "Singapore", "Úc", "Sydney", "Melbourne", "Hàn Quốc", "Seoul"];

const NUM = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
/** Số đọc thành chữ (0–99): 1 → "một", 15 → "mười lăm", 21 → "hai mươi mốt". */
const numVi = (n: number): string => n < 10 ? NUM[n] : n < 20 ? "mười" + (n % 10 ? " " + (n % 10 === 5 ? "lăm" : NUM[n % 10]) : "") : NUM[Math.floor(n / 10)] + " mươi" + (n % 10 ? " " + (n % 10 === 1 ? "mốt" : n % 10 === 5 ? "lăm" : NUM[n % 10]) : "");
/** Biến thể số (không phải phiên âm): "AM1" → "AM 1", "New 1" → "new một", "Hạng 12" → "hạng mười hai". */
function numberAliases(canon: string) {
  const out: string[] = []; if (!/\d/.test(canon) || /\d{3,}/.test(canon)) return out;
  const split = canon.replace(/([A-Za-z])(\d)/g, "$1 $2"); if (split !== canon) out.push(split);
  out.push(canon.replace(/(\d+)\.(\d+)/g, "$1 chấm $2").replace(/\d+/g, (d) => " " + numVi(+d) + " ").replace(/\s+/g, " ").trim());
  return out;
}

/* ================= học từ dữ liệu ================= */
type Row = Record<string, unknown>;
const S = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const cleanOrg = (n: string) => S(n).replace(/\b(công ty|cty|tnhh|cổ phần|cp|jsc|co\.?,? ?ltd\.?|ltd\.?|inc\.?|corp\.?|corporation|limited|vietnam|việt nam|vn)\b\.?/gi, " ").replace(/[()"“”]/g, " ").replace(/\s+/g, " ").replace(/^[-–,. ]+|[-–,. ]+$/g, "").trim();
const cleanCode = (n: string) => S(n).replace(/^\[[^\]]*\]\s*/, "").replace(/\s*\((tự học|ẩn.*?)\)\s*/gi, " ").trim();
const STOP_EN = new Set("the and for you this that with from have are not was were will can all any but our your their they them its into about more what when which who how out use one two new get set via per etc http https www com html json null true false undefined api id url".split(" "));

/** Khai thác thuật ngữ từ văn bản tự do: chữ nước ngoài / viết tắt lặp lại, cụm 2–3 chữ nước ngoài liền nhau, cụm tiếng Việt viết hoa giữa câu. */
function mine(corpus: { src: string; text: string }[], max = 1500) {
  const tf = new Map<string, { n: number; srcs: Set<string>; forms: Map<string, number> }>();
  const bump = (form: string, src: string) => {
    const k = nrm(form); if (!k || k.length < 2 || k.length > 40 || /^\d+$/.test(k.replace(/ /g, ""))) return;
    let x = tf.get(k); if (!x) { x = { n: 0, srcs: new Set(), forms: new Map() }; tf.set(k, x); }
    x.n++; x.srcs.add(src); x.forms.set(form, (x.forms.get(form) || 0) + 1);
  };
  for (const { src, text } of corpus) {
    for (const sent of text.replace(/https?:\/\/\S+|\S+@\S+/g, " ").split(/[.!?;:\n•·|()[\]{}"“”]+/)) {
      const ws = sent.match(/[\p{L}\p{N}]+(?:[&.+#-][\p{L}\p{N}]+)*/gu) || []; let run: string[] = [];
      const flushRun = () => { if (run.length >= 2 && run.length <= 3) bump(run.join(" "), src); run = []; };
      ws.forEach((w, i) => {
        const isF = foreignWord(w) && w.length >= 2 && w.length <= 24 && !STOP_EN.has(w.toLowerCase()) && !/^[0-9a-f]{8,}$/i.test(w);
        if (isF) { bump(w, src); run.push(w); } else flushRun();
        // cụm tiếng Việt viết hoa giữa câu (tên riêng): 2–4 chữ liền nhau đều viết hoa
        if (i > 0 && /^\p{Lu}/u.test(w) && !isF) {
          let j = i; while (j < ws.length && j - i < 4 && /^\p{Lu}\p{Ll}*$/u.test(ws[j]) && !foreignWord(ws[j])) j++;
          if (j - i >= 2 && (i === 0 || !/^\p{Lu}/u.test(ws[i - 1]))) bump(ws.slice(i, j).join(" "), src);
        }
      });
      flushRun();
    }
  }
  return [...tf.entries()].filter(([, x]) => x.n >= 3 || x.srcs.size >= 2)
    .map(([, x]) => ({ c: [...x.forms.entries()].sort((a, b) => b[1] - a[1])[0][0], score: Math.log2(1 + x.n) * (1 + x.srcs.size) }))
    .sort((a, b) => b.score - a.score).slice(0, max);
}
const html2text = (h: string) => S(String(h || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, " "));

async function gather(ws: string) {
  const db = createPrivilegedClient(), q = async (p: PromiseLike<{ data: unknown; error: unknown }>) => { try { const r = await p; return r.error ? [] : ((r.data ?? []) as Row[]); } catch { return []; } };
  const [partners, codes, jobs, aiJobs, tags, nicks, groups, camps, mails, zb, tpls, cats, cal, tabs, stats, fields, cvs, asst, hdocs] = await Promise.all([
    q(db.from("human_partners").select("name,cv_total,location,address").eq("workspace_id", ws).limit(2000)),
    q(db.from("human_master_codes").select("name,kind").eq("workspace_id", ws).limit(1000)),
    q(db.from("recruitment_jobs").select("title,company_name,location,summary,requirements,selling_points").eq("workspace_id", ws).limit(500)),
    q(db.from("ai_recruiter_jobs").select("company_name,job_title,location,summary,requirements,selling_points").eq("workspace_id", ws).limit(500)),
    q(db.from("conversation_tags").select("name,group_name").eq("workspace_id", ws).limit(500)),
    q(db.from("channel_accounts").select("display_name,channel_type").eq("workspace_id", ws).is("deleted_at", null).limit(500)),
    q(db.from("human_partner_groups").select("group_name").eq("workspace_id", ws).limit(1000)),
    q(db.from("channel_campaigns").select("name,campaign_type").eq("workspace_id", ws).limit(300)),
    q(db.from("email_campaigns").select("name,campaign_type").eq("workspace_id", ws).limit(300)),
    q(db.from("zalo_broadcasts").select("name").eq("workspace_id", ws).limit(300)),
    q(db.from("content_templates").select("code,group_name,content_type,body").eq("workspace_id", ws).limit(500)),
    q(db.from("content_categories").select("name,department").eq("workspace_id", ws).limit(200)),
    q(db.from("calendar_events").select("title,location,note").eq("workspace_id", ws).limit(500)),
    q(db.from("ahs_tabs").select("name").limit(100)), q(db.from("ahs_statuses").select("label").limit(300)), q(db.from("ahs_fields").select("label").limit(500)),
    q(db.from("human_cvs").select("position,skill,skill_tech,location,languages").eq("workspace_id", ws).limit(3000)),
    q(db.from("assistant_messages").select("content,role").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(1500)),
    q(db.from("hirex_documents").select("title,folder,content_html").eq("workspace_id", ws).limit(500)),
  ]);
  return { partners, codes, jobs, aiJobs, tags, nicks, groups, camps, mails, zb, tpls, cats, cal, tabs, stats, fields, cvs, asst, hdocs };
}
/** Tài liệu Human (bản sao mã hoá ở runtime/human-documents) — tên, thư mục và nội dung. */
function humanDocs(ws: string): { name: string; group: string; text: string }[] {
  try {
    const raw = fs.readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "runtime", "human-documents", `${ws}.enc`), "utf8");
    const j = JSON.parse(decryptCredential(raw)) as { documents?: { name?: string; group?: string; status?: string; folderPath?: string[] }[] };
    return (j.documents || []).map((d) => ({ name: S(d.name), group: S((d.folderPath || []).join(" / ") || d.group), text: html2text(String(d.status || "")).slice(0, 60000) }));
  } catch { return []; }
}

/* ================= học cách nghe nhầm từ ÂM THANH THẬT =================
   Không đoán phiên âm. Mỗi đoạn âm thanh thật có 2 bản chữ của cùng nội dung:
     - bản "nghe thô": bộ nhận giọng không biết ngữ cảnh (phụ đề trình duyệt lúc họp — live.jsonl; hoặc model phiên âm không prompt cho file họp gửi vào)
     - bản "chuẩn": phiên âm có ngữ cảnh HireX + đã sửa theo từ điển (transcript.txt; hoặc model phiên âm có prompt)
   Căn hai bản theo từng đoạn (bỏ phiếu vị trí bằng các từ hiếm → quy hoạch động khoảng cách sửa), lấy các chỗ bản thô viết khác
   mà bản chuẩn là đúng một mục từ điển → "cách nghe nhầm" thật (ví dụ thô "bờ rích" ↔ chuẩn "BrSE"). Đếm số lần, lưu learned.json. */
const LDIR = () => path.join(/*turbopackIgnore: true*/ C.data, "lexicon");
const LEARN_FILE = () => path.join(LDIR(), "learned.json");
const CORPUS = () => path.join(LDIR(), "corpus");
type Learned = Record<string, Record<string, number>>;
const toks = (s: string) => String(s || "").split(/\s+/).map((w) => ({ w, t: tnorm(w), n: nrm(w).replace(/ /g, "") })).filter((x) => x.t);
function alignLearn(raw: string, ref: string, byNorm: Map<string, Entry>, out: Learned) {
  const R = toks(raw), F = toks(ref); if (!R.length || !F.length) return 0;
  const pos = new Map<string, number[]>(); F.forEach((x, i) => { if (!STOP.has(x.n) && x.n.length > 2) { const a = pos.get(x.n); if (a) a.push(i); else pos.set(x.n, [i]); } });
  let j = 0, got = 0;
  for (let i = 0; i < R.length; i += 24) {
    const ch = R.slice(i, i + 24), vote = new Map<number, number>();
    ch.forEach((x, o) => { for (const p of pos.get(x.n) || []) if (p >= j - 150 && p <= j + 2500) { const st0 = p - o; vote.set(st0, (vote.get(st0) || 0) + 1); } });
    let best = -1, bv = 1; for (const [k, v] of vote) if (v > bv) { bv = v; best = k; }
    if (best < 0) continue;
    const a0 = Math.max(0, best - 4), Fw = F.slice(a0, best + ch.length + 8), n = ch.length, m = Fw.length;
    // khoảng cách sửa theo từ (DP) + truy vết
    const D: number[][] = Array.from({ length: n + 1 }, (_, x) => Array.from({ length: m + 1 }, (_, y) => (x === 0 ? y : y === 0 ? x : 0)));
    for (let x = 1; x <= n; x++) for (let y = 1; y <= m; y++) D[x][y] = Math.min(D[x - 1][y] + 1, D[x][y - 1] + 1, D[x - 1][y - 1] + (ch[x - 1].n === Fw[y - 1].n ? 0 : 1));
    let y0 = 0, bm = Infinity; for (let y = 0; y <= m; y++) if (D[n][y] < bm) { bm = D[n][y]; y0 = y; }   // kết thúc ở chỗ khớp nhất (căn nửa toàn cục)
    const ops: ["=" | "~", number, number][] = []; let x = n, y = y0;
    while (x > 0 && y > 0) { if (D[x][y] === D[x - 1][y - 1] + (ch[x - 1].n === Fw[y - 1].n ? 0 : 1)) { ops.push([ch[x - 1].n === Fw[y - 1].n ? "=" : "~", x - 1, y - 1]); x--; y--; } else if (D[x][y] === D[x - 1][y] + 1) { ops.push(["~", x - 1, -1]); x--; } else { ops.push(["~", -1, y - 1]); y--; } }
    ops.reverse(); j = a0 + y0;
    // các đoạn lệch liền nhau → cặp (thô, chuẩn)
    for (let k = 0; k < ops.length; ) {
      if (ops[k][0] === "=") { k++; continue; }
      const rs: number[] = [], fs2: number[] = []; while (k < ops.length && ops[k][0] !== "=") { if (ops[k][1] >= 0) rs.push(ops[k][1]); if (ops[k][2] >= 0) fs2.push(ops[k][2]); k++; }
      if (!rs.length || !fs2.length || rs.length > 6 || fs2.length > 6) continue;
      const refTxt = fs2.map((q) => Fw[q].w).join(" "), e = byNorm.get(nrm(refTxt)); if (!e) continue;
      const rawTxt = rs.map((q) => ch[q].w).join(" ").replace(/[.,;:!?…]+$/g, "");
      if (!plausible(rawTxt, e.c, byNorm)) continue;
      (out[e.c] ||= {})[rawTxt.toLocaleLowerCase("vi")] = ((out[e.c] || {})[rawTxt.toLocaleLowerCase("vi")] || 0) + 1; got++;
    }
  }
  return got;
}
/** Cặp nghe nhầm có thật không (lọc chỗ căn lệch nội dung): khoá âm phải gần nhau, không phải số, không trùng tên mục khác, tên chuẩn đủ dài. */
function plausible(raw: string, canon: string, byNorm?: Map<string, Entry>) {
  const r = nrm(raw), c = nrm(canon); if (!r || r === c || r.length < 2 || c.replace(/ /g, "").length < 3) return false;
  if (/^[\d ]+$/.test(r) || /\d/.test(r) !== /\d/.test(c)) return false;
  if (byNorm?.has(r)) return false;
  // bản thô toàn chữ tiếng Việt có dấu ("lý do") mà tên chuẩn là chữ nước ngoài ("list job") → nhiều khả năng căn lệch, bỏ
  if (foreign(canon) && !foreign(raw) && /[^\x00-\x7F]/.test(raw)) return false;                                                         // bản thô là một mục từ điển khác ("linkedin" ≠ "link")
  const a = r.split(" ").map(ph).join(""), b = c.split(" ").map(ph).join("");
  if (a[0] !== b[0] && !(/^[szc]/.test(a) && /^[szc]/.test(b))) return false;              // âm đầu phải giống (s/x/c gần nhau)
  const sim = 1 - lev(a, b) / Math.max(a.length, b.length), len = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return sim >= 0.55 && len >= 0.5;
}
/** Học từ mọi cặp (thô, chuẩn) đang có: cuộc họp đã bật phụ đề + file họp đã gửi vào (corpus/*.raw.txt ↔ *.ref.txt). */
function learnFromAudio(entries: Entry[]) {
  const byNorm = new Map(entries.map((e) => [nrm(e.c), e])), out: Learned = {}; let pairs = 0, hits = 0;
  for (const m of [...st().meta.values()].filter((x) => x.kind === "meeting")) {
    let ref = ""; try { ref = fs.readFileSync(fp(m.slug, "transcript.txt"), "utf8"); } catch { continue; }
    let raw = ""; try { raw = fs.readFileSync(fp(m.slug, "live.jsonl"), "utf8").split("\n").map((l) => { try { const j = JSON.parse(l); return j.fin === false || (j.src && j.src !== "vi") ? "" : String(j.raw || j.text || ""); } catch { return ""; } }).filter(Boolean).join(" "); } catch { continue; }
    if (raw.length < 40) continue; pairs++; hits += alignLearn(raw, ref, byNorm, out);
  }
  try { for (const f of fs.readdirSync(CORPUS()).filter((x) => x.endsWith(".raw.txt"))) { const ref = path.join(CORPUS(), f.replace(/\.raw\.txt$/, ".ref.txt")); if (!fs.existsSync(ref)) continue; pairs++; hits += alignLearn(fs.readFileSync(path.join(CORPUS(), f), "utf8"), fs.readFileSync(ref, "utf8"), byNorm, out); } } catch { /* chưa có file họp */ }
  fs.mkdirSync(LDIR(), { recursive: true }); fs.writeFileSync(LEARN_FILE(), JSON.stringify(out));
  return { pairs, hits, terms: Object.keys(out).length };
}
/** Cách nghe nhầm đã học từ âm thanh thật (giữ cặp gặp ≥ 2 lần, hoặc 1 lần nếu đủ dài và không phải từ thường). */
function learnedAliases(): Record<string, string[]> {
  const L = rj<Learned>(LEARN_FILE(), {}), out: Record<string, string[]> = {};
  for (const [c, m] of Object.entries(L)) out[c] = Object.entries(m).filter(([a, n]) => plausible(a, c) && (n >= 2 || (a.length >= 5 && !a.split(" ").every((w) => STOP.has(nrm(w)))))).map(([a]) => a);
  return out;
}
/** Bản chữ chuẩn của các file họp đã gửi vào (để biết từ nào thực sự hay được nói). */
function corpusRefs() { try { return fs.readdirSync(CORPUS()).filter((x) => x.endsWith(".ref.txt")).map((f) => fs.readFileSync(path.join(CORPUS(), f), "utf8")); } catch { return []; } }

/* ================= dựng từ điển ================= */
async function build(ws: string): Promise<Entry[]> {
  const map = new Map<string, Entry>();
  const add = (c: string, k: Kind, w: number, a: string[] = []) => {
    c = S(c); if (!c || c.length < 2 || c.length > 60 || /^[\d\s.,:/-]+$/.test(c)) return;
    if (/[_]/.test(c) || /^\d{1,2}\/\d{1,2}/.test(c)) return;                                  // tên file / ngày, không ai đọc thành lời
    if (c === c.toLocaleUpperCase("vi") && /[^\x00-\x7F]/.test(c)) { if (k === "person" || k === "customer" || k === "place") c = c.toLocaleLowerCase("vi").replace(/(^|\s)\p{L}/gu, (m) => m.toLocaleUpperCase("vi")); else return; }   // CHỮ HOA tiếng Việt
    const key = nrm(c); if (!key) return;
    const cur = map.get(key); if (cur) { cur.w = Math.max(cur.w, w); for (const x of a) if (!cur.a.includes(x)) cur.a.push(x); return; }
    map.set(key, { c, k, w, a: [...a] });
  };
  for (const [c, k] of CORE) add(c, k, 1.6);                                                // chỉ tên chuẩn — không dùng phiên âm viết tay
  for (const p of PLACES) add(p, "place", 1.1);
  const ctx = await meetContext(ws).catch(() => null);
  // tên người: bỏ đuôi bộ phận / chức danh ("Phan Ngọc - AM", "Cường J3", "Chị Ngọc Manager") — tên gốc vẫn giữ làm một cách gọi
  for (const p of ctx?.people || []) {
    const raw = S(p.name), nm = raw.replace(/\s*[-–·]\s*[\p{L} ]{1,12}$/u, "").replace(/\b(J\d|Sale|Rec|Manager|Test|AM|HR)\b/g, "").replace(/^(chị|anh|em|c\.|a\.)\s*/i, "").replace(/\s+/g, " ").trim();
    if (nm.length >= 2) add(nm, "person", 1.3, nm !== raw ? [raw] : []);
  }
  const D = await gather(ws).catch(() => null);
  const corpus: { src: string; text: string }[] = [];
  if (D) {
    for (const r of D.partners) { const n = cleanOrg(S(r.name)); if (n) add(n, "customer", 1 + Math.min(0.5, Math.log10(1 + (+String(r.cv_total) || 0)) / 4)); const l = S(r.location); if (l && !/^mã/i.test(l)) add(l, "place", 1); }
    for (const r of D.codes) { const n = cleanCode(S(r.name)); if (n && n.length <= 40) add(n, "code", 1.1); }
    for (const r of [...D.jobs, ...D.aiJobs]) { for (const v of [r.title, r.job_title]) if (S(v)) add(S(v), "job", 1.1); const co = cleanOrg(S(r.company_name)); if (co) add(co, "customer", 1.2); if (S(r.location)) add(S(r.location), "place", 1); corpus.push({ src: "job", text: [r.summary, r.requirements, r.selling_points].map(S).join("\n") }); }
    for (const r of D.tags) { add(S(r.name), "tag", 1.2); if (S(r.group_name)) add(S(r.group_name), "tag", 1); }
    for (const r of D.nicks) { const n = S(r.display_name); if (n && n.length <= 40 && !/@/.test(n)) add(n, "nick", 0.9); }
    for (const r of D.groups) { const parts = S(r.group_name).replace(/^\[[^\]]*\]-?/, "").split(/\s*-\s*/).map(S); if (parts[0]) add(cleanOrg(parts[0]), "customer", 1); corpus.push({ src: "group", text: parts.join(". ") }); }
    for (const r of [...D.camps, ...D.mails, ...D.zb]) corpus.push({ src: "campaign", text: S(r.name) + ". " + S(r.campaign_type) });
    for (const r of D.tpls) { if (S(r.group_name)) add(S(r.group_name), "code", 0.9); corpus.push({ src: "content", text: S(r.body).slice(0, 4000) }); }
    for (const r of D.cats) add(S(r.name), "code", 0.9);
    for (const r of D.cal) { corpus.push({ src: "calendar", text: [r.title, r.note].map(S).join(". ") }); if (S(r.location)) add(S(r.location), "place", 0.9); }
    for (const r of D.tabs) add(S(r.name), "sys", 1.1); for (const r of D.stats) add(S(r.label), "code", 1); for (const r of D.fields) { const l = S(r.label); if (l.length <= 30) add(l, "code", 0.8); }
    const cvCount = new Map<string, number>();
    for (const r of D.cvs) for (const v of [r.position, r.skill, r.skill_tech, r.languages]) for (const t of S(v).split(/[,;/|]+/).map(S)) if (t && t.length <= 30 && !/^(other|none|khác)$/i.test(t)) cvCount.set(t, (cvCount.get(t) || 0) + 1);
    for (const [t, n] of cvCount) if (n >= 2) add(t, foreign(t) ? "tech" : "code", 0.9 + Math.min(0.4, Math.log10(n) / 5));
    corpus.push(...D.asst.map((r) => ({ src: "soda", text: S(r.content).slice(0, 4000) })));
    for (const r of D.hdocs) { corpus.push({ src: "doc", text: S(r.title) + ". " + html2text(S(r.content_html)).slice(0, 60000) }); }
  }
  // Tài liệu: không lấy nguyên tên file (không ai đọc thành lời) — chỉ khai thác thuật ngữ trong tên + nội dung
  for (const d of humanDocs(ws)) corpus.push({ src: "doc", text: d.name.replace(/_/g, " ") + ". " + d.group.replace(/_/g, " ") + ". " + d.text });
  // biên bản + bản gốc các cuộc họp trước (cách CEO và mọi người thực sự gọi tên)
  for (const m of [...st().meta.values()].filter((x) => x.kind === "meeting" && x.status === "done").slice(-60)) {
    try { corpus.push({ src: "meeting", text: fs.readFileSync(fp(m.slug, "transcript.txt"), "utf8").slice(0, 200000) }); } catch { /* chưa có */ }
    try { corpus.push({ src: "minutes", text: fs.readFileSync(fp(m.slug, "minutes.json"), "utf8").replace(/[{}[\]"]/g, " ").slice(0, 60000) }); } catch { /* chưa có */ }
  }
  // file họp đã gửi vào (bản chuẩn): khai thác thuật ngữ + tăng trọng số từ thực sự được nói
  const refs = corpusRefs(); for (const t of refs) corpus.push({ src: "audio", text: t });
  for (const x of mine(corpus)) add(x.c, "mined", 0.6 + Math.min(0.6, x.score / 40));
  if (refs.length) { const all = " " + refs.map((t) => nrm(t)).join(" ") + " "; for (const e of map.values()) { const k = " " + nrm(e.c) + " "; if (k.length < 5) continue; let n = 0, i = -1; while ((i = all.indexOf(k, i + 1)) >= 0 && n < 50) n++; if (n) e.w += Math.min(0.5, Math.log10(1 + n) / 2.5); } }
  // biến thể số + cách nghe nhầm học từ âm thanh thật
  const learned = learnedAliases();
  for (const e of map.values()) { for (const a of numberAliases(e.c)) if (!e.a.includes(a)) e.a.push(a); for (const a of learned[e.c] || []) if (!e.a.includes(a)) e.a.push(a); }
  return [...map.values()];
}

/** Dạng có dấu (thường, bỏ ký hiệu) để so khớp chính xác cả thanh điệu — tránh thay nhầm "đẹp" bằng "Dev", "dài" bằng "Die". */
const tnorm = (s: string) => String(s || "").toLocaleLowerCase("vi").normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function index(entries: Entry[]): Lex {
  const idx = new Map<string, Cand[]>(), short = new Map<string, string>(), amb = new Set<string>();
  for (const e of entries) {
    const forms = [e.c, ...e.a];
    forms.forEach((f, i) => {
      const tt = tnorm(f).split(" ").filter(Boolean); if (!tt.length || tt.length > 6) return;
      const t = tt.map((x) => nrm(x)).join(" ").split(" ").filter(Boolean); if (t.length !== tt.length) return;
      const weak = t.every((x) => STOP.has(x));                                                 // toàn từ thường ("so đa", "hà nội"): chỉ khớp đúng cả dấu
      if (weak && t.length === 1) return;
      if (t.length === 1 && t[0].length < 2) return;
      if ((e.k === "person" || e.k === "nick") && t.length === 1) return;                       // tên một chữ ("Hải") chỉ sửa khi có anh / chị đứng trước
      if (t.length === 1 && i === 0 && !foreign(e.c) && e.k !== "sys") return;                  // một chữ tiếng Việt ("Khác", "Trùng"): không tự viết hoa giữa câu
      if (e.k === "mined" && t.length === 1 && !foreign(e.c)) return;
      const p = t.map(ph), c: Cand = { e, t, p, pj: p.join(""), exact: i === 0, tt: tt.join(" "), weak };
      const k = p[0]; const arr = idx.get(k); if (arr) arr.push(c); else idx.set(k, [c]);
    });
    if (e.k === "person") {
      const w = e.c.replace(/\b(J\d|Sale|Rec|Manager|Test)\b/gi, "").trim().split(/\s+/), sn = w[w.length - 1];
      if (sn) { const k = nrm(sn); if (short.has(k) && short.get(k) !== sn) amb.add(k); else short.set(k, sn); }
    }
  }
  for (const k of amb) short.delete(k);
  return { at: Date.now(), entries, idx, short };
}

/* ================= bộ nhớ đệm =================
   Từ điển KHÔNG tự học lại theo giờ. Chỉ dựng lại khi người dùng ra lệnh huấn luyện (train — xem lexicon-train.mjs / README):
   lúc đó đọc lại toàn bộ dữ liệu HireX + AI học cách đọc cho từ mới, ghi ra runtime/hs-record/lexicon/<workspace>.json.
   Web chỉ đọc file đó (đổi file là tự nạp lại); chưa có file thì dựng một lần từ dữ liệu, không gọi AI (miễn phí). */
const cache = new Map<string, Lex & { mt: number }>(), building = new Map<string, Promise<Lex>>();
const LFILE = (ws: string) => path.join(LDIR(), `${ws || "default"}.json`);
const mtime = (f: string) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
function save(ws: string, entries: Entry[], at = Date.now(), stats: Record<string, unknown> = {}) {
  fs.mkdirSync(LDIR(), { recursive: true }); const f = LFILE(ws), t = f + ".tmp";
  fs.writeFileSync(t, JSON.stringify({ at, stats, entries })); fs.renameSync(t, f);
}
function load(ws: string): (Lex & { mt: number }) | null {
  const f = LFILE(ws), mt = mtime(f); if (!mt) return null;
  const saved = rj<{ at?: number; entries?: Entry[] }>(f, {}); if (!saved.entries?.length) return null;
  return Object.assign(index(saved.entries), { at: saved.at || mt, mt });
}
const summary = (entries: Entry[]) => [...new Set(entries.map((e) => e.k))].map((k) => `${k} ${entries.filter((e) => e.k === k).length}`).join(", ");
/** Từ điển của không gian làm việc (dùng cho phụ đề, bản gốc, biên bản). */
export async function getLex(ws = ""): Promise<Lex> {
  const hit = cache.get(ws), mt = mtime(LFILE(ws));
  if (hit && hit.mt === mt) return hit;
  const fresh = load(ws); if (fresh) { cache.set(ws, fresh); return fresh; }
  if (hit) return hit;
  if (!building.has(ws)) building.set(ws, (async () => { const entries = await build(ws); save(ws, entries); console.log(`[Cuộc họp] Từ điển ngữ cảnh (lần đầu, chưa huấn luyện AI): ${entries.length} mục`); const l = load(ws)!; cache.set(ws, l); return l; })().finally(() => building.delete(ws)));
  try { return await building.get(ws)!; } catch { const l = Object.assign(index(CORE.map(([c, k]) => ({ c, k, w: 1.6, a: [] as string[] }))), { mt: -1 }); cache.set(ws, l); return l; }
}
/**
 * HUẤN LUYỆN (chạy khi người dùng ra lệnh, ví dụ chat "Huấn luyện ghi âm full db"):
 * đọc lại toàn bộ dữ liệu HireX → dựng từ điển → học cách nghe nhầm từ âm thanh thật (cuộc họp đã bật phụ đề + file họp gửi vào)
 * → dựng lại có gắn cách nghe nhầm → lưu file. Không gọi AI. Trả về thống kê để báo lại người dùng.
 */
export async function train(ws = "") {
  const t0 = Date.now(), before = rj<{ entries?: Entry[] }>(LFILE(ws), {}).entries || [];
  const first = await build(ws), learn = learnFromAudio(first), entries = await build(ws);
  const old = new Set(before.map((e) => e.c)), added = entries.filter((e) => !old.has(e.c));
  const refs = corpusRefs(), allRef = " " + refs.map((t) => nrm(t)).join(" ") + " ";
  const spoken = refs.length ? entries.filter((e) => nrm(e.c).length >= 3 && allRef.includes(" " + nrm(e.c) + " ")).sort((a, b) => b.w - a.w) : [];
  const L = learnedAliases(), sample = Object.entries(L).filter(([, a]) => a.length).slice(0, 20).map(([c, a]) => `${a.slice(0, 3).join(" / ")} → ${c}`);
  const stats = { entries: entries.length, kinds: summary(entries), added: added.length, addedSample: added.slice(0, 30).map((e) => `${e.c} (${KIND_VI[e.k]})`), audioPairs: learn.pairs, audioHits: learn.hits, learnedTerms: Object.values(L).filter((a) => a.length).length, learnedSample: sample, spoken: spoken.length, spokenSample: spoken.slice(0, 25).map((e) => e.c), ms: Date.now() - t0 };
  save(ws, entries, Date.now(), stats); cache.delete(ws);
  return stats;
}

/* ================= sửa câu ================= */
const HON = new Set(["anh", "chi", "em", "ban", "sep", "co", "chu", "ong", "ba", "a", "c", "e", "thay", "bac"]);
/**
 * Sửa một câu theo từ điển. Quy hoạch động (đường đi tốt nhất trên DAG các vị trí từ): best[i] = điểm lớn nhất cho đoạn từ i đến hết,
 * mỗi bước hoặc giữ 1 từ (điểm 0), hoặc thay đoạn i..i+L bằng một mục khớp (điểm = độ tin × trọng số). Trả câu đã sửa + các mục đã gặp.
 */
export function fixText(text: string, lex: Lex): { text: string; hits: Map<string, number> } {
  const hits = new Map<string, number>(); if (!text || !lex) return { text, hits };
  const parts = text.match(/[\p{L}\p{N}]+(?:[&.+#'-][\p{L}\p{N}]+)*|[^\p{L}\p{N}]+/gu) || [];
  // mỗi từ gốc tách thành các tiếng (R&D → r, d); nhớ tiếng nào thuộc từ nào để chỉ thay trọn từ
  const T: { tt: string; n: string; p: string; part: number; first: boolean; last: boolean }[] = [];
  parts.forEach((pt, i) => { if (!/^[\p{L}\p{N}]/u.test(pt)) return; const tt = tnorm(pt).split(" ").filter(Boolean); tt.forEach((x, j) => { const n = nrm(x); T.push({ tt: x, n, p: ph(n), part: i, first: j === 0, last: j === tt.length - 1 }); }); });
  const n = T.length, best = new Float64Array(n + 1), pick: ({ L: number; e: Entry } | null)[] = new Array(n + 1).fill(null);
  for (let i = n - 1; i >= 0; i--) {
    best[i] = best[i + 1]; pick[i] = null; if (!T[i].first) continue;
    for (const c of lex.idx.get(T[i].p) || []) {
      const L = c.t.length; if (i + L > n || !T[i + L - 1].last) continue;
      const span = T.slice(i, i + L), tt = span.map((x) => x.tt).join(" "), nj = span.map((x) => x.n).join(" "), pj = span.map((x) => x.p).join("");
      let sim = 0;
      if (tt === c.tt) sim = 1;                                                                  // khớp cả dấu
      else if (c.weak) continue;
      else if (nj === c.t.join(" ") && (L >= 2 ? nj.length >= 7 : c.exact && nj.length >= 5)) sim = 0.9;    // khớp không dấu (đủ dài)
      else if (L >= 2 && pj === c.pj && c.pj.length >= 7) sim = 0.85;                          // khớp âm Việt
      else if (L >= 2 && c.pj.length >= 8) { const r = 1 - lev(pj, c.pj) / Math.max(pj.length, c.pj.length); if (r >= 0.86) sim = r * 0.8; }   // gần đúng
      if (!sim) continue;
      if (L === 1 && STOP.has(span[0].n) && tt !== tnorm(c.e.c)) continue;
      const score = sim * (0.7 + 0.3 * Math.min(1.6, c.e.w)) + 0.15 * (L - 1);
      if (score < 0.72) continue;
      if (score + best[i + L] > best[i] + 1e-9) { best[i] = score + best[i + L]; pick[i] = { L, e: c.e }; }
    }
  }
  const out: string[] = []; let i = 0, pi = 0;
  while (i < n) {
    const pk = pick[i], a = T[i].part;
    if (pk) {
      const b = T[i + pk.L - 1].part; while (pi < a) out.push(parts[pi++]);
      const orig = parts.slice(a, b + 1).join("");
      out.push(orig.toLocaleLowerCase("vi") === pk.e.c.toLocaleLowerCase("vi") && !/\p{Lu}/u.test(pk.e.c) ? orig : pk.e.c);   // "Deploy" đầu câu giữ hoa
      pi = b + 1; hits.set(pk.e.c, (hits.get(pk.e.c) || 0) + 1); i += pk.L;
    } else {
      while (pi < a) out.push(parts[pi++]);
      let w = parts[a]; const prev = i > 0 ? T[i - 1].n : "";
      if (T[i].first && T[i].last && HON.has(prev) && lex.short.has(T[i].n) && (pi === a)) { w = lex.short.get(T[i].n)!; hits.set(w, (hits.get(w) || 0) + 1); }   // "anh dũng" → "anh Dũng"
      if (pi === a) { out.push(w); pi = a + 1; }
      i++; while (i < n && T[i].part === a) i++;
    }
  }
  while (pi < parts.length) out.push(parts[pi++]);
  return { text: out.join("").replace(/^\p{Ll}/u, (ch) => ch.toLocaleUpperCase("vi")), hits };
}
/** Giữ nguyên thuật ngữ khi dịch máy: thay bằng mã QZ{n}QZ (Google Dịch để nguyên), dịch xong trả lại. */
export function protect(text: string, hits: Map<string, number>, lex: Lex) {
  const keep = [...hits.keys()].map((c) => lex.entries.find((e) => e.c === c)).filter((e): e is Entry => !!e && e.k !== "person" && e.k !== "place").map((e) => e.c).sort((a, b) => b.length - a.length);
  const slots: string[] = []; let t = text;
  for (const c of keep) { const re = new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"); t = t.replace(re, () => { slots.push(c); return `QZ${slots.length - 1}QZ`; }); }
  return { text: t, back: (s: string) => s.replace(/QZ\s*(\d+)\s*QZ/g, (m, k) => slots[+k] ?? m) };
}
/** Cụm cho bộ nhận giọng của trình duyệt (contextual biasing nếu trình duyệt hỗ trợ): ưu tiên thuật ngữ HireX, tên người, khách hàng. */
export function phrases(lex: Lex, n = 400) {
  const rank: Record<Kind, number> = { sys: 9, term: 8, person: 7, customer: 6, job: 5, tag: 5, code: 4, place: 4, tech: 4, nick: 3, doc: 2, mined: 2 };
  return [...lex.entries].sort((a, b) => rank[b.k] - rank[a.k] || b.w - a.w).slice(0, n).map((e) => ({ p: e.c, b: Math.round((1 + rank[e.k] / 3) * 10) / 10, k: e.k }));
}
/** Thuật ngữ thực sự xuất hiện trong cuộc họp (đếm từ phụ đề + bản gốc), dùng cho prompt phiên âm và bảng thuật ngữ của biên bản. */
export function topHits(lex: Lex, hits: Map<string, number>, n = 60) {
  const by = new Map(lex.entries.map((e) => [e.c, e]));
  return [...hits.entries()].map(([c, k]) => ({ e: by.get(c), k })).filter((x): x is { e: Entry; k: number } => !!x.e).sort((a, b) => b.k * b.e.w - a.k * a.e.w).slice(0, n);
}
export const KIND_VI: Record<Kind, string> = { sys: "màn / chức năng HireX", term: "thuật ngữ", person: "người", customer: "khách hàng", job: "job", code: "mã / hạng / trạng thái", place: "địa điểm", tag: "nhãn", doc: "tài liệu", nick: "nick kênh", tech: "kỹ năng / công nghệ", mined: "thuật ngữ nội bộ" };
