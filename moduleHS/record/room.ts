import "server-only";

/* ============ Phòng dịch hội thoại nhiều thiết bị (kiểu Google Meet) ============
   Người chủ trì (đăng nhập HireX) bấm "Mời" → có link / mã QR. Người Nhật (hoặc người nói tiếng Anh) mở link trên điện thoại của mình:
   điện thoại nghe bằng micro riêng, bằng đúng thứ tiếng của họ → không phải bấm đổi người nói, hai bên nói chen nhau vẫn ghi được.
   Mọi dòng (của chủ trì và khách) đi qua phòng này; mỗi máy hỏi dài (long-poll) để nhận dòng mới ngay.
   - Dòng đang nói dở: chỉ lưu chữ (máy xem tự dịch nháp bằng Google Dịch ngay trên trình duyệt).
   - Dòng chốt: máy chủ sửa tên / thuật ngữ theo từ điển HireX (tiếng Việt) rồi dịch sang thứ tiếng còn lại.
   - Hai micro cùng phòng nghe lẫn tiếng nhau: dòng chốt trùng thời gian của 2 máy khác thứ tiếng → bỏ dòng có độ chắc thấp hơn hẳn
     (bộ nghe tiếng Việt nghe tiếng Nhật thì ra chữ vô nghĩa, độ chắc thấp — và ngược lại).
   Phòng chỉ ở bộ nhớ, tự xoá sau 6 giờ không dùng. Không cần đăng nhập để vào phòng: ai có link (mã ngẫu nhiên 12 ký tự) mới vào được. */
import fs from "node:fs";
import crypto from "node:crypto";
import { dir, fp, lang as langOf } from "./data";
import { fixText, getLex, protect } from "./lexicon";
import { gTranslate, scriptClean, dropEcho } from "./pipeline";
import { normText } from "./office";

export type RLine = { id: string; seq: number; dev: string; k: number; lang: string; text: string; tr: Record<string, string>; fin: boolean; t: number; t1: number; conf: number; drop?: boolean };
export type Room = { dv: number; ep: number; token: string; ws: string; slug: string; pair: string[]; t0: number; seq: number; lines: Map<string, RLine>; devs: Map<string, { lang: string; seen: number }>; wait: Set<() => void>; at: number };
type Store = { byTok: Map<string, Room>; byWs: Map<string, Room> };
const G = globalThis as unknown as { __hsRoom?: Store };
const R: Store = (G.__hsRoom ??= { byTok: new Map(), byWs: new Map() });
const TTL = 6 * 3600e3, MAX_LINES = 1500;

function prune() {
  const now = Date.now();
  for (const [k, r] of R.byTok) if (now - r.at > TTL) { R.byTok.delete(k); if (R.byWs.get(r.ws) === r) R.byWs.delete(r.ws); }
}
/** Phòng của người chủ trì (mỗi tài khoản 1 phòng đang mở; mở lại thì dùng tiếp). */
export function openRoom(key: string, ws: string, pair: string[]) {
  prune();
  let r = R.byWs.get(key);
  if (!r) {
    r = { dv: 0, ep: 1, token: crypto.randomBytes(9).toString("base64url"), ws, slug: "", pair, t0: Date.now(), seq: 0, lines: new Map(), devs: new Map(), wait: new Set(), at: Date.now() };
    R.byWs.set(key, r); R.byTok.set(r.token, r);
  } else { r.pair = pair; r.at = Date.now(); }
  return r;
}
/** Chủ trì bắt đầu ghi một cuộc họp mới: phòng sang cuộc hội thoại mới (xoá dòng cũ trên mọi máy), khách vẫn ở lại phòng. */
export function roomStart(r: Room, slug: string) {
  if (r.slug === slug) return; r.slug = slug; r.ep++; r.lines.clear(); r.t0 = Date.now(); r.seq++; r.at = Date.now();
  for (const w of r.wait) w(); r.wait.clear();
}
export const roomByToken = (t: string) => (/^[\w-]{8,40}$/.test(t || "") ? R.byTok.get(t) : undefined);

