import "server-only";

import { JAR, readHead, warmGet, okHost, NetError } from "./fb-http";
import { PyError, cut, fixUrl, hostnameOf, htmlUnescape, jsonDumps, pathOf, plen, pyRe, quote, reEscape, strip, truthy, urlencode } from "./pyish";
import { jsonLoads } from "./owl-postfb";
import { impersonating, open } from "./web-client";
import type { CheckOpt, CheckOut, CheckerMeta, CheckerMod } from "./checker-mods";

/* Vọng gác · Facebook / FB Page — port 1:1 của worker/checkfb.py + checkfbpage.py (chạy ngay trong máy chủ, không cần worker Python).
   Live / Die: graph.facebook.com/<uid>/picture (nhanh, nhẹ) → không rõ thì đối chiếu HTML facebook.com/<uid> (route CometErrorRoute = Die).
   Live thì đọc tên: HTML og:title + route · Page Plugin · GraphQL công khai ProfilePlus (phân loại Page / profile chuyên nghiệp), qua các "cổng"
   giới hạn đồng thời + tự giãn khoảng cách theo tỉ lệ lỗi. Lỗi mạng / bị chặn / không chắc → error (giữ nguyên trạng thái).
   Khác bản Python duy nhất: không ghi file gỡ lỗi _fbdebug (máy chủ web không ghi đĩa), gợi ý cài thư viện là `npm i impit`. */

/** tên "rác" Facebook trả khi bị chặn / trang trung gian (nhiều ngôn ngữ) → không bao giờ ghi vào cột tên */
export const FB_JUNK = String.raw`^\s*(redirecting|đang chuyển hướng|log in|log into|login|sign up|sign in|đăng nhập|đăng ký|facebook\s*$|security check|kiểm tra bảo mật|`
  + String.raw`error\b|lỗi\b|page not found|content not found|something went wrong|you must log in|you're temporarily|bạn tạm thời|`
  + String.raw`this content isn|nội dung này hiện|this page isn|trang này hiện|oops|sorry|xin lỗi|checkpoint|connect with|kết nối với)|log in or sign up|đăng nhập hoặc đăng ký`;
const JUNK = pyRe(FB_JUNK, "i");

const FB_FIELDS = [{ k: "cookie", label: "Cookie", secret: true, ph: "Tùy chọn · giúp đọc tên ổn định hơn" }, { k: "refresh", label: "Đọc lại tên", ph: "Trống = chỉ đọc ô tên còn trống · 1 = đọc lại tất cả" }];
export const FB_METAS: CheckerMeta[] = [
  { id: "fb", name: "Facebook", icon: "facebook", value: "UID Facebook", hint_tab: ["facebook", "fb", "via", "clone"], hint_field: ["uid", "id facebook", "id fb", "fb id", "id"], fields: FB_FIELDS,
    extra: [{ k: "name", label: "Tên FB", type: "text", icon: "user", match: ["ten fb", "ten facebook", "ten tai khoan", "fb name", "ten", "name", "ho ten"], hint: "Profile: Tên · Page: Page (Tên) · chỉ ghi khi Live", skip_filled: true, junk: FB_JUNK, stale: String.raw`\s\|\s` }],
    desc: "Graph picture: có ảnh thật = Live · ảnh trống (rsrc.php, không có height) = Die · bị giới hạn / lỗi = giữ nguyên. Live thì mở facebook.com/<uid> đọc tên.", threads: 5, timeout: 12 },
  { id: "fbpage", name: "FB Page", icon: "flag", value: "UID Page", hint_tab: ["fb page", "fanpage", "page"], hint_field: ["uid page", "page id", "id page", "uid", "id"], fields: FB_FIELDS,
    extra: [{ k: "name", label: "Tên Page", type: "text", icon: "flag", match: ["ten page", "ten fanpage", "ten trang", "page name", "ten", "name"], hint: "Page: Tên · lẫn profile: Profile (Tên) · chỉ ghi khi Live", skip_filled: true, junk: FB_JUNK, stale: String.raw`\s\|\s` }],
    desc: "Giống Facebook (Graph picture + đọc tên Page từ facebook.com/<id> khi Live).", threads: 5, timeout: 12 },
];

/* ───────── tiện ích chung ───────── */
export class Stopped extends Error { override name = "Stopped"; }
/** random có thể thay khi kiểm thử */
export const hooks = { random: () => Math.random(), now: () => Date.now() / 1000, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };
const uniform = (a: number, b: number) => a + (b - a) * hooks.random();
const randrange = (n: number) => Math.floor(hooks.random() * n);

