/* Lớp gọi web dùng chung cho các checker / Cú vọ chạy trong Node (thay phần http() của worker Python).
   Python:  curl_cffi (giả trình duyệt Chrome) nếu có, không thì urllib.      → request()
   Node:    `impit` (giả TLS/HTTP2 Chrome, Rust) nếu cài, không thì fetch của Node.
   `impit` là tuỳ chọn, đúng như curl_cffi: chưa cài thì vẫn chạy (kém ổn định hơn); muốn mạnh như bản Python: `npm i impit`.
   Giữ hành vi của worker Python: theo chuyển hướng ≤ 30 lần (header giữ nguyên, kể cả Cookie), timeout tính cho cả chuỗi chuyển hướng,
   mọi lỗi mạng gói thành NetError (Python: Fail("Lỗi mạng (<tên lỗi>)")). */
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import tls from "node:tls";
import zlib from "node:zlib";

export type Hdr = Array<[string, string]>;
export interface Resp { text: string; url: string; status: number }
/** Lỗi mạng — `kind` là tên lỗi hiển thị trong "Lỗi mạng (…)" (Python hiện tên lớp ngoại lệ: Timeout, ConnectionError, SSLError…). */
export class NetError extends Error { constructor(readonly kind: string) { super("Lỗi mạng (" + kind + ")"); } }

interface ImpitLike { fetch(url: string, init?: Record<string, unknown>): Promise<{ status: number; url: string; headers: Headers; body: ReadableStream<Uint8Array> | null; text(): Promise<string> }> }
const G = globalThis as unknown as { __ahsImpit?: Map<string, ImpitLike | null> };

const loadFlag = () => (process.env.AHS_HTTP || "").trim().toLowerCase();
/** Proxy theo biến môi trường như curl/urllib (https_proxy, http_proxy; bỏ qua no_proxy). */
function envProxy(url: string): string {
  const u = new URL(url), np = (process.env.no_proxy || process.env.NO_PROXY || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const h = u.hostname.toLowerCase();
  for (const p of np) { if (p === "*" || h === p.replace(/^\*?\./, "") || h.endsWith("." + p.replace(/^\*?\./, ""))) return ""; }
  const v = u.protocol === "https:" ? (process.env.https_proxy || process.env.HTTPS_PROXY) : (process.env.http_proxy || process.env.HTTP_PROXY);
  return (v || "").trim();
}
function impit(proxy: string): ImpitLike | null {
  if (loadFlag() === "fetch") return null;
  const cache = (G.__ahsImpit ??= new Map());
  if (cache.has(proxy)) return cache.get(proxy) ?? null;
  let v: ImpitLike | null = null;
  try {
    // require qua đường dẫn tương đối gốc dự án: bộ đóng gói không đụng tới (impit là phụ thuộc tuỳ chọn, gói native)
    const req = createRequire(path.join(process.cwd(), "package.json"));
    const mod = req("impit") as { Impit: new (o: Record<string, unknown>) => ImpitLike };
    v = new mod.Impit({ browser: "chrome142", followRedirects: false, ...(proxy ? { proxyUrl: proxy } : {}) });
  } catch { v = null; }
  if (cache.size > 8) cache.clear();                      // mỗi proxy một đối tượng; tránh phình khi đổi proxy liên tục
  cache.set(proxy, v);
  return v;
}
/** Có đang giả trình duyệt không (tương đương `cffi is not None` của Python). */
export function impersonating(): boolean { return impit("") !== null; }

const MAX_REDIRECTS = 30;
function kindOf(e: unknown): string {
  const n = (e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "") || "Error";
  const codes: string[] = [];                               // mã lỗi hệ thống nằm ở e, e.cause, e.cause.errors[] (AggregateError khi thử nhiều địa chỉ)
  const dig = (x: unknown, d: number) => { if (!x || typeof x !== "object" || d > 3) return; const o = x as { code?: unknown; cause?: unknown; errors?: unknown[] }; if (typeof o.code === "string") codes.push(o.code); dig(o.cause, d + 1); for (const y of o.errors || []) dig(y, d + 1); };
  dig(e, 0);
  const code = codes.find((c) => /^(E|UND_ERR)/.test(c)) || codes[0] || "";
  if (n === "AbortError" || n === "TimeoutError" || /Timeout/i.test(n) || /TIMEDOUT|TIMEOUT/.test(String(code))) return "Timeout";
  if (/^(ECONN|ENOTFOUND|EAI_|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_(SOCKET|CLOSED|INFO))/.test(String(code)) || /Connect|Network|Read|Write|Close|Proxy/.test(n)) return "ConnectionError";
  if (/CERT|SSL|TLS|ERR_SSL/i.test(String(code)) || /SSL|TLS/i.test(n)) return "SSLError";
  if (n === "TooManyRedirects") return "TooManyRedirects";
  return n === "TypeError" ? "RequestError" : n;
}

/** GET / POST (body = chuỗi đã mã hoá) → {text, url cuối, status}. timeout = giây (mặc định 30, như Python). */
export async function request(url: string, o: { method?: "GET" | "POST"; headers: Hdr; body?: string; timeout?: number; proxy?: string }): Promise<Resp> {
  const t0 = Date.now(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), (o.timeout ?? 30) * 1000);
  try {
    let cur = url, method = o.method || "GET", body: string | undefined = o.body;
    for (let hop = 0; ; hop++) {
      const proxy = o.proxy ? normProxy(o.proxy) : envProxy(cur), im = impit(proxy);
      const init: Record<string, unknown> = { method, headers: o.headers.map(([k, v]) => [k, v]), redirect: "manual", signal: ctl.signal };
      if (body !== undefined && method !== "GET") init.body = body;
      let res: { status: number; url: string; headers: Headers; text(): Promise<string> };
      if (!im && o.proxy) {                                    // không có impit mà có proxy riêng → tự nối qua proxy (như ProxyHandler của urllib)
        const left = Math.max(1, (o.timeout ?? 30) - (Date.now() - t0) / 1000);
        const head = await open(cur, { method: method as "GET" | "POST", headers: o.headers, body, timeout: left, proxy: o.proxy });
        res = { status: head.status, url: cur, headers: new Headers(head.location ? { location: head.location } : {}), text: async () => (await head.read(Infinity)).toString("utf8") };
      } else res = im ? await im.fetch(cur, init) : await fetch(cur, init as RequestInit);
      const loc = res.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
        if (hop >= MAX_REDIRECTS) throw Object.assign(new Error("redirects"), { name: "TooManyRedirects" });
        try { await (res as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer?.(); } catch { /* bỏ thân */ }
        cur = new URL(loc, cur).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) { method = "GET"; body = undefined; }
        continue;
      }
      const text = await res.text();
      return { text, url: cur, status: res.status };           // chuyển hướng tự xử lý từng bước → URL cuối chính là URL vừa gọi
    }
  } catch (e) {
    throw new NetError(kindOf(e));
  } finally { clearTimeout(timer); }
}

