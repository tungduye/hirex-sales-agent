// Kiểm thử (Tiện ích › Kiểm thử phần mềm) — tiến trình agent chạy riêng cho mỗi lượt test:
//   node qa-worker.mjs <thư mục lượt test> [--resume]
// Mở trình duyệt (Playwright, không giao diện) → AI đọc danh sách phần tử + ảnh màn hình → chọn 1 thao tác / lượt → ghi nhật ký,
// đo tốc độ, lỗi console / mạng → hết việc thì viết báo cáo → ở lại 10 phút chờ người dùng nhắn tiếp (test thêm / hỏi kết quả).
// Nhắn khi trình duyệt đã đóng: web chạy lại tiến trình với --resume (giữ nguyên nhật ký, trò chuyện, phát hiện).
// Giao tiếp với web HireX bằng file trong thư mục lượt test (không cổng mạng riêng):
//   run.json (đầu vào) · state.json (trạng thái, trò chuyện, nhật ký — ghi liên tục) · frame.jpg (hình trực tiếp, CDP screencast ~12 hình/giây)
//   step-NNN.jpg (ảnh từng bước) · cmd.jsonl (lệnh người dùng: nhắn / tiếp tục / tạm dừng / dừng / điều khiển chuột – phím) · report.json
// Tài khoản / mật khẩu người dùng nhập: nhận qua biến môi trường, AI chỉ thấy {{user}} / {{pass}}, không ghi ra đĩa.
// Tiết kiệm token: model nhanh (Luna) cho từng bước, lịch sử dạng chỉ-nối-thêm để OpenAI cache phần đầu (giảm ~90% giá phần đã cache),
// ảnh màn hình độ phân giải thấp trừ khi trang đổi; kẹt (lỗi liên tiếp / lặp) mới gọi model mạnh hơn cho 1 bước.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const DIR = process.argv[2], RESUME = process.argv.includes("--resume");
const RUN = JSON.parse(fs.readFileSync(path.join(DIR, "run.json"), "utf8"));
const KEY = (process.env.OPENAI_API_KEY || "").trim(), OA = process.env.HS_QA_OPENAI_URL || "https://api.openai.com/v1";
const MODEL = process.env.HS_QA_MODEL || "gpt-5.6-luna", SMART = process.env.HS_QA_SMART_MODEL || "gpt-5.6-terra", RMODEL = process.env.HS_QA_REPORT_MODEL || "gpt-5.6-terra";
/** Giá OpenAI / 1 triệu token: [vào, vào đã cache, ra] — chỉ để ước tính chi phí hiển thị. */
const PRICE = { "gpt-5.6-luna": [0.2, 0.02, 1.2], "gpt-5.6-terra": [2, 0.2, 12], "gpt-5.6-sol": [5, 0.5, 30], "gpt-5.4-mini": [0.75, 0.075, 4.5], "gpt-5-mini": [0.25, 0.025, 2] };
const SECRET = { user: process.env.HS_QA_USER || "", pass: process.env.HS_QA_PASS || "" };
const AUTH_DIR = process.env.HS_QA_AUTH_DIR || path.join(DIR, "..", "..", "auth");
const MAX_STEPS = Math.min(80, Math.max(5, +RUN.max_steps || 40)), FOLLOW = 30, MINUTES = +RUN.minutes > 0 ? Math.min(30, Math.max(2, +RUN.minutes)) : 0, MAX_MS = (MINUTES || 20) * 60e3, IDLE_MS = +process.env.HS_QA_IDLE_MS || 10 * 60e3, VW = 1280, VH = 800;
const f = (n) => path.join(DIR, n), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- trạng thái (state.json) ---------- */
const S0 = { status: "starting", phase: null, step: 0, max: MAX_STEPS, round: 1, url: RUN.url, title: "", thought: "", case: "", ask: null, frame: 0, cursor: null,
  started: Date.now(), ended: 0, error: "", log: [], notes: [], chat: [], cmdPos: 0, reported: -1,
  usage: { in: 0, cached: 0, out: 0, usd: 0, calls: 0 },
  metrics: { console: [], pageerror: [], failed: [], http: [], slow: [], navs: [], requests: 0, dialogs: [] } };
let S = S0;
/* Thu phóng trang web đang test (CSS zoom ở trang gốc): mặc định 75% để web bố cục cho màn rộng hơn vẫn lọt khung 1280×800.
   Toạ độ chuột / khung phần tử vẫn theo điểm ảnh nhìn thấy nên thao tác không lệch. Người dùng chỉnh − / + trên màn trực tiếp. */
const zClamp = (z) => Math.round(Math.max(0.5, Math.min(1.5, +z || 0.75)) * 100) / 100;
const zoomJs = (z) => `(()=>{if(window.top!==window)return;const a=()=>{const d=document.documentElement;if(d)d.style.zoom="${z}"};a();document.addEventListener("DOMContentLoaded",a)})()`;
async function setZoom(z) {
  S.zoom = zClamp(z); save(true);
  try { await ctx?.addInitScript(zoomJs(S.zoom)); } catch { /* ngữ cảnh đã đóng */ }
  for (const p of ctx?.pages() || []) await p.evaluate((v) => { document.documentElement.style.zoom = String(v); }, S.zoom).catch(() => {});
}
if (RESUME) { try { S = { ...S0, ...JSON.parse(fs.readFileSync(f("state.json"), "utf8")) }; } catch { /* hỏng: bắt đầu lại */ } S.status = "starting"; S.error = ""; S.ended = 0; S.ask = null; S.round = (S.round || 1) + 1; }
const T0 = S.started;
let saveTm = 0;
function save(now_ = false) {
  const w = () => { saveTm = 0; const t = f("state.json.tmp"); try { fs.writeFileSync(t, JSON.stringify(S)); fs.renameSync(t, f("state.json")); } catch { /* đĩa bận: lần sau ghi */ } };
  if (now_) { clearTimeout(saveTm); w(); } else if (!saveTm) saveTm = setTimeout(w, 200);
}
const log = (e) => { const x = { n: S.log.length + 1, t: Date.now() - T0, at: Date.now(), ok: true, ...e }; S.log.push(x); save(); return x; };
const chat = (who, text, extra = {}) => { const m = { id: uid(), who, text: String(text || "").slice(0, 2000), at: Date.now(), ...extra }; S.chat.push(m); if (S.chat.length > 400) S.chat.splice(0, S.chat.length - 400); save(); return m; };
const phase = (k, label = "") => { S.phase = { k, label: String(label).slice(0, 140), at: Date.now() }; save(); };
const cap = (a, n = 60) => { if (a.length > n) a.splice(0, a.length - n); };