export interface FbOpt extends CheckOpt { fmt?: [string, string]; name_src?: string; page_tag?: boolean }
const stoppedOf = (opt?: CheckOpt) => Boolean(opt?.stopped?.());
/** ngủ nhưng nhả ngay khi bấm Dừng (kiểm tra mỗi ≤0.1s) */
async function nap(sec: number, opt?: CheckOpt) {
  const end = hooks.now() + sec;
  for (;;) { if (stoppedOf(opt)) throw new Stopped(); const left = end - hooks.now(); if (left <= 0) return; await hooks.sleep(Math.min(100, left * 1000)); }
}
/** type(e).__name__ */
const ename = (e: unknown): string => e instanceof NetError ? e.kind : e instanceof PyError ? e.pyName : e instanceof Stopped ? "Stopped" : e instanceof Error ? (e.name !== "Error" ? e.name : e.constructor.name) : "Exception";
const tmo = (opt: CheckOpt, d: number) => Number(opt.timeout) || d;
const proxyOf = (opt: CheckOpt) => String(opt.proxy || "");
const cookieOf = (opt: CheckOpt) => { const c = opt.x?.cookie; return strip(truthy(c) ? String(c) : ""); };
/** fmt % nm */
const fmtS = (f: string, nm: string) => f.replace("%s", () => nm);

/* ───────── cổng: giới hạn đồng thời + khoảng cách tối thiểu, tự giãn theo tỉ lệ lỗi gần đây ───────── */
class Gate {
  f = 0; next = 0; private act = 0; private waiters: Array<() => void> = [];
  constructor(private ivmin: number, private cap: number, private n: number) {}
  slots(n: number) { this.n = n; }
  iv() { return Math.min(this.cap, this.ivmin * (1 + 10 * this.f)); }
  private async acquire(opt?: CheckOpt) {
    while (this.act >= this.n) {                                           // chờ chỗ trống nhưng vẫn nghe lệnh Dừng
      await new Promise<void>((ok) => {
        let t: ReturnType<typeof setTimeout> | undefined; // eslint-disable-line prefer-const
        const done = () => { if (t) clearTimeout(t); const i = this.waiters.indexOf(done); if (i >= 0) this.waiters.splice(i, 1); ok(); };
        t = setTimeout(done, 100); this.waiters.push(done);
      });
      if (this.act >= this.n && stoppedOf(opt)) throw new Stopped();
    }
    this.act++;
  }
  private release() { this.act--; const w = this.waiters.shift(); if (w) w(); }
  async run<T>(fn: () => Promise<T>, opt?: CheckOpt): Promise<T> {
    await this.acquire(opt);
    try {
      if (stoppedOf(opt)) throw new Stopped();
      const now = hooks.now(), slot = Math.max(now, this.next);
      this.next = slot + this.iv();
      if (slot > now) await nap(slot - now, opt);
      return await fn();
    } finally { this.release(); }
  }
  note(ok: boolean, hard = false) { this.f = this.f * 0.85 + (ok ? 0 : 0.15); if (hard) this.next = Math.max(this.next, hooks.now() + 2.0); }
}
const G_HTML = new Gate(0.2, 2.5, 4), G_PLG = new Gate(0.1, 1.5, 6), G_GQL = new Gate(0.1, 1.5, 6);
const ST = { warm: 0, gqlTry: 0, gqlDoc: "28585259111117102" };                 // doc_id hiện tại; Facebook đổi thì tự dò lại trong bundle JS
/** đặt lại trạng thái dùng chung (chỉ để kiểm thử) */
export function __reset() { for (const g of [G_HTML, G_PLG, G_GQL]) { g.f = 0; g.next = 0; } ST.warm = 0; ST.gqlTry = 0; ST.gqlDoc = "28585259111117102"; JAR.clear(); }
function gateSlots(threads: unknown) {
  const t = Math.trunc(Number(truthy(threads) ? threads : 10)) || 10;
  G_HTML.slots(Math.max(2, Math.min(6, Math.trunc(t / 5))));
  G_PLG.slots(Math.max(2, Math.min(10, Math.trunc(t / 4))));
  G_GQL.slots(Math.max(2, Math.min(10, Math.trunc(t / 4))));
}

