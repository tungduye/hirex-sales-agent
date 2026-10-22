/* Tiện ích viết lại đúng ngữ nghĩa Python cho phần Vọng gác Facebook (checkfb.py / checkfbpost.py):
   str.strip(), cắt chuỗi theo ký tự Unicode, \s \b \d \w của `re` (Unicode), html.unescape, urllib.parse
   (urlsplit / urljoin / quote / quote_plus / urlencode), json.dumps — để cùng đầu vào cho cùng đầu ra. */
import { HTML5, INVALID_CHARREFS, INVALID_CODEPOINTS } from "./html-entities-data";

export class PyError extends Error { constructor(readonly pyName: string, msg = "") { super(msg || pyName); } }

/* ───────── chuỗi ───────── */
const WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";   // str.isspace()
const WS_L = new RegExp("^[" + WS + "]+"), WS_R = new RegExp("[" + WS + "]+$");
/** str.strip() */
export const strip = (s: string) => s.replace(WS_L, "").replace(WS_R, "");
/** s[:n] theo ký tự Unicode */
export const cut = (s: string, n: number) => {
  if (s.length <= n) return s;
  let i = 0, c = 0;
  while (i < s.length && c < n) { const u = s.charCodeAt(i); i += u >= 0xd800 && u < 0xdc00 && i + 1 < s.length ? 2 : 1; c++; }
  return s.slice(0, i);
};
/** len(s) theo ký tự Unicode */
export const plen = (s: string) => { let n = 0; for (const _c of s) { void _c; n++; } return n; };
/** truthiness của Python cho chuỗi / số / null */
export const truthy = (v: unknown): boolean => !(v === null || v === undefined || v === false || v === "" || v === 0);
/** str(v or '') */
export const sOr = (v: unknown): string => (truthy(v) ? String(v) : "");

/* ───────── regex kiểu Python (str, Unicode) ─────────
   \s → tập str.isspace · \S · \b (ranh giới từ Unicode) · \d → \p{Nd} · \w → chữ/số/_ Unicode · "." không khớp \n (JS còn loại \r    ).
   Truyền vào nguồn regex viết như trong Python; hàm đổi sang cú pháp JS (cờ u luôn bật). */
const PW = "[\\p{L}\\p{N}_]";
const PYB = `(?:(?<=${PW})(?!${PW})|(?<!${PW})(?=${PW}))`;
export function pyRe(src: string, flags = ""): RegExp {
  let out = "", inCls = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      const n = src[i + 1]; i++;
      if (n === "s") out += inCls ? WS : `[${WS}]`;
      else if (n === "S") out += inCls ? "\\S" : `[^${WS}]`;          // (trong [] hiếm — không dùng)
      else if (n === "b" && !inCls) out += PYB;
      else if (n === "d") out += "\\p{Nd}";
      else if (n === "D") out += inCls ? "\\P{Nd}" : "\\P{Nd}";
      else if (n === "w") out += inCls ? "\\p{L}\\p{N}_" : PW;
      else out += "\\" + n;
    } else if (c === "[" && !inCls) { inCls = true; out += c; if (src[i + 1] === "^") { out += "^"; i++; } }
    else if (c === "]" && inCls) { inCls = false; out += c; }
    else if (c === "." && !inCls) out += flags.includes("s") ? "[\\s\\S]" : "[^\\n]";
    else out += c;
  }
  return new RegExp(out, flags.replace("s", "") + "u");
}
/** re.escape(s) */
export const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ───────── html.unescape ───────── */
const INVALID_SET = new Set(INVALID_CODEPOINTS);
const CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu;
export function htmlUnescape(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(CHARREF, (_m, g: string) => {
    if (g[0] === "#") {
      const hex = g[1] === "x" || g[1] === "X";
      const digits = (hex ? g.slice(2) : g.slice(1)).replace(/;+$/, "");
      const big = BigInt((hex ? "0x" : "") + digits);
      if (big <= BigInt(0x10ffff)) {
        const num = Number(big);
        if (Object.prototype.hasOwnProperty.call(INVALID_CHARREFS, num)) return INVALID_CHARREFS[num];
        if (num >= 0xd800 && num <= 0xdfff) return "�";
        if (INVALID_SET.has(num)) return "";
        return String.fromCodePoint(num);
      }
      return "�";
    }
    if (Object.prototype.hasOwnProperty.call(HTML5, g)) return HTML5[g];
    const cp = Array.from(g);
    for (let x = cp.length - 1; x > 1; x--) {
      const k = cp.slice(0, x).join("");
      if (Object.prototype.hasOwnProperty.call(HTML5, k)) return HTML5[k] + cp.slice(x).join("");
    }
    return "&" + g;
  });
}

