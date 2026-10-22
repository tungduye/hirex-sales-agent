/* Cú vọ — kịch bản "Thu thập bài viết đã đăng lên page" (Facebook Activity Log · GROUPPOSTS).
   Port 1:1 của worker/owl_postfb.py sang TypeScript: cùng hàm, cùng thứ tự xử lý, cùng chuỗi hiển thị.
   Cookie → token → graphql → phân trang. Các chỗ Python và JS khác nhau về ngữ nghĩa được viết lại cho đúng Python
   (cắt chuỗi theo ký tự Unicode, str.strip(), "truthy" của list/dict rỗng, số nguyên lớn, \b theo Unicode, strptime…)
   để cùng đầu vào cho cùng đầu ra. Thêm kịch bản mới = thêm 1 file owl-*.ts + 1 mục ở owl-auto.ts. */
import { impersonating, request, NetError, type Hdr } from "./web-client";

/** Địa chỉ gốc Facebook — đổi được để kiểm thử với máy chủ giả (mặc định là thật) */
export const E = { www: "https://www.facebook.com" };
export const FRIENDLY = "CometActivityLogStoriesListPaginationQuery";
export const DEFAULT_DOC = "27478633398483911";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const TS_KEYS = ["creation_time", "timestamp", "created_time", "node_timestamp"] as const;
const TZ_OFF = 7 * 3600;                                   // giờ hiển thị/lọc theo giờ Việt Nam (UTC+7), không phụ thuộc múi giờ máy chạy
const TOKEN_RE = /"(DTSGInitialData|DTSGInitData|LSD)"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"\\]+)"/g;

export class Fail extends Error {}

/* ───────── tiện ích cho đúng ngữ nghĩa Python ───────── */
type D = Record<string, unknown>;
const isD = (v: unknown): v is D => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (d: D, k: string) => Object.prototype.hasOwnProperty.call(d, k);
/** dict.get(k) */
const g = (d: unknown, k: string): unknown => (isD(d) && has(d, k) ? d[k] : undefined);
/** dict.get(k, mặc định) — khoá có mà giá trị null vẫn là null (không rơi về mặc định) */
const gd = (d: unknown, k: string, def: unknown): unknown => (isD(d) && has(d, k) ? d[k] : def);
/** truthiness của Python (list/dict rỗng, "", 0, None, False đều là sai) */
export const truthy = (v: unknown): boolean => {
  if (v === null || v === undefined || v === false || v === "" || v === 0 || (typeof v === "bigint" && Number(v) === 0)) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isD(v)) return Object.keys(v).length > 0;
  return true;
};
/** a or b or c … (trả giá trị đầu tiên "đúng", không thì giá trị cuối) */
const or = (...v: unknown[]): unknown => { for (let i = 0; i < v.length - 1; i++) if (truthy(v[i])) return v[i]; return v[v.length - 1]; };
const pyType = (v: unknown) => v === null || v === undefined ? "NoneType" : Array.isArray(v) ? "list" : isD(v) ? "dict" : typeof v === "string" ? "str" : typeof v === "boolean" ? "bool" : typeof v === "bigint" || Number.isInteger(v) ? "int" : "float";
/** repr(float) của Python cho số không nguyên */
function pyFloatRepr(x: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return String(x) + ".0";
  const [mant, ex] = x.toExponential().split("e"), e = Number(ex), neg = mant.startsWith("-"), dg = mant.replace("-", "").replace(".", "");
  let out: string;
  if (e >= -4 && e < 16) out = e >= 0 ? (dg.length > e + 1 ? dg.slice(0, e + 1) + "." + dg.slice(e + 1) : dg.padEnd(e + 1, "0") + ".0") : "0." + "0".repeat(-e - 1) + dg;
  else out = dg[0] + (dg.length > 1 ? "." + dg.slice(1) : "") + "e" + (e < 0 ? "-" : "+") + String(Math.abs(e)).padStart(2, "0");
  return (neg ? "-" : "") + out;
}
/** repr(str) của Python */
function pyStrRepr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\"; else if (ch === q) out += "\\" + q; else if (ch === "\n") out += "\\n"; else if (ch === "\r") out += "\\r"; else if (ch === "\t") out += "\\t";
    else if (ch !== " " && /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u.test(ch)) out += c < 0x100 ? "\\x" + c.toString(16).padStart(2, "0") : c < 0x10000 ? "\\u" + c.toString(16).padStart(4, "0") : "\\U" + c.toString(16).padStart(8, "0");
    else out += ch;
  }
  return out + q;
}
/** repr(v) */
function pyRepr(v: unknown): string {
  if (typeof v === "string") return pyStrRepr(v);
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : pyFloatRepr(v);
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
  return "{" + Object.entries(v as D).map(([k, x]) => pyStrRepr(unKey(k)) + ": " + pyRepr(x)).join(", ") + "}";
}
/** str(v) */
const str = (v: unknown): string => (typeof v === "string" ? v : pyRepr(v));
const WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";   // str.isspace()
const WS_L = new RegExp("^[" + WS + "]+"), WS_R = new RegExp("[" + WS + "]+$");
/** str.strip() */
export const strip = (s: string) => s.replace(WS_L, "").replace(WS_R, "");
/** str.strip(chars) */
const stripChars = (s: string, chars: string) => { let a = 0, b = s.length; while (a < b && chars.includes(s[a])) a++; while (b > a && chars.includes(s[b - 1])) b--; return s.slice(a, b); };
/** s[:n] theo ký tự Unicode (Python), không theo đơn vị UTF-16 */
const cut = (s: string, n: number) => { if (s.length <= n) return s; const a = Array.from(s); return a.length <= n ? s : a.slice(0, n).join(""); };
/** s[a:b] với chỉ số âm như Python, theo ký tự Unicode */
function pySlice(s: string, a: number, b: number): string {
  const c = Array.from(s), n = c.length, f = (i: number) => (i < 0 ? Math.max(0, i + n) : Math.min(i, n));
  const x = f(a), y = f(b);
  return x >= y ? "" : c.slice(x, y).join("");
}
/** int(v): ném lỗi như Python khi không đổi được */
function pyInt(v: unknown): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("cannot convert float " + v + " to integer"); return Math.trunc(v); }
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") { const t = strip(v); if (/^[+-]?\d+(?:_\d+)*$/.test(t)) return parseInt(t.replace(/_/g, ""), 10); throw new Error("invalid literal for int() with base 10: " + pyRepr(v)); }
  throw new Error("int() argument must be a string, a bytes-like object or a real number, not '" + pyType(v) + "'");
}
function pyFloat(v: unknown): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") { const t = strip(v); if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return parseFloat(t); throw new Error("could not convert string to float: " + pyRepr(v)); }
  throw new Error("float() argument must be a string or a real number, not '" + pyType(v) + "'");
}
/** str.isdigit() */
const isdigit = (s: string) => s.length > 0 && /^[\p{Nd}\u00b2\u00b3\u00b9\u2070\u2074-\u2079\u2080-\u2089]+$/u.test(s);
/** \b của Python (từ = chữ/số Unicode + _) */
const PW = "[\\p{L}\\p{N}_]";
const PYB = `(?:(?<=${PW})(?!${PW})|(?<!${PW})(?=${PW}))`;