/* ───────── header giống trình duyệt thật ───────── */
const CH = ['"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"', '"Chromium";v="123", "Microsoft Edge";v="123", "Not:A-Brand";v="8"'];
const PROF: Array<[string, string]> = [   // bộ header ĐỒNG BỘ theo từng trình duyệt (UA khớp sec-ch-ua / sec-fetch-*) — Facebook chặn 400 khi UA nói Chrome mà thiếu/lệch header đi kèm
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", CH[0]],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0", ""],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0", CH[1]]];
type H = Map<string, string>;
function hdr(opt: CheckOpt, variant = 0, plugin = false): H {
  const [ua, ch] = PROF[(randrange(PROF.length) + variant) % PROF.length];
  const h: H = new Map();
  if (ch) { h.set("sec-ch-ua", ch); h.set("sec-ch-ua-mobile", "?0"); h.set("sec-ch-ua-platform", '"Windows"'); }
  h.set("Upgrade-Insecure-Requests", "1"); h.set("User-Agent", ua);
  h.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8");
  h.set("Sec-Fetch-Site", plugin ? "cross-site" : "none"); h.set("Sec-Fetch-Mode", "navigate"); h.set("Sec-Fetch-Dest", plugin ? "iframe" : "document");
  h.set("Accept-Encoding", "gzip"); h.set("Accept-Language", "en-US,en;q=0.9");
  if (!plugin) h.set("Sec-Fetch-User", "?1"); else h.set("Referer", "https://developers.facebook.com/");
  const ck = cookieOf(opt); if (ck) h.set("Cookie", ck);
  return h;
}
const rh = (h: H): Array<[string, string]> => [...h];
const UAS = PROF.map((p) => p[0]);

/* ───────── Graph: Live / Die nhanh ───────── */
const RATE = new Set([4, 17, 32, 341, 613]);                                    // mã lỗi Graph = bị giới hạn tốc độ (không phải Die)
const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const dget = (d: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : undefined);
/** str(v) tối thiểu cho giá trị JSON */
const pyStr = (v: unknown): string => typeof v === "string" ? v : v === null || v === undefined ? "None" : typeof v === "boolean" ? (v ? "True" : "False") : typeof v === "object" ? JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)) : String(v);
const inRate = (v: unknown) => { if (typeof v === "object" && v !== null) throw new PyError("TypeError", "unhashable type"); return (typeof v === "number" && RATE.has(v)) || (typeof v === "bigint" && RATE.has(Number(v))); };

/** graph.facebook.com/<uid>/picture?redirect=false → ['live'|'die'|null, ghi chú]
 *  Live: JSON có "height" + url ảnh thật (scontent…) · Die: không có "height", url là ảnh trống static.xx.fbcdn.net/rsrc.php
 *  (302 KHÔNG đủ để kết luận: UID Die vẫn 302 sang ảnh trống → cách cũ báo Live nhầm) */
async function graph(uid: string, opt: CheckOpt): Promise<[string | null, string]> {
  let url = `https://graph.facebook.com/${uid}/picture?redirect=false&type=normal`;
  const h: Array<[string, string]> = [["User-Agent", UAS[randrange(UAS.length)]], ["Accept", "application/json"]];
  let code = 0, body: Buffer = Buffer.alloc(0);
  for (let hop = 0; ; hop++) {
    const head = await open(url, { headers: h, timeout: tmo(opt, 10), proxy: proxyOf(opt) });
    if ([301, 302, 303, 307, 308].includes(head.status) && head.location) {
      head.close();
      if (hop >= 10) throw new NetError("HTTPError");
      url = new URL(head.location.replace(/ /g, "%20"), url).toString(); continue;
    }
    code = head.status; body = await head.read(20000); break;
  }
  let j: unknown;
  try { j = jsonLoads(body.toString("utf8") || "{}"); } catch { j = {}; }
  const err = isDict(j) ? dget(j, "error") : undefined;
  if (truthy(err)) {
    if (!isDict(err)) throw new PyError("AttributeError", "'" + (Array.isArray(err) ? "list" : typeof err === "string" ? "str" : "int") + "' object has no attribute 'get'");
    const ec = dget(err, "code");
    if (inRate(ec) || code === 429 || code === 403) return [null, "Facebook giới hạn tốc độ (giảm luồng / dùng proxy)"];
    if (code === 400 || code === 404) return ["die", "Die · UID không tồn tại"];
    return [null, "lỗi Graph " + pyStr(ec)];
  }
  const d = isDict(j) ? dget(j, "data") : undefined;
  if (code === 200 && isDict(d)) {
    const u = truthy(dget(d, "url")) ? pyStr(dget(d, "url")) : "";
    if (truthy(dget(d, "height")) || (u && !u.includes("rsrc.php"))) return ["live", "Live"];
    if (u.includes("rsrc.php")) return ["die", "Die · không khả dụng"];
  }
  if (code === 400 || code === 404) return ["die", "Die · " + code];
  return [null, "HTTP " + code];
}

/** lấy UID số từ giá trị ô (chấp nhận cả link facebook.com/profile.php?id=...) */
const UID_RE = pyRe("(\\d{5,20})");
export function norm(value: unknown): string { const m = UID_RE.exec(truthy(value) ? String(value) : ""); return m ? m[1] : ""; }

/* ───────── đọc tên tài khoản từ HTML facebook.com/<uid> (đã đối chiếu với HTML thật: profile / page) ─────────
   Profile : <meta og:title="Truong An">  ·  canonicalRouteName = comet.fbweb.CometProfileLoggedOutRoute
   Page    : <meta og:title="Hạ Anhhh">   ·  canonicalRouteName = comet.fbweb.CometProfilePlusLoggedOutRoute  (+ "delegate_page":{"id":...})
   og:title nằm đầu trang (~1KB), route ở ~130KB → chỉ tải ≤ 450KB đầu rồi dừng. */
