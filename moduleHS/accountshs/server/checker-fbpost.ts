import "server-only";

import { NetError, request, impersonating, type Hdr } from "./web-client";
import { PyError, asciiDigits, cut, isdigit, pathOf, pyRe, reEscape, strip, truthy } from "./pyish";
import { jsonLoads } from "./owl-postfb";
import { hooks, Stopped } from "./checker-fb";
import type { CheckOpt, CheckOut, CheckerMeta, CheckerMod } from "./checker-mods";

/* Vọng gác · Bài đăng FB (bài viết LIVE / DIE theo UID bài viết) — port 1:1 của worker/checkfbpost.py.
   Logic nhận diện tham khảo từ fb_checklive.py (không phụ thuộc ngôn ngữ):
     - LIVE: facebook.com/{uid} bị chuyển hướng sang URL thật của bài viết, hoặc trang có post_id/story_fbid/og:url chứa UID.
     - DIE : HTTP 404, mã lỗi nội bộ FB (1357031, 1357004…), hoặc trang vỏ chung "Facebook" không có dữ liệu bài.
     - Bị chặn (403/429), bị đẩy về login/checkpoint, lỗi mạng → Lỗi (giữ nguyên trạng thái). */

export const FBPOST_META: CheckerMeta = {
  id: "fbpost", name: "Bài đăng FB", icon: "note", value: "UID bài viết",
  hint_tab: ["bai dang fb", "bai dang", "post fb", "fb post", "bai viet"], hint_field: ["uid bai viet", "uid bai dang", "post id", "id bai viet", "uid", "link bai viet", "link"],
  fields: [{ k: "cookie", label: "Cookie", secret: true, ph: "Tùy chọn · giúp đọc bài ổn định hơn" }],
  // số liệu đọc thêm khi bài LIVE → ghi vào 1 cột của tab (Vọng gác tự tìm / tự tạo cột)
  extra: [{ k: "comments", label: "Số bình luận", type: "number", icon: "chat", match: ["so binh luan", "binh luan", "so comment", "comment", "comments", "so cmt", "cmt"], hint: "Ghi khi bài Live" }],
  threads: 5, timeout: 15,
};

const UAS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"];
const DIE_CODES = ["1357031", "1357004", "1357001", "1357002", "1357033"];

/** UID bài từ số thuần hoặc link (story_fbid=, fbid=, posts/, videos/, permalink/) */
const NORM_A = pyRe("(?:story_fbid=|fbid=|posts/|videos/|permalink/|reel/|/)(\\d{6,})");
const NORM_B = pyRe("\\d{6,}");
export function norm(value: unknown): string {
  const s = strip(truthy(value) ? String(value) : "");
  if (!s) return "";
  if (isdigit(s)) return s;
  let m = NORM_A.exec(s);
  if (m) return m[1];
  m = NORM_B.exec(s);
  return m ? m[0] : "";
}

const RE_OGURL = pyRe('<meta[^>]+property="og:url"[^>]+content="([^"]+)"');
const RE_OGTYPE = pyRe('<meta[^>]+property="og:type"[^>]+content="([^"]+)"');
const RE_OGTITLE = pyRe('<meta[^>]+property="og:title"');
const RE_TITLE = pyRe("<title[^>]*>(.*?)</title>", "si");
const RE_NOTITLE = pyRe('property="og:title"');
const DIE_RE = DIE_CODES.map((c) => pyRe('"error"\\s*:\\s*' + c));

export function classify(uid: string, status: number, finalUrl: string, html: string): [string, string] {
  const u = (finalUrl || "").toLowerCase();
  if (status === 404) return ["die", "HTTP 404"];
  if (status === 429 || status === 403) return ["error", `Bị chặn HTTP ${status} (giảm luồng / đổi proxy)`];
  if (u.includes("/login") || u.includes("checkpoint") || u.includes("login.php")) return ["error", "Bị chuyển về login/checkpoint"];
  const path = pathOf(finalUrl || "").replace(/\/+$/, "");
  if ((finalUrl || "").includes(uid) && path !== "/" + uid) return ["live", "Chuyển hướng về URL bài viết"];
  if (status >= 500) return ["error", `Lỗi server HTTP ${status}`];
  for (let i = 0; i < DIE_CODES.length; i++) {
    const code = DIE_CODES[i];
    if (DIE_RE[i].test(html) || html.includes(`error_code":${code}`)) return ["die", `Mã lỗi FB ${code}`];
  }
  if (pyRe('"(?:story_fbid|top_level_post_id|post_id|video_id)"\\s*:\\s*"?' + reEscape(uid)).test(html)) return ["live", "Có post_id/story_fbid"];
  let m = RE_OGURL.exec(html);
  if (m && m[1].includes(uid)) return ["live", "og:url chứa UID"];
  m = RE_OGTYPE.exec(html);
  if (m && ["article", "video.other", "video.movie", "website"].includes(m[1]) && RE_OGTITLE.test(html) && html.includes(uid)) return ["live", `og:type=${m[1]}`];
  if (status === 200 && !RE_NOTITLE.test(html) && !html.includes(uid)) return ["die", "Trang không có dữ liệu bài viết"];
  const t = RE_TITLE.exec(html);
  const title = t ? cut(strip(t[1]), 50) : "";
  if (status === 200 && path === "/" + uid && title.toLowerCase() === "facebook") return ["die", "Trang chung 'Facebook'"];
  return ["error", `Không xác định (HTTP ${status})`];
}