/* ---------- lệnh người dùng (cmd.jsonl) — đọc liên tục 4 lần / giây, kể cả khi AI đang nghĩ ---------- */
const pending = { say: [], stop: false, pause: false, go: false, bonus: 0 };
let remoteQ = Promise.resolve();
function pump() {
  let txt = "";
  try { const b = fs.readFileSync(f("cmd.jsonl")); if (b.length <= S.cmdPos) return; txt = b.subarray(S.cmdPos).toString("utf8"); const cut = txt.lastIndexOf("\n"); if (cut < 0) return; txt = txt.slice(0, cut); S.cmdPos += Buffer.byteLength(txt) + 1; } catch { return; }
  for (const l of txt.split("\n")) {
    let c; try { c = JSON.parse(l); } catch { continue; }
    if (c.type === "stop") { pending.stop = true; pending.go = true; chat("sys", "Đã yêu cầu dừng"); }
    else if (c.type === "pause") { if (!pending.pause) { pending.pause = true; chat("sys", "Tạm dừng — có thể tự thao tác trên màn hình"); } }
    else if (c.type === "continue") { pending.pause = false; pending.go = true; }
    else if ((c.type === "say" || c.type === "answer") && c.text) { const t = String(c.text).slice(0, 2000); chat("user", t, c.cid ? { cid: String(c.cid).slice(0, 40) } : {}); pending.say.push(t); pending.bonus += 10; pending.pause = false; pending.go = true; }
    else if (["click", "type", "key", "scroll", "goto", "back"].includes(c.type)) remoteQ = remoteQ.then(() => remote(c)).catch(() => {});
    else if (c.type === "zoom") remoteQ = remoteQ.then(() => setZoom(c.z)).catch(() => {});
  }
  save();
}
async function until(fn, ms) { const end = Date.now() + ms; while (!fn() && Date.now() < end) await sleep(150); return fn(); }

/* ---------- trình duyệt ---------- */
let browser, ctx, page, cdp = null;
const host = (() => { try { return new URL(RUN.url).host.replace(/[^\w.-]/g, "_"); } catch { return "x"; } })();
const authFile = path.join(AUTH_DIR, host + ".json");
async function launch() {
  const opts = { headless: true, args: ["--disable-dev-shm-usage", "--no-first-run", "--lang=vi-VN"] };
  if (process.env.HS_QA_CHROME) opts.executablePath = process.env.HS_QA_CHROME;
  const tries = [opts, { ...opts, channel: "msedge" }, { ...opts, channel: "chrome" }];
  let first;
  for (const o of tries) { try { return await chromium.launch(o); } catch (e) { first ??= e; } }
  throw new Error("Không mở được trình duyệt trên máy chủ: " + String(first?.message || first).split("\n")[0]);
}
const INIT = () => {   // chạy trong trang: đo LCP / CLS
  try {
    window.__qa = { lcp: 0, cls: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__qa.lcp = Math.round(e.startTime); }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__qa.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  } catch { /* trình duyệt không hỗ trợ */ }
};

/* Hình trực tiếp: CDP screencast — trình duyệt tự đẩy hình mỗi khi màn hình đổi (~12 hình/giây khi có chuyển động, đứng yên thì không tốn gì).
   Ghi frame.jpg (thay nguyên tử); web đọc và phát như video (multipart). Không nhận được hình 3 giây → chụp bù 1 tấm. */
let lastFrame = 0, latest = null, flushTm = 0;
function writeFrame(b) { try { fs.writeFileSync(f("frame.tmp"), b); fs.renameSync(f("frame.tmp"), f("frame.jpg")); S.frame++; lastFrame = Date.now(); } catch { /* web đang đọc: hình sau */ } }
function onFrame(b) { latest = b; if (flushTm) return; const wait = Math.max(0, 80 - (Date.now() - lastFrame)); flushTm = setTimeout(() => { flushTm = 0; if (latest) { writeFrame(latest); latest = null; } }, wait); }
async function cast(p) {
  try { await cdp?.send("Page.stopScreencast"); await cdp?.detach(); } catch { /* trang cũ đã đóng */ }
  cdp = null;
  try {
    const s = await ctx.newCDPSession(p); cdp = s;
    s.on("Page.screencastFrame", (x) => { s.send("Page.screencastFrameAck", { sessionId: x.sessionId }).catch(() => {}); if (s === cdp) onFrame(Buffer.from(x.data, "base64")); });
    await s.send("Page.startScreencast", { format: "jpeg", quality: 62, maxWidth: VW, maxHeight: VH, everyNthFrame: 1 });
  } catch { cdp = null; }
}
let tickTm = 0;
function ticker() { clearInterval(tickTm); tickTm = setInterval(async () => { if (!page || page.isClosed() || Date.now() - lastFrame < 3000) return; try { writeFrame(await page.screenshot({ type: "jpeg", quality: 60, timeout: 4000 })); } catch { /* đang chuyển trang */ } }, 1000); }

function watch(p) {
  const M = S.metrics, starts = new Map(), rel = () => Date.now() - T0;
  p.on("console", (m) => { if (m.type() === "error") { M.console.push({ t: rel(), text: m.text().slice(0, 300) }); cap(M.console); } });
  p.on("pageerror", (e) => { M.pageerror.push({ t: rel(), text: String(e.message || e).slice(0, 300) }); cap(M.pageerror); });
  p.on("request", (r) => { M.requests++; starts.set(r, Date.now()); });
  p.on("requestfailed", (r) => { const u = r.url(); if (/^data:|^blob:/.test(u)) return; M.failed.push({ t: rel(), url: u.slice(0, 200), err: (r.failure()?.errorText || "").slice(0, 80), type: r.resourceType() }); cap(M.failed); });
  p.on("requestfinished", (r) => { const t0 = starts.get(r); starts.delete(r); if (!t0) return; const ms = Date.now() - t0; if (ms > 1500 && !/^data:/.test(r.url())) { M.slow.push({ t: rel(), url: r.url().slice(0, 200), ms, type: r.resourceType(), method: r.method() }); cap(M.slow, 80); } });
  p.on("response", (r) => { const s = r.status(); if (s >= 400) { M.http.push({ t: rel(), url: r.url().slice(0, 200), status: s, method: r.request().method() }); cap(M.http); } });
  p.on("dialog", async (d) => { M.dialogs.push({ t: rel(), type: d.type(), text: d.message().slice(0, 200) }); log({ kind: "dialog", label: `Hộp thoại ${d.type()}: “${d.message().slice(0, 80)}”` }); try { await d.accept(); } catch { /* đã đóng */ } });
  p.on("load", () => navPerf(p).catch(() => {}));
  p.on("framenavigated", (fr) => { if (fr === p.mainFrame()) { S.url = fr.url(); save(); } });
}
async function navPerf(p) {
  await sleep(1200);
  const x = await p.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return n ? { url: location.href, ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), lcp: window.__qa?.lcp || 0, cls: +(window.__qa?.cls || 0).toFixed(3), size_kb: Math.round((n.transferSize || 0) / 1024) } : null; }).catch(() => null);
  if (x) { S.metrics.navs.push({ t: Date.now() - T0, ...x }); cap(S.metrics.navs, 40); save(); }
}
async function attachPage(p) { page = p; watch(p); await cast(p); }
async function settle(ms = 2500) {
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: ms }).catch(() => {});
}