const RT = pyRe('canonicalRouteName":"comet\\.fbweb\\.(\\w+)"');
const GENERIC = new Set(["redirecting...", "redirecting…", "redirecting", "đang chuyển hướng...", "facebook", "log in to facebook", "log into facebook", "đăng nhập facebook", "đăng nhập hoặc đăng ký",
  "facebook - log in or sign up", "facebook – log in or sign up", "error", "lỗi", "security check", "page not found", "content not found", "nội dung này hiện không khả dụng", "this content isn't available right now"]);
const GOOD_RT = /^Comet(Profile|Page)/;
const META_TAG = pyRe("<meta\\b[^>]*>", "g");
const CONTENT = pyRe('content="([^"]*)"');
const metaRe = new Map<string, RegExp>();
function meta(html: string, prop: string): string {
  let re = metaRe.get(prop); if (!re) { re = pyRe('(?:property|name)="' + reEscape(prop) + '"'); metaRe.set(prop, re); }
  META_TAG.lastIndex = 0;
  const head = cut(html, 60000);
  for (let m = META_TAG.exec(head); m; m = META_TAG.exec(head)) {
    const t = m[0];
    if (re.test(t)) { const c = CONTENT.exec(t); if (c) return strip(htmlUnescape(c[1])); }
    if (m[0].length === 0) META_TAG.lastIndex++;
  }
  return "";
}
export function route(html: string): string { const m = RT.exec(html); return m ? m[1] : ""; }
const LOC = pyRe("^(.*\\S)\\s+\\|\\s+([^|]+?)\\s*$");
/** Page có đặt địa điểm: og:title = "Tên | Địa điểm " (mô tả: "Tên, Địa điểm. …") → chỉ lấy Tên. Tên có "|" thật (mô tả bắt đầu bằng đúng tiêu đề) thì giữ nguyên. */
function stripLoc(nm: string, desc: string): string {
  const m = LOC.exec(nm);
  if (!m) return nm;
  if (strip(desc || "").startsWith(nm)) return nm;
  return strip(m[1]);
}
const PLG_A = pyRe('<a\\b[^>]*class="[^"]*\\b_1drp\\b[^"]*"[^>]*>([^<]*)</a>');
const PLG_T = pyRe('\\btitle="([^"]*)"');
const PN = pyRe('"pageName":"((?:[^"\\\\]|\\\\.)*)"');
/** Page Plugin → [tên sạch | '', là_Page_kiểu_cũ]. Page: <a class="_1drp" title="Tên"> (~50KB) → chắc chắn Page · Page mới / profile chuyên nghiệp: tên nằm trong props JSON "pageName" → chỉ có TÊN, KHÔNG phân biệt được loại */
export function parsePlugin2(html: string): [string, boolean] {
  let nm: string, pg: boolean;
  const m = PLG_A.exec(html);
  if (m) { const t = PLG_T.exec(m[0]); nm = strip(htmlUnescape(truthy(t ? t[1] : m[1]) ? (t ? t[1] : m[1]) : "")); pg = true; }
  else {
    const p = PN.exec(html);
    if (!p) return ["", false];
    try { nm = strip(JSON.parse('"' + p[1] + '"') as string); } catch { return ["", false]; }
    pg = false;
  }
  if (!nm || GENERIC.has(nm.toLowerCase()) || JUNK.test(nm)) return ["", pg];
  return [nm, pg];
}
const TITLE_RE = pyRe("<title[^>]*>([^<]*)</title>", "i");
const FB_TAIL = pyRe("\\s*[|\\-–]\\s*Facebook\\s*$");
/** → [tên | '', loại, lý do]. loại: 'page' (route CometPage…) · 'profile' (CometProfile…) · 'plus' (CometProfilePlus…).
 *  CHÚ Ý 'plus': route ProfilePlus dùng cho CẢ Page kiểu mới LẪN profile bật chế độ chuyên nghiệp (HTML khi chưa đăng nhập của 2 loại này giống hệt nhau)
 *  → không được suy ra Page từ route; phải hỏi Plugin Page / GraphQL. */