function bump(r: Room, l: RLine) {
  l.seq = ++r.seq; r.lines.set(l.id, l); r.at = Date.now();
  if (r.lines.size > MAX_LINES) { const old = [...r.lines.values()].sort((a, b) => a.seq - b.seq).slice(0, r.lines.size - MAX_LINES); for (const o of old) r.lines.delete(o.id); }
  for (const w of r.wait) w(); r.wait.clear();
}
export function put(r: Room, x: { dev: string; k: number; lang: string; text: string; tr?: Record<string, string>; fin: boolean; conf?: number; ts?: number; drop?: boolean }) {
  const id = `${x.dev}:${x.k}`, o = r.lines.get(id);
  if (o?.drop && !x.drop) return o;
  const l: RLine = { id, seq: 0, dev: x.dev, k: x.k, lang: x.lang, text: x.text, tr: x.tr ? { ...(o?.tr || {}), ...x.tr } : o?.text === x.text ? o.tr : {}, fin: x.fin, t: o?.t || x.ts || Date.now(), t1: Date.now(), conf: x.conf || 0, drop: x.drop };
  bump(r, l);
  if (l.fin && !l.drop) arbitrate(r, l);
  return l;
}
/** Hai máy cùng phòng nghe lẫn tiếng nhau: dòng chốt chồng thời gian, khác thứ tiếng → bỏ dòng kém chắc hơn hẳn. */
function arbitrate(r: Room, l: RLine) {
  if (!l.conf) return;
  for (const o of r.lines.values()) {
    if (o === l || o.dev === l.dev || o.lang === l.lang || !o.fin || o.drop || !o.conf) continue;
    if (!(o.t <= l.t1 + 700 && l.t <= o.t1 + 700)) continue;
    const lo = o.conf < l.conf - 0.15 ? o : l.conf < o.conf - 0.15 ? l : null;
    if (lo) { lo.drop = true; bump(r, lo); if (lo === l) return; }
  }
}
const view = (r: Room, after: number) => ({
  ok: true, seq: r.seq, dv: r.dv, ep: r.ep, t0: r.t0, pair: r.pair,
  devs: [...r.devs.entries()].filter(([, d]) => Date.now() - d.seen < 30e3).map(([dev, d]) => ({ dev, lang: d.lang })),
  lines: [...r.lines.values()].filter((l) => l.seq > after).sort((a, b) => a.seq - b.seq).map(({ id, seq, dev, k, lang, text, tr, fin, t, drop }) => ({ id, seq, dev, k, lang, text, tr, fin, t, drop: drop ? 1 : 0 })),
});
/** Hỏi dài: có dòng mới thì trả ngay, không thì chờ tối đa 20 giây. */
export async function poll(r: Room, after: number, dev: string, lg: string, dv = -1) {
  if (dev) {
    const o = r.devs.get(dev), fresh = !o || Date.now() - o.seen > 30e3;
    r.devs.set(dev, { lang: lg || o?.lang || "", seen: Date.now() });
    if (fresh) { r.dv++; for (const w of r.wait) w(); r.wait.clear(); }                        // máy mới vào phòng → báo ngay cho các máy khác
  }
  if (r.seq <= after && dv === r.dv) await new Promise<void>((ok) => { const f = () => { clearTimeout(t); ok(); }; const t = setTimeout(() => { r.wait.delete(f); ok(); }, 20e3); r.wait.add(f); });
  return view(r, after);
}
/** Một dòng chốt: sửa theo từ điển (tiếng Việt) + dịch sang các thứ tiếng còn lại của phòng. */
export async function finalLine(r: Room, src: string, raw: string) {
  const lex = await getLex(r.ws).catch(() => null), fx = lex && src === "vi" ? fixText(raw, lex) : { text: raw, hits: new Map<string, number>() };
  const t = dropEcho(fx.text, [], ""), tr: Record<string, string> = {};
  if (t) await Promise.all(r.pair.filter((x) => x !== src).map(async (to) => {
    const pr = lex ? protect(t, fx.hits, lex) : { text: t, back: (x: string) => x };
    try { tr[to] = pr.back(await gTranslate(pr.text, to, src)); } catch (e) { console.warn("[Phòng dịch] Google Dịch lỗi:", e instanceof Error ? e.message : e); }
  }));
  return { text: t, tr };
}
export function logLine(r: Room, x: Record<string, unknown>) {
  if (!r.slug) return;
  try { fs.mkdirSync(dir(r.slug), { recursive: true }); fs.appendFileSync(fp(r.slug, "live.jsonl"), JSON.stringify({ t: Date.now(), ...x }) + "\n"); } catch { /* bỏ qua */ }
}