/* ---------- đọc trang: phần tử tương tác (đánh số) + chữ ---------- */
const SNAP = () => {
  for (const e of document.querySelectorAll("[data-qa]")) e.removeAttribute("data-qa");
  const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=radio],[role=option],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
  const out = []; let id = 0;
  const lab = (e) => { if (e.labels && e.labels[0]) return e.labels[0].innerText; const l = e.getAttribute("aria-labelledby"); if (l) return document.getElementById(l)?.innerText || ""; return ""; };
  for (const e of document.querySelectorAll(sel)) {
    if (id >= 130) break;
    const r = e.getBoundingClientRect(); if (r.width < 3 || r.height < 3 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const s = getComputedStyle(e); if (s.visibility === "hidden" || s.display === "none" || +s.opacity < 0.05) continue;
    const cx = Math.min(innerWidth - 1, Math.max(0, r.x + r.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, r.y + r.height / 2)), top = document.elementFromPoint(cx, cy);
    const covered = top && top !== e && !e.contains(top) && !top.contains(e);
    id++; e.setAttribute("data-qa", String(id));
    const tag = e.tagName.toLowerCase(), type = tag === "input" ? (e.type || "text") : "", role = e.getAttribute("role") || "";
    const clean = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const name = clean(e.getAttribute("aria-label") || lab(e) || (tag === "input" || tag === "textarea" ? e.placeholder || e.name : e.innerText) || e.title || e.getAttribute("alt") || e.querySelector?.("img")?.alt || (e.querySelector?.("svg") ? "(icon)" : ""));
    let extra = "";
    if (tag === "input" || tag === "textarea") extra += type === "password" ? (e.value ? " =••••" : " =trống") : e.type === "checkbox" || e.type === "radio" ? (e.checked ? " [x]" : " [ ]") : ` =“${clean(e.value).slice(0, 40)}”`;
    if (tag === "select") extra += ` =“${clean(e.options[e.selectedIndex]?.text)}” [${[...e.options].slice(0, 8).map((o) => clean(o.text)).join(" | ")}]`;
    if (e.disabled || e.getAttribute("aria-disabled") === "true") extra += " (khoá)";
    if (e.getAttribute("aria-expanded")) extra += ` (mở=${e.getAttribute("aria-expanded")})`;
    if (covered) extra += " (bị che)";
    out.push(`[${id}] ${tag}${type ? ":" + type : ""}${role ? " role=" + role : ""} "${name}"${extra} @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const text = (document.body?.innerText || "").replace(/\n{2,}/g, "\n").slice(0, 1600);
  return { url: location.href, title: document.title, els: out, text, scroll: `${Math.round(scrollY)}/${Math.max(0, document.documentElement.scrollHeight - innerHeight)}` };
};
async function snapshot() {
  for (let i = 0; i < 2; i++) { try { return await page.evaluate(SNAP); } catch { await sleep(600); } }
  return { url: page.url(), title: "", els: [], text: "", scroll: "0/0" };
}
async function shot(n) {
  const name = `step-${String(n).padStart(3, "0")}.jpg`;
  try { const b = await page.screenshot({ type: "jpeg", quality: 55, timeout: 10000 }); fs.writeFileSync(f(name), b); return { name, b64: b.toString("base64") }; } catch { return { name: "", b64: "" }; }
}

/* ---------- thao tác ---------- */
const sub = (t) => String(t ?? "").replace(/\{\{\s*user\s*\}\}/gi, SECRET.user).replace(/\{\{\s*pass\s*\}\}/gi, SECRET.pass);
const hide = (t) => String(t ?? "").replace(/\{\{\s*pass\s*\}\}/gi, "••••").slice(0, 80);
const el = (ref) => page.locator(`[data-qa="${Number(ref)}"]`).first();
/** Chữ trên trang + ô nhập chưa hợp lệ (thông báo kiểm tra của trình duyệt không nằm trong DOM) — so trước / sau thao tác. */
const probe = () => page.evaluate(() => ({
  lines: (document.body?.innerText || "").split("\n").map((x) => x.trim()).filter((x) => x && x.length < 200).slice(0, 600),
  inv: [...document.querySelectorAll("input,select,textarea")].filter((e) => e.willValidate && !e.validity.valid).map((e) => `${(e.labels?.[0]?.innerText || e.getAttribute("aria-label") || e.name || e.placeholder || e.type || "").trim().slice(0, 30)}: ${e.validationMessage}`).slice(0, 4),
})).catch(() => ({ lines: [], inv: [] }));
const errsNow = () => S.metrics.console.length + S.metrics.pageerror.length + S.metrics.failed.length + S.metrics.http.length;
const nm = (a, ref) => (a.name ? "“" + String(a.name).slice(0, 50) + "”" : ref);
const LABEL = {
  click: (a, r) => `Bấm ${nm(a, r)}`, fill: (a, r) => `Điền ${nm(a, r)}: ${hide(a.text)}`, select: (a, r) => `Chọn ${nm(a, r)} = ${String(a.text).slice(0, 40)}`,
  press: (a) => `Nhấn phím ${a.key}`, hover: (a, r) => `Rê chuột ${nm(a, r)}`, scroll: (a) => `Cuộn ${a.direction === "up" ? "lên" : "xuống"}`,
  goto: (a) => `Mở ${String(a.url).replace(/^https?:\/\//, "").slice(0, 70)}`, back: () => "Quay lại trang trước", wait: (a) => `Chờ ${(Math.min(10000, Math.max(300, +a.ms || 1500)) / 1000).toFixed(1)} giây`,
};
/** Con trỏ ảo trên hình trực tiếp: báo web vị trí sắp thao tác, chờ một nhịp cho người xem thấy con trỏ di tới. */
async function pointAt(ref, k) {
  const b = await el(ref).boundingBox().catch(() => null); if (!b) return;
  S.cursor = { x: Math.max(0, Math.min(1, (b.x + b.width / 2) / VW)), y: Math.max(0, Math.min(1, (b.y + b.height / 2) / VH)), w: b.width / VW, h: b.height / VH, k, at: Date.now() }; save(true);
  await sleep(320);
}
async function act(name, a) {
  const ref = a.ref != null ? `[${a.ref}]` : "", label = (LABEL[name] || (() => name))(a, ref);
  phase("act", label);
  if (a.ref != null && ["click", "fill", "select", "hover"].includes(name)) await pointAt(a.ref, name);
  const before = await probe(), t0 = Date.now(), e0 = errsNow(), u0 = page.url(); let res = "";
  switch (name) {
    case "click": { const l = el(a.ref); try { await l.click({ timeout: 6000 }); } catch (e) { const b = await l.boundingBox().catch(() => null); if (!b) throw e; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); res = "bấm theo toạ độ (phần tử bị che / không bấm thẳng được). "; } break; }
    case "fill": { const l = el(a.ref); try { await l.fill(sub(a.text), { timeout: 6000 }); } catch { await l.click({ timeout: 4000 }); await page.keyboard.press("Control+A"); await page.keyboard.type(sub(a.text), { delay: 15 }); } if (a.enter) await page.keyboard.press("Enter"); break; }
    case "select": await el(a.ref).selectOption({ label: String(a.text) }, { timeout: 6000 }).catch(() => el(a.ref).selectOption(String(a.text), { timeout: 4000 })); break;
    case "press": await page.keyboard.press(String(a.key || "Enter")); break;
    case "hover": await el(a.ref).hover({ timeout: 5000 }); break;
    case "scroll": await page.mouse.move(VW / 2, VH / 2); await page.mouse.wheel(0, a.direction === "up" ? -650 : 650); break;
    case "goto": { const u = new URL(String(a.url), page.url()).href; if (!/^https?:/i.test(u)) throw new Error("Chỉ mở link http / https"); await page.goto(u, { waitUntil: "domcontentloaded", timeout: 30000 }); break; }
    case "back": await page.goBack({ timeout: 15000 }).catch(() => {}); break;
    case "wait": await sleep(Math.min(10000, Math.max(300, +a.ms || 1500))); break;
    default: throw new Error("Thao tác không hỗ trợ: " + name);
  }
  phase("load", "Chờ trang phản hồi");
  await settle();
  const ms = Date.now() - t0, e1 = errsNow(), after = await probe(), had = new Set(before.lines), added = [...new Set(after.lines.filter((l) => !had.has(l)))].slice(0, 5);
  if (added.length) res += `Hiện thêm: “${added.map((x) => x.slice(0, 90)).join("” · “")}”. `;
  if (after.inv.length) res += `Ô chưa hợp lệ (trình duyệt báo): ${after.inv.join("; ")}. `;
  if (!added.length && !after.inv.length && page.url() === u0 && !["wait", "scroll", "hover", "fill", "select"].includes(name)) res += "Không thấy thay đổi chữ trên trang. ";
  res += `${page.url() !== u0 ? "Chuyển sang " + page.url() + ". " : ""}${e1 > e0 ? `+${e1 - e0} lỗi mới (console / mạng). ` : ""}Xong sau ${(ms / 1000).toFixed(1)} giây.`;
  return { label, res, ms, err: e1 - e0 };
}

/* ---------- người dùng điều khiển tay (khi chờ / tạm dừng / sau khi xong) ---------- */
async function remote(c) {
  if (!page || page.isClosed()) return;
  try {
    if (c.type === "click") { const x = Math.max(0, Math.min(VW, +c.x * VW)), y = Math.max(0, Math.min(VH, +c.y * VH)); S.cursor = { x: x / VW, y: y / VH, k: "user", at: Date.now() }; await page.mouse.click(x, y); }
    else if (c.type === "type") await page.keyboard.type(String(c.text || "").slice(0, 500), { delay: 10 });
    else if (c.type === "key") await page.keyboard.press(String(c.key || "Enter"));
    else if (c.type === "scroll") await page.mouse.wheel(0, Math.max(-2000, Math.min(2000, +c.dy || 0)));
    else if (c.type === "back") await page.goBack({ timeout: 15000 });
    else if (c.type === "goto") { const u = new URL(String(c.url), page.url()).href; if (/^https?:/i.test(u)) await page.goto(u, { waitUntil: "domcontentloaded", timeout: 30000 }); }
  } catch { /* thao tác tay lỗi: bỏ qua */ }
}

/* ---------- AI ---------- */
const STR = { type: "string" }, NUM = { type: "number" }, NULLS = (t) => ({ type: [t, "null"] });
const fn = (name, description, props, req = []) => ({ type: "function", name, description, strict: true, parameters: { type: "object", additionalProperties: false,
  required: ["thought", "case", "say", ...req, ...Object.keys(props).filter((k) => !req.includes(k))],
  properties: { thought: { type: "string", description: "Ngắn (≤ 12 từ), động từ đầu: đang làm gì / kiểm tra gì." }, case: { type: "string", description: "Tên trường hợp test đang chạy (ngắn), giữ nguyên khi các bước cùng một trường hợp." },
    say: { type: ["string", "null"], description: "Chỉ khi người dùng VỪA NHẮN: 1–2 câu trả lời / xác nhận sẽ làm gì (xưng em). Không có tin mới thì null." }, ...props } } });
const TOOLS = [
  fn("click", "Bấm một phần tử theo số [ref] trong danh sách.", { ref: NUM, name: NULLS("string") }, ["ref"]),
  fn("fill", "Điền chữ vào ô nhập [ref] (xoá chữ cũ). Dùng {{user}} / {{pass}} cho tài khoản / mật khẩu người dùng cung cấp. enter=true để nhấn Enter sau khi điền.", { ref: NUM, text: STR, name: NULLS("string"), enter: NULLS("boolean") }, ["ref", "text"]),
  fn("select", "Chọn một mục trong ô chọn <select> [ref] theo chữ hiển thị.", { ref: NUM, text: STR, name: NULLS("string") }, ["ref", "text"]),
  fn("press", "Nhấn một phím: Enter, Escape, Tab, ArrowDown, ArrowUp, Backspace…", { key: STR }, ["key"]),
  fn("hover", "Rê chuột lên phần tử [ref] (xem tooltip / menu).", { ref: NUM, name: NULLS("string") }, ["ref"]),
  fn("scroll", "Cuộn trang lên / xuống một màn.", { direction: { type: "string", enum: ["up", "down"] } }, ["direction"]),
  fn("goto", "Mở một đường dẫn (tuyệt đối hoặc tương đối).", { url: STR }, ["url"]),
  fn("back", "Quay lại trang trước.", {}),
  fn("wait", "Chờ trang xử lý / tải (ms, tối đa 10000).", { ms: NUM }, ["ms"]),
  fn("note", "Ghi một phát hiện (không thao tác): lỗi, điểm UX khó dùng, chậm, nội dung sai, hoặc điểm tốt.", { type: { type: "string", enum: ["bug", "ux", "perf", "content", "ok"] }, severity: { type: "string", enum: ["cao", "trung bình", "thấp"] }, title: STR, detail: STR }, ["type", "severity", "title", "detail"]),
  fn("reply", "Trả lời người dùng bằng lời mà KHÔNG thao tác (họ hỏi về kết quả, lỗi, cách sửa…). Xong việc người dùng nhờ thì gọi finish.", { text: STR }, ["text"]),
  fn("ask_user", "Dừng lại hỏi người dùng: gặp màn đăng nhập mà chưa có tài khoản ({{user}} trống), cần OTP / captcha, hoặc yêu cầu không rõ. Người dùng có thể tự thao tác trên màn hình trực tiếp rồi bấm Tiếp tục.", { kind: { type: "string", enum: ["login", "otp", "question"] }, message: STR }, ["kind", "message"]),
  fn("plan", "Lập KẾ HOẠCH TEST ngay lượt đầu (chỉ 1 lần): 3–8 trường hợp quan trọng nhất theo yêu cầu, sắp theo ưu tiên, kèm số phút ước tính để chạy hết (thực tế, mỗi bước ~10 giây).", { cases: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "why"], properties: { name: { type: "string", description: "Tên ngắn (≤ 6 từ) — dùng ĐÚNG tên này làm \"case\" khi chạy." }, why: { type: "string", description: "Kiểm tra gì (≤ 15 từ)." } } } }, minutes: NUM }, ["cases", "minutes"]),
  fn("finish", "Kết thúc lượt này khi đã làm đủ việc người dùng nhờ (hoặc không thể tiếp tục). summary: 1–2 câu báo người dùng đã làm gì / thấy gì.", { reason: STR, summary: STR }, ["reason", "summary"]),
];
const INS = `Bạn là kỹ sư kiểm thử (QA) kiêm chuyên gia UI/UX, điều khiển một trình duyệt thật để kiểm thử web theo yêu cầu người dùng, đồng thời trò chuyện với họ (tiếng Việt, xưng "em", ngắn gọn).
Mỗi lượt bạn nhận TRẠNG THÁI HIỆN TẠI: ảnh màn hình + danh sách phần tử dạng [số] thẻ "tên" =giá trị @x,y rộngxcao + chữ trên trang. Các thao tác trước và kết quả nằm trong lịch sử. Gọi ĐÚNG 1 công cụ mỗi lượt.
CÁCH TEST:
- Lập trong đầu danh sách trường hợp test bao phủ yêu cầu: luồng chính, dữ liệu sai / trống / quá dài / ký tự đặc biệt, nút & liên kết chính, điều hướng, thông báo lỗi, trạng thái loading, thao tác lặp. Chạy lần lượt, đặt "case" là tên trường hợp.
- Tự tạo dữ liệu test hợp lý (tên, email dạng test.qa+<số>@example.com, SĐT 09xxxxxxxx, ngày, số…). Không dùng dữ liệu thật của người khác.
- Không thao tác phá huỷ dữ liệu thật (xoá, gửi tiền, gửi tin cho khách, thanh toán) trừ khi người dùng nói rõ; gặp nút như vậy thì dừng trước bước xác nhận cuối và ghi note.
- Màn đăng nhập: có tài khoản ({{user}}) thì điền {{user}} / {{pass}}; không có thì ask_user kind=login. OTP / captcha → ask_user.
- Sau mỗi thao tác, đối chiếu kết quả với mong đợi. Thấy lỗi, hành vi lạ, chậm (> 2 giây), bố cục khó dùng, nhiều bước, chữ / nhãn khó hiểu, thiếu phản hồi khi bấm, nút bị che → note ngay (ngắn, cụ thể, kèm vị trí).
- Dùng [số] của danh sách HIỆN TẠI (số đổi sau mỗi lượt). Phần tử ngoài màn hình → scroll. Không lặp lại thao tác đã thất bại quá 2 lần.
- Lượt đầu gọi plan (kế hoạch + số phút). Sau đó chạy theo kế hoạch, "case" = đúng tên trong kế hoạch. Theo dõi "còn ~N phút": sắp hết thì bỏ trường hợp ít quan trọng và finish.
- Tự quyết, KHÔNG hỏi người dùng trừ khi thật sự cần (đăng nhập thiếu tài khoản, OTP / captcha, yêu cầu mâu thuẫn).
- Đủ trường hợp hoặc hết đường đi → finish. Ngân sách bước có hạn: ưu tiên trường hợp quan trọng.
TRÒ CHUYỆN:
- Tin "NGƯỜI DÙNG NHẮN" là yêu cầu / câu hỏi mới: ưu tiên làm theo. Trả lời ngắn trong trường "say" của chính công cụ đang gọi (vd "Dạ, em thử thêm email có dấu cách ạ").
- Họ chỉ hỏi (không cần thao tác) → reply (khi gọi reply thì say = null); xong việc họ nhờ → finish với summary. Trả lời bằng chữ thường, xuống dòng / gạch đầu dòng "- " khi cần, **đậm** cho ý chính.
- Người dùng có thể đã tự thao tác trên màn hình (đăng nhập, mở trang khác): luôn dựa vào TRẠNG THÁI HIỆN TẠI.
"thought" ngắn, bắt đầu bằng động từ (vd "Điền email sai định dạng", "Kiểm tra thông báo lỗi").`;

