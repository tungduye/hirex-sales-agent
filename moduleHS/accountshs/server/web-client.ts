/* Lớp gọi web dùng chung cho các checker / Cú vọ chạy trong Node (thay phần http() của worker Python).
   Python:  curl_cffi (giả trình duyệt Chrome) nếu có, không thì urllib.      → request()
   Node:    `impit` (giả TLS/HTTP2 Chrome, Rust) nếu cài, không thì fetch của Node.
   `impit` là tuỳ chọn, đúng như curl_cffi: chưa cài thì vẫn chạy (kém ổn định hơn); muốn mạnh như bản Python: `npm i impit`.
   Giữ hành vi của worker Python: theo chuyển hướng ≤ 30 lần (header giữ nguyên, kể cả Cookie), timeout tính cho cả chuỗi chuyển hướng,
   mọi lỗi mạng gói thành NetError (Python: Fail("Lỗi mạng (<tên lỗi>)")). */
import { createRequire } from "node:module";
import path from "node:path";

export type Hdr = Array<[string, string]>;
export interface Resp { text: string; url: string; status: number }
/** Lỗi mạng — `kind` là tên lỗi hiển thị trong "Lỗi mạng (…)" (Python hiện tên lớp ngoại lệ: Timeout, ConnectionError, SSLError…). */
export class NetError extends Error { constructor(readonly kind: string) { super("Lỗi mạng (" + kind + ")"); } }

interface ImpitLike { fetch(url: string, init?: Record<string, unknown>): Promise<{ status: number; url: string; headers: Headers; text(): Promise<string> }> }
const G = globalThis as unknown as { __ahsImpit?: { v: ImpitLike | null; proxy: string } };

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
  const c = G.__ahsImpit;
  if (c && c.proxy === proxy) return c.v;
  let v: ImpitLike | null = null;
  try {
    // require qua đường dẫn tương đối gốc dự án: bộ đóng gói không đụng tới (impit là phụ thuộc tuỳ chọn, gói native)
    const req = createRequire(path.join(process.cwd(), "package.json"));
    const mod = req("impit") as { Impit: new (o: Record<string, unknown>) => ImpitLike };
    v = new mod.Impit({ browser: "chrome142", followRedirects: false, ...(proxy ? { proxyUrl: proxy } : {}) });
  } catch { v = null; }
  G.__ahsImpit = { v, proxy };
  return v;
}
/** Có đang giả trình duyệt không (tương đương `cffi is not None` của Python). */
export function impersonating(): boolean { return impit("") !== null; }

const MAX_REDIRECTS = 30;
function kindOf(e: unknown): string {
  const n = (e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "") || "Error";
  const code = e && typeof e === "object" && "cause" in e && (e as { cause?: { code?: string } }).cause?.code || (e as { code?: string })?.code || "";
  if (n === "AbortError" || n === "TimeoutError" || /Timeout/i.test(n) || /TIMEDOUT/.test(String(code))) return "Timeout";
  if (/^(ECONN|ENOTFOUND|EAI_|EHOSTUNREACH|ENETUNREACH|EPIPE)/.test(String(code)) || /Connect|Network|Read|Write|Close|Proxy/.test(n)) return "ConnectionError";
  if (/CERT|SSL|TLS|ERR_SSL/i.test(String(code)) || /SSL|TLS/i.test(n)) return "SSLError";
  if (n === "TooManyRedirects") return "TooManyRedirects";
  return n === "TypeError" ? "RequestError" : n;
}

/** GET / POST (body = chuỗi đã mã hoá) → {text, url cuối, status}. timeout = giây (mặc định 30, như Python). */
export async function request(url: string, o: { method?: "GET" | "POST"; headers: Hdr; body?: string; timeout?: number }): Promise<Resp> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), (o.timeout ?? 30) * 1000);
  try {
    let cur = url, method = o.method || "GET", body: string | undefined = o.body;
    for (let hop = 0; ; hop++) {
      const proxy = envProxy(cur), im = impit(proxy);
      const init: Record<string, unknown> = { method, headers: o.headers.map(([k, v]) => [k, v]), redirect: "manual", signal: ctl.signal };
      if (body !== undefined && method !== "GET") init.body = body;
      const res = im ? await im.fetch(cur, init) : await fetch(cur, init as RequestInit);
      const loc = res.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
        if (hop >= MAX_REDIRECTS) throw Object.assign(new Error("redirects"), { name: "TooManyRedirects" });
        try { await (res as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer?.(); } catch { /* bỏ thân */ }
        cur = new URL(loc, cur).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) { method = "GET"; body = undefined; }
        continue;
      }
      const text = await res.text();
      return { text, url: res.url || cur, status: res.status };
    }
  } catch (e) {
    throw new NetError(kindOf(e));
  } finally { clearTimeout(timer); }
}