export function parseHtml(html: string, uid: string): [string, string, string] {
  const head = cut(html, 60000);
  let nm = meta(html, "og:title");
  if (!nm) { const t = TITLE_RE.exec(head); nm = t ? strip(htmlUnescape(t[1])) : ""; }
  nm = strip(nm.replace(FB_TAIL, ""));
  nm = stripLoc(nm, meta(html, "og:description"));
  if (!nm || GENERIC.has(nm.toLowerCase()) || JUNK.test(nm)) return ["", "", "chưa đọc được tên (trang đăng nhập / bị chặn)"];
  if (!head.includes(uid)) return ["", "", "chưa đọc được tên (trang không khớp UID)"];   // og:url / al:android:url = fb://profile/<uid>
  const rt = route(html);
  if (!GOOD_RT.test(rt)) return ["", "", "chưa đọc được tên (" + (rt || "trang chưa tải đủ") + ")"];   // chỉ tin tên khi route đúng là trang profile / page
  return [nm, rt.startsWith("CometPage") ? "page" : rt.includes("ProfilePlus") ? "plus" : "profile", ""];
}
/** → [tên | '', lý do]. Loại 'plus' (chưa phân biệt được Page / profile chuyên nghiệp) → KHÔNG trả tên, để nơi gọi hỏi Plugin. */
export function parseName(html: string, uid: string, fmt: [string, string] = ["Page (%s)", "%s"]): [string, string] {
  const [nm, kind, why] = parseHtml(html, uid);
  if (!nm) return ["", why];
  if (kind === "plus") return ["", "chưa phân biệt Page / profile"];
  return [fmtS(kind === "page" ? fmt[0] : fmt[1], nm), ""];
}
/** → ['live'|'die'|'error', ghi chú, tên] */
export function classify(uid: string, st: number, fu: string, html: string, fmt: [string, string] = ["Page (%s)", "%s"]): [string, string, string] {
  const path = pathOf(fu || "").toLowerCase();
  if (st === 404) return ["die", "404", ""];
  if (st === 401 || st === 403 || st === 429 || st >= 500) return ["error", `HTTP ${st} (bị chặn / lỗi Facebook)`, ""];
  if (path.startsWith("/login") || path.startsWith("/checkpoint") || path.startsWith("/recover")) return ["error", "bị đẩy về đăng nhập (thử proxy / cookie)", ""];
  const [nm] = parseName(html, uid, fmt);
  if (nm) return ["live", "Live", nm];
  const rt = route(html);
  if (rt.startsWith("CometProfilePlus")) return ["live", "Live", ""];            // sống (Page mới / profile chuyên nghiệp) nhưng chưa biết loại: tên sẽ đọc ở lượt sau
  if (rt === "CometErrorRoute") return ["die", "Die · nội dung không khả dụng", ""];
  if (!rt) return ["error", "chưa đọc được trang (bị chặn / chưa tải đủ)", ""];
  return ["error", `chưa xác định (${rt})`, ""];
}

/* ───────── tải trang qua các cổng ───────── */
const wwwUrl = (uid: string) => `https://www.facebook.com/${uid}`;
const fetchHtml = (uid: string, opt: CheckOpt, variant = 0) => readHead(wwwUrl(uid), rh(hdr(opt, variant)), tmo(opt, 10) + 5, proxyOf(opt));
const fetchGated = (uid: string, opt: CheckOpt, variant = 0) => G_HTML.run(() => fetchHtml(uid, opt, variant), opt);
const pluginUrl = (uid: string) => "https://www.facebook.com/plugins/page.php?href=" + quote("https://www.facebook.com/" + uid, "") + "&tabs=&width=340&height=130&small_header=true";
/** Page Plugin (embed chính thức, ~50KB): trả TÊN PAGE sạch (không kèm "| Địa điểm"). Chỉ Page; profile cá nhân không có → trang lỗi 19KB */
const fetchPlugin = (uid: string, opt: CheckOpt, variant = 0) => G_PLG.run(() => readHead(pluginUrl(uid), rh(hdr(opt, variant, true)), tmo(opt, 10) + 5, proxyOf(opt), 120_000), opt);

/** lấy cookie nền (datr…) 1 lần / 20 phút, chỉ đọc header */
async function warm(opt: CheckOpt) {
  if (hooks.now() - ST.warm < 1200 || truthy(opt.x?.cookie)) return;
  ST.warm = hooks.now();
  await warmGet("https://www.facebook.com/", rh(hdr(opt)), 10, proxyOf(opt));
}

/* ───────── phân loại Page / profile chuyên nghiệp: truy vấn GraphQL công khai (không cần đăng nhập) ─────────
   Trang facebook.com/<uid> (route ProfilePlus) tự gọi ProfilePlusCometLoggedOutRootQuery; phản hồi có dòng giới thiệu
     "Page · Recruiter" (Page) | "Profile · Digital creator" (profile bật chế độ chuyên nghiệp)
   Dòng này nằm ngay đầu phản hồi (~3-4KB) → chỉ đọc 16KB đầu rồi đóng. Không cần lsd / cookie / token. */