function addUsage(model, u) {
  if (!u) return; const p = PRICE[model] || PRICE[MODEL] || [0, 0, 0], inp = u.input_tokens || 0, cached = u.input_tokens_details?.cached_tokens || 0, out = u.output_tokens || 0;
  const usd = ((inp - cached) * p[0] + cached * p[1] + out * p[2]) / 1e6, U = S.usage;
  U.in += inp; U.cached += cached; U.out += out; U.calls++; U.usd = +(U.usd + usd).toFixed(5);
  const m = (U.by ||= {})[model] ||= { in: 0, cached: 0, out: 0, calls: 0, usd: 0, role: model === RMODEL && model === SMART ? "Bước khó · Báo cáo" : model === RMODEL ? "Báo cáo" : model === SMART ? "Bước khó" : "Từng bước" };
  m.in += inp; m.cached += cached; m.out += out; m.calls++; m.usd = +(m.usd + usd).toFixed(5);
}
async function ai(body, ms = 120000) {
  if (!KEY) throw new Error("Máy chủ chưa cấu hình OpenAI key");
  for (let k = 0; ; k++) {
    let r;
    try { r = await fetch(OA + "/responses", { method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify({ store: false, ...body }), signal: AbortSignal.timeout(ms) }); }
    catch (e) { if (k < 2) { await sleep(2000 * (k + 1)); continue; } throw new Error("Không gọi được AI: " + (e?.message || e)); }
    if (r.ok) { const j = await r.json(); addUsage(body.model, j.usage); return j; }
    const t = (await r.text()).slice(0, 300);
    if ((r.status === 429 || r.status >= 500) && k < 3) { await sleep(3000 * (k + 1)); continue; }
    if (r.status === 404 && body.model !== MODEL) { body = { ...body, model: MODEL }; continue; }
    throw new Error(`AI ${r.status}: ${t}`);
  }
}