/* ============ link công khai /api/hs/record/j/<mã>[/poll|/push] ============ */
const J = (b: unknown, s = 200) => Response.json(b, { status: s, headers: { "Cache-Control": "no-store" } });
export async function roomRoute(req: Request, seg: string[]) {
  const r = roomByToken(seg[1] || ""), q = new URL(req.url).searchParams;
  if (!r) return seg[2] ? J({ ok: false, stage: "Phòng đã đóng" }, 404) : new Response(GONE, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
  if (!seg[2]) return new Response(guestHtml(r, langOf(q.get("l")) || r.pair.find((x) => x !== "vi") || "ja"), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  const dev = String(q.get("dev") || "").replace(/[^\w-]/g, "").slice(0, 24);
  if (seg[2] === "poll" && req.method === "GET") return J(await poll(r, +(q.get("after") || 0) || 0, dev, langOf(q.get("lang")), q.has("dv") ? +(q.get("dv") || 0) : -1));
  if (seg[2] === "push" && req.method === "POST") {
    let b: Record<string, unknown> = {}; try { b = await req.json(); } catch { return J({ ok: false }, 400); }
    const d = String(b.dev || "").replace(/[^\w-]/g, "").slice(0, 24), src = langOf(b.lang), k = Math.max(0, Math.floor(+(b.k as number) || 0));
    if (!d || !src) return J({ ok: false }, 400);
    r.devs.set(d, { lang: src, seen: Date.now() });
    const raw = scriptClean(normText(String(b.text || "")).slice(0, 1200));
    if (b.drop) { put(r, { dev: d, k, lang: src, text: "", fin: true, drop: true }); return J({ ok: true }); }
    if (!b.fin) { if (raw) put(r, { dev: d, k, lang: src, text: raw, fin: false, ts: +(b.ts as number) || 0 }); return J({ ok: true }); }
    const out = raw ? await finalLine(r, src, raw) : { text: "", tr: {} };
    const l = put(r, { dev: d, k, lang: src, text: out.text, tr: out.tr, fin: true, conf: Math.min(1, Math.max(0, +(b.conf as number) || 0)), ts: +(b.ts as number) || 0, drop: !out.text });
    if (out.text) logLine(r, { k, fin: true, src, dev: d, raw, text: out.text, tr: Object.values(out.tr)[0] || "", lang: Object.keys(out.tr)[0] || "" });
    return J({ ok: true, text: out.text, tr: out.tr, drop: l.drop ? 1 : 0 });
  }
  return J({ ok: false }, 404);
}

const GONE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>HireX</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#555">Phòng dịch đã đóng · 通訳ルームは終了しました</body>`;
function guestHtml(r: Room, me: string) {
  const v = Date.now().toString(36);
  return `<!doctype html><html lang="${me}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>HireX · ${me === "ja" ? "通訳" : "Interpreter"}</title><link rel="stylesheet" href="/api/hs/qa?action=asset&f=guest.css&v=${v}"></head>
<body><div id="app"></div><script type="module">import { mount } from "/api/hs/qa?action=asset&f=guest.js&v=${v}"; mount(document.getElementById("app"), ${JSON.stringify({ token: r.token, me, pair: r.pair })});</script></body></html>`;
}