/* ───────── số bình luận (theo fb_checklive.py: đọc từ HTML bài LIVE, không tốn thêm request) ───────── */
const NUM = "([\\d.,]+\\s?[KkMm]?)";
const CMT = [
  '"comment_count"\\s*:\\s*\\{\\s*"total_count"\\s*:\\s*(\\d+)',
  '"comment_rendering_instance"\\s*:\\s*\\{\\s*"comments"\\s*:\\s*\\{\\s*"total_count"\\s*:\\s*(\\d+)',
  '"comments"\\s*:\\s*\\{\\s*"total_count"\\s*:\\s*(\\d+)',
  '"total_comment_count"\\s*:\\s*(\\d+)',
  '"comment_total_count"\\s*:\\s*(\\d+)',
  '"i18n_comment_count"\\s*:\\s*"' + NUM + '"',
  '"commentCount"\\s*:\\s*"?(\\d+)',
  'CommentAction"[^}]{0,120}?"userInteractionCount"\\s*:\\s*"?(\\d+)',
  '"text"\\s*:\\s*"' + NUM + '\\s+(?:comments?|bình luận)"',
  '>' + NUM + '\\s+(?:comments?|bình luận)<',
].map((p) => pyRe(p, "gs"));

/** round() của Python (làm tròn về số chẵn khi đúng .5) */
function pyRound(x: number): number { const f = Math.floor(x), d = x - f; return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1); }
const FLOAT_OK = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** '1,234' → 1234 · '1.2K' → 1200 · '3M' → 3000000 */
export function count(s0: string): bigint | null {
  const s = strip(String(s0)).replace(/ /g, "");
  if (!s) return null;
  const last = s[s.length - 1];
  if ("KkMm".includes(last)) {
    const t = strip(asciiDigits(s.slice(0, -1).replace(/,/g, ".")));
    if (!FLOAT_OK.test(t)) return null;
    const f = parseFloat(t) * ("Kk".includes(last) ? 1000 : 1000000);
    if (!Number.isFinite(f)) throw new PyError("OverflowError", "cannot convert float infinity to integer");
    return BigInt(pyRound(f));
  }
  const d = s.replace(/[.,]/g, "");
  if (!isdigit(d)) return null;
  if (!/^\p{Nd}+$/u.test(d)) throw new PyError("ValueError", "invalid literal for int()");   // số mũ / vòng tròn: isdigit() đúng nhưng int() báo lỗi
  return BigInt(asciiDigits(d));
}
const SCRIPT_JSON = pyRe('<script[^>]*type="application/json"[^>]*>(.*?)</script>', "gs");
/** số bình luận có sẵn trong HTML (Facebook chỉ nhúng vài bình luận đầu) — dùng làm mức tối thiểu */
function cmtListed(html: string): number {
  const seen = new Set<string>();
  SCRIPT_JSON.lastIndex = 0;
  for (let m = SCRIPT_JSON.exec(html); m; m = SCRIPT_JSON.exec(html)) {
    const blob = m[1];
    if (!blob.includes('"Comment"')) continue;
    let root: unknown; try { root = jsonLoads(blob); } catch { continue; }
    const st: unknown[] = [root];
    while (st.length) {
      const o = st.pop();
      if (Array.isArray(o)) { for (const x of o) st.push(x); }
      else if (typeof o === "object" && o !== null) {
        const d = o as Record<string, unknown>;
        const au = d.author;
        if (d.__typename === "Comment" && typeof au === "object" && au !== null && !Array.isArray(au)) {
          const cid = truthy(d.legacy_fbid) ? String(d.legacy_fbid) : truthy(d.id) ? String(d.id) : "";
          if (cid) seen.add(cid);
        }
        for (const x of Object.values(d)) st.push(x);
      }
    }
  }
  return seen.size;
}
/** số bình luận (int) hoặc null nếu không đọc được; nhiều chỗ khớp → lấy chỗ gần UID bài nhất, ưu tiên > 0 */
export function comments(html: string, uid: string): bigint | number | null {
  // vị trí theo ký tự Unicode như Python (UTF-16 chỉ lệch khi có ký tự ngoài BMP)
  const astral = /[\ud800-\udbff]/.test(html);
  let pre: Int32Array | null = null;
  const cp = (i: number): number => {
    if (!astral) return i;
    if (!pre) { pre = new Int32Array(html.length + 1); for (let k = 0; k < html.length; k++) pre[k + 1] = pre[k] + (html.charCodeAt(k) >= 0xd800 && html.charCodeAt(k) < 0xdc00 ? 1 : 0); }
    return i - pre[i];
  };
  const ai = html.indexOf(uid), anchor = ai < 0 ? -1 : cp(ai);
  let zero = false, n: bigint | null = null;
  for (const pat of CMT) {
    pat.lastIndex = 0;
    const found: Array<[number, bigint]> = [];
    for (let m = pat.exec(html); m; m = pat.exec(html)) { const v = count(m[1]); if (v !== null) found.push([cp(m.index), v]); if (m[0].length === 0) pat.lastIndex++; }
    if (!found.length) continue;
    const pos = found.filter(([, v]) => v > BigInt(0));
    if (pos.length) {
      if (anchor >= 0) pos.sort((a, b) => Math.abs(a[0] - anchor) - Math.abs(b[0] - anchor));
      n = pos[0][1];
      break;
    }
    zero = true;
  }
  if (n === null && zero) n = BigInt(0);
  const k = cmtListed(html);
  if (n === null && !k) return null;
  const big = n !== null && n > BigInt(k) ? n : BigInt(k);
  return big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
}

