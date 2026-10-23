import "server-only";

// Từ điển ngữ cảnh của Cuộc họp: học từ toàn bộ dữ liệu HireX để phụ đề / bản gốc / biên bản viết đúng tên người, khách hàng, thuật ngữ, địa điểm.
//
// 1) Nguồn (chỉ đọc lại khi HUẤN LUYỆN theo lệnh — train(), chạy bằng `node moduleHS/record/lexicon-train.mjs`; không tự chạy theo giờ):
//    - Có cấu trúc: thành viên (HireX / Tài nguyên / Human), khách hàng Human, bộ mã Human (vị trí, hạng, tình trạng CV…), job, nhãn Suối Nguồn,
//      nick kênh, nhóm Zalo của khách, chiến dịch, mẫu content, lịch hẹn, tab / trạng thái / trường của Tài nguyên, kỹ năng & vị trí CV, địa điểm.
//    - Văn bản tự do (khai thác thuật ngữ): toàn bộ Tài liệu (bản Human + Tài liệu HireX), hội thoại với Soda, biên bản + bản gốc các cuộc họp trước,
//      mô tả job, nội dung mẫu. Lấy từ tiếng Anh / viết tắt / cụm viết hoa xuất hiện lặp lại, xếp hạng theo tần suất × số nguồn (TF × độ phủ).
// 2) Cách đọc: người Việt đọc thuật ngữ nước ngoài theo kiểu Việt ("BrSE" → "bờ rích", "HireX" → "hai rếch") nên bộ nhận giọng viết sai.
//    Mỗi thuật ngữ có danh sách "cách nghe nhầm": viết tay cho thuật ngữ cốt lõi + tự sinh cho chữ viết tắt (đọc từng chữ cái kiểu Việt / Anh)
//    + AI sinh một lần cho thuật ngữ mới khi huấn luyện (lưu vĩnh viễn ở runtime/hs-record/lexicon/aliases.json — mỗi từ chỉ tốn một lần).
// 3) Sửa câu (fixText): quy hoạch động trên đồ thị các cách tách câu (đường đi tốt nhất / Viterbi): mỗi đoạn 1–6 từ hoặc giữ nguyên, hoặc thay bằng
//    thuật ngữ khớp (khớp chính xác > khớp âm Việt > khớp gần đúng theo khoảng cách Levenshtein trên khoá âm). Có hàng rào chống thay nhầm từ thường.
import fs from "node:fs";
import path from "node:path";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { decryptCredential } from "@/modules/integrations/gmail/server/credential-encryption";
import { postOpenAIResponse, responseOutputText } from "@/lib/openai/responses";
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
/** Thuật ngữ cốt lõi + cách người Việt hay đọc / bộ nhận giọng hay viết (viết tay, theo các buổi họp thực tế). */
const CORE: [string, Kind, string[]][] = [
  ["Intalent", "sys", ["in ta lần", "in ta lừn", "in tà lừn", "in ta len", "in talent", "intelen", "in tơ len"]],
  ["Intalent Việt Nam", "sys", ["in ta lần việt nam"]],
  ["HireX", "sys", ["hai rếch", "hai rex", "hai ếch", "hai rét", "hia rếch", "hire x", "hai ơ ếch", "hai rếch x", "hai-rếch"]],
  ["Soda", "sys", ["so đa", "sô đa", "xô đa", "sô-đa", "sổ đa", "sò đa", "xo da"]],
  ["Suối Nguồn", "sys", ["suối nguồn", "xuối nguồn", "suối ngồn"]],
  ["Hola", "sys", ["hô la", "hô-la", "hồ la", "ô la"]],
  ["Hole", "sys", ["hô lê", "hôn", "hô", "hồ lê", "hô le"]],
  ["Human", "sys", ["hiu mần", "hiu man", "hiu mần", "hiu-man", "hiu men", "hu man"]],
  ["Tài nguyên", "sys", ["tài nguyên"]], ["Vọng gác", "sys", ["vọng gác"]], ["Cú vọ", "sys", ["cú vọ", "cu vo"]],
  ["KIT", "sys", ["kít", "kịt"]], ["AI Recruiter", "sys", ["ai ri cờ ru tơ", "ây ai ri cru tơ", "ai recruiter", "ai rì cờ ru tơ", "ai rếch ru tơ"]],
  ["Kho content", "sys", ["kho con ten", "kho côn ten", "kho content"]], ["Kho mẫu", "sys", ["kho mẫu"]],
  ["Tài liệu", "sys", ["tài liệu"]], ["Lịch hẹn", "sys", ["lịch hẹn"]], ["Tiện ích", "sys", ["tiện ích"]], ["Kiểm thử", "sys", ["kiểm thử"]],
  ["Gửi nhóm Zalo", "sys", ["gửi nhóm da lô", "gửi nhóm za lô"]], ["Chiến dịch", "sys", ["chiến dịch"]], ["Scan CV", "sys", ["xì can xi vi", "scan xi vi", "sờ can cv"]],
  ["BrSE", "term", ["bờ rích", "bờ rít", "bờ ríc", "bi rơ ét", "bi ét", "bi a ét", "bê rê ét", "bờ rờ ét", "bơ rít", "b r s e", "brs", "bờ rít sơ", "bờ-rích"]],
  ["Comtor", "term", ["côm tơ", "com tơ", "côm-tơ", "com to", "cổm tơ", "côm tờ"]],
  ["CV", "term", ["xi vi", "si vi", "xê vê", "cê vê", "cờ vờ"]], ["JD", "term", ["giây đi", "di đi", "gi đi", "chây đi", "j d"]], ["UV", "term", ["u vê", "diu vi", "u vi"]],
  ["AM1", "term", ["am một", "a em một", "ây em một", "a mờ một", "am 1"]], ["AM2", "term", ["am hai", "a em hai", "ây em hai", "a mờ hai", "am 2"]], ["AM", "term", ["ây em", "a em", "a mờ"]],
  ["KPI", "term", ["ca pê i", "cây pi ai", "kờ pi ai", "kê pi ai", "ca pi ai"]], ["Rec", "term", ["réc", "rếch", "rét", "rek", "rếc"]], ["Sale", "term", ["seo", "sêu", "xeo", "xêu", "xen", "sên"]],
  ["Recer", "term", ["ré cơ", "rếch cơ", "ri xơ"]], ["R&D", "term", ["a en đi", "a and đi", "r and d", "rờ và đê", "a en di"]], ["CTV", "term", ["cê tê vê", "xê tê vê", "c t v"]],
  ["Parttime", "term", ["pát tham", "pát thai", "part time"]], ["Fulltime", "term", ["phun tham", "phun thai", "full time"]],
  ["owner", "term", ["ô nơ", "âu nơ", "ao nơ"]], ["Hot Do", "term", ["hót đô", "hốt đô", "hot đô"]], ["X1", "term", ["ích một", "x một"]], ["X2", "term", ["ích hai", "x hai"]],
  ["Zalo", "term", ["da lô", "za lô", "gia lô", "da-lô", "zà lô"]], ["Facebook", "term", ["phây búc", "phây búc", "phê búc", "phây"]], ["LinkedIn", "term", ["linh kin", "linh đin", "lin kờ in", "linh ke đin", "link in"]],
  ["Gmail", "term", ["gờ mail", "gờ meo", "gi meo", "gmail"]], ["Telegram", "term", ["tê lê gram", "te le gram"]], ["WhatsApp", "term", ["oát sáp", "oắt sáp", "whats app"]],
  ["checklive", "term", ["chéc lai", "check lai", "chét lai", "chếch lai"]], ["Live", "term", ["lai"]], ["Die", "term", ["đai"]], ["proxy", "term", ["prốc xi", "phờ rốc xi", "rốc xi"]],
  ["deploy", "term", ["đi ploi", "đi-ploi", "đì ploi", "đi plôi"]], ["release", "term", ["ri li", "ri lít", "ri lis"]], ["build", "term", ["bin", "biu", "bin đờ"]], ["bug", "term", ["bấc", "bắc", "búc"]],
  ["fix", "term", ["phích", "phít", "fíc"]], ["test", "term", ["tét", "tếch"]], ["tester", "term", ["tét tơ", "tét-tơ"]], ["Dev", "term", ["đép", "đeo", "đép vờ"]], ["PM", "term", ["pi em", "pê mờ", "pi am"]],
  ["BA", "term", ["bi ây", "bê a"]], ["QA", "term", ["kiu ây", "qui a", "kiu ê"]], ["PMO", "term", ["pi em ô"]], ["HR", "term", ["hát rờ", "ếch a", "hát a"]], ["HRD", "term", ["hát rờ đê"]], ["HRM", "term", ["hát rờ mờ"]],
  ["offer", "term", ["óp phơ", "ốp phờ", "óp-phơ", "ốp phơ"]], ["onboard", "term", ["on bót", "ôn bót", "on bo"]], ["interview", "term", ["in tơ viu"]], ["deadline", "term", ["đét lai", "đết lai", "đét-lai"]],
  ["meeting", "term", ["mít tinh"]], ["report", "term", ["ri pót", "ri po"]], ["feedback", "term", ["phít bách", "phít bác", "phi bách"]], ["data", "term", ["đa ta", "đây ta", "đata"]], ["dashboard", "term", ["đát bót", "đát bo"]],
  ["template", "term", ["tem pờ lết", "tem plết", "tem lết"]], ["content", "term", ["con ten", "côn ten", "con-ten"]], ["prompt", "term", ["prom", "phờ rom", "rôm"]], ["token", "term", ["tô ken", "tô-ken"]],
  ["OpenAI", "term", ["ô pần ai", "ô pen ai", "open ai"]], ["GPT", "term", ["gi pi ti", "giê pê tê", "ji pi ti"]], ["ChatGPT", "term", ["chát gi pi ti", "chát gờ pê tê"]], ["API", "term", ["a pi ai", "ây pi ai", "a pê i"]],
  ["UI", "term", ["diu ai", "u i"]], ["UX", "term", ["diu ích", "u ích"]], ["UI/UX", "term", ["diu ai diu ích", "u i u ích"]], ["web", "term", ["guép", "oép", "quép"]], ["app", "term", ["áp", "ép"]], ["link", "term", ["linh"]],
  ["Supabase", "tech", ["xu pa bêch", "su pa bết", "súp pờ bết"]], ["Next.js", "tech", ["nếch gi ét", "néc gi ét", "next js"]], ["Cloudflare", "tech", ["clau phle", "cờ lao phờ le"]], ["n8n", "tech", ["en tám en", "n tám n"]],
  ["JLPT", "term", ["giây eo pi ti", "gi eo pê tê"]], ["N1", "term", ["en một", "n một"]], ["N2", "term", ["en hai", "n hai"]], ["N3", "term", ["en ba", "n ba"]], ["N4", "term", ["en bốn"]], ["N5", "term", ["en năm"]],
  ["A3", "term", ["a ba"]], ["mẫu A3", "term", ["mẫu a ba"]], ["Hạng 1", "term", ["hạng một"]], ["Tình trạng CV", "term", ["tình trạng xi vi"]], ["PV1", "term", ["pê vê một", "phỏng vấn một"]], ["PV2", "term", ["pê vê hai"]],
  ["Lâu dài", "term", ["lâu dài"]], ["Tạm thời", "term", ["tạm thời"]], ["Không xác định", "term", ["không xác định"]],
];
/** Địa điểm hay nhắc (Việt Nam + Nhật). */
const PLACES = ["Hà Nội", "Hồ Chí Minh", "TP.HCM", "Sài Gòn", "Đà Nẵng", "Hải Phòng", "Cần Thơ", "Huế", "Nha Trang", "Đà Lạt", "Vũng Tàu", "Bắc Ninh", "Bắc Giang", "Hưng Yên", "Hải Dương", "Quảng Ninh", "Hạ Long", "Thái Nguyên", "Vĩnh Phúc", "Nam Định", "Thanh Hóa", "Nghệ An", "Vinh", "Hà Tĩnh", "Quảng Bình", "Quảng Trị", "Quảng Nam", "Quảng Ngãi", "Bình Định", "Quy Nhơn", "Phú Yên", "Khánh Hòa", "Ninh Thuận", "Bình Thuận", "Đắk Lắk", "Gia Lai", "Kon Tum", "Lâm Đồng", "Bình Dương", "Đồng Nai", "Biên Hòa", "Long An", "Tây Ninh", "Bình Phước", "Bà Rịa", "Tiền Giang", "Bến Tre", "Vĩnh Long", "Trà Vinh", "Sóc Trăng", "An Giang", "Kiên Giang", "Phú Quốc", "Cà Mau", "Bạc Liêu", "Hòa Bình", "Sơn La", "Lào Cai", "Sa Pa", "Yên Bái", "Hà Giang", "Cao Bằng", "Lạng Sơn", "Tuyên Quang", "Phú Thọ", "Ninh Bình", "Thái Bình", "Hà Nam", "Cầu Giấy", "Đống Đa", "Thanh Xuân", "Hoàn Kiếm", "Ba Đình", "Nam Từ Liêm", "Bắc Từ Liêm", "Hai Bà Trưng", "Long Biên", "Hoàng Mai", "Mỹ Đình", "Duy Tân", "Tokyo", "Osaka", "Nagoya", "Yokohama", "Kyoto", "Fukuoka", "Sapporo", "Kobe", "Sendai", "Hiroshima", "Saitama", "Chiba", "Okinawa", "Nhật Bản", "Việt Nam", "Singapore", "Úc", "Sydney", "Melbourne", "Hàn Quốc", "Seoul"];
const PLACE_AL: Record<string, string[]> = { "TP.HCM": ["hát xê mờ", "hồ chí minh", "hcm", "tê pê hồ chí minh"], Tokyo: ["tô ki ô", "tô-ki-ô", "tô ky ô"], Osaka: ["ô sa ca", "ô-sa-ka"], Nagoya: ["na gô da", "na gô ya"], Yokohama: ["dô cô ha ma"], Kyoto: ["ki ô tô", "kyo tô"], Fukuoka: ["phu cu ô ca"], Sydney: ["xít ni"], Singapore: ["xinh ga po", "sing ga po"] };

