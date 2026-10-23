// Kiểm thử (Tiện ích › Kiểm thử phần mềm) — tiến trình agent chạy riêng cho mỗi lượt test:
//   node qa-worker.mjs <thư mục lượt test>
// Mở trình duyệt (Playwright, không giao diện) → AI (OpenAI) nhìn ảnh màn hình + danh sách phần tử → chọn 1 thao tác / lượt
// (bấm, điền, chọn, cuộn, mở link…) → ghi nhật ký, đo thời gian, lỗi console / mạng → hết việc thì AI viết báo cáo.
// Giao tiếp với web HireX bằng file trong thư mục lượt test (không cổng mạng riêng):
//   run.json (đầu vào) · state.json (trạng thái + nhật ký, ghi liên tục) · frame.jpg (hình trực tiếp, ~1 giây / lần) · step-NNN.jpg (ảnh từng bước)
//   cmd.jsonl (lệnh của người dùng: tiếp tục / trả lời / dừng / điều khiển chuột – bàn phím) · report.json (báo cáo)
// Tài khoản / mật khẩu người dùng nhập: nhận qua biến môi trường, AI chỉ thấy {{user}} / {{pass}}, không ghi ra đĩa.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const DIR = process.argv[2];
const RUN = JSON.parse(fs.readFileSync(path.join(DIR, "run.json"), "utf8"));
const KEY = (process.env.OPENAI_API_KEY || "").trim(), OA = process.env.HS_QA_OPENAI_URL || "https://api.openai.com/v1";
const MODEL = process.env.HS_QA_MODEL || "gpt-5.6-luna", RMODEL = process.env.HS_QA_REPORT_MODEL || "gpt-5.6-sol";
const SECRET = { user: process.env.HS_QA_USER || "", pass: process.env.HS_QA_PASS || "" };
const AUTH_DIR = process.env.HS_QA_AUTH_DIR || path.join(DIR, "..", "..", "auth");
const MAX_STEPS = Math.min(80, Math.max(5, +RUN.max_steps || 40)), MAX_MS = 20 * 60e3, VW = 1280, VH = 800;
const T0 = Date.now(), f = (n) => path.join(DIR, n), now = () => Date.now() - T0;

/* ---------- trạng thái (state.json) ---------- */
const S = { status: "starting", step: 0, max: MAX_STEPS, url: RUN.url, title: "", thought: "", case: "", ask: null, frame: 0, started: T0, ended: 0, error: "", log: [], notes: [],
  metrics: { console: [], pageerror: [], failed: [], http: [], slow: [], navs: [], requests: 0, dialogs: [] } };
let saveTm = 0;
function save(now_ = false) {
  const w = () => { saveTm = 0; const t = f("state.json.tmp"); try { fs.writeFileSync(t, JSON.stringify(S)); fs.renameSync(t, f("state.json")); } catch { /* đĩa bận: lần sau ghi */ } };
  if (now_) { clearTimeout(saveTm); w(); } else if (!saveTm) saveTm = setTimeout(w, 250);
}
const log = (e) => { const x = { n: S.log.length + 1, t: now(), ok: true, ...e }; S.log.push(x); save(); return x; };
const cap = (a, n = 60) => { if (a.length > n) a.splice(0, a.length - n); };