/** → [status, url cuối, html] (curl_cffi: theo chuyển hướng, giả Chrome · không có: giữ bộ header đầy đủ) */
async function getPage(url: string, hdr: Hdr, timeout: number, proxy: string): Promise<[number, string, string]> {
  const cffi = impersonating();
  const r = await request(url, { headers: cffi ? hdr.filter(([k]) => k.toLowerCase() !== "user-agent") : hdr, timeout, proxy });
  let text = r.text;
  if (!cffi && r.status >= 300 && text.length > 500_000) text = cut(text, 500_000);
  if (!cffi && text.length > 1_000_000 && Buffer.byteLength(text) > 2_000_000) text = Buffer.from(text).subarray(0, 2_000_000).toString("utf8");
  return [r.status, r.url, text];
}
const ename = (e: unknown): string => e instanceof NetError ? e.kind : e instanceof PyError ? e.pyName : e instanceof Error ? (e.name !== "Error" ? e.name : e.constructor.name) : "Exception";

export async function fbpostCheck(value: string, opt: CheckOpt): Promise<CheckOut> {
  const uid = norm(value);
  if (!uid) return { res: "error", info: "UID bài viết không hợp lệ" };
  const hdr: Hdr = [["User-Agent", UAS[Math.floor(hooks.random() * UAS.length)]],
    ["Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"],
    ["Accept-Language", "en-US,en;q=0.9"],           // ép tiếng Anh để HTML ổn định
    ["Upgrade-Insecure-Requests", "1"]];
  const ck = strip(truthy(opt.x?.cookie) ? String(opt.x?.cookie) : "");
  if (ck) hdr.push(["Cookie", ck]);
  const timeout = Number(opt.timeout) || 15;
  let last: CheckOut = { res: "error", info: "Lỗi kết nối" };
  const wait = async (sec: number) => { const end = hooks.now() + sec; while (hooks.now() < end) { if (opt.stopped?.()) throw new Stopped(); await hooks.sleep(Math.min(100, (end - hooks.now()) * 1000)); } };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {              // thử lại 1 lần khi chưa xác định được
      if (opt.stopped?.()) throw new Stopped();
      try {
        const [st, fu, html] = await getPage(`https://www.facebook.com/${uid}`, hdr, timeout, String(opt.proxy || ""));
        const res = classify(uid, st, fu, html);
        if (res[0] === "live") {
          const n = comments(html, uid);
          if (n === null && attempt === 0) {                       // live nhưng chưa đọc được số bình luận → thử lại 1 lần
            last = { res: res[0], info: res[1] + " · chưa đọc được số bình luận", extra: {} };
            await wait(0.6);
            continue;
          }
          return { res: res[0], info: res[1] + (n !== null ? ` · ${n} bình luận` : " · không đọc được số bình luận (thêm cookie)"), extra: n !== null ? { comments: n } : {} };
        }
        if (res[0] !== "error") return { res: res[0], info: res[1] };
        last = { res: res[0], info: res[1] };
      } catch (e) { if (e instanceof Stopped) throw e; last = { res: "error", info: ename(e) }; }
      await wait(0.6 + attempt);
    }
  } catch (e) { if (e instanceof Stopped) return { res: "error", info: "Đã dừng" }; throw e; }
  return last;
}

export const fbpostMod: CheckerMod = { CHECKER: FBPOST_META, check: (value, opt) => fbpostCheck(value, opt) };
export const __t = { norm, classify, count, comments };