/* Lịch sử gửi AI: CHỈ NỐI THÊM (thao tác + kết quả, tin người dùng) → phần đầu giống hệt lượt trước nên OpenAI tính giá cache.
   Ảnh + danh sách phần tử chỉ nằm ở tin cuối (trạng thái hiện tại), không lưu vào lịch sử. */
const H = [];
let headCache = null;
function head() {
  if (headCache) return headCache;
  const content = [{ type: "input_text", text: `YÊU CẦU BAN ĐẦU: ${RUN.goal || "Kiểm thử tổng quát trang này: chức năng chính, UI/UX, lỗi, tốc độ."}\nTRANG GỐC: ${RUN.url}\nTÀI KHOẢN: ${SECRET.user ? "có — dùng {{user}} / {{pass}}" : "không có (gặp đăng nhập thì ask_user)"}` }];
  for (const img of RUN.images || []) { try { const b = fs.readFileSync(f(img)); content.push({ type: "input_text", text: "Ảnh người dùng gửi kèm yêu cầu:" }, { type: "input_image", image_url: `data:image/${/png$/i.test(img) ? "png" : "jpeg"};base64,${b.toString("base64")}`, detail: "auto" }); } catch { /* ảnh mất */ } }
  return (headCache = [{ role: "user", content }]);
}
/** Tiếp tục lượt cũ (--resume): tóm tắt nhật ký + trò chuyện thành 1 tin ở đầu lịch sử. */
function resumeBrief() {
  const L = S.log.filter((x) => x.kind !== "dialog").slice(-60).map((x) => `${x.n}. [${x.case || "-"}] ${x.label}${x.res ? " → " + x.res.slice(0, 160) : ""}${x.ok ? "" : " (LỖI)"}`).join("\n");
  const C = S.chat.filter((m) => m.who !== "sys").slice(-20).map((m) => `${m.who === "user" ? "Người dùng" : "Em"}: ${m.text.slice(0, 300)}`).join("\n");
  H.push({ role: "user", content: `(Phiên trước đã đóng trình duyệt; đây là tóm tắt để làm tiếp.)\nNHẬT KÝ ĐÃ LÀM:\n${L || "(chưa)"}\nPHÁT HIỆN: ${S.notes.map((n) => n.title).join("; ") || "(chưa)"}\nTRÒ CHUYỆN:\n${C || "(chưa)"}` });
}
let lastUrl = "", stuck = 0;
async function decide(snap, b64) {
  const said = pending.say.splice(0);
  for (const t of said) H.push({ role: "user", content: "NGƯỜI DÙNG NHẮN: " + t });
  const changed = snap.url !== lastUrl; lastUrl = snap.url;
  const left = Math.max(0, Math.round((S.roundAt + S.budgetMs - Date.now()) / 60000));
  const now = `TRẠNG THÁI HIỆN TẠI — bước ${S.step}/${S.max} · còn ~${left} phút${S.plan ? ` · kế hoạch: ${S.plan.cases.map((c) => `${c.name}${c.st === "done" ? " ✓" : ""}`).join("; ")}` : ""}
Trang: ${snap.title} — ${snap.url} (cuộn ${snap.scroll})
PHÁT HIỆN ĐÃ GHI: ${S.notes.slice(-25).map((n) => n.title).join("; ") || "(chưa)"}
PHẦN TỬ:
${snap.els.join("\n") || "(không có)"}
CHỮ TRÊN TRANG (rút gọn):
${snap.text}`;
  const content = [{ type: "input_text", text: now }];
  if (b64) content.push({ type: "input_image", image_url: "data:image/jpeg;base64," + b64, detail: changed || stuck ? "high" : "low" });
  const model = stuck >= 2 ? SMART : MODEL;
  const first = !S.plan && S.round === 1 && !RESUME;   // lượt đầu: bắt buộc lập kế hoạch
  const j = await ai({ model, instructions: INS, input: [...head(), ...H, { role: "user", content }], tools: TOOLS, tool_choice: first ? { type: "function", name: "plan" } : "required", parallel_tool_calls: false, reasoning: { effort: "low" }, max_output_tokens: 1500 });
  const c = (j.output || []).find((o) => o.type === "function_call");
  if (!c) return { name: "finish", args: { reason: "AI không chọn thao tác", summary: "", thought: "Kết thúc", case: "", say: null }, call: null };
  let args = {}; try { args = JSON.parse(c.arguments || "{}"); } catch { /* sai JSON */ }
  return { name: c.name, args, heard: said.length > 0, call: { type: "function_call", call_id: c.call_id, name: c.name, arguments: c.arguments || "{}" } };
}
/** Ghi thao tác + kết quả vào lịch sử AI; quá dài thì gộp phần cũ thành 1 tin tóm tắt (mất cache 1 lần). */
function remember(call, output) {
  if (call) H.push(call, { type: "function_call_output", call_id: call.call_id, output: String(output).slice(0, 1200) });
  if (H.length > 160) {
    const old = H.splice(0, 100), lines = [];
    for (const x of old) if (x.type === "function_call") lines.push(`${x.name} ${x.arguments.slice(0, 120)}`); else if (x.type === "function_call_output") lines[lines.length - 1] += " → " + x.output.slice(0, 140); else if (x.role === "user") lines.push(String(x.content).slice(0, 200));
    H.unshift({ role: "user", content: "TÓM TẮT CÁC BƯỚC TRƯỚC:\n" + lines.join("\n") });
  }
}