/* ───────── urllib.parse ───────── */
const SCHEME_CHARS = /^[A-Za-z0-9+\-.]*$/;
const USES_RELATIVE = new Set(["", "ftp", "http", "gopher", "nntp", "imap", "wais", "file", "https", "shttp", "mms", "prospero", "rtsp", "rtsps", "rtspu", "sftp", "svn", "svn+ssh", "ws", "wss"]);
const USES_NETLOC = new Set(["", "ftp", "http", "gopher", "nntp", "telnet", "imap", "wais", "file", "mms", "https", "shttp", "snews", "prospero", "rtsp", "rtspu", "rsync", "svn", "svn+ssh", "sftp", "nfs", "git", "git+ssh", "ws", "wss"]);
const USES_PARAMS = new Set(["", "ftp", "hdl", "prospero", "http", "imap", "https", "shttp", "rtsp", "rtsps", "mms", "sftp", "tel"]);
export interface Split { scheme: string; netloc: string; path: string; query: string; fragment: string }
export function urlsplit(url0: string, scheme0 = ""): Split {
  let url = url0.replace(/^[\u0000- ]+/, "");
  let scheme = scheme0.replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
  url = url.replace(/[\t\r\n]/g, ""); scheme = scheme.replace(/[\t\r\n]/g, "");
  let netloc = "", query = "", fragment = "";
  const i = url.indexOf(":");
  if (i > 0 && /^[A-Za-z]/.test(url[0]) && SCHEME_CHARS.test(url.slice(0, i))) { scheme = url.slice(0, i).toLowerCase(); url = url.slice(i + 1); }
  if (url.slice(0, 2) === "//") {
    let delim = url.length;
    for (const c of "/?#") { const w = url.indexOf(c, 2); if (w >= 0 && w < delim) delim = w; }
    netloc = url.slice(2, delim); url = url.slice(delim);
    if ((netloc.includes("[") && !netloc.includes("]")) || (netloc.includes("]") && !netloc.includes("["))) throw new PyError("ValueError", "Invalid IPv6 URL");
  }
  const h = url.indexOf("#"); if (h >= 0) { fragment = url.slice(h + 1); url = url.slice(0, h); }
  const q = url.indexOf("?"); if (q >= 0) { query = url.slice(q + 1); url = url.slice(0, q); }
  return { scheme, netloc, path: url, query, fragment };
}
export interface Parsed extends Split { params: string }
export function urlparse(url: string, scheme = ""): Parsed {
  const s = urlsplit(url, scheme); let path = s.path, params = "";
  if (USES_PARAMS.has(s.scheme) && path.includes(";")) {
    let i: number;
    if (path.includes("/")) { i = path.indexOf(";", path.lastIndexOf("/")); if (i < 0) i = -1; } else i = path.indexOf(";");
    if (i >= 0) { params = path.slice(i + 1); path = path.slice(0, i); }
  }
  return { ...s, path, params };
}
export function urlunsplit(c: Split): string {
  let url = c.path;
  if (c.netloc) { if (url && url[0] !== "/") url = "/" + url; url = "//" + c.netloc + url; }
  else if (url.slice(0, 2) === "//") url = "//" + url;
  else if (c.scheme && USES_NETLOC.has(c.scheme) && (!url || url[0] === "/")) url = "//" + url;
  if (c.scheme) url = c.scheme + ":" + url;
  if (c.query) url = url + "?" + c.query;
  if (c.fragment) url = url + "#" + c.fragment;
  return url;
}
export function urlunparse(c: Parsed): string { return urlunsplit({ ...c, path: c.params ? `${c.path};${c.params}` : c.path }); }
export function urljoin(base: string, url: string): string {
  if (!base) return url; if (!url) return base;
  const b = urlparse(base, ""), u = urlparse(url, b.scheme);
  if (u.scheme !== b.scheme || !USES_RELATIVE.has(u.scheme)) return url;
  let netloc = u.netloc, path = u.path, params = u.params, query = u.query;
  if (USES_NETLOC.has(u.scheme)) { if (netloc) return urlunparse({ ...u }); netloc = b.netloc; }
  if (!path && !params) { path = b.path; params = b.params; if (!query) query = b.query; return urlunparse({ scheme: u.scheme, netloc, path, params, query, fragment: u.fragment }); }
  const baseParts = b.path.split("/");
  if (baseParts[baseParts.length - 1] !== "") baseParts.pop();
  let segments: string[];
  if (path[0] === "/") segments = path.split("/");
  else { segments = baseParts.concat(path.split("/")); if (segments.length > 2) segments = [segments[0], ...segments.slice(1, -1).filter(Boolean), segments[segments.length - 1]]; }
  return urlunparse({ scheme: u.scheme, netloc, path: resolve(segments) || "/", params, query, fragment: u.fragment });
}
function resolve(segments: string[]): string {
  const out: string[] = [];
  for (const seg of segments) { if (seg === "..") out.pop(); else if (seg === ".") continue; else out.push(seg); }
  if (segments[segments.length - 1] === "." || segments[segments.length - 1] === "..") out.push("");
  return out.join("/");
}
/** urlsplit(url).hostname */
export function hostnameOf(url: string): string | null {
  const netloc = urlsplit(url).netloc;
  const hostinfo = netloc.slice(netloc.lastIndexOf("@") + 1);
  let host: string;
  const ob = hostinfo.indexOf("[");
  if (ob >= 0) { const br = hostinfo.slice(ob + 1); const e = br.indexOf("]"); host = e >= 0 ? br.slice(0, e) : br; }
  else { const c = hostinfo.indexOf(":"); host = c >= 0 ? hostinfo.slice(0, c) : hostinfo; }
  if (!host) return null;
  const p = host.indexOf("%");
  return p >= 0 ? host.slice(0, p).toLowerCase() + host.slice(p) : host.toLowerCase();
}
/** urlparse(url).path */
export const pathOf = (url: string): string => urlparse(url).path;

