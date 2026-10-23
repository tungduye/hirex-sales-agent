// HUẤN LUYỆN TỪ ĐIỂN GHI ÂM (full DB) — chạy tay, không tự chạy theo giờ.
//
// ▶ LỆNH CHO CLAUDE: khi người dùng chat "Huấn luyện ghi âm full db" (hoặc ý tương tự: "train ghi âm", "học lại full db cho ghi âm"),
//   Claude chạy lệnh dưới đây trên máy chứa thư mục HireX (shell của máy, cwd = thư mục gốc HireX), rồi báo lại kết quả in ra
//   (số mục, mục mới, số từ AI vừa học cách đọc, token đã dùng, ví dụ câu đã sửa):
//
//       node moduleHS/record/lexicon-train.mjs            (đọc lại toàn bộ dữ liệu + AI học cách đọc cho từ mới — tốn ít token)
//       node moduleHS/record/lexicon-train.mjs --no-ai    (chỉ đọc lại dữ liệu, miễn phí)
//       node moduleHS/record/lexicon-train.mjs --seconds 140   (giới hạn thời gian học AI; còn từ chưa học thì chạy lại lệnh cho tới khi "còn 0")
//
//   Web (cổng 3000 / 3005) tự nạp file từ điển mới ngay, không cần khởi động lại.
//
// Cách chạy: dịch lexicon.ts + context.ts (TypeScript) sang JS vào thư mục tạm, thay các import của Next bằng bản thay thế nhỏ
// (Supabase bằng SUPABASE_SECRET_KEY, giải mã Tài liệu Human bằng EMAIL_TOKEN_ENCRYPTION_KEY, OpenAI bằng HS_OPENAI_API_KEY),
// gọi train(), in thống kê, xoá thư mục tạm. Khoá chỉ đọc từ .env.local lúc chạy, không ghi ra đĩa.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NO_AI = process.argv.includes("--no-ai"), SEC = +(process.argv[process.argv.indexOf("--seconds") + 1] || 0) || 0;
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
export async function postOpenAIResponse({ apiKey, timeoutMs, body }) { return fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs || 120000) }); }
export function responseOutputText(j) { return (j.output || []).flatMap((o) => o.content || []).filter((c) => c.type === "output_text").map((c) => c.text).join(""); }
const DATA = path.resolve(E.HS_RECORD_DIR || path.join(ROOT, "runtime", "hs-record")), M = path.join(DATA, "m");
export const C = { data: DATA, get key() { return ${NO_AI ? '""' : '(E.HS_OPENAI_API_KEY || E.OPENAI_API_KEY || "").trim()'}; }, text: E.HS_RECORD_TEXT_MODEL || "gpt-5.6-luna" };
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
try {
  tr("context.ts", "context.mjs"); tr("lexicon.ts", "lexicon.mjs");
  const lex = await import(pathToFileURL(path.join(tmp, "lexicon.mjs")).href);
  const { createPrivilegedClient } = await import(pathToFileURL(path.join(tmp, "shim.mjs")).href);
  const { data: wss } = await createPrivilegedClient().from("workspaces").select("id,name").order("created_at");
  for (const w of wss || []) {
    console.log(`\n=== Huấn luyện từ điển ghi âm · ${w.name || w.id} ${NO_AI ? "(không AI)" : ""}`);
    const s = await lex.train(w.id, { ai: !NO_AI, seconds: SEC || undefined });
    console.log(`Từ điển: ${s.entries} mục — ${s.kinds}`);
    console.log(`Mục mới so với lần trước: ${s.added}${s.added ? " — ví dụ: " + s.addedSample.slice(0, 15).join(", ") : ""}`);
    console.log(`AI học cách đọc: ${s.aiLearned} từ mới · còn ${s.aiLeft} từ chưa học${s.aiLeft ? " (chạy lại lệnh để học tiếp)" : ""} · ${s.aiCalls} lần gọi · ${s.aiTokens} token · ${(s.ms / 1000).toFixed(1)} giây`);
    const L = await lex.getLex(w.id);
    for (const x of ["anh dũng bảo bên bờ rích lọc lại cv trên suối nguồn", "em check lai nick da lô rồi báo hai rếch với so đa", "khách bên nhật cần comtor en hai ở hà nội, hạng một", "bên môn sờ ta láp với si ti nao gửi jd bờ rích cho chị phan ngọc"])
      console.log(`  "${x}"\n   → "${lex.fixText(x, L).text}"`);
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