/** Đánh dấu kế hoạch: trường hợp đang chạy = doing, các trường hợp trước đó đang chạy = done. */
const fold = (t) => String(t || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function planTick(name, end = false) {
  if (!S.plan) return; const k = fold(name);
  const hit = k ? S.plan.cases.find((c) => fold(c.name) === k) || S.plan.cases.find((c) => fold(c.name).includes(k) || k.includes(fold(c.name))) : null;
  for (const c of S.plan.cases) if (c.st === "doing" && (end || c !== hit)) c.st = "done";
  if (hit && !end && hit.st !== "done") hit.st = "doing";
}

/* ---------- chờ người dùng ---------- */
async function waitUser(kind, message) {
  S.status = "waiting"; S.ask = { kind, message }; pending.go = false;
  phase("wait", kind === "login" ? "Chờ bạn đăng nhập" : kind === "otp" ? "Chờ bạn nhập mã" : "Chờ bạn trả lời");
  chat("agent", message, { kind: "ask", ask: kind });
  log({ kind: "ask", label: kind === "login" ? "Chờ đăng nhập" : kind === "otp" ? "Chờ nhập mã" : "Hỏi người dùng", res: message, case: S.case }); save(true);
  const ok = await until(() => pending.go || pending.stop, 15 * 60e3);
  S.ask = null; S.status = "running"; pending.go = false;
  if (!ok) throw new Error("Hết 15 phút chờ người dùng");
  phase("load", "Tiếp tục"); await settle(1500);
  if (kind === "login") await saveAuth();
  save(true);
}
async function paused() {
  S.status = "paused"; phase("pause", "Đã tạm dừng"); pending.go = false; save(true);
  await until(() => pending.go || pending.stop || !pending.pause, 30 * 60e3);
  pending.pause = false; pending.go = false; S.status = "running"; save(true);
}
async function saveAuth() { try { fs.mkdirSync(AUTH_DIR, { recursive: true }); await ctx.storageState({ path: authFile }); } catch { /* không lưu được phiên */ } }

/* ---------- báo cáo ---------- */
const RSCHEMA = { type: "object", additionalProperties: false, required: ["title", "feature", "mechanism", "verdict", "cases", "issues", "perf", "tech", "next"], properties: {
  title: STR, feature: { type: "string", description: "1–3 dòng: chức năng / màn hình này làm gì." },
  mechanism: { type: "array", items: STR, description: "Cơ chế hoạt động quan sát được: các bước, mỗi bước bắt đầu bằng động từ." },
  verdict: { type: "object", additionalProperties: false, required: ["score", "status", "summary"], properties: { score: NUM, status: { type: "string", enum: ["Đạt", "Cần cải thiện", "Lỗi nặng"] }, summary: STR } },
  cases: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "steps", "expected", "actual", "result"], properties: { name: STR, steps: STR, expected: STR, actual: STR, result: { type: "string", enum: ["pass", "fail", "warn", "skip"] } } } },
  issues: { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "severity", "title", "evidence", "fix"], properties: { type: { type: "string", enum: ["bug", "ux", "perf", "content", "a11y", "security"] }, severity: { type: "string", enum: ["cao", "trung bình", "thấp"] }, title: STR, evidence: STR, fix: STR } } },
  perf: { type: "object", additionalProperties: false, required: ["summary", "items"], properties: { summary: STR, items: { type: "array", items: STR } } },
  tech: { type: "array", items: { type: "object", additionalProperties: false, required: ["problem", "suggest"], properties: { problem: STR, suggest: STR } } },
  next: { type: "array", items: STR },
} };
const RINS = `Bạn là trưởng nhóm QA + UI/UX. Viết BÁO CÁO KIỂM THỬ tiếng Việt từ dữ liệu một lượt test tự động (yêu cầu + các tin người dùng nhắn thêm, nhật ký thao tác, phát hiện, số đo tốc độ, lỗi console / mạng, ảnh cuối).
Người đọc là chủ sản phẩm, không phải dev: câu NGẮN, bắt đầu bằng ĐỘNG TỪ ("Bấm Lưu → hiện thông báo…", "Gộp 3 bước thành 1"), không lời dẫn, không thuật ngữ thừa. Chỉ dựa trên dữ liệu có; không bịa.
- feature: 1–3 dòng chức năng là gì. mechanism: 3–8 bước cơ chế hoạt động quan sát được.
- cases: mỗi trường hợp đã chạy (theo "case" trong nhật ký): steps (chuỗi bước rút gọn, nối bằng →), expected, actual, result pass / fail / warn (chạy được nhưng có vấn đề) / skip (không chạy được, nêu lý do).
- issues: lỗi + điểm UX gây khó chịu (nhiều bước, bố cục khó tìm, thiếu phản hồi, chữ khó hiểu, nút bị che, không hợp lý trên màn nhỏ…) + chậm + lỗi console / HTTP đáng kể. severity: cao (chặn việc / sai dữ liệu), trung bình (khó chịu, tốn thời gian), thấp (thẩm mỹ). fix: cách sửa cụ thể.
- perf: tóm tắt tốc độ theo số đo (TTFB, DOM, load, LCP, CLS, request chậm, dung lượng); items: điểm cụ thể kèm số.
- tech: vấn đề kỹ thuật thấy được (tải chậm, gọi API lặp, ảnh nặng, chặn render, polling dày, chat / stream chậm…) → đề xuất công nghệ / cách làm thay thế (cache, phân trang, lazy load, SSE / WebSocket, CDN, nén ảnh, debounce…). Không có thì mảng rỗng.
- verdict: score 0–100 (chức năng 50% + UX 30% + tốc độ / ổn định 20%); status; summary 1–2 câu.
- next: các trường hợp nên test thêm (chưa chạy được / ngoài ngân sách).`;
async function report(final) {
  S.status = "reporting"; phase("report", "Đang viết báo cáo"); S.thought = "Viết báo cáo"; save(true);
  const M = S.metrics, uniq = (a, k) => [...new Map(a.map((x) => [k(x), x])).values()];
  const data = { yeu_cau: RUN.goal, nguoi_dung_nhan: S.chat.filter((m) => m.who === "user").map((m) => m.text), trang: RUN.url, ket_thuc: final, so_buoc: S.step,
    nhat_ky: S.log.map((x) => `${x.n}. [${x.case || "-"}] ${x.label} → ${x.res || ""}${x.ok ? "" : " (LỖI)"} (${(x.ms || 0) / 1000}s)`).join("\n"),
    phat_hien: S.notes, toc_do_trang: M.navs.slice(-15), request_cham: uniq(M.slow, (x) => x.url).sort((a, b) => b.ms - a.ms).slice(0, 15), tong_request: M.requests,
    loi_console: uniq(M.console, (x) => x.text).slice(0, 15), loi_js: uniq(M.pageerror, (x) => x.text).slice(0, 10), http_loi: uniq(M.http, (x) => x.status + x.url).slice(0, 15), request_hong: uniq(M.failed, (x) => x.url).slice(0, 10), hop_thoai: M.dialogs };
  const content = [{ type: "input_text", text: JSON.stringify(data) }];
  const last = [...S.log].reverse().find((x) => x.shot); if (last) { try { content.push({ type: "input_image", image_url: "data:image/jpeg;base64," + fs.readFileSync(f(last.shot)).toString("base64"), detail: "low" }); } catch { /* ảnh mất */ } }
  const j = await ai({ model: RMODEL, instructions: RINS, input: [{ role: "user", content }], reasoning: { effort: "medium" }, text: { format: { type: "json_schema", name: "bao_cao_kiem_thu", schema: RSCHEMA, strict: true } } }, 300000);
  const txt = (j.output || []).filter((o) => o.type === "message").flatMap((o) => o.content || []).map((c) => c.text || "").join("");
  const r = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
  r.verdict.score = Math.max(0, Math.min(100, Math.round(+r.verdict.score || 0)));
  fs.writeFileSync(f("report.json"), JSON.stringify(r));
  S.title = r.title || S.title; S.score = r.verdict.score; S.verdict = r.verdict.status; S.reported = S.log.length + S.notes.length;
  return r;
}