/* json.loads của Python, viết lại để giữ đúng 3 điều JSON.parse của JS làm khác:
   1) thứ tự khoá — JS đưa khoá dạng số (“123”) lên đầu; Python giữ thứ tự gốc (duyệt `walk` phụ thuộc thứ tự) → khoá số được thêm tiền tố \u0001;
   2) số nguyên lớn hơn 2^53 giữ nguyên (bigint) — id Facebook có thể dài hơn 15 chữ số;
   3) chấp nhận NaN / Infinity như Python. Đối tượng tạo bằng Object.create(null) nên khoá "__proto__" vẫn là khoá thường. */
const KEY_NUM = /^(?:0|[1-9]\d{0,9})$/;
const mkKey = (k: string) => (KEY_NUM.test(k) && Number(k) < 4294967295 ? "\u0001" + k : k);
/** gỡ tiền tố khoá số khi cần liệt kê tên khoá */
const unKey = (k: string) => (k.charCodeAt(0) === 1 ? k.slice(1) : k);
export function jsonLoads(src: string): unknown {
  let i = 0;
  const n = src.length;
  const fail = (): never => { throw new SyntaxError("JSON không hợp lệ tại vị trí " + i); };
  const ws = () => { while (i < n) { const c = src.charCodeAt(i); if (c === 32 || c === 9 || c === 10 || c === 13) i++; else break; } };
  const str = (): string => {
    const a = i++;
    for (;;) {
      if (i >= n) fail();
      const c = src.charCodeAt(i);
      if (c === 34) { i++; break; }
      if (c < 32) fail();
      i += c === 92 ? 2 : 1;
    }
    return JSON.parse(src.slice(a, i)) as string;
  };
  const NUM = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
  const val = (): unknown => {
    ws();
    const c = src[i];
    if (c === "{") {
      i++;
      const o: D = Object.create(null) as D;
      ws();
      if (src[i] === "}") { i++; return o; }
      for (;;) {
        ws();
        if (src[i] !== '"') fail();
        const k = str();
        ws();
        if (src[i++] !== ":") fail();
        o[mkKey(k)] = val();
        ws();
        const d = src[i++];
        if (d === "}") return o;
        if (d !== ",") fail();
      }
    }
    if (c === "[") {
      i++;
      const a: unknown[] = [];
      ws();
      if (src[i] === "]") { i++; return a; }
      for (;;) {
        a.push(val());
        ws();
        const d = src[i++];
        if (d === "]") return a;
        if (d !== ",") fail();
      }
    }
    if (c === '"') return str();
    if (src.startsWith("true", i)) { i += 4; return true; }
    if (src.startsWith("false", i)) { i += 5; return false; }
    if (src.startsWith("null", i)) { i += 4; return null; }
    if (src.startsWith("NaN", i)) { i += 3; return NaN; }
    if (src.startsWith("Infinity", i)) { i += 8; return Infinity; }
    if (src.startsWith("-Infinity", i)) { i += 9; return -Infinity; }
    NUM.lastIndex = i;
    const m = NUM.exec(src);
    if (!m) fail();
    i = NUM.lastIndex;
    const t = m![0], v = Number(t);
    return !m![1] && !m![2] && !Number.isSafeInteger(v) ? BigInt(t) : v;
  };
  const out = val();
  ws();
  if (i < n) fail();
  return out;
}
/** json.dumps(o, separators=(",", ":")) — ensure_ascii mặc định của Python */
const jsonDumps = (o: unknown) => JSON.stringify(o).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
/** urllib.parse.quote_plus (an toàn: chữ, số, _.-~) */
function quotePlus(s: string): string {
  let out = "";
  for (const b of Buffer.from(s, "utf8")) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9_.\-~]/.test(c)) out += c; else if (b === 32) out += "+"; else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}