/* ---------- lệnh người dùng (cmd.jsonl) ---------- */
let cmdPos = 0;
function cmds() {
  let txt = ""; try { const b = fs.readFileSync(f("cmd.jsonl")); if (b.length <= cmdPos) return []; txt = b.subarray(cmdPos).toString("utf8"); cmdPos = b.length; } catch { return []; }
  return txt.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const pending = { say: [], stop: false, pause: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- trình duyệt ---------- */
let browser, ctx, page;
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
/** Hình trực tiếp: chụp màn hình ~1 lần / giây (và ngay sau mỗi thao tác) → frame.jpg; web hiển thị như một tab trình duyệt. */
let frameBusy = false, frameTm = 0;
async function frame() {
  if (frameBusy || !page || page.isClosed()) return; frameBusy = true;
  try { const b = await page.screenshot({ type: "jpeg", quality: 60, timeout: 5000 }); fs.writeFileSync(f("frame.tmp"), b); fs.renameSync(f("frame.tmp"), f("frame.jpg")); S.frame++; save(); } catch { /* trang đang chuyển */ }
  finally { frameBusy = false; }
}
function frames() { clearInterval(frameTm); frameTm = setInterval(() => { frame().catch(() => {}); }, 1000); }
function watch(p) {
  const M = S.metrics, starts = new Map();
  p.on("console", (m) => { if (m.type() === "error") { M.console.push({ t: now(), text: m.text().slice(0, 300) }); cap(M.console); } });
  p.on("pageerror", (e) => { M.pageerror.push({ t: now(), text: String(e.message || e).slice(0, 300) }); cap(M.pageerror); });
  p.on("request", (r) => { M.requests++; starts.set(r, Date.now()); });
  p.on("requestfailed", (r) => { const u = r.url(); if (/^data:|^blob:/.test(u)) return; M.failed.push({ t: now(), url: u.slice(0, 200), err: (r.failure()?.errorText || "").slice(0, 80), type: r.resourceType() }); cap(M.failed); });
  p.on("requestfinished", (r) => { const t0 = starts.get(r); starts.delete(r); if (!t0) return; const ms = Date.now() - t0; if (ms > 1500 && !/^data:/.test(r.url())) { M.slow.push({ t: now(), url: r.url().slice(0, 200), ms, type: r.resourceType(), method: r.method() }); cap(M.slow, 80); } });
  p.on("response", (r) => { const s = r.status(); if (s >= 400) { M.http.push({ t: now(), url: r.url().slice(0, 200), status: s, method: r.request().method() }); cap(M.http); } });
  p.on("dialog", async (d) => { M.dialogs.push({ t: now(), type: d.type(), text: d.message().slice(0, 200) }); log({ kind: "dialog", label: `Hộp thoại ${d.type()}: “${d.message().slice(0, 80)}”` }); try { await d.accept(); } catch { /* đã đóng */ } });
  p.on("load", () => navPerf(p).catch(() => {}));
}
async function navPerf(p) {
  await sleep(1200);
  const x = await p.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return n ? { url: location.href, ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), lcp: window.__qa?.lcp || 0, cls: +(window.__qa?.cls || 0).toFixed(3), size_kb: Math.round((n.transferSize || 0) / 1024) } : null; }).catch(() => null);
  if (x) { S.metrics.navs.push({ t: now(), ...x }); cap(S.metrics.navs, 40); save(); }
}
async function attachPage(p) { page = p; watch(p); }
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
    if (id >= 150) break;
    const r = e.getBoundingClientRect(); if (r.width < 3 || r.height < 3 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const s = getComputedStyle(e); if (s.visibility === "hidden" || s.display === "none" || +s.opacity < 0.05) continue;
    const cx = Math.min(innerWidth - 1, Math.max(0, r.x + r.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, r.y + r.height / 2)), top = document.elementFromPoint(cx, cy);
    const covered = top && top !== e && !e.contains(top) && !top.contains(e);
    id++; e.setAttribute("data-qa", String(id));
    const tag = e.tagName.toLowerCase(), type = tag === "input" ? (e.type || "text") : "", role = e.getAttribute("role") || "";
    const clean = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 70);
    const name = clean(e.getAttribute("aria-label") || lab(e) || (tag === "input" || tag === "textarea" ? e.placeholder || e.name : e.innerText) || e.title || e.getAttribute("alt") || e.querySelector?.("img")?.alt || (e.querySelector?.("svg") ? "(icon)" : ""));
    let extra = "";
    if (tag === "input" || tag === "textarea") extra += type === "password" ? (e.value ? " =••••" : " =trống") : e.type === "checkbox" || e.type === "radio" ? (e.checked ? " [x]" : " [ ]") : ` =“${clean(e.value).slice(0, 40)}”`;
    if (tag === "select") extra += ` =“${clean(e.options[e.selectedIndex]?.text)}” [${[...e.options].slice(0, 8).map((o) => clean(o.text)).join(" | ")}]`;
    if (e.disabled || e.getAttribute("aria-disabled") === "true") extra += " (khoá)";
    if (e.getAttribute("aria-expanded")) extra += ` (mở=${e.getAttribute("aria-expanded")})`;
    if (covered) extra += " (bị che)";
    out.push(`[${id}] ${tag}${type ? ":" + type : ""}${role ? " role=" + role : ""} "${name}"${extra} @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const text = (document.body?.innerText || "").replace(/\n{2,}/g, "\n").slice(0, 2500);
  return { url: location.href, title: document.title, els: out, text, scroll: `${Math.round(scrollY)}/${Math.max(0, document.documentElement.scrollHeight - innerHeight)}` };
};
async function snapshot() {
  for (let i = 0; i < 2; i++) { try { return await page.evaluate(SNAP); } catch { await sleep(600); } }
  return { url: page.url(), title: "", els: [], text: "", scroll: "0/0" };
}
async function shot(n) {
  const name = `step-${String(n).padStart(3, "0")}.jpg`;
  try { const b = await page.screenshot({ type: "jpeg", quality: 55, timeout: 10000 }); fs.writeFileSync(f(name), b); fs.writeFileSync(f("frame.tmp"), b); fs.renameSync(f("frame.tmp"), f("frame.jpg")); S.frame++; return { name, b64: b.toString("base64") }; } catch { return { name: "", b64: "" }; }
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
async function act(name, a) {
  const before = await probe(), t0 = Date.now(), e0 = errsNow(), u0 = page.url(); let label = "", res = "";
  const ref = a.ref != null ? `[${a.ref}]` : "";
  switch (name) {
    case "click": { label = `Bấm ${a.name ? "“" + a.name + "”" : ref}`; const l = el(a.ref); try { await l.click({ timeout: 6000 }); } catch (e) { const b = await l.boundingBox().catch(() => null); if (!b) throw e; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); res = "bấm theo toạ độ (phần tử bị che / không bấm thẳng được). "; } break; }
    case "fill": { label = `Điền ${a.name ? "“" + a.name + "”" : ref}: ${hide(a.text)}`; const l = el(a.ref); try { await l.fill(sub(a.text), { timeout: 6000 }); } catch { await l.click({ timeout: 4000 }); await page.keyboard.press("Control+A"); await page.keyboard.type(sub(a.text), { delay: 15 }); } if (a.enter) await page.keyboard.press("Enter"); break; }
    case "select": { label = `Chọn ${a.name ? "“" + a.name + "”" : ref} = ${a.text}`; await el(a.ref).selectOption({ label: String(a.text) }, { timeout: 6000 }).catch(() => el(a.ref).selectOption(String(a.text), { timeout: 4000 })); break; }
    case "press": { label = `Nhấn phím ${a.key}`; await page.keyboard.press(String(a.key || "Enter")); break; }
    case "hover": { label = `Rê chuột ${a.name ? "“" + a.name + "”" : ref}`; await el(a.ref).hover({ timeout: 5000 }); break; }
    case "scroll": { label = `Cuộn ${a.direction === "up" ? "lên" : "xuống"}`; await page.mouse.move(VW / 2, VH / 2); await page.mouse.wheel(0, a.direction === "up" ? -650 : 650); break; }
    case "goto": { const u = new URL(String(a.url), page.url()).href; if (!/^https?:/i.test(u)) throw new Error("Chỉ mở link http / https"); label = `Mở ${u.replace(/^https?:\/\//, "").slice(0, 70)}`; await page.goto(u, { waitUntil: "domcontentloaded", timeout: 30000 }); break; }
    case "back": { label = "Quay lại trang trước"; await page.goBack({ timeout: 15000 }).catch(() => {}); break; }
    case "wait": { const ms = Math.min(10000, Math.max(300, +a.ms || 1500)); label = `Chờ ${(ms / 1000).toFixed(1)} giây`; await sleep(ms); break; }
    default: throw new Error("Thao tác không hỗ trợ: " + name);
  }
  await settle();
  const ms = Date.now() - t0, e1 = errsNow(), after = await probe(), had = new Set(before.lines), added = [...new Set(after.lines.filter((l) => !had.has(l)))].slice(0, 5);
  if (added.length) res += `Hiện thêm: “${added.map((x) => x.slice(0, 90)).join("” · “")}”. `;
  if (after.inv.length) res += `Ô chưa hợp lệ (trình duyệt báo): ${after.inv.join("; ")}. `;
  if (!added.length && !after.inv.length && page.url() === u0 && !["wait", "scroll", "hover", "fill", "select"].includes(name)) res += "Không thấy thay đổi chữ trên trang. ";
  res += `${page.url() !== u0 ? "Chuyển sang " + page.url() + ". " : ""}${e1 > e0 ? `+${e1 - e0} lỗi mới (console / mạng). ` : ""}Xong sau ${(ms / 1000).toFixed(1)} giây.`;
  return { label, res, ms, err: e1 - e0 };
}

/* ---------- AI ---------- */
const STR = { type: "string" }, NUM = { type: "number" };
const fn = (name, description, props, req = []) => ({ type: "function", name, description, strict: true, parameters: { type: "object", additionalProperties: false, required: ["thought", "case", ...req, ...Object.keys(props).filter((k) => !req.includes(k))], properties: { thought: { type: "string", description: "Ngắn (≤ 15 từ), động từ đầu: đang làm gì / kiểm tra gì." }, case: { type: "string", description: "Tên trường hợp test đang chạy (ngắn), giữ nguyên tên khi các bước cùng một trường hợp." }, ...props } } });
const NULLS = (t) => ({ type: [t, "null"] });
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
  fn("ask_user", "Dừng lại hỏi người dùng: gặp màn đăng nhập mà chưa có tài khoản ({{user}} trống), cần OTP / captcha, hoặc yêu cầu không rõ. Người dùng có thể tự thao tác trên màn hình trực tiếp rồi bấm Tiếp tục.", { kind: { type: "string", enum: ["login", "otp", "question"] }, message: STR }, ["kind", "message"]),
  fn("finish", "Kết thúc khi đã kiểm thử đủ yêu cầu (hoặc không thể tiếp tục).", { reason: STR }, ["reason"]),
];
const INS = `Bạn là kỹ sư kiểm thử (QA) kiêm chuyên gia UI/UX, điều khiển một trình duyệt thật để kiểm thử web theo yêu cầu của người dùng (tiếng Việt).
Mỗi lượt bạn nhận: yêu cầu, nhật ký các bước đã làm, ảnh màn hình hiện tại và danh sách phần tử tương tác dạng [số] thẻ "tên" =giá trị @x,y rộngxcao. Gọi ĐÚNG 1 công cụ mỗi lượt.
CÁCH TEST:
- Lập trong đầu danh sách trường hợp test bao phủ yêu cầu: luồng chính (happy path), dữ liệu sai / trống / quá dài / ký tự đặc biệt, nút & liên kết chính, điều hướng, thông báo lỗi, trạng thái loading, thao tác lặp. Chạy lần lượt, đặt "case" là tên trường hợp.
- Tự tạo dữ liệu test hợp lý (tên, email dạng test.qa+<số>@example.com, SĐT 09xxxxxxxx, ngày, số…). Không dùng dữ liệu thật của người khác.
- Không thao tác phá huỷ dữ liệu thật (xoá, gửi tiền, gửi tin cho khách, thanh toán) trừ khi yêu cầu nói rõ; gặp nút như vậy thì dừng trước bước xác nhận cuối và ghi note.
- Màn đăng nhập: nếu có tài khoản (được báo có {{user}}) thì điền {{user}} / {{pass}}; nếu không thì gọi ask_user kind=login. OTP / captcha → ask_user.
- Sau mỗi thao tác, đối chiếu kết quả với mong đợi. Thấy lỗi, hành vi lạ, chậm (> 2 giây), bố cục khó dùng, phải bấm nhiều bước, chữ / nhãn khó hiểu, thiếu phản hồi khi bấm, nút bị che → gọi note ngay (ngắn, cụ thể, kèm vị trí).
- Dùng [số] trong danh sách hiện tại; số thay đổi sau mỗi lượt. Phần tử ngoài màn hình → scroll. Không lặp lại một thao tác đã thất bại quá 2 lần.
- Đủ trường hợp hoặc hết đường đi → finish. Ngân sách bước có hạn: ưu tiên trường hợp quan trọng.
"thought" ngắn, bắt đầu bằng động từ (vd "Điền email sai định dạng", "Kiểm tra thông báo lỗi").`;
async function ai(body, ms = 120000) {
  if (!KEY) throw new Error("Máy chủ chưa cấu hình OPENAI_API_KEY");
  for (let k = 0; ; k++) {
    let r;
    try { r = await fetch(OA + "/responses", { method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); }
    catch (e) { if (k < 2) { await sleep(2000 * (k + 1)); continue; } throw new Error("Không gọi được AI: " + (e?.message || e)); }
    if (r.ok) return r.json();
    const t = (await r.text()).slice(0, 300);
    if ((r.status === 429 || r.status >= 500) && k < 3) { await sleep(3000 * (k + 1)); continue; }
    if (r.status === 404 && body.model !== MODEL) { body = { ...body, model: MODEL }; continue; }
    throw new Error(`AI ${r.status}: ${t}`);
  }
}
const histText = () => S.log.filter((x) => x.kind !== "dialog").slice(-40).map((x) => `${x.n}. ${x.case ? `[${x.case}] ` : ""}${x.label}${x.res ? " → " + x.res : ""}${x.ok ? "" : " (LỖI)"}`).join("\n") || "(chưa có)";
async function decide(snap, b64) {
  const say = pending.say.splice(0);
  if (say.length) S.extra = [...(S.extra || []), ...say];
  const text = `YÊU CẦU: ${RUN.goal || "Kiểm thử tổng quát trang này: chức năng chính, UI/UX, lỗi, tốc độ."}${(S.extra || []).length ? "\nNGƯỜI DÙNG BỔ SUNG: " + S.extra.join(" | ") : ""}
TRANG GỐC: ${RUN.url}
TÀI KHOẢN: ${SECRET.user ? "có — dùng {{user}} / {{pass}}" : "không có (gặp đăng nhập thì ask_user)"}
BƯỚC: ${S.step}/${MAX_STEPS}
NHẬT KÝ:
${histText()}
PHÁT HIỆN ĐÃ GHI: ${S.notes.map((n) => n.title).join("; ") || "(chưa)"}
TRANG HIỆN TẠI: ${snap.title} — ${snap.url} (cuộn ${snap.scroll})
PHẦN TỬ:
${snap.els.join("\n") || "(không có)"}
CHỮ TRÊN TRANG (rút gọn):
${snap.text.slice(0, 1800)}`;
  const content = [{ type: "input_text", text }];
  if (S.step <= 1) for (const img of RUN.images || []) { try { const b = fs.readFileSync(f(img)); content.push({ type: "input_text", text: "Ảnh người dùng gửi kèm yêu cầu:" }, { type: "input_image", image_url: `data:image/${/png$/i.test(img) ? "png" : "jpeg"};base64,${b.toString("base64")}` }); } catch { /* ảnh mất */ } }
  if (b64) content.push({ type: "input_image", image_url: "data:image/jpeg;base64," + b64 });
  const j = await ai({ model: MODEL, instructions: INS, input: [{ role: "user", content }], tools: TOOLS, tool_choice: "required", parallel_tool_calls: false, reasoning: { effort: "low" }, max_output_tokens: 1500 });
  const c = (j.output || []).find((o) => o.type === "function_call");
  if (!c) return { name: "finish", args: { reason: "AI không chọn thao tác", thought: "Kết thúc", case: "" } };
  let args = {}; try { args = JSON.parse(c.arguments || "{}"); } catch { /* sai JSON */ }
  return { name: c.name, args };
}

/* ---------- chờ người dùng (đăng nhập / OTP / câu hỏi / tạm dừng) ---------- */
async function remote(c) {
  try {
    if (c.type === "click") { const x = Math.max(0, Math.min(VW, +c.x * VW)), y = Math.max(0, Math.min(VH, +c.y * VH)); await page.mouse.click(x, y); }
    else if (c.type === "type") await page.keyboard.type(String(c.text || "").slice(0, 500), { delay: 10 });
    else if (c.type === "key") await page.keyboard.press(String(c.key || "Enter"));
    else if (c.type === "scroll") await page.mouse.wheel(0, Math.max(-2000, Math.min(2000, +c.dy || 0)));
    else if (c.type === "goto") { const u = new URL(String(c.url), page.url()).href; if (/^https?:/i.test(u)) await page.goto(u, { waitUntil: "domcontentloaded", timeout: 30000 }); }
  } catch { /* thao tác tay lỗi: bỏ qua */ }
}
function pump() {   // đọc lệnh mới; trả về lệnh điều khiển chuột / phím để chạy
  const out = [];
  for (const c of cmds()) {
    if (c.type === "stop") pending.stop = true;
    else if (c.type === "pause") pending.pause = true;
    else if (c.type === "say" && c.text) pending.say.push(String(c.text).slice(0, 1000));
    else if (c.type === "continue" || c.type === "answer") { pending.go = true; if (c.text) pending.say.push(String(c.text).slice(0, 1000)); }
    else out.push(c);
  }
  return out;
}
async function waitUser(kind, message) {
  S.status = "waiting"; S.ask = { kind, message }; pending.go = false; log({ kind: "ask", label: kind === "login" ? "Chờ đăng nhập" : kind === "otp" ? "Chờ nhập mã" : kind === "pause" ? "Tạm dừng" : "Hỏi người dùng", res: message, case: S.case }); save(true);
  const deadline = Date.now() + 15 * 60e3;
  while (!pending.go && !pending.stop && Date.now() < deadline) { const cs = pump(); for (const c of cs) await remote(c); if (cs.length) { await sleep(150); await frame(); } await sleep(200); }
  S.ask = null; S.status = "running"; pending.pause = false;
  if (!pending.go && !pending.stop) throw new Error("Hết 15 phút chờ người dùng");
  pending.go = false; await settle(1500);
  if (kind === "login") await saveAuth();
  save(true);
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
const RINS = `Bạn là trưởng nhóm QA + UI/UX. Viết BÁO CÁO KIỂM THỬ tiếng Việt từ dữ liệu một lượt test tự động (nhật ký thao tác, phát hiện, số đo tốc độ, lỗi console / mạng, ảnh cuối).
Người đọc là chủ sản phẩm, không phải dev: câu NGẮN, bắt đầu bằng ĐỘNG TỪ ("Bấm Lưu → hiện thông báo…", "Gộp 3 bước thành 1"), không lời dẫn, không thuật ngữ thừa. Chỉ dựa trên dữ liệu có; không bịa.
- feature: 1–3 dòng chức năng là gì. mechanism: 3–8 bước cơ chế hoạt động quan sát được.
- cases: mỗi trường hợp đã chạy (theo "case" trong nhật ký): steps (chuỗi bước rút gọn, nối bằng →), expected, actual, result pass / fail / warn (chạy được nhưng có vấn đề) / skip (không chạy được, nêu lý do).
- issues: lỗi + điểm UX gây khó chịu (nhiều bước, bố cục khó tìm, thiếu phản hồi, chữ khó hiểu, nút bị che, không hợp lý trên màn nhỏ…) + chậm + lỗi console / HTTP đáng kể. severity: cao (chặn việc / sai dữ liệu), trung bình (khó chịu, tốn thời gian), thấp (thẩm mỹ). fix: cách sửa cụ thể.
- perf: tóm tắt tốc độ theo số đo (TTFB, DOM, load, LCP, CLS, request chậm, dung lượng); items: điểm cụ thể kèm số.
- tech: vấn đề kỹ thuật thấy được (tải chậm, gọi API lặp, ảnh nặng, chặn render, polling dày, chat / stream chậm…) → đề xuất công nghệ / cách làm thay thế (cache, phân trang, lazy load, SSE / WebSocket, CDN, nén ảnh, debounce…). Không có thì mảng rỗng.
- verdict: score 0–100 (chức năng 50% + UX 30% + tốc độ / ổn định 20%); status; summary 1–2 câu.
- next: các trường hợp nên test thêm (chưa chạy được / ngoài ngân sách).`;
async function report(final) {
  S.status = "reporting"; S.thought = "Viết báo cáo"; save(true);
  const M = S.metrics, uniq = (a, k) => [...new Map(a.map((x) => [k(x), x])).values()];
  const data = { yeu_cau: RUN.goal, bo_sung: S.extra || [], trang: RUN.url, ket_thuc: final, so_buoc: S.step,
    nhat_ky: S.log.map((x) => `${x.n}. [${x.case || "-"}] ${x.label} → ${x.res || ""}${x.ok ? "" : " (LỖI)"} (${(x.ms || 0) / 1000}s)`).join("\n"),
    phat_hien: S.notes, toc_do_trang: M.navs.slice(-15), request_cham: uniq(M.slow, (x) => x.url).sort((a, b) => b.ms - a.ms).slice(0, 15), tong_request: M.requests,
    loi_console: uniq(M.console, (x) => x.text).slice(0, 15), loi_js: uniq(M.pageerror, (x) => x.text).slice(0, 10), http_loi: uniq(M.http, (x) => x.status + x.url).slice(0, 15), request_hong: uniq(M.failed, (x) => x.url).slice(0, 10), hop_thoai: M.dialogs };
  const content = [{ type: "input_text", text: JSON.stringify(data) }];
  const last = [...S.log].reverse().find((x) => x.shot); if (last) { try { content.push({ type: "input_image", image_url: "data:image/jpeg;base64," + fs.readFileSync(f(last.shot)).toString("base64") }); } catch { /* ảnh mất */ } }
  const j = await ai({ model: RMODEL, instructions: RINS, input: [{ role: "user", content }], reasoning: { effort: "medium" }, text: { format: { type: "json_schema", name: "bao_cao_kiem_thu", schema: RSCHEMA, strict: true } } }, 300000);
  const txt = (j.output || []).filter((o) => o.type === "message").flatMap((o) => o.content || []).map((c) => c.text || "").join("");
  const r = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
  r.verdict.score = Math.max(0, Math.min(100, Math.round(+r.verdict.score || 0)));
  fs.writeFileSync(f("report.json"), JSON.stringify(r));
  S.title = r.title || S.title; S.score = r.verdict.score; S.verdict = r.verdict.status;
}

/* ---------- chạy ---------- */
async function main() {
  process.on("SIGTERM", () => { pending.stop = true; });
  save(true);
  browser = await launch();
  const st = RUN.use_auth !== false && fs.existsSync(authFile) ? authFile : undefined;
  ctx = await browser.newContext({ viewport: { width: VW, height: VH }, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh", storageState: st, ignoreHTTPSErrors: true, acceptDownloads: false });
  await ctx.addInitScript(INIT);
  let first = true;
  ctx.on("page", (p) => { if (first || p === page) return; log({ kind: "info", label: "Mở tab mới", res: p.url() }); attachPage(p).catch(() => {}); });
  const p0 = await ctx.newPage(); first = false; await attachPage(p0);
  S.status = "running"; S.thought = "Mở trang"; save(true); frames();
  const t = Date.now();
  try { await page.goto(RUN.url, { waitUntil: "domcontentloaded", timeout: 45000 }); await settle(4000); log({ kind: "goto", label: `Mở ${RUN.url.replace(/^https?:\/\//, "").slice(0, 70)}`, res: `Tải sau ${((Date.now() - t) / 1000).toFixed(1)} giây${st ? " (dùng phiên đăng nhập đã lưu)" : ""}.`, ms: Date.now() - t, case: "Mở trang" }); }
  catch (e) { log({ kind: "goto", label: "Mở trang", res: String(e.message || e).split("\n")[0], ok: false, case: "Mở trang" }); }
  let final = "Hoàn tất", fails = 0;
  while (S.step < MAX_STEPS) {
    for (const c of pump()) await remote(c);
    if (pending.stop) { final = "Người dùng dừng"; break; }
    if (Date.now() - T0 > MAX_MS) { final = "Hết thời gian (20 phút)"; break; }
    if (pending.pause) await waitUser("pause", "Đã tạm dừng — có thể tự thao tác trên màn hình, gõ yêu cầu thêm, rồi bấm Tiếp tục.");
    S.step++;
    const snap = await snapshot(), sh = await shot(S.step); S.url = snap.url; S.title = snap.title || S.title; save();
    let d;
    try { d = await decide(snap, sh.b64); fails = 0; } catch (e) { if (++fails >= 3) { final = "Lỗi AI: " + String(e.message || e).slice(0, 160); break; } S.step--; await sleep(3000); continue; }
    const { name, args } = d; S.thought = String(args.thought || "").slice(0, 120); S.case = String(args.case || S.case).slice(0, 80); save();
    if (name === "finish") { final = String(args.reason || "Hoàn tất").slice(0, 200); log({ kind: "finish", label: "Kết thúc kiểm thử", res: final, case: S.case, shot: sh.name }); break; }
    if (name === "note") { S.notes.push({ type: args.type, severity: args.severity, title: String(args.title || "").slice(0, 160), detail: String(args.detail || "").slice(0, 400), step: S.step, shot: sh.name, url: snap.url }); log({ kind: "note", label: `Ghi nhận: ${String(args.title || "").slice(0, 100)}`, res: String(args.detail || "").slice(0, 200), case: S.case, shot: sh.name, note: args.type, sev: args.severity }); S.step--; if (S.notes.length > 60) break; continue; }
    if (name === "ask_user") { if (SECRET.user && args.kind === "login") { pending.say.push("Có tài khoản: điền {{user}} / {{pass}}."); continue; } await waitUser(args.kind, String(args.message || "").slice(0, 300)); continue; }
    try { const r = await act(name, args); log({ kind: name, label: r.label, res: r.res, ms: r.ms, case: S.case, shot: sh.name, thought: S.thought }); }
    catch (e) { log({ kind: name, label: `${name} ${args.ref != null ? "[" + args.ref + "]" : ""}`.trim(), res: "Không làm được: " + String(e.message || e).split("\n")[0].slice(0, 160), ok: false, case: S.case, shot: sh.name, thought: S.thought }); }
  }
  if (S.step >= MAX_STEPS && final === "Hoàn tất") final = `Dùng hết ${MAX_STEPS} bước`;
  await shot(S.step + 1).then((x) => { if (x.name) log({ kind: "info", label: "Màn hình cuối", shot: x.name, case: "" }); });
  if (RUN.use_auth !== false) await saveAuth();
  try { await report(final); S.status = "done"; } catch (e) { S.status = "done"; S.error = "Không viết được báo cáo: " + String(e.message || e).slice(0, 200); }
}
main().catch((e) => { S.status = "error"; S.error = String(e?.message || e).split("\n")[0].slice(0, 300); })
  .finally(async () => { clearInterval(frameTm); S.ended = Date.now(); S.thought = ""; S.ask = null; save(true); try { await browser?.close(); } catch { /* đã đóng */ } process.exit(0); });