const GQL_URL = "https://www.facebook.com/api/graphql/", GQL_NAME = "ProfilePlusCometLoggedOutRootQuery";
const KIND_WORDS: Record<string, Set<string>> = {
  page: new Set(["page", "trang", "página", "pagina", "seite", "halaman", "страница"]),
  profile: new Set(["profile", "trang cá nhân", "perfil", "profil", "profilo", "profiel", "профиль"]) };
const CAT = pyRe('InfluencerCategoryContextItemRenderer.{0,1500}?"text":"((?:[^"\\\\]|\\\\.)*)"', "s");
/** → ['page' | 'profile' | null, dòng giới thiệu] */
export function parseGql(body: string): [string | null, string] {
  const m = CAT.exec(body || "");
  if (!m) return [null, ""];
  let t: string; try { t = JSON.parse('"' + m[1] + '"') as string; } catch { t = m[1]; }
  const first = strip(t.split("\u00b7")[0]).toLowerCase();
  for (const [k, ws] of Object.entries(KIND_WORDS)) if (ws.has(first)) return [k, t];
  return [null, t];
}
function gqlBody(uid: string, doc: string): string {
  return urlencode([["av", "0"], ["__a", "1"], ["__comet_req", "15"], ["fb_api_caller_class", "RelayModern"], ["fb_api_req_friendly_name", GQL_NAME],
    ["variables", jsonDumps({ scale: 1, userID: uid, __relay_internal__pv__ProfileCometFeaturedHighlightsPortraitAspectRatioGKrelayprovider: false }, true)],
    ["server_timestamps", "true"], ["doc_id", doc]]);
}
const JS_URL = pyRe("https:\\\\?/\\\\?/static\\.xx\\.fbcdn\\.net\\\\?/rsrc\\.php\\\\?/[^\"'\\s\\\\]+?\\.js", "g");
const DOC_RE = pyRe('__d\\("' + GQL_NAME + '_facebookRelayOperation",\\[\\],\\(function\\([^)]*\\)\\{[a-z]\\.exports="(\\d+)"');
/** doc_id đổi theo bản build của Facebook: đọc lại từ các file JS của trang (tối đa 1 lần / 10 phút) */
async function gqlDiscover(uid: string, opt: CheckOpt): Promise<boolean> {
  if (hooks.now() - ST.gqlTry < 600) return false;
  ST.gqlTry = hooks.now();
  try {
    const [, , html] = await readHead(wwwUrl(uid), rh(hdr(opt)), tmo(opt, 10) + 8, proxyOf(opt), 450_000);
    const urls: string[] = [];
    JS_URL.lastIndex = 0;
    for (let m = JS_URL.exec(html); m; m = JS_URL.exec(html)) { const u = m[0].replace(/\\\//g, "/").replace(/\\/g, ""); if (!urls.includes(u)) urls.push(u); }
    for (const u of urls.slice(0, 14)) {
      const h2 = hdr(opt); h2.set("Accept", "*/*");
      const [, , js] = await readHead(u, rh(h2), 20, proxyOf(opt), 6_000_000);
      const m = DOC_RE.exec(js);
      if (m) { ST.gqlDoc = m[1]; return true; }
    }
  } catch { /* bỏ qua */ }
  return false;
}
/** → [kind, dòng giới thiệu, lý do]. kind: 'page' | 'profile' | null */
async function fetchGql(uid: string, opt: CheckOpt, variant = 0): Promise<[string | null, string, string]> {
  const go = () => {
    const h = hdr(opt, variant);
    for (const [k, v] of [["Accept", "*/*"], ["Content-Type", "application/x-www-form-urlencoded"], ["Origin", "https://www.facebook.com"], ["Referer", "https://www.facebook.com/"], ["Sec-Fetch-Site", "same-origin"], ["Sec-Fetch-Mode", "cors"], ["Sec-Fetch-Dest", "empty"], ["X-FB-Friendly-Name", GQL_NAME]] as const) h.set(k, v);
    h.delete("Upgrade-Insecure-Requests"); h.delete("Sec-Fetch-User");
    return readHead(GQL_URL, rh(h), tmo(opt, 10) + 5, proxyOf(opt), 16_000, gqlBody(uid, ST.gqlDoc));
  };
  const [st, , body] = await G_GQL.run(go, opt);
  if (st === 200) {
    const [k, t] = parseGql(body);
    G_GQL.note(true);
    if (k) return [k, t, ""];
    if (cut(body, 400).includes('"errors"') || !cut(body, 20).includes("data")) {
      if (await gqlDiscover(uid, opt)) return [null, "", "doc_id đã đổi (đã dò lại)"];
    }
    return [null, t, "không thấy dòng Page / Profile"];
  }
  G_GQL.note(false, st === 429);
  return [null, "", `gql HTTP ${st}`];
}

const REFRESH = pyRe('http-equiv="refresh"[^>]*content="\\d+;\\s*url=([^"]+)"|(?:location\\.(?:replace|assign)\\(|location(?:\\.href)?\\s*=\\s*)["\']([^"\']+)["\']', "i");

/** → [tên, ''] | ['', lý do]. Mỗi lần thử qua cổng riêng (giới hạn đồng thời + tự giãn theo tỉ lệ lỗi), đổi kiểu request khi bị 400.
 *  PHÂN LOẠI Page / profile (đã đối chiếu Facebook thật, kể cả Page kiểu mới & profile bật chế độ chuyên nghiệp):
 *    · HTML route CometPage… = Page cũ · CometProfile… = profile thường
 *    · HTML route CometProfilePlus… = Page mới HOẶC profile chuyên nghiệp → hỏi GraphQL công khai: "Page · …" = Page · "Profile · …" = profile
 *    · Plugin Page kiểu cũ (class _1drp) cũng là bằng chứng Page
 *    · Không phân biệt được → KHÔNG ghi tên (thà để trống, lượt sau đọc lại, còn hơn ghi nhầm)
 *  TÊN: HTML og:title (đã bỏ " | Địa điểm") hoặc Plugin (tên sạch).
 *  Thứ tự: tab FB Page (name_src='plugin'): Plugin ×2 → HTML ×2 · tab Facebook: HTML ×2 → (GraphQL khi cần loại) → Plugin. */
export async function readName(uid: string, opt: FbOpt, fmt: [string, string] = ["Page (%s)", "%s"]): Promise<[string, string]> {
  let q = opt.name_src === "plugin" ? ["plugin", "plugin", "html", "html"] : ["html", "html", "gql", "plugin", "gql", "plugin"];
  let last = "chưa đọc được tên";
  let hnm = "", hk = "";           // HTML: tên + loại ('page' | 'profile' | 'plus')
  let pnm = "", ppage = false;     // Plugin: tên + có _1drp (chắc chắn Page)
  let gk: string | null = null;    // GraphQL: 'page' | 'profile' | null
  let prog = true;
  const tagged = fmt[0] !== fmt[1];   // có phân biệt Page / profile khi ghi tên (tab Facebook: Page (Tên) · tab FB Page: Profile (Tên))
  const decide = (): string => {
    const nm = pnm && (ppage || gk === "page" || hk === "page") ? pnm : (hnm || pnm);   // Page: ưu tiên tên sạch của plugin
    if (!nm) return "";
    if (!tagged) return fmtS(fmt[0], nm);
    const kind = hk === "page" || hk === "profile" ? hk : gk || (ppage ? "page" : "");
    if (kind === "page") return fmtS(fmt[0], nm);
    if (kind === "profile") return fmtS(fmt[1], nm);
    return "";
  };
  const needKind = () => tagged && hk !== "page" && hk !== "profile" && gk === null && !ppage;
  let n = 0;
  while (q.length) {
    const src = q.shift()!;
    if ((src === "plugin" && pnm) || (src === "html" && hnm) || (src === "gql" && !needKind())) continue;
    if (n && !prog) await nap([0.3, 0.8, 1.5][Math.min(n - 1, 2)] + hooks.random() * 0.4, opt);   // lượt trước không tiến triển (lỗi / bị chặn) → nghỉ rồi thử lại
    const i = n; n++;
    const snap = [hnm, gk, pnm];
    try {
      if (src === "gql") {
        const [k, , why] = await fetchGql(uid, opt, i);
        if (k) gk = k; else last = `chưa phân biệt được Page / profile (${why})`;
      } else if (src === "plugin") {
        const [st, , html] = await fetchPlugin(uid, opt, i);
        if (st === 200) {
          G_PLG.note(true);
          [pnm, ppage] = parsePlugin2(html);
          if (!pnm) last = "chưa đọc được tên (plugin không có tên)";
        } else { G_PLG.note(false, st === 429); last = `chưa đọc được tên (plugin HTTP ${st})`; }
      } else {
        let [st, fu, html] = await fetchGated(uid, opt, i);
        for (let hop = 0; hop < 2; hop++) {
          const m = (html.length < 60000 || plen(html) < 60000 || cut(html, 3000).toLowerCase().includes("redirecting")) ? REFRESH.exec(cut(html, 20000)) : null;
          if (!m) break;
          const nxt = fixUrl(htmlUnescape(truthy(m[1]) ? m[1] : m[2]).replace(/\\\//g, "/"), fu);
          if (!okHost(hostnameOf(nxt) || "") || nxt.includes("login")) break;
          [st, fu, html] = await readHead(nxt, rh(hdr(opt, i)), tmo(opt, 10) + 5, proxyOf(opt));
        }
        const pth = pathOf(fu).toLowerCase();
        if (st === 200 && !(pth.startsWith("/login") || pth.startsWith("/checkpoint"))) {
          const [nm, kind, why] = parseHtml(html, uid);
          if (nm) { hnm = nm; hk = kind; G_HTML.note(true); } else { last = why; G_HTML.note(false); }
        } else { last = `chưa đọc được tên (HTTP ${st})`; G_HTML.note(false, st === 429); }
      }
    } catch (e) {
      if (e instanceof Stopped) throw e;
      (src === "plugin" ? G_PLG : G_HTML).note(false);
      last = `chưa đọc được tên (${ename(e)})`;
    }
    prog = hnm !== snap[0] || gk !== snap[1] || pnm !== snap[2];
    const d = decide();
    if (d) return [d, ""];
    if (src === "html" && hnm && needKind()) q = ["gql", "gql", "plugin"];            // route ProfilePlus: cần biết Page hay profile → GraphQL ngay
    else if (src === "plugin" && pnm && needKind()) q = ["gql", "gql", "html"];       // plugin chỉ cho tên (không rõ loại) → hỏi GraphQL
    else if (src === "gql" && gk && !(hnm || pnm)) q = ["plugin", "plugin", "html"];  // biết loại rồi nhưng chưa có tên → plugin
  }
  if (!impersonating() && last.includes("400")) last += " · cài impit: npm i impit";     // (bản Python gợi ý cài curl_cffi)
  return ["", last];
}

/* ───────── kiểm tra 1 UID ───────── */
const REFRESH_YES = new Set(["1", "x", "true", "có", "co"]);
/** Live/Die: graph.facebook.com (nhanh, nhẹ, chính xác) · không rõ thì đối chiếu HTML facebook.com/<uid> (route CometErrorRoute = Die).
 *  Live thì mở facebook.com/<uid> đọc tên (nếu bật). Lỗi mạng / bị chặn / không chắc → error: giữ nguyên trạng thái. */
export async function fbCheck(value: string, opt: FbOpt): Promise<CheckOut> {
  try { return await fbCheckNow(value, opt); }
  catch (e) { if (e instanceof Stopped) return { res: "error", info: "Đã dừng" }; throw e; }
}
async function fbCheckNow(value: string, opt: FbOpt): Promise<CheckOut> {
  const uid = norm(value);
  if (!uid) return { res: "error", info: "UID không hợp lệ" };
  const fmt: [string, string] = opt.fmt || [opt.page_tag ?? true ? "Page (%s)" : "%s", "%s"];   // (định dạng khi là Page, định dạng khi là profile)
  const want = (opt.xon ?? ["name"]).includes("name");
  let res: string | null = null, info = "";
  for (let i = 0; i < 2; i++) {                                                   // lỗi mạng → thử lại 1 lần
    await nap(uniform(0.02, 0.15), opt);
    try { [res, info] = await graph(uid, opt); }
    catch (e) { res = null; info = ename(e); }
    if (res) break;
    if (i === 0) await nap(0.5, opt);
  }
  if (!res) {                                                                     // Graph không rõ → hỏi trang HTML
    let r2: string, i2: string, nm: string;
    try { const [st, fu, html] = await fetchGated(uid, opt); [r2, i2, nm] = classify(uid, st, fu, html, fmt); }
    catch (e) { return { res: "error", info: info || ename(e) }; }
    if (r2 === "error") return { res: "error", info: info ? `${info} · ${i2}` : i2 };
    return r2 === "live" && want && nm ? { res: r2, info: i2, extra: { name: nm } } : { res: r2, info: i2 };
  }
  if (res === "die" || !want) return { res, info };
  const have = strip(String(opt.have?.name ?? ""));
  if (have && !JUNK.test(have) && !REFRESH_YES.has(strip(String(opt.x?.refresh ?? "")).toLowerCase()))
    return { res: "live", info: "Live · đã có tên" };                             // lượt chạy lớn: chỉ đọc tên cho ô còn trống / tên rác (đặt "Đọc lại tên" = 1 để đọc lại tất cả)
  gateSlots(opt.threads);
  await warm(opt);
  const [nm, why] = await readName(uid, opt, fmt);
  return nm ? { res: "live", info: `Live · ${nm}`, extra: { name: nm } } : { res: "live", info: `Live · ${why}` };
}

export const fbMod: CheckerMod = { CHECKER: FB_METAS[0], check: (value, opt) => fbCheck(value, opt) };
export const fbpageMod: CheckerMod = { CHECKER: FB_METAS[1], check: (value, opt) => fbCheck(value, { ...opt, fmt: ["%s", "Profile (%s)"], name_src: "plugin" }) };

/** để bài kiểm thử đối chiếu với Python gọi trực tiếp */
export const __t = { graph, norm, parseName, parseHtml, parsePlugin2, parseGql, classify, readName, route, meta, stripLoc, gateSlots, reset: __reset, gqlBody, pluginUrl, ST, hdr, rh, fetchGql, gqlDiscover, G_HTML, G_PLG, G_GQL };