const ALWAYS_SAFE = /[A-Za-z0-9_.\-~]/;
/** urllib.parse.quote(s, safe) */
export function quote(s: string, safe = "/"): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) throw new PyError("UnicodeEncodeError", "surrogates not allowed");
    if (ch.length === 1 && cp < 128 && (ALWAYS_SAFE.test(ch) || safe.includes(ch))) { out += ch; continue; }
    for (const b of Buffer.from(ch, "utf8")) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}
export const quotePlus = (s: string, safe = ""): string => (s.includes(" ") ? quote(s, safe + " ").replace(/ /g, "+") : quote(s, safe));
/** urllib.parse.urlencode(dict) — giá trị là chuỗi */
export const urlencode = (d: Array<[string, string]>): string => d.map(([k, v]) => quotePlus(k) + "=" + quotePlus(v)).join("&");

/** Facebook trả Location dạng JSON-escape (% = %): giải mã, ghép với URL gốc, mã hoá % đúng chuẩn (_fix_url của checkfb.py) */
export function fixUrl(loc: string, base: string): string {
  const SUR = "\u{F0001}";                     // \uD800–\uDFFF riêng lẻ: Python giữ nguyên ký tự lẻ rồi quote() báo UnicodeEncodeError; JS sẽ ghép đôi nên dùng dấu hiệu thay thế
  const l = strip(loc).replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => { const n = parseInt(h, 16); return n >= 0xd800 && n <= 0xdfff ? SUR : String.fromCharCode(n); });
  const p = urlsplit(urljoin(base, l));
  if (p.path.includes(SUR) || p.query.includes(SUR)) throw new PyError("UnicodeEncodeError", "surrogates not allowed");
  return urlunsplit({ scheme: p.scheme, netloc: p.netloc, path: quote(p.path, "/%:@!$&'()*+,;=-._~"), query: quote(p.query, "=&%:/?+,;@-._~"), fragment: "" });
}

/** json.dumps(v) mặc định (ensure_ascii, dấu phân cách ", " ": ") hoặc gọn (separators=(',',':')) */
export function jsonDumps(v: unknown, compact = false): string {
  const esc = (s: string) => {
    let o = '"';
    for (const ch of s) {
      const c = ch.codePointAt(0)!;
      if (ch === '"') o += '\\"'; else if (ch === "\\") o += "\\\\"; else if (ch === "\n") o += "\\n"; else if (ch === "\r") o += "\\r"; else if (ch === "\t") o += "\\t"; else if (ch === "\b") o += "\\b"; else if (ch === "\f") o += "\\f";
      else if (c < 0x20 || (c > 0x7e && c < 0x10000)) o += "\\u" + c.toString(16).padStart(4, "0");
      else if (c >= 0x10000) { const h = c - 0x10000; o += "\\u" + (0xd800 + (h >> 10)).toString(16) + "\\u" + (0xdc00 + (h & 0x3ff)).toString(16); }
      else o += ch;
    }
    return o + '"';
  };
  const sep = compact ? [",", ":"] : [", ", ": "];
  const go = (x: unknown): string => {
    if (x === null || x === undefined) return "null";
    if (typeof x === "boolean") return x ? "true" : "false";
    if (typeof x === "number") return Number.isInteger(x) ? String(x) : String(x);
    if (typeof x === "string") return esc(x);
    if (Array.isArray(x)) return "[" + x.map(go).join(sep[0]) + "]";
    return "{" + Object.entries(x as Record<string, unknown>).map(([k, y]) => esc(k) + sep[1] + go(y)).join(sep[0]) + "}";
  };
  return go(v);
}