/* ───────── đọc từng bước (cho Vọng gác Facebook): 1 request, KHÔNG tự theo chuyển hướng, đọc thân theo luồng ─────────
   Tương đương _read_head của checkfb.py: gọi 1 lần, lấy Location để nơi gọi tự quyết định đi tiếp, đọc thân tới `cap` byte
   hoặc tới khi `stop(đuôi dữ liệu)` đúng (vd đã thấy route) rồi đóng luôn — không tải hết ~1MB của trang. */
export interface Head {
  status: number; location: string; setCookies: string[];
  /** đọc thân tối đa cap byte; stop(đuôi ≤130000 byte vừa nhận) = true thì dừng sớm. Gọi xong là đóng kết nối. */
  read(cap: number, stop?: (tail: Buffer) => boolean, chunk?: number): Promise<Buffer>;
  close(): void;
}
export const normProxy = (p: string): string => { const t = (p || "").trim(); return !t ? "" : t.includes("://") ? t : "http://" + t; };
const TAIL = 130000;

function wrapStream(status: number, location: string, setCookies: string[], it: AsyncIterator<Uint8Array>, closeUp: () => void, finish: () => void): Head {
  let closed = false;
  const close = () => { if (closed) return; closed = true; try { void it.return?.(); } catch { /* */ } try { closeUp(); } catch { /* */ } finish(); };
  return {
    status, location, setCookies, close,
    async read(cap, stop) {
      const parts: Buffer[] = []; let n = 0;
      try {
        for (;;) {
          const r = await it.next();
          if (r.done) break;
          const b = Buffer.from(r.value); parts.push(b); n += b.length;
          if (n >= cap) break;
          if (stop) { const t: Buffer[] = []; let m = 0; for (let i = parts.length - 1; i >= 0 && m < TAIL; i--) { t.unshift(parts[i]); m += parts[i].length; } const all = Buffer.concat(t); if (stop(all.length > TAIL ? all.subarray(all.length - TAIL) : all)) break; }
        }
      } catch (e) { close(); throw new NetError(kindOf(e)); }
      close();
      return Buffer.concat(parts);
    },
  };
}
const setCookiesOf = (h: Headers): string[] => {
  const hh = h as Headers & { getSetCookie?: () => string[] };
  if (typeof hh.getSetCookie === "function") return hh.getSetCookie();
  const v = h.get("set-cookie"); return v ? [v] : [];
};
async function* webBody(body: ReadableStream<Uint8Array> | null): AsyncGenerator<Uint8Array> {
  if (!body) return;
  const rd = body.getReader();
  try { for (;;) { const r = await rd.read(); if (r.done) return; yield r.value; } } finally { try { await rd.cancel(); } catch { /* */ } }
}

