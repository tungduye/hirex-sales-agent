import "server-only";

// Ngữ cảnh cho Cuộc họp, lấy tự động từ dữ liệu HireX (cùng nguồn Soda đọc) — thay cho Từ vựng / Chủ đề / Mẫu / Công ty nhập tay:
//  - Thành viên: tài khoản HireX (tên, bộ phận, vai trò), chủ sở hữu ở Tài nguyên, người dùng Human.
//  - Hệ thống: tên các màn / chức năng HireX và nghiệp vụ (Soda, Suối Nguồn, Hola/Hole, Tài nguyên, Hạng, X1/X2, AM1/AM2…).
//  - Dữ liệu đang chạy: nhãn Suối Nguồn, khách hàng nhiều CV, job đang tuyển, các cuộc họp gần đây.
// Dùng cho: prompt phiên âm (nghe đúng tên / thuật ngữ), từ khoá phụ đề trực tiếp, và bối cảnh viết biên bản.
// Đọc DB tối đa 1 lần / 10 phút mỗi không gian làm việc; lỗi DB thì vẫn chạy với phần cố định.
import fs from "node:fs";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { st, fp, rj, fmtT, type Meta } from "./data";

export interface Person { name: string; dept: string; note: string }
export interface MeetContext { people: Person[]; tags: string[]; customers: string[]; jobs: string[]; recent: string[] }

/** Bản đồ HireX (viết theo code + cách Soda gọi tên) — phần cố định của ngữ cảnh. */
const HIREX_MAP = [
  "CÔNG TY: Intalent Việt Nam — tuyển dụng / headhunt nhân sự IT (nhiều vị trí tiếng Nhật) cho doanh nghiệp Nhật và doanh nghiệp tại Việt Nam. CEO là anh Dũng.",
  "HireX = hệ thống nội bộ của Intalent (CRM tuyển dụng – bán hàng). Các màn / chức năng (tên gọi chuẩn):",
  "- Suối Nguồn: hộp thư chung Zalo / Facebook / Email; tab Tất cả, Của tôi, Giao cho tôi, Nhóm, Chưa trả lời, Khác / Quan trọng; nhãn (thẻ) và nhóm thẻ, giao cho owner, ghim, tắt thông báo, menu ba chấm, thao tác hàng loạt, avatar hội thoại.",
  "- Trợ lý HireX \"Soda\" (chat trên web và Zalo): trả lời số liệu theo cơ cấu Bộ phận (Sale, Rec, R&D) · Owner · Thị trường (IT, IT Nhật, IT Úc) · Định dạng (Mail, text, ảnh, profile) · Số lượng · Tình trạng thẻ; đề xuất thao tác bằng thẻ xác nhận; đọc Tài liệu.",
  "- Hola và Hole: 2 bộ soạn tin trả lời trong Suối Nguồn (Hola nhanh theo tin cuối, Hole đọc hồ sơ khách / ứng viên).",
  "- Chiến dịch (Email, Zalo, Facebook cá nhân), Gửi nhóm Zalo (gửi / ghim vào nhóm), Kho content (content, mẫu), Job (bảng job), Khách hàng và CV (đồng bộ từ Human), Tài liệu (thư viện tài liệu), Lịch hẹn, Scan (Scan CV, Scan Website), AI Recruiter, Công việc, Phân tích, Cài đặt (Vai trò & phân quyền, Tài khoản kết nối), Tiện ích › Cuộc họp (ghi âm, phụ đề, biên bản).",
  "- Tài nguyên (AccountsHS): quản lý tài khoản / nick theo tab Facebook, FB Page, Email (Gmail), SĐT, Zalo, WhatsApp, LinkedIn, Telegram, Proxy, Bài đăng FB, Nhóm FB; trạng thái Live / Die / Đang kháng, xác minh, Tình trạng sở hữu (Lâu dài / Tạm thời / Mất / Không xác định); Vọng gác (checklive tự động), Cú vọ (AI hỏi đáp / sửa dữ liệu tài khoản).",
  "- KIT: bộ công cụ marketing và mở rộng dữ liệu (Facebook → SĐT, LinkedIn → email…); Agent scan LinkedIn / Facebook. Human: CRM gốc của công ty (khách hàng, CV, báo cáo), HireX đồng bộ về.",
  "NGHIỆP VỤ: Rec (tuyển dụng: tìm, tư vấn ứng viên — UV, đẩy CV), Sale (tìm khách, nhận JD / order), AM1 / AM2 (người quản lý khách hàng chính / phụ), CTV / Parttime; khách hàng xếp Hạng 1 → Hạng 7 (Pending); Xếp hạng dự án X1 Đang chạy, X2 Hot Do, X3–X5 Pending / Do, X6–X7 Sale; Tình trạng 1 / Tình trạng 2 của CV; mẫu A3 (tổng hợp CV đã gửi để nhắc khách); vị trí hay tuyển BrSE, Comtor, PM, Dev, Tester, tiếng Nhật N1–N3; JD, CV, offer, onboard, phỏng vấn vòng 1 / 2 (PV1, PV2), KPI, deadline, deploy / release, bug.",
].join("\n");
/** Thuật ngữ chuẩn hay bị nghe sai (gửi cho bộ nhận dạng). */
const TERMS = ["Intalent", "HireX", "Soda", "Suối Nguồn", "Hola", "Hole", "Human", "Tài nguyên", "Vọng gác", "Cú vọ", "KIT", "AI Recruiter", "Kho content", "BrSE", "Comtor", "AM1", "AM2", "CV", "JD", "UV", "Rec", "Sale", "R&D", "CTV", "Parttime", "owner", "Hot Do", "X1", "X2", "Zalo", "Facebook", "LinkedIn", "Gmail", "checklive", "deploy", "release", "N1", "N2", "N3"];

