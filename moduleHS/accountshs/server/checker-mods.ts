import "server-only";

import net from "node:net";
import tls from "node:tls";

/* Vọng gác — các checker chạy THUẦN trong Node (không cần curl_cffi): Telegram · Gmail · Proxy.
   Port từ checker/checktelegram.py · checkgmail.py · checkproxy.py. Giữ nguyên CHECKER meta + kết quả
   ('live' | 'die' | 'error', ghi chú, [số liệu thêm]). Checker cần curl_cffi (FB / FB Page / Bài đăng FB)
   KHÔNG ở đây — chúng được đẩy sang worker Python (xem server/checker.ts + worker/). */

export type CheckRes = "live" | "die" | "error" | string;
export interface CheckOut { res: CheckRes; info: string; extra?: Record<string, unknown> }
export interface CheckerMeta {
  id: string; name: string; icon: string; value: string;
  hint_tab: string[]; hint_field: string[];
  fields?: Array<{ k: string; label: string; secret?: boolean; ph?: string }>;
  extra?: Array<{ k: string; label: string; type?: string; icon?: string; match?: string[]; hint?: string }>;
  parts?: Array<{ k: string; label: string; icon?: string; match?: string[] }>;
  results?: Array<[string, string]>;
  desc?: string; threads?: number; timeout?: number; batch?: number; no_proxy?: boolean; url?: string;
  /** true = cần worker Python (curl_cffi); UI vẫn hiện nhưng chạy qua hàng đợi job. */
  worker?: boolean;
}
export interface CheckOpt {
  timeout?: number; proxy?: string; url?: string; x?: Record<string, string>; xon?: string[];
  stopped?: () => boolean;
}
export interface CheckerMod {
  CHECKER: CheckerMeta;
  check?: (value: string, opt: CheckOpt) => Promise<CheckOut>;
  check_batch?: (values: string[], opt: CheckOpt) => Promise<CheckOut[]>;
  compose?: (v: string, parts: Record<string, string>) => string;
  show?: (v: string) => string;
  meta?: () => Record<string, unknown>;
}

export class Abort extends Error {}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function nap(sec: number, opt: CheckOpt) {
  const end = Date.now() + sec * 1000;
  for (;;) { if (opt.stopped?.()) throw new Abort("stopped"); const left = end - Date.now(); if (left <= 0) return; await sleep(Math.min(100, left)); }
}