/* ───────── str.isdigit() / int() của Python ───────── */
const ISDIGIT = /^[\u{30}-\u{39}\u{b2}-\u{b3}\u{b9}\u{660}-\u{669}\u{6f0}-\u{6f9}\u{7c0}-\u{7c9}\u{966}-\u{96f}\u{9e6}-\u{9ef}\u{a66}-\u{a6f}\u{ae6}-\u{aef}\u{b66}-\u{b6f}\u{be6}-\u{bef}\u{c66}-\u{c6f}\u{ce6}-\u{cef}\u{d66}-\u{d6f}\u{de6}-\u{def}\u{e50}-\u{e59}\u{ed0}-\u{ed9}\u{f20}-\u{f29}\u{1040}-\u{1049}\u{1090}-\u{1099}\u{1369}-\u{1371}\u{17e0}-\u{17e9}\u{1810}-\u{1819}\u{1946}-\u{194f}\u{19d0}-\u{19da}\u{1a80}-\u{1a89}\u{1a90}-\u{1a99}\u{1b50}-\u{1b59}\u{1bb0}-\u{1bb9}\u{1c40}-\u{1c49}\u{1c50}-\u{1c59}\u{2070}\u{2074}-\u{2079}\u{2080}-\u{2089}\u{2460}-\u{2468}\u{2474}-\u{247c}\u{2488}-\u{2490}\u{24ea}\u{24f5}-\u{24fd}\u{24ff}\u{2776}-\u{277e}\u{2780}-\u{2788}\u{278a}-\u{2792}\u{a620}-\u{a629}\u{a8d0}-\u{a8d9}\u{a900}-\u{a909}\u{a9d0}-\u{a9d9}\u{a9f0}-\u{a9f9}\u{aa50}-\u{aa59}\u{abf0}-\u{abf9}\u{ff10}-\u{ff19}\u{104a0}-\u{104a9}\u{10a40}-\u{10a43}\u{10d30}-\u{10d39}\u{10e60}-\u{10e68}\u{11052}-\u{1105a}\u{11066}-\u{1106f}\u{110f0}-\u{110f9}\u{11136}-\u{1113f}\u{111d0}-\u{111d9}\u{112f0}-\u{112f9}\u{11450}-\u{11459}\u{114d0}-\u{114d9}\u{11650}-\u{11659}\u{116c0}-\u{116c9}\u{11730}-\u{11739}\u{118e0}-\u{118e9}\u{11950}-\u{11959}\u{11c50}-\u{11c59}\u{11d50}-\u{11d59}\u{11da0}-\u{11da9}\u{11f50}-\u{11f59}\u{16a60}-\u{16a69}\u{16ac0}-\u{16ac9}\u{16b50}-\u{16b59}\u{1d7ce}-\u{1d7ff}\u{1e140}-\u{1e149}\u{1e2f0}-\u{1e2f9}\u{1e4f0}-\u{1e4f9}\u{1e950}-\u{1e959}\u{1f100}-\u{1f10a}\u{1fbf0}-\u{1fbf9}]+$/u;
/** str.isdigit() (chữ số Unicode, gồm cả số mũ / số trong vòng tròn) */
export const isdigit = (s: string) => s.length > 0 && ISDIGIT.test(s);
const ND_ZEROS = [0x30,0x660,0x6f0,0x7c0,0x966,0x9e6,0xa66,0xae6,0xb66,0xbe6,0xc66,0xce6,0xd66,0xde6,0xe50,0xed0,0xf20,0x1040,0x1090,0x17e0,0x1810,0x1946,0x19d0,0x1a80,0x1a90,0x1b50,0x1bb0,0x1c40,0x1c50,0xa620,0xa8d0,0xa900,0xa9d0,0xa9f0,0xaa50,0xabf0,0xff10,0x104a0,0x10d30,0x11066,0x110f0,0x11136,0x111d0,0x112f0,0x11450,0x114d0,0x11650,0x116c0,0x11730,0x118e0,0x11950,0x11c50,0x11d50,0x11da0,0x11f50,0x16a60,0x16ac0,0x16b50,0x1d7ce,0x1d7d8,0x1d7e2,0x1d7ec,0x1d7f6,0x1e140,0x1e2f0,0x1e4f0,0x1e950,0x1fbf0];
/** chuyển chữ số thập phân Unicode (Nd) sang ASCII như int() của Python hiểu; ký tự khác giữ nguyên */
export function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (ch) => { const c = ch.codePointAt(0)!; let z = 0; for (const x of ND_ZEROS) { if (x <= c) z = x; else break; } return String(c - z); });
}