type Row = Record<string, unknown>;
const S = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const cache = new Map<string, { at: number; v: MeetContext }>();
const TTL = 10 * 60_000;

async function load(workspaceId: string): Promise<MeetContext> {
  const db = createPrivilegedClient(), q = async (p: PromiseLike<{ data: unknown; error: unknown }>) => { try { const r = await p; return r.error ? [] : ((r.data ?? []) as Row[]); } catch { return []; } };
  const ws = workspaceId || S((await q(db.from("workspaces").select("id").order("created_at").limit(1)))[0]?.id);
  const [profiles, roles, owners, depts, human, tags, partners, jobs] = await Promise.all([
    q(db.from("profiles").select("full_name,department,role_id").eq("workspace_id", ws).limit(300)),
    q(db.from("workspace_roles").select("id,name").eq("workspace_id", ws).limit(100)),
    q(db.from("ahs_owners").select("name,dept_id").limit(300)),
    q(db.from("ahs_depts").select("id,name").limit(100)),
    q(db.from("human_user_links").select("human_name").eq("workspace_id", ws).limit(300)),
    q(db.from("conversation_tags").select("name").eq("workspace_id", ws).limit(200)),
    q(db.from("human_partners").select("name,cv_total").eq("workspace_id", ws).eq("active", true).gt("cv_total", 0).order("cv_total", { ascending: false }).limit(40)),
    q(db.from("recruitment_jobs").select("title").eq("workspace_id", ws).eq("status", "OPEN").limit(300)),
  ]);
  const role = new Map(roles.map((r) => [S(r.id), S(r.name)])), dept = new Map(depts.map((d) => [S(d.id), S(d.name)]));
  const people = new Map<string, Person>(), key = (n: string) => n.toLocaleLowerCase("vi").normalize("NFC");
  const add = (name: string, d: string, note: string) => {
    if (!name || name.length > 60) return; const cur = people.get(key(name));
    if (!cur) { people.set(key(name), { name, dept: d, note }); return; }
    if (!cur.dept && d) cur.dept = d; if (note && !cur.note.includes(note)) cur.note = cur.note ? `${cur.note}; ${note}` : note;   // cùng người ở nhiều nguồn: gộp
  };
  for (const p of profiles) {
    const n = S(p.full_name); if (!n || /^(hirex admin|.*\btest)$/i.test(n)) continue;
    if (/^ceo$/i.test(n)) { add("Dũng", "Ban giám đốc", "CEO, gọi là anh Dũng, thường chủ trì họp"); continue; }
    const r = role.get(S(p.role_id)) || ""; add(n, S(p.department), /quản trị/i.test(r) ? "quản trị viên HireX" : "");
  }
  for (const o of owners) { const raw = S(o.name), [pre, nm] = raw.includes("·") ? raw.split("·").map(S) : ["", raw]; add(nm, dept.get(S(o.dept_id)) || "", pre); }
  for (const h of human) { const n = S(h.human_name); if (n && !/^(deactive|parttime)/i.test(n)) add(n, "", ""); }
  const jobCount = new Map<string, number>(); for (const j of jobs) { const t = S(j.title); if (t) jobCount.set(t, (jobCount.get(t) || 0) + 1); }
  return { people: [...people.values()], tags: tags.map((t) => S(t.name)).filter((t) => t && !/^(test|nhãn \d+|hello)/i.test(t)), customers: partners.map((p) => S(p.name)).filter(Boolean),
    jobs: [...jobCount].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t]) => t), recent: [] };
}

