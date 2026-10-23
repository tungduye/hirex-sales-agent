// HUẤN LUYỆN TỪ ĐIỂN GHI ÂM (full DB + âm thanh thật) — chạy tay, không tự chạy theo giờ.
//
// ▶ LỆNH CHO CLAUDE: khi người dùng chat "Huấn luyện ghi âm full db" (hoặc ý tương tự: "train ghi âm", "học lại full db cho ghi âm"),
//   Claude chạy trên máy chứa thư mục HireX (cwd = thư mục gốc HireX) rồi báo lại kết quả in ra:
//
//       node moduleHS/record/lexicon-train.mjs
//         → đọc lại toàn bộ dữ liệu HireX + học cách nghe nhầm từ âm thanh thật đã có (cuộc họp bật phụ đề, file họp đã gửi). MIỄN PHÍ.
//
//   Khi người dùng gửi thêm file ghi âm cuộc họp để học: đặt file vào runtime/hs-record/lexicon/audio/ rồi chạy
//       node moduleHS/record/lexicon-train.mjs --audio --seconds 150
//         → mỗi file cắt 10 phút / đoạn, phiên âm 2 lần: "nghe thô" (gpt-4o-mini-transcribe, không ngữ cảnh — giống bộ nghe trình duyệt)
//           và "chuẩn" (gpt-transcribe + ngữ cảnh HireX) → corpus/<file>.raw.txt + .ref.txt → căn 2 bản để học cách nghe nhầm thật.
//           TỐN PHÍ OpenAI (~$0,45 / giờ âm thanh, key HS). Làm dở thì chạy lại lệnh cho tới khi in "còn 0 đoạn".
//
//   Web (cổng 3000 / 3005) tự nạp file từ điển mới ngay, không cần khởi động lại.
//
// Cách chạy: dịch lexicon.ts + context.ts (TypeScript) sang JS vào thư mục tạm, thay các import của Next bằng bản thay thế nhỏ
// (Supabase bằng SUPABASE_SECRET_KEY, giải mã Tài liệu Human bằng EMAIL_TOKEN_ENCRYPTION_KEY), gọi train(), in thống kê, xoá thư mục tạm.
// Khoá chỉ đọc từ .env.local lúc chạy, không ghi ra đĩa.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const AUDIO = process.argv.includes("--audio"), SEC = +(process.argv[process.argv.indexOf("--seconds") + 1] || 0) || 150, T0 = Date.now();
import { spawnSync } from "node:child_process";
for (const l of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const ts = (await import(pathToFileURL(path.join(ROOT, "node_modules", "typescript", "lib", "typescript.js")).href)).default;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hs-lex-"));
const supa = pathToFileURL(path.join(ROOT, "node_modules", "@supabase", "supabase-js", "dist", "index.mjs")).href;

// bản thay thế cho các import của Next / src (chỉ phần lexicon + context cần)
fs.writeFileSync(path.join(tmp, "shim.mjs"), `
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
import { createClient } from ${JSON.stringify(supa)};
const E = process.env, ROOT = ${JSON.stringify(ROOT)};
export const createPrivilegedClient = () => createClient(E.NEXT_PUBLIC_SUPABASE_URL, E.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
export function decryptCredential(v) { const [ver, iv, tag, ct] = String(v).split(":"); if (ver !== "v1") throw new Error("bad"); const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(E.EMAIL_TOKEN_ENCRYPTION_KEY, "base64"), Buffer.from(iv, "base64")); d.setAuthTag(Buffer.from(tag, "base64")); return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8"); }
const DATA = path.resolve(E.HS_RECORD_DIR || path.join(ROOT, "runtime", "hs-record")), M = path.join(DATA, "m");
export const C = { data: DATA, key: "", text: "" };
export const rj = (f, fb) => { try { const x = JSON.parse(fs.readFileSync(f, "utf8")); return x && typeof x === "object" ? x : fb; } catch { return fb; } };
export const fp = (s, f) => path.join(M, s, f);
let META; export const st = () => { if (!META) { META = new Map(); try { for (const d of fs.readdirSync(M)) { const m = rj(path.join(M, d, "meta.json"), null); if (m) META.set(d, m); } } catch {} } return { meta: META }; };
const pad = (n) => String(n).padStart(2, "0");
export const fmtT = (t) => { const d = new Date(+t + 7 * 3600e3); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + " " + pad(d.getUTCDate()) + "/" + pad(d.getUTCMonth() + 1) + "/" + d.getUTCFullYear(); };
`);
const tr = (file, out, extra = "") => {
  let src = fs.readFileSync(path.join(ROOT, "moduleHS", "record", file), "utf8").replace(/^import "server-only";$/m, "");
  // gom mọi import (trừ node:*) về shim; import "./context" về bản đã dịch
  src = src.replace(/^import\s+(\{[^}]*\}|\w+)\s+from\s+"([^"]+)";$/gm, (all, what, from) => from.startsWith("node:") ? all : from === "./context" ? `import ${what} from "./context.mjs";` : `import ${what.replace(/\btype\s+\w+,?\s*/g, "")} from "./shim.mjs";`);
  fs.writeFileSync(path.join(tmp, out), extra + ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
};
/** Phiên âm 2 bản cho các file họp trong lexicon/audio (làm tiếp chỗ dở, dừng khi hết thời gian cho phép). */
async function transcribeAudio(ctxMod, ws) {
  const KEY = (process.env.HS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim(); if (!KEY) { console.log("Chưa có HS_OPENAI_API_KEY"); return; }
  const LD = path.join(path.resolve(process.env.HS_RECORD_DIR || path.join(ROOT, "runtime", "hs-record")), "lexicon"), AD = path.join(LD, "audio"), CD = path.join(LD, "corpus"), WK = path.join(LD, "work");
  fs.mkdirSync(CD, { recursive: true }); fs.mkdirSync(WK, { recursive: true });
  const files = fs.existsSync(AD) ? fs.readdirSync(AD).filter((f) => /\.(mp3|m4a|wav|webm|ogg|mp4)$/i.test(f)) : [];
  if (!files.length) { console.log("Không có file trong runtime/hs-record/lexicon/audio/"); return; }
  const prompt = ctxMod.sttPrompt(await ctxMod.meetContext(ws));
  const jobs = [];
  for (const f of files) {
    const base = f.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}._-]+/gu, "_"), wd = path.join(WK, base);
    if (fs.existsSync(path.join(CD, base + ".ref.txt")) && fs.existsSync(path.join(CD, base + ".raw.txt"))) continue;
    if (!fs.existsSync(wd)) { fs.mkdirSync(wd, { recursive: true }); spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", path.join(AD, f), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-f", "segment", "-segment_time", "600", path.join(wd, "p%03d.mp3")]); }
    for (const p of fs.readdirSync(wd).filter((x) => x.endsWith(".mp3")).sort()) for (const kind of ["raw", "ref"]) if (!fs.existsSync(path.join(wd, p + "." + kind + ".txt"))) jobs.push({ base, wd, p, kind });
  }
  const call = async ({ wd, p, kind }) => {
    const fd = new FormData(); fd.append("file", new Blob([fs.readFileSync(path.join(wd, p))], { type: "audio/mpeg" }), p);
    fd.append("model", kind === "raw" ? "gpt-4o-mini-transcribe" : (process.env.HS_RECORD_TRANSCRIBE_MODEL || "gpt-transcribe"));
    if (kind === "ref") fd.append("prompt", prompt);
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + KEY }, body: fd, signal: AbortSignal.timeout(170000) });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
    fs.writeFileSync(path.join(wd, p + "." + kind + ".txt"), String((await r.json()).text || "").replace(/\s+/g, " ").trim());
  };
  let done = 0, fail = 0; const q = jobs.slice();
  await Promise.all(Array.from({ length: 6 }, async () => { let j; while ((j = q.shift())) { if (Date.now() - T0 > SEC * 1000) { q.unshift(j); return; } try { await call(j); done++; } catch (e) { fail++; console.log("  lỗi", j.p, j.kind, e.message); } } }));
  // ghép các đoạn đã đủ thành corpus
  for (const base of new Set(jobs.map((j) => j.base))) {
    const wd = path.join(WK, base), parts = fs.readdirSync(wd).filter((x) => x.endsWith(".mp3")).sort();
    if (parts.every((p) => fs.existsSync(path.join(wd, p + ".raw.txt")) && fs.existsSync(path.join(wd, p + ".ref.txt"))))
      for (const kind of ["raw", "ref"]) fs.writeFileSync(path.join(CD, base + "." + kind + ".txt"), parts.map((p) => fs.readFileSync(path.join(wd, p + "." + kind + ".txt"), "utf8")).join("\n"));
  }
  console.log(`Phiên âm file họp: xong ${done} lượt${fail ? `, lỗi ${fail}` : ""} · còn ${q.length} đoạn${q.length ? " (chạy lại lệnh để làm tiếp)" : ""}`);
}
try {
  tr("context.ts", "context.mjs"); tr("lexicon.ts", "lexicon.mjs");
  const lex = await import(pathToFileURL(path.join(tmp, "lexicon.mjs")).href), ctxMod = await import(pathToFileURL(path.join(tmp, "context.mjs")).href);
  const { createPrivilegedClient } = await import(pathToFileURL(path.join(tmp, "shim.mjs")).href);
  const { data: wss } = await createPrivilegedClient().from("workspaces").select("id,name").order("created_at");
  for (const w of wss || []) {
    console.log(`\n=== Huấn luyện từ điển ghi âm · ${w.name || w.id}`);
    if (AUDIO) await transcribeAudio(ctxMod, w.id);
    const s = await lex.train(w.id);
    console.log(`Từ điển: ${s.entries} mục — ${s.kinds}`);
    console.log(`Mục mới so với lần trước: ${s.added}${s.added ? " — ví dụ: " + s.addedSample.slice(0, 15).join(", ") : ""}`);
    console.log(`Học từ âm thanh thật: ${s.audioPairs} bản ghi · ${s.audioHits} chỗ nghe nhầm · ${s.learnedTerms} thuật ngữ có cách nghe nhầm · ${(s.ms / 1000).toFixed(1)} giây`);
    if (s.learnedSample.length) console.log("  ví dụ: " + s.learnedSample.slice(0, 12).join(" · "));
    if (s.spoken) console.log(`Từ trong từ điển thực sự được nói trong các file họp: ${s.spoken} — ${s.spokenSample.join(", ")}`);
    const L = await lex.getLex(w.id);
    for (const x of ["anh dũng bảo bên brse lọc lại cv trên suối nguồn", "khách bên nhật cần comtor n2 ở hà nội, hạng 1, am 1 là chị phan ngọc"])
      console.log(`  "${x}"\n   → "${lex.fixText(x, L).text}"`);
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