/** Đọc chữ viết tắt từng chữ cái: kiểu Việt và kiểu Anh. */
const LET: Record<string, [string, string]> = { a: ["a", "ây"], b: ["bê", "bi"], c: ["xê", "xi"], d: ["đê", "đi"], e: ["e", "i"], f: ["ép", "ép"], g: ["gờ", "gi"], h: ["hát", "ết"], i: ["i", "ai"], j: ["gi", "giây"], k: ["ca", "kây"], l: ["lờ", "eo"], m: ["em", "em"], n: ["en", "en"], o: ["ô", "âu"], p: ["pê", "pi"], q: ["qui", "kiu"], r: ["rờ", "a"], s: ["ét", "ét"], t: ["tê", "ti"], u: ["u", "diu"], v: ["vê", "vi"], w: ["vê kép", "đáp bờ liu"], x: ["ích", "ích"], y: ["i dài", "oai"], z: ["dét", "di"] };
const NUM = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
/** Số đọc thành chữ (0–99): 1 → "một", 15 → "mười lăm", 21 → "hai mươi mốt". */
const numVi = (n: number): string => n < 10 ? NUM[n] : n < 20 ? "mười" + (n % 10 ? " " + (n % 10 === 5 ? "lăm" : NUM[n % 10]) : "") : NUM[Math.floor(n / 10)] + " mươi" + (n % 10 ? " " + (n % 10 === 1 ? "mốt" : n % 10 === 5 ? "lăm" : NUM[n % 10]) : "");
function spellAliases(canon: string) {
  const out: string[] = [];
  if (/\d/.test(canon) && !/\d{3,}/.test(canon)) out.push(canon.replace(/(\d+)\.(\d+)/g, "$1 chấm $2").replace(/\d+/g, (d) => " " + numVi(+d) + " ").replace(/\s+/g, " ").trim());   // "New 1" → "new một", "Hạng 12" → "hạng mười hai"
  for (const w of canon.split(/[\s/]+/)) {
    if (!/^[A-Za-z0-9&]{2,6}$/.test(w) || !/[A-Z].*[A-Z]|[A-Z]\d|\d[A-Z]/.test(w)) continue;
    for (const k of [0, 1]) out.push(canon.replace(w, [...w.toLowerCase()].map((ch) => /\d/.test(ch) ? NUM[+ch] : ch === "&" ? "và" : LET[ch]?.[k] || ch).join(" ")));
  }
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

/* ================= cách nghe nhầm do AI sinh (học dần, lưu vĩnh viễn) ================= */
const LDIR = () => path.join(/*turbopackIgnore: true*/ C.data, "lexicon");
const ALIAS_FILE = () => path.join(LDIR(), "aliases.json");
let aliasBusy = false;
/** Chỉ chạy khi huấn luyện (train): AI viết cách đọc cho các thuật ngữ nước ngoài / viết tắt chưa học. Trả về số từ đã học + token đã dùng. */
async function learnAliases(entries: Entry[], max = Infinity, until = Infinity) {
  const out = { learned: 0, input: 0, output: 0, calls: 0, left: 0 }; if (aliasBusy || !C.key) return out; aliasBusy = true;
  try {
    const known = rj<Record<string, string[]>>(ALIAS_FILE(), {});
    const todo = entries.filter((e) => !(e.c in known) && foreign(e.c) && ["sys", "term", "tech", "customer", "job", "code", "mined", "nick", "place"].includes(e.k)).sort((a, b) => b.w - a.w).slice(0, max);
    out.left = todo.length;
    for (let i = 0; i < todo.length; i += 100) {
      if (Date.now() > until) break;                                                         // hết thời gian cho phép: lần sau học tiếp
      const batch = todo.slice(i, i + 100).map((e) => e.c);
      const ins = "Bạn giúp bộ nhận giọng nói tiếng Việt (Google, vi-VN) trong các cuộc họp của công ty tuyển dụng IT Intalent. Với MỖI thuật ngữ / tên riêng trong danh sách, liệt kê 2–5 cách người Việt hay ĐỌC nó và bộ nhận giọng hay VIẾT RA (phiên âm kiểu Việt, tách âm, đọc từng chữ cái, dấu sai), viết thường. Ví dụ: \"BrSE\" → [\"bờ rích\",\"bờ rít\",\"bi a ét\"], \"HireX\" → [\"hai rếch\",\"hai ếch\"], \"Comtor\" → [\"côm tơ\"], \"Monstarlab\" → [\"môn sờ ta láp\",\"mon sta lab\"]. Không thêm giải thích. Trả về JSON: {\"items\":[{\"term\":\"...\",\"spoken\":[\"...\"]}]}.";
      try {
        const r = await postOpenAIResponse({ apiKey: C.key, timeoutMs: 120000, body: { model: C.text, instructions: ins, input: batch.join("\n"), reasoning: { effort: "low" },
          text: { format: { type: "json_schema", name: "aliases", strict: true, schema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["term", "spoken"], properties: { term: { type: "string" }, spoken: { type: "array", items: { type: "string" } } } } } } } } } } });
        if (!r.ok) { console.warn("[Cuộc họp] học cách đọc:", r.status); break; }
        const res = await r.json() as { usage?: { input_tokens?: number; output_tokens?: number } }; out.calls++; out.input += res.usage?.input_tokens || 0; out.output += res.usage?.output_tokens || 0;
        const j = JSON.parse(responseOutputText(res)) as { items: { term: string; spoken: string[] }[] };
        const got = new Map(j.items.map((x) => [x.term, x.spoken]));
        for (const t of batch) { known[t] = (got.get(t) || []).map(S).filter((s) => s && s.length <= 60 && nrm(s) !== nrm(t)).slice(0, 6); out.learned++; out.left--; }
        fs.mkdirSync(LDIR(), { recursive: true }); fs.writeFileSync(ALIAS_FILE(), JSON.stringify(known));
      } catch (e) { console.warn("[Cuộc họp] học cách đọc lỗi:", e instanceof Error ? e.message : e); break; }
    }
  } finally { aliasBusy = false; }
  return out;
}

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
  for (const [c, k, a] of CORE) add(c, k, 1.6, a);
  for (const p of PLACES) add(p, "place", 1.1, PLACE_AL[p] || []);
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
  for (const x of mine(corpus)) add(x.c, "mined", 0.6 + Math.min(0.6, x.score / 40));
  // cách đọc: tự sinh cho chữ viết tắt + AI đã học
  const learned = rj<Record<string, string[]>>(ALIAS_FILE(), {});
  for (const e of map.values()) { for (const a of spellAliases(e.c)) if (!e.a.includes(a)) e.a.push(a); for (const a of learned[e.c] || []) if (!e.a.includes(a)) e.a.push(a); }
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
  const learned = rj<Record<string, string[]>>(ALIAS_FILE(), {});
  for (const e of saved.entries) for (const a of learned[e.c] || []) if (!e.a.includes(a)) e.a.push(a);
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
  try { return await building.get(ws)!; } catch { const l = Object.assign(index(CORE.map(([c, k, a]) => ({ c, k, w: 1.6, a }))), { mt: -1 }); cache.set(ws, l); return l; }
}
/**
 * HUẤN LUYỆN (chạy khi người dùng ra lệnh, ví dụ chat "Huấn luyện ghi âm full db"):
 * đọc lại toàn bộ dữ liệu HireX → dựng từ điển → AI học cách đọc cho mọi thuật ngữ mới chưa học (tốn ít token, mỗi từ một lần) → lưu file.
 * Trả về thống kê để báo lại người dùng.
 */