/** Các cuộc họp đã xong gần nhất (tên, ngày, tóm tắt) để biên bản nối mạch với các buổi trước. */
function recentMeetings(except: string, n = 5) {
  return [...st().meta.values()].filter((m) => m.kind === "meeting" && m.status === "done" && m.slug !== except).sort((a, b) => (b.started || 0) - (a.started || 0)).slice(0, n).map((m: Meta) => {
    const j = rj<{ summary?: string }>(fp(m.slug, "minutes.json"), {}); let s = S(j.summary);
    if (!s) { try { s = S(fs.readFileSync(fp(m.slug, "summary.html"), "utf8").replace(/<[^>]+>/g, " ")); } catch { s = ""; } }
    return `${fmtT(m.started || m.created * 1000).slice(6)} · ${m.title}: ${s.slice(0, 260)}`;
  });
}

export async function meetContext(workspaceId = "", except = ""): Promise<MeetContext> {
  const k = workspaceId || "-", hit = cache.get(k);
  const base = hit && Date.now() - hit.at < TTL ? hit.v : await load(workspaceId).catch((): MeetContext => ({ people: [], tags: [], customers: [], jobs: [], recent: [] }));
  if (!hit || hit.v !== base) cache.set(k, { at: Date.now(), v: base });
  return { ...base, recent: recentMeetings(except) };
}

/** Bối cảnh đầy đủ cho AI viết biên bản. */
export function contextText(c: MeetContext) {
  return [
    HIREX_MAP,
    c.people.length && "THÀNH VIÊN (tên trong HireX / Tài nguyên / Human — bộ phận; một người có thể có cả tên ngắn và họ tên đầy đủ); trong họp thường gọi tên ngắn, kèm anh / chị / em:\n" + c.people.map((p) => `- ${p.name}${p.dept ? " — " + p.dept : ""}${p.note ? ` (${p.note})` : ""}`).join("\n"),
    c.tags.length && "NHÃN SUỐI NGUỒN: " + c.tags.join(", "),
    c.customers.length && "KHÁCH HÀNG NHIỀU CV (tên chuẩn): " + c.customers.join(", "),
    c.jobs.length && "JOB ĐANG TUYỂN: " + c.jobs.join("; "),
    c.recent.length && "CÁC CUỘC HỌP GẦN ĐÂY (để nối mạch, không chép vào biên bản):\n" + c.recent.map((r) => "- " + r).join("\n"),
  ].filter(Boolean).join("\n\n");
}

/** Tên người ngắn (gọi trong họp): "Đỗ Quang Hải" → "Hải", "Cường J3" → "Cường". */
const shortName = (n: string) => { const w = n.replace(/\b(J\d|Sale|Rec|Manager|Test)\b/gi, "").replace(/^(chị|anh|em|c\.)\s*/i, "").trim().split(/\s+/); return w.length >= 3 ? w.slice(-2).join(" ") : w.join(" "); };
/** Tên người + thuật ngữ cho bộ nhận dạng (phiên âm, phụ đề trực tiếp). */
export function contextTerms(c: MeetContext) {
  const names = [...new Set(c.people.flatMap((p) => [p.name, shortName(p.name)]).filter((n) => n.length >= 2))];
  return { names, terms: [...new Set([...TERMS, ...c.tags])], customers: c.customers.slice(0, 20) };
}
/** Prompt cho model phiên âm: 1 câu bối cảnh + tên người + thuật ngữ (≤ ~900 ký tự), kèm đuôi đoạn trước để nối câu. */
export function sttPrompt(c: MeetContext, prev = "", focus: string[] = []) {
  const t = contextTerms(c);
  const short = [...new Set(c.people.map((p) => shortName(p.name)).filter((n) => n.length >= 2))];
  // focus = thuật ngữ đã nghe thấy trong chính cuộc họp này (từ phụ đề trực tiếp) → đưa lên đầu để model phiên âm viết đúng
  const terms = [...new Set([...focus, ...t.terms])];
  const head = `Cuộc họp nội bộ công ty Intalent về hệ thống HireX (có thể xen tiếng Anh, tiếng Nhật). Người tham gia có thể gồm: ${short.slice(0, 24).join(", ")}. Thuật ngữ: ${terms.slice(0, focus.length ? 48 : 32).join(", ")}.`;
  const tail = S(prev).slice(-240);
  return (tail ? `${head} … ${tail}` : head).slice(0, 1000);
}