/* ---------- một lượt làm việc (lần đầu, hoặc sau mỗi tin nhắn) ---------- */
async function work() {
  const base = S.step + (S.round === 1 ? MAX_STEPS : FOLLOW), t0 = Date.now(); pending.bonus = 0;
  S.roundAt = t0; S.roundStep = S.step; S.budgetMs = S.round === 1 ? MAX_MS : Math.min(MAX_MS, 10 * 60e3); let fails = 0, summary = "", lastSig = "", same = 0, budget = base;
  S.status = "running"; save(true);
  while (true) {
    budget = Math.min(base + pending.bonus, base + 40); S.max = budget;   // mỗi tin nhắn giữa chừng được thêm 10 bước
    if (pending.stop) return { final: "Người dùng dừng", summary };
    if (S.step >= budget) return { final: `Dùng hết ${budget} bước`, summary };
    if (Date.now() - t0 > S.budgetMs) return { final: `Hết thời gian (${Math.round(S.budgetMs / 60000)} phút)`, summary };
    if (pending.pause) { await paused(); continue; }
    await remoteQ;
    phase("look", "Đọc màn hình");
    const snap = await snapshot(), sh = await shot(S.step + 1); S.url = snap.url; S.title = snap.title || S.title;
    phase("think", stuck >= 2 ? "Đang nghĩ kỹ hơn" : "Đang suy nghĩ");
    let d;
    try { d = await decide(snap, sh.b64); fails = 0; } catch (e) { if (++fails >= 3) return { final: "Lỗi AI: " + String(e.message || e).slice(0, 160), summary }; await sleep(3000); continue; }
    const { name, args, call } = d;
    if (args.say && d.heard && name !== "reply") chat("agent", args.say);   // chỉ đáp khi người dùng vừa nhắn — không kể từng bước
    S.thought = String(args.thought || "").slice(0, 120); S.case = String(args.case || S.case).slice(0, 80); planTick(S.case); save();
    if (name === "plan") {
      const cs = (Array.isArray(args.cases) ? args.cases : []).slice(0, 10).map((c) => ({ name: String(c.name || "").slice(0, 60), why: String(c.why || "").slice(0, 120), st: "todo" })).filter((c) => c.name);
      const mins = Math.max(1, Math.min(MINUTES || 20, Math.round(+args.minutes || 5)));
      S.plan = { cases: cs, minutes: mins }; if (!MINUTES) S.budgetMs = Math.min(20, Math.max(mins + 3, Math.ceil(mins * 1.5))) * 60e3;   // Tự động: giới hạn theo ước tính + 3 phút dự phòng
      chat("agent", `Em sẽ test ${cs.length} trường hợp, khoảng ${mins} phút.`, { kind: "plan" }); remember(call, "Đã lập kế hoạch — bắt đầu trường hợp đầu tiên."); continue;
    }
    if (name === "finish") { planTick("", true); summary = String(args.summary || "").slice(0, 600); remember(call, "ok"); log({ kind: "finish", label: "Kết thúc lượt", res: String(args.reason || "").slice(0, 200), case: S.case, shot: sh.name }); return { final: String(args.reason || "Hoàn tất").slice(0, 200), summary }; }
    if (name === "reply") { chat("agent", String(args.text || "").slice(0, 2000)); remember(call, "đã gửi"); continue; }
    if (name === "note") {
      const n = { type: args.type, severity: args.severity, title: String(args.title || "").slice(0, 160), detail: String(args.detail || "").slice(0, 400), step: S.step, shot: sh.name, url: snap.url };
      S.notes.push(n); chat("agent", n.title, { kind: "note", note: n.type, sev: n.severity, detail: n.detail, shot: sh.name });
      log({ kind: "note", label: `Ghi nhận: ${n.title.slice(0, 100)}`, res: n.detail.slice(0, 200), case: S.case, shot: sh.name, note: n.type, sev: n.severity });
      remember(call, "đã ghi"); if (S.notes.length > 80) return { final: "Quá nhiều phát hiện", summary }; continue;
    }
    if (name === "ask_user") {
      if (SECRET.user && args.kind === "login") { remember(call, "Có tài khoản: điền {{user}} / {{pass}}."); continue; }
      await waitUser(args.kind, String(args.message || "").slice(0, 300)); remember(call, "Người dùng đã xử lý / trả lời (xem tin nhắn mới nếu có) — kiểm tra lại màn hình."); continue;
    }
    S.step++;
    const sig = name + JSON.stringify({ ...args, thought: 0, case: 0, say: 0 }); same = sig === lastSig ? same + 1 : 0; lastSig = sig;
    try {
      const r = await act(name, args); log({ kind: name, label: r.label, res: r.res, ms: r.ms, case: S.case, shot: sh.name, thought: S.thought });
      remember(call, r.res); stuck = same >= 2 ? stuck + 1 : 0;
    } catch (e) {
      const msg = "Không làm được: " + String(e.message || e).split("\n")[0].slice(0, 160);
      log({ kind: name, label: (LABEL[name] || (() => name))(args, args.ref != null ? `[${args.ref}]` : ""), res: msg, ok: false, case: S.case, shot: sh.name, thought: S.thought });
      remember(call, msg); stuck++;
    }
  }
}