export async function train(ws = "", opts: { ai?: boolean; seconds?: number } = {}) {
  const t0 = Date.now(), before = rj<{ entries?: Entry[] }>(LFILE(ws), {}).entries || [];
  let entries = await build(ws);
  const ai = opts.ai === false ? { learned: 0, input: 0, output: 0, calls: 0, left: 0 } : await learnAliases(entries, Infinity, opts.seconds ? t0 + opts.seconds * 1000 : Infinity);
  if (ai.learned) entries = await build(ws);                                               // dựng lại để gắn cách đọc vừa học
  const old = new Set(before.map((e) => e.c)), added = entries.filter((e) => !old.has(e.c));
  const stats = { entries: entries.length, kinds: summary(entries), added: added.length, addedSample: added.slice(0, 30).map((e) => `${e.c} (${KIND_VI[e.k]})`), aiLearned: ai.learned, aiLeft: ai.left, aiCalls: ai.calls, aiTokens: ai.input + ai.output, ms: Date.now() - t0 };
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
  return [...lex.entries].sort((a, b) => rank[b.k] - rank[a.k] || b.w - a.w).slice(0, n).map((e) => ({ p: e.c, b: Math.round((1 + rank[e.k] / 3) * 10) / 10 }));
}
/** Thuật ngữ thực sự xuất hiện trong cuộc họp (đếm từ phụ đề + bản gốc), dùng cho prompt phiên âm và bảng thuật ngữ của biên bản. */
export function topHits(lex: Lex, hits: Map<string, number>, n = 60) {
  const by = new Map(lex.entries.map((e) => [e.c, e]));
  return [...hits.entries()].map(([c, k]) => ({ e: by.get(c), k })).filter((x): x is { e: Entry; k: number } => !!x.e).sort((a, b) => b.k * b.e.w - a.k * a.e.w).slice(0, n);
}
export const KIND_VI: Record<Kind, string> = { sys: "màn / chức năng HireX", term: "thuật ngữ", person: "người", customer: "khách hàng", job: "job", code: "mã / hạng / trạng thái", place: "địa điểm", tag: "nhãn", doc: "tài liệu", nick: "nick kênh", tech: "kỹ năng / công nghệ", mined: "thuật ngữ nội bộ" };