/** 1 request (không theo chuyển hướng). proxy trống → proxy từ biến môi trường (chỉ khi có impit). Lỗi mạng → NetError. */
export async function open(url: string, o: { method?: "GET" | "POST"; headers: Hdr; body?: string; timeout?: number; proxy?: string }): Promise<Head> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), (o.timeout ?? 30) * 1000), finish = () => clearTimeout(timer);
  try {
    const method = o.method || "GET", explicit = normProxy(o.proxy || "");
    const im = impit(explicit || envProxy(url));
    if (im || !explicit) {
      const init: Record<string, unknown> = { method, headers: o.headers.map(([k, v]) => [k, v]), redirect: "manual", signal: ctl.signal };
      if (o.body !== undefined && method !== "GET") init.body = o.body;
      const res = im ? await im.fetch(url, init) : await fetch(url, init as RequestInit);
      const it = webBody(res.body as ReadableStream<Uint8Array> | null)[Symbol.asyncIterator]();
      return wrapStream(res.status, res.headers.get("location") || "", setCookiesOf(res.headers), it, () => ctl.abort(), finish);
    }
    return await viaProxy(url, { method, headers: o.headers, body: o.body }, explicit, ctl, finish);
  } catch (e) { finish(); throw e instanceof NetError ? e : new NetError(kindOf(e)); }
}

/** Không có impit mà có proxy: tự nối qua proxy HTTP (http:// → gửi thẳng URL tuyệt đối · https:// → CONNECT rồi TLS), như ProxyHandler của urllib. */
async function viaProxy(url: string, o: { method: string; headers: Hdr; body?: string }, proxy: string, ctl: AbortController, finish: () => void): Promise<Head> {
  const u = new URL(url), pu = new URL(proxy);
  if (pu.protocol !== "http:" && pu.protocol !== "https:") throw new NetError("ProxyError");
  const auth = pu.username ? "Basic " + Buffer.from(decodeURIComponent(pu.username) + ":" + decodeURIComponent(pu.password)).toString("base64") : "";
  const hdr: Record<string, string> = { Host: u.host };
  for (const [k, v] of o.headers) hdr[k] = v;
  if (o.body !== undefined && o.method !== "GET") hdr["Content-Length"] = String(Buffer.byteLength(o.body));
  const pport = Number(pu.port) || (pu.protocol === "https:" ? 443 : 80);
  const pmod = pu.protocol === "https:" ? https : http;
  const ph = auth ? { "Proxy-Authorization": auth } : {};
  const res = await new Promise<http.IncomingMessage>((ok, bad) => {
    const go = (req: http.ClientRequest) => { req.on("response", ok); req.on("error", bad); if (o.body !== undefined && o.method !== "GET") req.write(o.body); req.end(); };
    if (u.protocol === "http:") {
      go(http.request({ host: pu.hostname, port: pport, method: o.method, path: url, headers: { ...hdr, ...ph }, signal: ctl.signal }));
      return;
    }
    const c = pmod.request({ host: pu.hostname, port: pport, method: "CONNECT", path: `${u.hostname}:${u.port || 443}`, headers: { Host: `${u.hostname}:${u.port || 443}`, ...ph }, signal: ctl.signal });
    c.on("error", bad);
    c.on("connect", (cres, sock) => {
      if (cres.statusCode !== 200) { sock.destroy(); bad(Object.assign(new Error("proxy"), { name: "ProxyError" })); return; }
      go(https.request({ host: u.hostname, port: Number(u.port) || 443, method: o.method, path: u.pathname + u.search, headers: hdr, signal: ctl.signal, agent: false, createConnection: () => tls.connect({ socket: sock, servername: u.hostname }) }));
    });
    c.end();
  });
  let stream: Readable = res;
  const enc = String(res.headers["content-encoding"] || "").toLowerCase();
  if (enc === "gzip") stream = res.pipe(zlib.createGunzip()); else if (enc === "deflate") stream = res.pipe(zlib.createInflate()); else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
  const sc = res.headers["set-cookie"] || [];
  return wrapStream(res.statusCode || 0, String(res.headers.location || ""), Array.isArray(sc) ? sc : [String(sc)], stream[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>, () => { stream.destroy(); res.destroy(); }, finish);
}
