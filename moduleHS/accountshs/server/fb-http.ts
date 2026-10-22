/* Lớp gọi web của Vọng gác Facebook — port của _read_head / _read_cffi / _read_urllib / _warm trong worker/checkfb.py.
   · Theo chuyển hướng THỦ CÔNG tối đa 6 lượt (sửa Location bị JSON-escape bằng fixUrl), chỉ đi tiếp trong *.facebook.com.
   · Đọc thân theo luồng tới `cap` byte hoặc tới khi thấy route Facebook (canonicalRouteName) — không tải hết ~1MB.
   · Giống bản Python: có `impit` (giả Chrome, tương đương curl_cffi) thì chỉ gửi vài header đặc trưng (UA / sec-ch-ua… do impit tự đặt),
     không có thì gửi đủ bộ header (tương đương nhánh urllib).
   · Cookie: 1 bộ dùng chung (như 1 trình duyệt: có datr) cho các request không tự mang Cookie; có Cookie riêng thì dùng bộ tạm. */
import { impersonating, normProxy, open, NetError, type Hdr } from "./web-client";
import { cut, fixUrl, hostnameOf } from "./pyish";

/* ───────── cookie jar (http.cookiejar rút gọn: tên · miền · đường dẫn · hết hạn · Secure) ───────── */
interface Ck { name: string; value: string; domain: string; hostOnly: boolean; path: string; secure: boolean; exp: number | null }
export class CookieJar {
  private c: Ck[] = [];
  clear() { this.c = []; }
  add(url: string, lines: string[]) {
    let u: URL; try { u = new URL(url); } catch { return; }
    const host = u.hostname.toLowerCase(), now = Date.now() / 1000;
    for (const line of lines) {
      const parts = line.split(";"), first = parts[0], eq = first.indexOf("=");
      if (eq < 0) continue;
      const name = first.slice(0, eq).trim(), value = first.slice(eq + 1).trim();
      if (!name) continue;
      let domain = host, hostOnly = true, path = "", secure = false, exp: number | null = null, maxAge: number | null = null;
      for (const a of parts.slice(1)) {
        const i = a.indexOf("="), k = (i < 0 ? a : a.slice(0, i)).trim().toLowerCase(), v = i < 0 ? "" : a.slice(i + 1).trim();
        if (k === "domain" && v) { const d = v.replace(/^\./, "").toLowerCase(); if (d === host || host.endsWith("." + d)) { domain = d; hostOnly = false; } else { domain = ""; } }
        else if (k === "path" && v.startsWith("/")) path = v;
        else if (k === "secure") secure = true;
        else if (k === "max-age" && /^-?\d+$/.test(v)) maxAge = Number(v);
        else if (k === "expires") { const t = Date.parse(v); if (!Number.isNaN(t)) exp = t / 1000; }
      }
      if (!domain) continue;                                                       // Domain không khớp máy chủ → bỏ
      if (!hostOnly && !domain.includes(".")) continue;
      if (!path) { const p = u.pathname, i = p.lastIndexOf("/"); path = i <= 0 ? "/" : p.slice(0, i); }
      if (maxAge !== null) exp = now + maxAge;
      this.c = this.c.filter((x) => !(x.name === name && x.domain === domain && x.path === path));
      if (exp !== null && exp <= now) continue;                                    // hết hạn = xoá
      this.c.push({ name, value, domain, hostOnly, path, secure, exp });
    }
  }
  header(url: string): string {
    let u: URL; try { u = new URL(url); } catch { return ""; }
    const host = u.hostname.toLowerCase(), now = Date.now() / 1000, p = u.pathname || "/", https = u.protocol === "https:";
    this.c = this.c.filter((x) => x.exp === null || x.exp > now);
    const hit = this.c.filter((x) => (x.hostOnly ? host === x.domain : host === x.domain || host.endsWith("." + x.domain)) && (!x.secure || https)
      && (p === x.path || (p.startsWith(x.path) && (x.path.endsWith("/") || p[x.path.length] === "/"))));
    hit.sort((a, b) => b.path.length - a.path.length);
    return hit.map((x) => x.name + "=" + x.value).join("; ");
  }
}
/** bộ cookie dùng chung của Vọng gác Facebook */
export const JAR = new CookieJar();

export const okHost = (h: string) => h === "facebook.com" || h.endsWith(".facebook.com");
const RT_B = /canonicalRouteName":"comet\.fbweb\.[A-Za-z0-9_]+"/;             // _RTB (bytes → \w chỉ ASCII)
const CFFI_KEEP = new Set(["Cookie", "Referer", "Accept-Language", "Sec-Fetch-Site", "Sec-Fetch-Dest", "Content-Type", "Origin", "X-FB-Friendly-Name"]);
const REDIR = new Set([301, 302, 303, 307, 308]);

/** _read_head(url, hdr, timeout, proxy, cap, data) → [status, url cuối, html] */
export async function readHead(url: string, hdr: Hdr, timeout: number, proxy: string, cap = 450_000, data?: string): Promise<[number, string, string]> {
  const cffi = impersonating();
  const explicit = hdr.some(([k, v]) => k.toLowerCase() === "cookie" && v);
  const jar = explicit ? new CookieJar() : JAR;
  for (let hop = 0; hop < 6; hop++) {
    let h: Hdr = cffi ? hdr.filter(([k]) => CFFI_KEEP.has(k)) : hdr.slice();
    if (!explicit) { const ck = jar.header(url); if (ck) h = [...h, ["Cookie", ck]]; }
    const head = await open(url, { method: data !== undefined ? "POST" : "GET", headers: h, body: data, timeout, proxy });
    jar.add(url, head.setCookies);
    const code = head.status;
    if (REDIR.has(code) && head.location && hop < 5) {
      head.close();
      const nxt = fixUrl(head.location, url);
      if (!okHost(hostnameOf(nxt) || "")) return [code, nxt, ""];
      url = nxt; continue;
    }
    const stop = (t: Buffer) => RT_B.test(t.toString("latin1"));
    if (cffi) {
      const buf = await head.read(cap, code === 200 ? stop : undefined);
      return [code, url, cut(buf.toString("utf8"), cap)];
    }
    if (code < 200 || code >= 300) {                                            // HTTPError của urllib: chỉ lấy phần đầu nội dung lỗi
      const buf = await head.read(6000);
      return [code, url, buf.toString("utf8")];
    }
    const buf = await head.read(cap, stop);
    return [code, url, buf.toString("utf8")];
  }
  return [310, url, ""];
}

/** lấy cookie nền (datr…) — chỉ đọc 2KB đầu trang chủ, theo chuyển hướng ≤10 lần, bỏ qua mọi lỗi */
export async function warmGet(url: string, hdr: Hdr, timeout: number, proxy: string): Promise<void> {
  const explicit = hdr.some(([k, v]) => k.toLowerCase() === "cookie" && v);
  try {
    let cur = url;
    for (let hop = 0; hop < 10; hop++) {
      let h = hdr.slice();
      if (!explicit) { const ck = JAR.header(cur); if (ck) h = [...h, ["Cookie", ck]]; }
      const head = await open(cur, { headers: h, timeout, proxy });
      JAR.add(cur, head.setCookies);
      if (REDIR.has(head.status) && head.location) { head.close(); cur = new URL(head.location, cur).toString(); continue; }
      await head.read(2048); return;
    }
  } catch { /* bỏ qua */ }
}
export { NetError, normProxy };