/* ---------- chạy ---------- */
async function main() {
  process.on("SIGTERM", () => { pending.stop = true; pending.go = true; });
  const pt = setInterval(pump, 250); pump();
  phase("open", RESUME ? "Mở lại trình duyệt" : "Mở trình duyệt"); save(true);
  browser = await launch();
  const st = RUN.use_auth !== false && fs.existsSync(authFile) ? authFile : undefined;
  ctx = await browser.newContext({ viewport: { width: VW, height: VH }, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh", storageState: st, ignoreHTTPSErrors: true, acceptDownloads: false });
  await ctx.addInitScript(INIT);
  S.zoom = zClamp(S.zoom ?? RUN.zoom ?? 0.75); await ctx.addInitScript(zoomJs(S.zoom));
  let first = true;
  ctx.on("page", (p) => { if (first || p === page) return; log({ kind: "info", label: "Mở tab mới", res: p.url() }); attachPage(p).catch(() => {}); });
  const p0 = await ctx.newPage(); first = false; await attachPage(p0); ticker();
  const url = RESUME && S.url ? S.url : RUN.url, t = Date.now();
  phase("load", "Đang mở " + url.replace(/^https?:\/\//, "").slice(0, 60));
  try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); await settle(4000); log({ kind: "goto", label: `Mở ${url.replace(/^https?:\/\//, "").slice(0, 70)}`, res: `Tải sau ${((Date.now() - t) / 1000).toFixed(1)} giây${st ? " (dùng phiên đăng nhập đã lưu)" : ""}.`, ms: Date.now() - t, case: RESUME ? "Mở lại" : "Mở trang" }); }
  catch (e) { log({ kind: "goto", label: "Mở trang", res: String(e.message || e).split("\n")[0], ok: false, case: "Mở trang" }); }
  if (RESUME) resumeBrief(); else chat("agent", RUN.goal ? "Dạ, em bắt đầu test theo yêu cầu. Anh/chị cứ nhắn thêm bất cứ lúc nào." : "Dạ, em bắt đầu test tổng quát trang này. Anh/chị cứ nhắn thêm bất cứ lúc nào.");
  for (;;) {
    const { final, summary } = await work();
    const fresh = S.reported !== S.log.length + S.notes.length;
    if (fresh && S.log.some((x) => x.kind !== "goto" && x.kind !== "info")) {
      try { const r = await report(final); if (summary) chat("agent", summary); chat("agent", `**${r.verdict.status} · ${r.verdict.score}/100**\n${r.verdict.summary}`, { kind: "done", score: r.verdict.score }); }
      catch (e) { S.error = "Không viết được báo cáo: " + String(e.message || e).slice(0, 200); chat("sys", S.error); }
    } else if (summary) chat("agent", summary);
    if (RUN.use_auth !== false) await saveAuth();
    if (pending.stop) break;
    // ở lại chờ người dùng nhắn tiếp (trình duyệt vẫn mở, vẫn tự thao tác được)
    S.status = "idle"; S.thought = ""; phase("idle", "Xong — nhắn để test tiếp hoặc hỏi kết quả"); pending.go = false; save(true);
    const got = await until(() => pending.say.length > 0 || pending.stop, IDLE_MS);
    if (!got || pending.stop) { if (!got) chat("sys", `Đã đóng trình duyệt sau ${Math.round(IDLE_MS / 60000)} phút không dùng — nhắn để mở lại và test tiếp`); break; }
    S.round++;
  }
  clearInterval(pt);
}
main().then(() => { S.status = "done"; }).catch((e) => { S.status = "error"; S.error = String(e?.message || e).split("\n")[0].slice(0, 300); chat("sys", "Lỗi: " + S.error); })
  .finally(async () => { clearInterval(tickTm); S.ended = Date.now(); S.thought = ""; S.ask = null; S.phase = null; S.cursor = null; save(true); try { await browser?.close(); } catch { /* đã đóng */ } process.exit(0); });