/* ───────── Telegram (t.me/<username>) ───────── */
const TG_LINK = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?@?([A-Za-z0-9_]+)/i;
const TG_PLAIN = /^@?([A-Za-z0-9_]+)$/;
const TG_VALID = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const TG_DIE = /If you have\s*Telegram\s*,\s*you can contact\s*@\w+\s*right away/i;
const TG_TITLE = /class="tgme_page_title"[^>]*>([\s\S]*?)<\/div>/i;
function unescapeHtml(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") { const hex = e[1] === "x" || e[1] === "X"; return String.fromCodePoint(parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10)); }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[e.toLowerCase()] ?? m;
  });
}
function tgNorm(value: string) { const m = TG_LINK.exec(value || "") || TG_PLAIN.exec((value || "").trim()); const u = m ? m[1] : ""; return TG_VALID.test(u) ? u : ""; }
function tgMeta(h: string, prop: string) {
  for (const t of h.slice(0, 40000).match(/<meta\b[^>]*>/gi) || []) {
    if (new RegExp(`(?:property|name)="${prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "i").test(t)) {
      const c = /content="([^"]*)"/.exec(t); if (c) return unescapeHtml(c[1]).trim();
    }
  }
  return "";
}
function tgParse(h: string): { res: CheckRes | null; info: string; name: string } {
  let name = ""; const m = TG_TITLE.exec(h);
  if (m) name = unescapeHtml(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  const og = tgMeta(h, "og:title");
  if (!name && og && !/^\s*Telegram\s*[:\-–]/i.test(og)) name = og;
  if (name) return { res: "live", info: "Live", name };
  const text = unescapeHtml(h.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  if (TG_DIE.test(text)) return { res: "die", info: "Die · không có tài khoản này", name: "" };
  if (h.includes("tgme_page") && (h.includes("tgme_page_photo") || h.includes("tgme_page_title"))) return { res: "live", info: "Live", name: "" };
  return { res: null, info: "không nhận ra trang t.me", name: "" };
}
const telegram: CheckerMod = {
  CHECKER: {
    id: "telegram", name: "Telegram", icon: "send", value: "Username Telegram",
    hint_tab: ["telegram", "tele", "tg"], hint_field: ["telegram", "username", "user name", "tele", "tg", "user", "id"],
    fields: [], extra: [{ k: "name", label: "Tên Telegram", type: "text", icon: "send", match: ["ten telegram", "ten tele", "ten tg", "telegram name", "ten", "name", "ho ten"], hint: "Tên hiển thị · chỉ ghi khi Live" }],
    desc: "t.me/<username>: có tên hiển thị = Live · \"If you have Telegram…\" = Die · lỗi / bị giới hạn = giữ nguyên.",
    threads: 8, timeout: 10,
  },
  async check(value, opt) {
    const u = tgNorm(value);
    if (!u) return { res: "error", info: "Username không hợp lệ (5–32 ký tự, chữ / số / _)" };
    const want = (opt.xon ?? ["name"]).includes("name");
    let why = "";
    try {
      for (let i = 0; i < 3; i++) {
        if (opt.stopped?.()) return { res: "error", info: "Đã dừng" };
        let code = 0, h = "";
        try {
          const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), (opt.timeout || 10) * 1000);
          const r = await fetch("https://t.me/" + u, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" } });
          clearTimeout(to); code = r.status; h = await r.text();
        } catch (e) { why = e instanceof Error ? e.name : "err"; await nap(0.4 * (i + 1) + Math.random() * 0.3, opt); continue; }
        if (code === 429) { why = "Telegram giới hạn tốc độ (giảm luồng / dùng proxy)"; await nap(1.5, opt); continue; }
        if (code !== 200) { why = "HTTP " + code; await nap(0.4 * (i + 1), opt); continue; }
        const p = tgParse(h);
        if (p.res === "live") return (want && p.name) ? { res: "live", info: "Live · " + p.name, extra: { name: p.name } } : { res: "live", info: "Live" };
        if (p.res === "die") return { res: "die", info: p.info };
        why = p.info; await nap(0.4 * (i + 1), opt);
      }
    } catch (e) { if (e instanceof Abort) return { res: "error", info: "Đã dừng" }; }
    return { res: "error", info: why || "chưa đọc được trang t.me" };
  },
};

/* ───────── Gmail (API checkmail.live, gửi theo lô ≤1000) ───────── */
const EM = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const gmInfo: Record<string, unknown> = {};
const gmail: CheckerMod = {
  CHECKER: {
    id: "gmail", name: "Gmail", icon: "mail", value: "Email",
    hint_tab: ["gmail", "email", "mail"], hint_field: ["email", "gmail", "mail"], batch: 1000, threads: 1, timeout: 60,
    fields: [{ k: "api_key", label: "API key", secret: true, ph: "Dán API key checkmail.live" }, { k: "session", label: "Session", secret: true, ph: "Chỉ cần khi API báo lỗi phiên" }],
    no_proxy: true, desc: "checkmail.live: gom tối đa 1.000 email / request. Hết lượt / sai key → dừng cả lượt.",
  },
  meta: () => ({ ...gmInfo }),
  async check_batch(values, opt) {
    const key = String(opt.x?.api_key || "").trim();
    if (!key) throw new Abort("Chưa nhập API key");
    const ems = values.map((v) => { const m = EM.exec(v || ""); return m ? m[0].toLowerCase() : ""; });
    const send = [...new Set(ems.filter(Boolean))].sort();
    const resMap: Record<string, string> = {};
    if (send.length) {
      const hdr: Record<string, string> = {
        accept: "application/json, text/plain, */*", "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5",
        "content-type": "application/json", origin: "https://checkmail.live", referer: "https://checkmail.live/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
      };
      const ss = String(opt.x?.session || "").trim();
      if (ss) hdr.cookie = ss.includes("=") ? ss : "PHPSESSID=" + ss;
      let d: Record<string, unknown>;
      try {
        const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), Math.max(30, opt.timeout || 60) * 1000);
        const r = await fetch("https://checkmail.live/check/", { method: "POST", signal: ctrl.signal, headers: hdr, body: JSON.stringify({ api_key: key, fastCheck: true, checkExist: false, emails: send }) });
        clearTimeout(to);
        if (!r.ok) {
          let msg = ""; try { msg = ((await r.json()) as { message?: string }).message || ""; } catch { /* */ }
          if ([401, 402, 403, 429].includes(r.status)) throw new Abort(`API từ chối (HTTP ${r.status})${msg ? ": " + msg : ""} - kiểm tra / đổi API key`);
          return values.map(() => ({ res: "error", info: "HTTP " + r.status }));
        }
        d = (await r.json()) as Record<string, unknown>;
      } catch (e) { if (e instanceof Abort) throw e; return values.map(() => ({ res: "error", info: e instanceof Error ? e.name : "err" })); }
      if (d.new_credit != null) gmInfo.credit = d.new_credit;
      if (!d.status) throw new Abort("API: " + (d.message || "lỗi không rõ") + " - kiểm tra / đổi API key");
      const items = (d.data as Array<Record<string, unknown>>) || [];
      items.forEach((it, i) => {
        const idx = Number(it.index ?? i + 1);
        const em = String(it.email || "").toLowerCase() || (idx > 0 && idx <= send.length ? send[idx - 1] : "");
        if (em) resMap[em] = String(it.status || "").toLowerCase();
      });
    }
    return ems.map((e) => {
      if (!e) return { res: "error", info: "Email không hợp lệ" };
      if (e in resMap) { const st = resMap[e]; return { res: ["live", "die", "verify_phone", "not_exist"].includes(st) ? st : "error", info: st }; }
      return { res: "error", info: "API không trả kết quả" };
    });
  },
};

/* ───────── Proxy (kết nối qua proxy tới trang kiểm tra, có kiểm xác thực) ───────── */
const A_OK = "Đúng user/pass", A_BAD = "Sai user/pass", A_MISS = "Thiếu user/pass", A_NONE = "Không cần", A_OPEN = "Không yêu cầu";
interface Px { sch: string; host: string; port: number; user: string; pw: string; auto: boolean }
const HOSTP = String.raw`([\w.-]+|\[[0-9a-fA-F:]+\])`;
const PX_PATS: Array<[string, RegExp]> = [
  ["none", new RegExp("^" + HOSTP + ":(\\d{1,5})$")],
  ["hp@c", new RegExp("^" + HOSTP + ":(\\d{1,5})@(.+)$")],
  ["hp:c", new RegExp("^" + HOSTP + ":(\\d{1,5})[:|;\\s]+([^:|;\\s]+)[:|;\\s]+(.+)$")],
  ["c@hp", new RegExp("^(.+)@" + HOSTP + ":(\\d{1,5})$")],
  ["c:hp", new RegExp("^([^:|;\\s]+)[:|;\\s]+(.+)[:|;\\s]+" + HOSTP + ":(\\d{1,5})$")],
];
function pxParse(value: string): Px | null {
  const v = String(value || "").trim(); if (!v) return null;
  const m = /^(\w+):\/\/(.+)$/.exec(v);
  let sch = m ? m[1].toLowerCase() : "http"; let rest = m ? m[2] : v;
  if (sch === "socks5h") sch = "socks5"; if (sch === "socks4a") sch = "socks4";
  rest = rest.trim().replace(/\/+$/, "");
  for (const [kind, rx] of PX_PATS) {
    const g = rx.exec(rest); if (!g) continue;
    let host: string, port: string, user = "", pw = "";
    if (kind === "none") { host = g[1]; port = g[2]; }
    else if (kind === "hp@c") { host = g[1]; port = g[2]; [user, pw] = splitFirst(g[3], ":"); }
    else if (kind === "c@hp") { [user, pw] = splitFirst(g[1], ":"); host = g[2]; port = g[3]; }
    else if (kind === "hp:c") { host = g[1]; port = g[2]; user = g[3]; pw = g[4]; }
    else { user = g[1]; pw = g[2]; host = g[3]; port = g[4]; }
    const p = Number(port); if (p > 0 && p < 65536) return { sch, host: host.replace(/^\[|\]$/g, ""), port: p, user, pw, auto: !m };
  }
  return null;
}
function splitFirst(s: string, sep: string): [string, string] { const i = s.indexOf(sep); return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]; }
const pxType = (t: string) => { const s = String(t || "").toLowerCase().replace(/[^a-z0-9]/g, ""); return s.includes("socks5") || s === "socks" ? "socks5" : s.includes("socks4") ? "socks4" : s === "https" ? "https" : s.includes("http") ? "http" : ""; };

class PxFail extends Error { constructor(readonly resK: CheckRes, readonly why: string, readonly auth: string | null = null) { super(why); } }
class PxNotThis extends Error {}

function connectRaw(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((res, rej) => {
    const s = net.connect({ host, port });
    const to = setTimeout(() => { s.destroy(); rej(new PxFail("die", "Hết thời gian kết nối proxy")); }, timeoutMs);
    s.once("connect", () => { clearTimeout(to); res(s); });
    s.once("error", (e) => { clearTimeout(to); rej(new PxFail("die", "Không kết nối được proxy (" + (e as NodeJS.ErrnoException).code + ")")); });
  });
}
function readHead(s: net.Socket | tls.TLSSocket, timeoutMs: number): Promise<Buffer> {
  return new Promise((res, rej) => {
    let buf = Buffer.alloc(0);
    const to = setTimeout(() => { cleanup(); rej(new PxFail("die", "Hết thời gian đọc proxy")); }, timeoutMs);
    const onData = (d: Buffer) => { buf = Buffer.concat([buf, d]); if (buf.includes("\r\n\r\n") || buf.length > 16384) { cleanup(); res(buf); } };
    const onEnd = () => { cleanup(); res(buf); };
    const onErr = (e: Error) => { cleanup(); rej(e); };
    const cleanup = () => { clearTimeout(to); s.off("data", onData); s.off("end", onEnd); s.off("error", onErr); };
    s.on("data", onData); s.on("end", onEnd); s.on("error", onErr);
  });
}
function readN(s: net.Socket, n: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((res, rej) => {
    let buf = Buffer.alloc(0);
    const to = setTimeout(() => { cleanup(); rej(new PxNotThis("timeout")); }, timeoutMs);
    const onData = (d: Buffer) => { buf = Buffer.concat([buf, d]); if (buf.length >= n) { cleanup(); res(buf.subarray(0, n)); } };
    const onEnd = () => { cleanup(); rej(new PxNotThis("đóng kết nối")); };
    const onErr = (e: Error) => { cleanup(); rej(e); };
    const cleanup = () => { clearTimeout(to); s.off("data", onData); s.off("end", onEnd); s.off("error", onErr); };
    s.on("data", onData); s.on("end", onEnd); s.on("error", onErr);
  });
}
function httpCode(head: Buffer): number { const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(head.toString("latin1")); if (!m) throw new PxNotThis("không phải HTTP"); return +m[1]; }
const basic = (p: Px) => "Basic " + Buffer.from(`${p.user}:${p.pw}`).toString("base64");

async function pxTry(p: Px, sch: string, url: URL, tmo: number): Promise<{ code: number; used: boolean }> {
  const th = url.hostname, tp = +(url.port || (url.protocol === "https:" ? 443 : 80));
  const path = url.pathname + (url.search || "");
  const s = await connectRaw(p.host, p.port, tmo);
  let used = Boolean(p.user);
  try {
    if ((sch === "http" || sch === "https") && url.protocol === "http:") {
      let req = `GET ${url.href} HTTP/1.1\r\nHost: ${url.host}\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n`;
      if (p.user) req += `Proxy-Authorization: ${basic(p)}\r\n`;
      s.write(req + "\r\n");
      const code = httpCode(await readHead(s, tmo));
      if (code === 407) throw new PxFail("die", p.user ? "407 sai user/pass" : "407 proxy cần user/pass", p.user ? A_BAD : A_MISS);
      return { code, used };
    }
    if (sch === "http" || sch === "https") {
      let req = `CONNECT ${th}:${tp} HTTP/1.1\r\nHost: ${th}:${tp}\r\nUser-Agent: Mozilla/5.0\r\nProxy-Connection: keep-alive\r\n`;
      if (p.user) req += `Proxy-Authorization: ${basic(p)}\r\n`;
      s.write(req + "\r\n");
      const code = httpCode(await readHead(s, tmo));
      if (code === 407) throw new PxFail("die", p.user ? "407 sai user/pass" : "407 proxy cần user/pass", p.user ? A_BAD : A_MISS);
      if (code !== 200) throw new PxFail("die", `CONNECT bị từ chối (${code})`);
    } else if (sch === "socks5") { used = (await socks5(s, p, th, tp, tmo)) === 0x02; }
    else if (sch === "socks4") { await socks4(s, p, th, tp, tmo); used = false; }
    else throw new PxFail("error", `Loại proxy ${sch} chưa hỗ trợ`);
    let sock: net.Socket | tls.TLSSocket = s;
    if (url.protocol === "https:") sock = tls.connect({ socket: s, servername: th, rejectUnauthorized: false });
    sock.write(`GET ${path || "/"} HTTP/1.1\r\nHost: ${th}\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n`);
    let code: number; try { code = httpCode(await readHead(sock, tmo)); } catch { throw new PxFail("die", "Trang kiểm tra không trả lời qua proxy"); }
    return { code, used };
  } catch (e) {
    if (e instanceof PxFail || e instanceof PxNotThis) throw e;
    throw new PxNotThis((e as Error).name);
  } finally { try { s.destroy(); } catch { /* */ } }
}
async function socks5(s: net.Socket, p: Px, th: string, tp: number, tmo: number): Promise<number> {
  const meth = p.user ? Buffer.from([0x00, 0x02]) : Buffer.from([0x00]);
  s.write(Buffer.concat([Buffer.from([0x05, meth.length]), meth]));
  const r = await readN(s, 2, tmo);
  if (r[0] !== 5) throw new PxNotThis("không phải SOCKS5");
  if (r[1] === 0xff) throw new PxFail("die", p.user ? "SOCKS5 từ chối cách xác thực" : "SOCKS5 cần user/pass", p.user ? A_BAD : A_MISS);
  if (r[1] === 0x02) {
    const u = Buffer.from(p.user).subarray(0, 255), w = Buffer.from(p.pw).subarray(0, 255);
    s.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([w.length]), w]));
    const a = await readN(s, 2, tmo); if (a[1] !== 0) throw new PxFail("die", "SOCKS5 sai user/pass", A_BAD);
  } else if (r[1] !== 0x00) throw new PxFail("die", `SOCKS5 đòi cách xác thực không hỗ trợ (${r[1]})`);
  const hb = Buffer.from(th); const pb = Buffer.alloc(2); pb.writeUInt16BE(tp);
  s.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]), hb, pb]));
  const h = await readN(s, 4, tmo); if (h[1] !== 0) throw new PxFail("die", `SOCKS5 không mở được kết nối (mã ${h[1]})`);
  const at = h[3], n = at === 1 ? 4 : at === 4 ? 16 : (await readN(s, 1, tmo))[0];
  await readN(s, n + 2, tmo); return r[1] === 0x02 ? 0x02 : 0;
}
async function socks4(s: net.Socket, p: Px, th: string, tp: number, tmo: number) {
  const { promises: dns } = await import("node:dns");
  let ip: Buffer; try { const a = await dns.lookup(th); ip = Buffer.from(a.address.split(".").map(Number)); } catch { throw new PxFail("error", "Không phân giải được " + th); }
  const pb = Buffer.alloc(2); pb.writeUInt16BE(tp);
  s.write(Buffer.concat([Buffer.from([0x04, 0x01]), pb, ip, Buffer.from(p.user).subarray(0, 255), Buffer.from([0])]));
  const r = await readN(s, 8, tmo); if (r[0] !== 0) throw new PxNotThis("không phải SOCKS4"); if (r[1] !== 0x5a) throw new PxFail("die", `SOCKS4 từ chối (mã ${r[1]})`);
}
async function needsAuth(p: Px, url: URL, tmo: number): Promise<boolean> {
  try {
    const s = await connectRaw(p.host, p.port, tmo);
    try {
      if (url.protocol === "http:") s.write(`GET ${url.href} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`);
      else s.write(`CONNECT ${url.hostname}:${url.port || 443} HTTP/1.1\r\nHost: ${url.hostname}:${url.port || 443}\r\n\r\n`);
      return httpCode(await readHead(s, tmo)) === 407;
    } finally { s.destroy(); }
  } catch { return true; }
}
const proxy: CheckerMod = {
  CHECKER: {
    id: "proxy", name: "Proxy", icon: "shield", value: "IP / Proxy",
    parts: [
      { k: "port", label: "Port", icon: "hash", match: ["port", "cong", "cổng"] },
      { k: "user", label: "User", icon: "user", match: ["user", "username", "user name", "ten dang nhap", "login", "tai khoan proxy"] },
      { k: "pw", label: "Mật khẩu", icon: "lock", match: ["mat khau", "pass", "password", "pw", "pwd", "mk"] },
      { k: "type", label: "Loại", icon: "list", match: ["loai", "loai proxy", "type", "giao thuc", "protocol", "kieu"] },
    ],
    hint_tab: ["proxy", "proxies"], hint_field: ["proxy", "ip", "ip:port", "host"],
    url: "https://www.google.com/generate_204", no_proxy: true,
    extra: [{ k: "auth", label: "Xác thực", type: "text", icon: "key", match: ["xac thuc", "auth", "authen", "trang thai auth", "user pass"] }],
    threads: 20, timeout: 10,
    desc: "Kết nối qua proxy tới trang kiểm tra (mặc định Google generate_204); kiểm luôn user/pass. Hỗ trợ HTTP/HTTPS/SOCKS5/SOCKS4.",
  },
  compose(v, pt) {
    v = String(v || "").trim();
    const port = String(pt.port || "").replace(/\D/g, ""); const user = String(pt.user || "").trim(); const pw = String(pt.pw || "").trim(); const ty = pxType(pt.type);
    if (/^[0-9a-fA-F]*:[0-9a-fA-F:]+$/.test(v) && (v.match(/:/g) || []).length >= 2 && port) v = "[" + v + "]";
    let p = pxParse(v); if (!p && port) p = pxParse(v.replace(/:$/, "") + ":" + port); if (!p) return v;
    if (!p.user && user) { p.user = user; p.pw = pw; }
    const sch = ty || (p.auto ? "" : p.sch); const h = p.host.includes(":") ? "[" + p.host + "]" : p.host;
    return (sch ? sch + "://" : "") + `${h}:${p.port}` + (p.user ? `@${p.user}:${p.pw}` : "");
  },
  show(value) { const p = pxParse(value); if (!p) return String(value || ""); return `${p.auto ? "" : p.sch + "://"}${p.host}:${p.port}${p.user ? " · " + p.user + ":••••" : ""}`; },
  async check(value, opt) {
    const p = pxParse(value); if (!p) return { res: "error", info: "Proxy không hợp lệ" };
    let url: URL; try { url = new URL(opt.url || proxy.CHECKER.url!); } catch { return { res: "error", info: "Trang kiểm tra không hợp lệ" }; }
    const tmo = (opt.timeout || 10) * 1000;
    const order = p.auto ? ["http", "socks5", "socks4"] : [p.sch];
    let last: PxFail | null = null;
    for (const sch of order) {
      let code: number, used: boolean;
      try { ({ code, used } = await pxTry(p, sch, url, tmo)); }
      catch (f) {
        if (f instanceof PxNotThis) { last = last || new PxFail("die", "Proxy không phản hồi đúng giao thức (" + f.message + ")"); continue; }
        if (f instanceof PxFail) {
          if (f.resK === "die" && f.auth === null && p.auto && sch !== order[order.length - 1] && !f.why.includes("Không kết nối") && !f.why.includes("Hết thời gian kết nối")) { last = last && sch !== "http" ? last : f; continue; }
          return f.auth ? { res: f.resK, info: f.why, extra: { auth: f.auth } } : { res: f.resK, info: f.why };
        }
        return { res: "error", info: (f as Error).message };
      }
      const name = sch.toUpperCase();
      if (p.user && used && (sch === "http" || sch === "https")) used = await needsAuth(p, url, tmo);
      const auth = p.user ? (used ? A_OK : A_OPEN) : A_NONE;
      if (code >= 200 && code < 400) return { res: "live", info: `${code} · ${name} · ${auth}`, extra: { auth } };
      return { res: "error", info: `HTTP ${code} · ${name} · ${auth}`, extra: { auth } };
    }
    return { res: "die", info: (last || new PxFail("die", "Không kết nối được proxy")).why };
  },
};

/* checker chạy trong worker (curl_cffi) — chỉ khai báo META để UI hiện; chạy = tạo job. */
const fbWorker: CheckerMeta[] = [
  { id: "fb", name: "Facebook", icon: "facebook", value: "UID Facebook", worker: true, hint_tab: ["facebook", "fb", "via", "clone"], hint_field: ["uid", "id facebook", "id fb", "fb id", "id"], fields: [{ k: "cookie", label: "Cookie", secret: true, ph: "Tùy chọn · giúp đọc tên ổn định hơn" }, { k: "refresh", label: "Đọc lại tên", ph: "Trống = chỉ đọc ô tên còn trống · 1 = đọc lại tất cả" }], extra: [{ k: "name", label: "Tên FB", type: "text", icon: "user", match: ["ten fb", "ten facebook", "ten tai khoan", "fb name", "ten", "name", "ho ten"], hint: "chỉ ghi khi Live" }], threads: 5, timeout: 12, desc: "Cần worker Python (curl_cffi). Graph picture + đọc tên khi Live." },
  { id: "fbpage", name: "FB Page", icon: "flag", value: "UID Page", worker: true, hint_tab: ["fb page", "fanpage", "page"], hint_field: ["uid page", "page id", "id page", "uid", "id"], fields: [{ k: "cookie", label: "Cookie", secret: true, ph: "Tùy chọn" }, { k: "refresh", label: "Đọc lại tên" }], extra: [{ k: "name", label: "Tên Page", type: "text", icon: "flag", match: ["ten page", "ten fanpage", "ten trang", "page name", "ten", "name"], hint: "chỉ ghi khi Live" }], threads: 5, timeout: 12, desc: "Cần worker Python (curl_cffi). Giống Facebook." },
  { id: "fbpost", name: "Bài đăng FB", icon: "note", value: "UID bài viết", worker: true, hint_tab: ["bai dang fb", "bai dang", "post fb", "fb post", "bai viet"], hint_field: ["uid bai viet", "uid bai dang", "post id", "id bai viet", "uid", "link bai viet", "link"], fields: [{ k: "cookie", label: "Cookie", secret: true, ph: "Tùy chọn" }], extra: [{ k: "comments", label: "Số bình luận", type: "number", icon: "chat", match: ["so binh luan", "binh luan", "so comment", "comment", "comments", "so cmt", "cmt"], hint: "Ghi khi bài Live" }], threads: 5, timeout: 15, desc: "Cần worker Python (curl_cffi). Bài LIVE/DIE theo UID." },
];

export const MODS: CheckerMod[] = [telegram, gmail, proxy];
export const WORKER_METAS = fbWorker;
export const MOD_MAP: Record<string, CheckerMod> = Object.fromEntries(MODS.map((m) => [m.CHECKER.id, m]));
export const WORKER_IDS = new Set(fbWorker.map((m) => m.id));
/** META của mọi checker (node + worker), theo thứ tự hiển thị. */
export const ALL_METAS: CheckerMeta[] = [...MODS.map((m) => m.CHECKER), ...fbWorker];
