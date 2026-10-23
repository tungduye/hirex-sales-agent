// Báo cáo kiểm thử → Word (cùng kiểu chữ với biên bản Cuộc họp: Arial, tiêu đề đỏ, mục I–VI, bảng nền xanh nhạt). Thuần.
import { docKit, styledDocx } from "../record/minutes.ts";

export interface QaCase { name: string; steps: string; expected: string; actual: string; result: "pass" | "fail" | "warn" | "skip" }
export interface QaIssue { type: string; severity: string; title: string; evidence: string; fix: string }
export interface QaReport {
  title: string; feature: string; mechanism: string[]; verdict: { score: number; status: string; summary: string };
  cases: QaCase[]; issues: QaIssue[]; perf: { summary: string; items: string[] }; tech: Array<{ problem: string; suggest: string }>; next: string[];
}
export interface QaHead { url: string; goal: string; date: string; dur: string; steps: number }

const RES: Record<string, string> = { pass: "Đạt", fail: "Lỗi", warn: "Cần xem", skip: "Bỏ qua" };
const TYPE: Record<string, string> = { bug: "Lỗi", ux: "UX", perf: "Tốc độ", content: "Nội dung", a11y: "Truy cập", security: "Bảo mật" };
const roman = (n: number) => ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"][n] || String(n);

export function qaDocx(R: QaReport, h: QaHead) {
  const { r, p, li, table } = docKit;
  let n = 0;
  const sec = (t: string) => p("Heading1", r(`${roman(++n)}. ${t}`));
  let o = p("MeetingTitle", r(`BÁO CÁO KIỂM THỬ: ${(R.title || h.url).toLocaleUpperCase("vi-VN")}`))
    + p("MeetingDate", r(`Trang: ${h.url}`)) + p("MeetingDate", r(`Ngày test: ${h.date} · ${h.dur} · ${h.steps} bước`))
    + p("MeetingDate", r(`Yêu cầu: ${h.goal || "Kiểm thử tổng quát"}`))
    + p("Normal", "", '<w:spacing w:after="0" w:line="120" w:lineRule="exact"/>');
  o += sec("ĐÁNH GIÁ CHUNG") + p("BodyText", r(`${R.verdict.status} · ${R.verdict.score}/100. `, true, R.verdict.score >= 80 ? "22815D" : R.verdict.score >= 55 ? "B56E15" : "C00000") + r(R.verdict.summary));
  o += sec("CHỨC NĂNG VÀ CƠ CHẾ") + p("BodyText", r(R.feature)) + R.mechanism.map((x) => li(r(x))).join("");
  if (R.cases.length) o += sec("TRƯỜNG HỢP KIỂM THỬ") + table([["Trường hợp", "Các bước", "Mong đợi → Thực tế", "Kết quả"], ...R.cases.map((c) => [c.name, c.steps, `${c.expected} → ${c.actual}`, RES[c.result] || c.result])], [2000, 2900, 3171, 1000]);
  if (R.issues.length) o += sec("LỖI VÀ ĐIỂM CẦN CẢI THIỆN") + table([["Vấn đề", "Mức", "Bằng chứng", "Cách sửa"], ...R.issues.map((x) => [`[${TYPE[x.type] || x.type}] ${x.title}`, x.severity, x.evidence, x.fix])], [2600, 1000, 2600, 2871]);
  o += sec("TỐC ĐỘ VÀ KỸ THUẬT") + p("BodyText", r(R.perf.summary)) + R.perf.items.map((x) => li(r(x))).join("") + R.tech.map((t) => li(r(t.problem + " → ", true) + r(t.suggest))).join("");
  if (R.next.length) o += sec("NÊN TEST THÊM") + R.next.map((x) => li(r(x))).join("");
  return styledDocx(o);
}