const urlencode = (pairs: Array<[string, string]>) => pairs.map(([k, v]) => quotePlus(k) + "=" + quotePlus(v)).join("&");

/* ───────── cookie ───────── */
/** `(s or "")` của Python: giá trị sai → "", giá trị đúng nhưng không phải chuỗi → AttributeError như Python */
function strArg(s: unknown, meth: string): string {
  if (!truthy(s)) return "";
  if (typeof s !== "string") throw new Error("'" + pyType(s) + "' object has no attribute '" + meth + "'");
  return s;
}
export function cleanCookie(s: string): string {
  s = stripChars(strip(strArg(s, "replace").replace(/\^%/g, "%").replace(/\^/g, "")), "'\"");
  return stripChars(strip(s.replace(/^(cookie:|-b)[\s]*/i, "")), "'\"");
}
/** 'a=b; c=d' · JSON [{name,value}] · JSON {a:b} · dòng Netscape → bảng (giữ thứ tự chèn như dict) */
export function parseCookie(s: string): Map<string, string> {
  s = strip(strArg(s, "strip"));
  const out = new Map<string, string>();
  if (!s) return out;
  if ("[{".includes(s[0])) {
    try {
      let o = jsonLoads(s);
      if (isD(o) && Array.isArray(g(o, "cookies"))) o = g(o, "cookies");
      if (Array.isArray(o)) { for (const c of o) if (isD(c) && has(c, "name")) out.set(str(c.name), str(gd(c, "value", ""))); }
      else if (isD(o)) { for (const [k, v] of Object.entries(o)) out.set(unKey(k), str(v)); }
      return out;
    } catch { /* không phải JSON → đọc theo dòng */ }
  }
  for (const line of s.split(/[\r\n]+/)) {
    const cols = line.split("\t");
    if (cols.length >= 7 && !line.startsWith("#")) { out.set(cols[5], cols[6]); continue; }
    for (const part of line.split(";")) {
      const i = part.indexOf("=");
      if (i >= 0) out.set(strip(part.slice(0, i)), strip(part.slice(i + 1)));
    }
  }
  return out;
}
const cookieHeader = (d: Map<string, string>) => [...d].map(([k, v]) => k + "=" + v).join("; ");
function makeHeaders(ck: Map<string, string>, cookie: string, post: boolean, referer?: string): Hdr {
  const h: Hdr = [
    ["User-Agent", UA], ["Cookie", cookie],
    ["Accept", post ? "*/*" : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"],
    ["Accept-Language", "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"], ["Accept-Encoding", "gzip, deflate"], ["Referer", referer || (E.www + "/")],
    ["Sec-Ch-Ua", '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"'], ["Sec-Ch-Ua-Mobile", "?0"], ["Sec-Ch-Ua-Platform", '"Windows"'],
    ["Sec-Fetch-Dest", post ? "empty" : "document"], ["Sec-Fetch-Mode", post ? "cors" : "navigate"], ["Sec-Fetch-Site", "same-origin"],
  ];
  if (!post) h.push(["Sec-Fetch-User", "?1"], ["Upgrade-Insecure-Requests", "1"], ["Cache-Control", "max-age=0"]);
  if (ck.get("dpr")) h.push(["Dpr", ck.get("dpr")!]);
  const m = /^(\p{Nd}+)x\p{Nd}+$/u.exec(ck.get("wd") ?? "");
  if (m && !post) h.push(["Viewport-Width", m[1]]);
  if (post) h.push(["Content-Type", "application/x-www-form-urlencoded"], ["Origin", E.www]);
  return h;
}
/** -> [text, url cuối, status]; lỗi mạng → Fail("Lỗi mạng (…)") */
async function http(url: string, ck: Map<string, string>, data?: Array<[string, string]>, extra?: Record<string, string>, referer?: string, timeout = 30): Promise<[string, string, number]> {
  const post = data !== undefined;
  const h = makeHeaders(ck, cookieHeader(ck), post, referer);
  if (extra) for (const [k, v] of Object.entries(extra)) if (v) { const i = h.findIndex(([n]) => n === k); if (i >= 0) h[i] = [k, v]; else h.push([k, v]); }
  try {
    const r = await request(url, { method: post ? "POST" : "GET", headers: h, body: post ? urlencode(data!) : undefined, timeout });
    return [r.text, r.url, r.status];
  } catch (e) {
    if (e instanceof NetError) throw new Fail(e.message);
    throw e;
  }
}

/* ───────── token / cấu hình trang ───────── */
export function findTokens(html: string): [string, string] {
  const items: Record<string, string> = {};
  for (const m of html.matchAll(TOKEN_RE)) items[m[1]] = m[2];
  let token: unknown = items.DTSGInitialData || items.DTSGInitData;
  if (!token) {                                             // dự phòng 1: __eqmc
    const m = /<script\b[^>]*\bid=["']__eqmc["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (m) {
      try {
        const o = jsonLoads(m[1]);
        if (!isD(o)) throw Object.assign(new Error("'" + pyType(o) + "' object has no attribute 'get'"), { fatal: true });
        token = or(g(o, "f"), "");
      } catch (e) { if ((e as { fatal?: boolean }).fatal) throw e; }
    }
  }
  if (!token) {                                             // dự phòng 2: chuỗi dạng NAf...:8:171...
    const m = /"(NA[A-Za-z0-9_\-]{20,}:\p{Nd}+:\p{Nd}+)"/u.exec(html);
    token = m ? m[1] : "";
  }
  if (token && !/^[A-Za-z0-9_:\-]{20,}$/.test(String(token))) token = "";
  return [String(token || ""), items.LSD || ""];
}
export function pageConfig(html: string): Record<string, string> {
  const cfg: Record<string, string> = { __comet_req: "15" };
  const m = new RegExp('"queryID"\\s*:\\s*"(\\p{Nd}+)"\\s*,\\s*"variables"\\s*:\\s*\\{[^{}]*\\}\\s*,\\s*"queryName"\\s*:\\s*"' + FRIENDLY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"', "u").exec(html);
  if (m) cfg.doc_id = m[1];
  for (const [key, out] of [["__spin_r", "__spin_r"], ["__spin_t", "__spin_t"], ["__spin_b", "__spin_b"], ["hsi", "__hsi"], ["comet_env", "__comet_req"]] as const) {
    const q = new RegExp('"' + key + '"\\s*:\\s*("[^"\\n]*"|\\p{Nd}+)', "u").exec(html);
    if (q) { const v = q[1]; cfg[out] = v.startsWith('"') ? v.slice(1, -1) : v; }
  }
  if (!("__spin_r" in cfg)) { const q = /"client_revision"\s*:\s*(\p{Nd}+)/u.exec(html); if (q) cfg.__spin_r = q[1]; }
  return cfg;
}
const activityUrl = (uid: string) => `${E.www}/${uid}/allactivity?activity_history=false&category_key=GROUPPOSTS&manage_mode=false&should_load_landing_page=false&locale=en_US`;

interface Sess { ck: Map<string, string>; uid: string; dtsg: string; lsd: string; cfg: Record<string, string> }
async function openSession(rawCookie: string, uidOverride = ""): Promise<Sess> {
  const ck = parseCookie(cleanCookie(rawCookie));
  if (!ck.get("c_user") || !ck.get("xs")) throw new Fail("Cookie thiếu c_user / xs");
  const uid = uidOverride || ck.get("i_user") || ck.get("c_user")!;
  let last = "Không thấy token";
  for (const url of [activityUrl(uid), E.www + "/"]) {
    const [html, final, status] = await http(url, ck);
    const low = final.toLowerCase();
    if (low.includes("checkpoint")) throw new Fail("Tài khoản bị checkpoint");
    if (["/login", "/recover", "/two_factor"].some((p) => low.includes(p))) throw new Fail("Cookie hết hạn");
    if (status !== 200) { last = "HTTP " + status; continue; }
    const [dtsg, lsd] = findTokens(html);
    if (dtsg) return { ck, uid, dtsg, lsd, cfg: pageConfig(html) };
  }
  throw new Fail(last + (impersonating() ? "" : " · thử: npm i impit"));
}
const jazoest = (t: string) => "2" + Array.from(t).reduce((a, c) => a + c.codePointAt(0)!, 0);
async function graphql(sess: Sess, variables: unknown, docId: string): Promise<[string, number]> {
  const cfg = sess.cfg;
  const data: Array<[string, string]> = [
    ["av", sess.uid], ["__aaid", "0"], ["__user", sess.uid], ["__a", "1"], ["__req", "m"],
    ["__comet_req", cfg.__comet_req || "15"], ["locale", "en_US"],
    ["fb_dtsg", sess.dtsg], ["jazoest", jazoest(sess.dtsg)], ["lsd", sess.lsd],
    ["__crn", "comet.fbweb.CometActivityLogMainContentRootRoute"],
    ["fb_api_caller_class", "RelayModern"], ["fb_api_req_friendly_name", FRIENDLY],
    ["server_timestamps", "true"],
    ["variables", jsonDumps(variables)],
    ["doc_id", docId],
  ];
  const set = (k: string, v: string) => { const i = data.findIndex(([n]) => n === k); if (i >= 0) data[i] = [k, v]; else data.push([k, v]); };
  if (cfg.__spin_r) { set("__rev", cfg.__spin_r); set("__spin_r", cfg.__spin_r); }
  for (const k of ["__spin_b", "__spin_t", "__hsi"]) if (cfg[k]) set(k, cfg[k]);
  const extra = { "X-FB-Friendly-Name": FRIENDLY, "X-FB-LSD": sess.lsd, "X-ASBD-ID": "359341" };
  const [text, , status] = await http(E.www + "/api/graphql/", sess.ck, data, extra, activityUrl(sess.uid));
  return [text, status];
}
export function parseResponse(text: string): unknown[] {
  const out: unknown[] = [];
  for (let line of strip(text || "").split("\n")) {
    line = strip(line.replace(/^[\s]*for[\s]*\([\s]*;[\s]*;[\s]*\)[\s]*;/, ""));
    if (!line) continue;
    try { out.push(jsonLoads(line)); } catch { /* dòng không phải JSON */ }
  }
  return out;
}

/* ───────── duyệt JSON ───────── */
/** Duyệt tiền thứ tự (cha trước, con theo thứ tự khoá) — giống `walk()` của Python */
function* walk(o: unknown): Generator<D, void, undefined> {
  const st: unknown[] = [o];
  while (st.length) {
    const x = st.pop();
    if (isD(x)) { yield x; const vs = Object.values(x); for (let i = vs.length - 1; i >= 0; i--) st.push(vs[i]); }
    else if (Array.isArray(x)) for (let i = x.length - 1; i >= 0; i--) st.push(x[i]);
  }
}
const tsOk = (v: unknown): v is number => typeof v === "number" && 1_000_000_000 < v && v < 4_000_000_000;
export function findTs(node: unknown): number | null {
  if (isD(node)) for (const k of TS_KEYS) { const v = g(node, k); if (tsOk(v)) return Math.trunc(v); }   // ưu tiên cấp node = giờ đăng bài thật
  for (const d of walk(node)) for (const k of TS_KEYS) { const v = g(d, k); if (tsOk(v)) return Math.trunc(v); }
  return null;
}
export function findTexts(node: unknown): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const d of walk(node)) {
    const v = g(d, "text");
    if (typeof v === "string" && strip(v) && !seen.has(v)) { seen.add(v); out.push(strip(v)); }
  }
  return out;
}
function findEdges(o: unknown): D[] {
  if (isD(o)) {
    const e = g(o, "edges");
    if (Array.isArray(e) && e.length && e.every(isD)) return e as D[];
    for (const v of Object.values(o)) { const r = findEdges(v); if (r.length) return r; }
  } else if (Array.isArray(o)) {
    for (const v of o) { const r = findEdges(v); if (r.length) return r; }
  }
  return [];
}
export function apiError(objs: unknown[]): string {
  for (const o of objs) {
    const errs = isD(o) ? g(o, "errors") : null;
    if (truthy(errs) && Array.isArray(errs) && isD(errs[0])) return cut(str(or(g(errs[0], "summary"), g(errs[0], "message"), "Lỗi API")), 80);
  }
  return "";
}

/* ───────── tách 1 node Activity Log ───────── */
const txt = (v: unknown): string => { if (isD(v)) v = g(v, "text"); return typeof v === "string" ? strip(v) : ""; };
function urlsOf(node: unknown): string[] {
  const out: string[] = [];
  for (const d of walk(node)) for (const k of ["url", "uri", "permalink_url", "wwwURL"]) {
    const v = g(d, k);
    if (typeof v === "string" && v.startsWith("http") && v.includes("facebook.com") && !out.includes(v)) out.push(v);
  }
  return out;
}
/** id node base64 → số cuối, làm post_uid dự phòng */
function nodeIdNum(nid: string): string {
  try {
    const raw = nid + "=".repeat((4 - (nid.length % 4)) % 4);
    const data = raw.replace(/[^A-Za-z0-9+/=]/g, "").replace(/=+$/, ""), pads = raw.replace(/[^A-Za-z0-9+/=]/g, "").length - data.length;
    if (data.length % 4 === 1) return "";
    if (data.length % 4 !== 0 && pads < 4 - (data.length % 4)) return "";
    const s = Buffer.from(data, "base64").toString("utf8").replace(/\ufffd/g, "");
    const nums = s.match(/\p{Nd}{6,}/gu);
    return nums ? nums[nums.length - 1] : "";
  } catch { return ""; }
}
interface Ent { id: string; name: string; url: string }
/** summary.text + ranges(offset/length/entity) → {actor, group}. Cắt tên theo offset/length nên lấy đúng tên page và tên nhóm. */
function entities(node: D): { actor?: Ent; group?: Ent } {
  const out: { actor?: Ent; group?: Ent } = {};
  const roots: unknown[] = [g(node, "summary"), g(node, "title")].filter(isD);
  for (const root of [...roots, node]) {                    // summary/title trước, tránh nhầm @tag trong nội dung
    for (const d of walk(root)) {
      const t = g(d, "text"), rngs = g(d, "ranges");
      if (!(typeof t === "string" && Array.isArray(rngs) && rngs.length)) continue;
      for (const r of rngs) {
        if (!isD(r)) continue;
        const e = or(g(r, "entity"), {}) as D, tn = g(e, "__typename");
        if (tn !== "User" && tn !== "Page" && tn !== "Group") continue;
        let nm: string;
        try { const o = pyInt(gd(r, "offset", 0)), ln = pyInt(gd(r, "length", 0)); nm = strip(pySlice(t, o, o + ln)); } catch { nm = ""; }
        nm = nm || str(or(g(e, "short_name"), g(e, "name"), ""));
        const key = tn === "Group" ? "group" : "actor";
        if (!out[key]) out[key] = { id: str(or(g(e, "id"), "")), name: nm, url: str(or(g(e, "url"), g(e, "profile_url"), "")) };
      }
      if (out.actor || out.group) break;
    }
    if (out.actor || out.group) break;
  }
  return out;
}
function findObj(node: D, key: string): D {
  const v = g(node, key);
  if (isD(v)) return v;
  for (const d of walk(node)) { const x = g(d, key); if (isD(x)) return x; }
  return {};
}
const reFirst = (re: RegExp, s: string) => re.exec(s);
const pad2 = (n: number) => String(n).padStart(2, "0");
const vnTime = (ts: number) => { const d = new Date((ts + TZ_OFF) * 1000); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
export interface Item {
  ts: number | null; time: string; group_name: string; group_id: string; group_link: string; post_uid: string; post_link: string; content: string;
  page_name: string; page_uid: string; profile_name: string; profile_uid: string; title: string; attach: string; node_id: string; texts: string; _src?: unknown;
}
/** 1 node Activity Log (Story) → dict các cột */
export function parseNode(node: D): Item {
  const ts = findTs(node), urls = urlsOf(node);
  const title = txt(g(node, "title")) || txt(g(node, "story_title"));
  let content = txt(g(node, "message")) || txt(g(node, "summary"));
  if (!content) for (const k of ["body", "snippet", "description"]) { content = txt(g(node, k)); if (content) break; }
  if (content && title && strip(content) === strip(title)) content = "";           // summary == title → không phải nội dung
  const ent = entities(node), gr = ent.group || ({} as Partial<Ent>), a = ent.actor || ({} as Partial<Ent>);
  let pid = str(or(g(node, "post_id"), ""));
  if (!isdigit(pid)) {
    for (const d of walk(node)) {
      const v = or(g(d, "post_id"), g(d, "story_fbid"));
      if (truthy(v) && isdigit(str(v))) { pid = str(v); break; }
    }
  }
  if (!isdigit(pid)) {
    for (const u of urls) { const m = reFirst(/\/(?:permalink|posts)\/(\p{Nd}+)/u, u); if (m) { pid = m[1]; break; } }
  }
  if (!pid) pid = nodeIdNum(str(gd(node, "id", "")));
  let gseg = "";
  let m = reFirst(/facebook\.com\/groups\/([^/?#]+)/, gr.url || "");
  if (m) gseg = m[1];
  if (!gseg) for (const u of urls) { m = reFirst(/facebook\.com\/groups\/([^/?#]+)\/(?:permalink|posts)\//, u); if (m) { gseg = m[1]; break; } }
  if (!gseg) for (const u of urls) { m = reFirst(/facebook\.com\/groups\/([^/?#]+)/, u); if (m) { gseg = m[1]; break; } }
  if (!gseg && gr.id) gseg = gr.id;
  let postLink = "";
  const nodeUrl = str(or(g(node, "url"), ""));
  if (/facebook\.com\/.+\/(?:permalink|posts)\/\p{Nd}+/u.test(nodeUrl)) postLink = nodeUrl;      // link gốc FB trả về → chính xác nhất
  else if (gseg && pid) postLink = `${E.www}/groups/${gseg}/posts/${pid}/`;
  else if (pid && a.id) postLink = `${E.www}/${a.id}/posts/${pid}/`;
  if (!postLink) for (const u of urls) if (/\/(?:permalink|posts)\/\p{Nd}+/u.test(u)) { postLink = u; break; }
  let gname = gr.name || "";
  const gid = gr.id || "";
  const glink = gr.url || (gseg ? `${E.www}/groups/${gseg}/` : "");
  if (!gname && title) {
    const mm = new RegExp("(?:posted in|shared .* in|đã đăng trong|đã chia sẻ .* trong)[\\s]+(.+?)\\.?$", "iu").exec(title);
    if (mm) gname = strip(mm[1]);
  }
  let pgName = a.name || "", pgUid = a.id || "";
  if (!pgUid) {
    for (const d of walk(node)) {
      const ac = g(d, "actors");
      if (Array.isArray(ac) && ac.length && isD(ac[0]) && truthy(g(ac[0], "id"))) { pgUid = str(g(ac[0], "id")); pgName = pgName || str(or(g(ac[0], "name"), "")); break; }
    }
  }
  if (!pgName && title) {
    const mm = new RegExp("^[\\s]*(.+?)[\\s]+(?:posted|shared|đã đăng|đã chia sẻ)" + PYB, "u").exec(title);
    if (mm) pgName = strip(mm[1]);
  }
  const ua = findObj(node, "underlying_admin_creator");
  const pfName = str(or(g(ua, "name"), "")), pfUid = str(or(g(ua, "id"), ""));
  let attach = "";
  for (const d of walk(node)) { const t = g(d, "__typename"); if (t === "Photo" || t === "Video" || t === "ExternalUrl" || t === "GenericAttachmentMedia" || t === "Link") { attach = t; break; } }
  return {
    ts, time: ts ? vnTime(ts) : "", group_name: gname, group_id: gid, group_link: glink, post_uid: pid, post_link: postLink, content: cut(content, 5000),
    page_name: pgName, page_uid: pgUid, profile_name: pfName, profile_uid: pfUid, title, attach, node_id: str(gd(node, "id", "")), texts: cut(findTexts(node).join(" | "), 3000),
  };
}
export function edgesNodes(objs: unknown[]): { items: Item[]; endCursor: unknown; hasNext: unknown } {
  const items: Item[] = [];
  let endCursor: unknown = null, hasNext: unknown = null;
  for (const obj of objs) {
    for (const d of walk(obj)) {
      const pi = g(d, "page_info");
      if (isD(pi)) { if (truthy(g(pi, "end_cursor"))) endCursor = g(pi, "end_cursor"); if (has(pi, "has_next_page")) hasNext = pi.has_next_page; }
    }
    for (const ed of findEdges(obj)) {
      const node = has(ed, "node") ? ed.node : ed;
      if (isD(node)) { const it = parseNode(node); if (it.ts !== null || truthy(it.texts)) items.push(it); }
    }
  }
  return { items, endCursor, hasNext };
}
async function openSessionFor(cookie: string, uid: unknown): Promise<Sess> {
  const u = String(uid ?? "").replace(/\P{Nd}/gu, "");      // Luôn ép i_user = UID Page khi khác c_user (cookie admin) → đọc đúng nhật ký của Page
  if (u) {
    const ck = parseCookie(cleanCookie(cookie));
    if (ck.get("c_user") && ck.get("c_user") !== u) { ck.set("i_user", u); cookie = cookieHeader(ck); }
  }
  return openSession(cookie, u);
}

/* ───────── ngày giờ lọc (giờ Việt Nam) — strptime của Python ───────── */
const SP = { Y: "(\\d\\d\\d\\d)", m: "(1[0-2]|0[1-9]|[1-9])", d: "(3[0-1]|[1-2]\\d|0[1-9]|[1-9]| [1-9])", H: "(2[0-3]|[0-1]\\d|\\d)", M: "([0-5]\\d|\\d)" };
const FORMATS: Array<[string, RegExp]> = [
  ["%Y-%m-%dT%H:%M", new RegExp(`^${SP.Y}-${SP.m}-${SP.d}T${SP.H}:${SP.M}$`, "i")],
  ["%Y-%m-%d %H:%M", new RegExp(`^${SP.Y}-${SP.m}-${SP.d}\\s+${SP.H}:${SP.M}$`, "i")],
  ["%Y-%m-%d", new RegExp(`^${SP.Y}-${SP.m}-${SP.d}$`, "i")],
];
export function toTs(s: unknown, end = false): number | null {
  s = strip(strArg(s, "strip"));
  if (!s) return null;
  for (const [f, re] of FORMATS) {
    const m = re.exec(s as string);
    if (!m) continue;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(strip(m[3]))];
    let H = m[4] !== undefined ? Number(m[4]) : 0, M = m[5] !== undefined ? Number(m[5]) : 0, S = 0;
    const dt = new Date(0); dt.setUTCFullYear(y, mo - 1, d); dt.setUTCHours(0, 0, 0, 0);
    if (y < 1 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) continue;   // ngày không có thật (30/2…) → ValueError → thử định dạng sau
    if (end) { if (f === "%Y-%m-%d") { H = 23; M = 59; S = 59; } else S = 59; }
    return Math.trunc(dt.getTime() / 1000 + H * 3600 + M * 60 + S - TZ_OFF);
  }
  return null;
}

/* ───────── chạy 1 nguồn ───────── */
export interface Ctx {
  emit(rows: Array<Record<string, unknown>>): Promise<void>;
  log(msg: string, kind?: string): Promise<void>;
  status(s: string): Promise<void>;
  stopped(): Promise<boolean>;
  sleep(s: number): Promise<void>;
  saveRaw(name: string, text: string): void;
}
export interface Src { id?: unknown; label?: unknown; cookie?: unknown; uid?: unknown; name?: unknown }
/** Hai hàm trì hoãn để kiểm thử có thể thay (mặc định: thật) */
export const hooks = { random: Math.random };
export async function run(ctx: Ctx, src: Src, p: Record<string, unknown>, defaults: Record<string, unknown> = { doc_id: DEFAULT_DOC, delay: 3, page_gap: 4, raw: false }): Promise<void> {
  const cookie = String(src.cookie || "");
  let uid = String(src.uid || "").replace(/\P{Nd}/gu, "");
  const name = str(or(src.name, src.label, uid, "?"));
  const n = pyInt(or(p.n, 25));
  const start = toTs(p.from), end = toTs(p.to, true);
  const doc = strip(str(or(p.doc_id, defaults.doc_id, DEFAULT_DOC)));
  const delay = pyFloat(or(has(p, "delay") ? p.delay : gd(defaults, "delay", 3), 0));
  const raw = truthy(has(p, "raw") ? p.raw : gd(defaults, "raw", false));
  if (!cookie) throw new Fail("Không có cookie");
  await ctx.status("Lấy token");
  let sess = await openSessionFor(cookie, uid);
  uid = sess.uid;
  await ctx.log("Token OK - uid " + uid);
  let cursor: unknown = null, got = 0, page = 0, empty = 0, refreshed = false;
  const seen = new Set<string>();
  const per = Math.min(n, 50);
  while (!(await ctx.stopped()) && got < n) {
    page += 1;
    const variables = { audience: null, category: "GROUPPOSTS", category_key: "GROUPPOSTS", count: per, cursor, feedLocation: null, media_content_filters: [], month: null, person_id: null, privacy: "NONE", scale: 1, timeline_visibility: "ALL", year: null, id: uid };
    const [text, status] = await graphql(sess, variables, doc);
    if (raw && page === 1) ctx.saveRaw("postfb_" + uid, text);
    const objs = parseResponse(text), err = apiError(objs);
    if ((status !== 200 || !objs.length || err) && !refreshed) {
      refreshed = true;
      await ctx.log("Làm mới token", "warn");
      sess = await openSessionFor(cookie, uid);
      page -= 1;
      continue;
    }
    if (!objs.length || err) throw new Fail(err || `Phản hồi lỗi (HTTP ${status})`);
    const { items, endCursor, hasNext } = edgesNodes(objs);
    if (page === 1 && !items.length) {
      ctx.saveRaw("postfb_empty_" + uid, text);
      await ctx.log("Trang 1 không có bài (đã lưu raw)", "warn");
      break;
    }
    const fresh: Item[] = [];
    let oldest: number | null = null;
    for (const it of items) {
      const key = it.post_uid ? "s:" + it.post_uid : it.node_id ? "s:" + it.node_id : "t:" + it.ts + "|" + cut(it.texts, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      const ts = it.ts;
      if (ts) {
        oldest = oldest === null ? ts : Math.min(oldest, ts);
        if (end && ts > end) continue;
        if (start && ts < start) continue;
      }
      delete (it as { ts?: unknown }).ts;
      if (!it.page_name) it.page_name = name;
      if (!it.page_uid) it.page_uid = uid;
      fresh.push(it);
      if (got + fresh.length >= n) break;
    }
    got += fresh.length;
    if (fresh.length) await ctx.emit(fresh as unknown as Array<Record<string, unknown>>);
    await ctx.status(start || end ? `${got} bài - trang ${page}` : `${got} / ${n} bài - trang ${page}`);
    empty = !items.length ? empty + 1 : 0;
    if (empty >= 2 || !truthy(hasNext) || !truthy(endCursor) || endCursor === cursor) break;
    if (start && oldest && oldest < start) break;
    cursor = endCursor;
    if (delay) await ctx.sleep(Math.max(0, delay - 1) + (delay + 1 - Math.max(0, delay - 1)) * hooks.random());
  }
  await ctx.log(`${name}: ${got} bài`, "ok");
}

/** chỉ để kiểm thử (so sánh với bản Python) */
export const __t = { jazoest, urlencode, quotePlus, jsonDumps, pyRepr, strip, cut };
