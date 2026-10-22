// Pure text helpers for AI Recruiter replies: reading candidate messages, checking evidence,
// and the deterministic fallback questions. No I/O; covered by tests/recruiter-text.test.mjs.
import { hasRecruiterCvAttachment, normalizeRecruiterMatchText } from "../server/ai-recruiter-job-policy.ts";
import { BARE_GREETING } from "./recruiter-opening.ts";

export function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function messageContext(message: { text_content: string | null; attachment_count: number; metadata: unknown }) {
  if (typeof message.text_content === "string" && message.text_content.trim()) return message.text_content.slice(0, 6000);
  const attachments = object(message.metadata) && Array.isArray(message.metadata.attachments) ? message.metadata.attachments : [];
  const descriptions = attachments.flatMap((value) => {
    if (!object(value)) return [];
    const filename = typeof value.filename === "string" ? value.filename.trim() : "";
    const contentType = typeof value.contentType === "string" ? value.contentType.toLowerCase() : "";
    if (contentType.startsWith("image/") || /\bimage\b|\bảnh\b/iu.test(filename)) return ["ảnh"];
    if (contentType === "application/pdf" || /\.pdf$/iu.test(filename)) return [`tài liệu PDF${filename ? ` (${filename})` : ""}`];
    return [`tệp đính kèm${filename ? ` (${filename})` : ""}`];
  });
  return descriptions.length > 0 ? `[${descriptions.join(", ")}]` : `[${message.attachment_count} tệp đính kèm]`;
}
export function hasCvEvidence(message: { text_content: string | null; metadata: unknown }) {
  return hasRecruiterCvAttachment(message.metadata);
}
export function normalizedEvidence(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("vi-VN");
}
export const normalizedMatchText = normalizeRecruiterMatchText;
export function mentionsJob(reply: string, job: Record<string, unknown>) {
  const haystack = normalizedMatchText(reply),
    company = normalizedMatchText(job.company_name);
  return company.length >= 3 && haystack.includes(company);
}
export function humanizeRecruiterReply(value: string) {
  const natural = value
    .replace(/^Em ghi nhận anh (?:không muốn|không còn muốn) ứng tuyển lại ([^.]+)\.\s*/iu, "Mình bỏ qua $1 nhé. ")
    .replace(/^(?:Dạ\s+)?(?:em\s+)?(?:đã\s+)?(?:ghi nhận|hiểu)(?:\s+rồi)?(?:\s+rằng)?[,:]?\s*/iu, "");
  const cleaned = natural
    .replace(/\s*[？]+\s*/gu, "? ")
    .replace(/\s+([.,!])/gu, "$1")
    .replace(/([.!])(?:\s*\1)+/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
  return cleaned ? cleaned[0].toLocaleUpperCase("vi-VN") + cleaned.slice(1) : cleaned;
}
export function isBareRecruiterGreeting(value: string) {
  return BARE_GREETING.test(value.trim());
}
export function recruiterProfileQuestion(latestText: string, profile: Record<string, unknown>) {
  if (!profile.candidate_type)
    return isBareRecruiterGreeting(latestText)
      ? "Em chào anh ạ, em đang có một vài job IT tiếng Nhật khá tốt cho các hướng BrSE, PM, SE và Developer.\n\nAnh đang quan tâm hướng BrSE, PM hay nghiêng về Dev hơn để em lọc job sát cho anh ạ?"
      : "Dạ được anh ạ, anh đang quan tâm hướng BrSE, PM hay nghiêng về Dev hơn để em lọc job sát cho anh ạ?";
  if (!profile.location) return `Với hướng ${String(profile.candidate_type)}, anh muốn ưu tiên làm ở khu vực nào ạ?`;
  if (!profile.japanese_level)
    return `Em sẽ lọc theo khu vực ${String(profile.location)}. Anh cho em biết mức tiếng Nhật hiện tại và khả năng trao đổi công việc với khách Nhật nhé?`;
  if (profile.japan_years === undefined || profile.japan_years === null)
    return "Anh đã từng sống hoặc làm việc tại Nhật chưa ạ? Nếu chưa từng thì em vẫn lọc job ở Việt Nam cho anh được.";
  return null;
}
export function clarificationReply(profile: Record<string, unknown>) {
  const known = [
    typeof profile.japanese_level === "string" ? profile.japanese_level : null,
    typeof profile.years_experience === "number" ? `${profile.years_experience} năm kinh nghiệm` : null,
    Array.isArray(profile.primary_skills) ? profile.primary_skills.join("/") : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `${known ? `Với ${known}, ` : ""}anh chia sẻ giúp em vị trí muốn ưu tiên nhất để em lọc job sát hơn nhé.`;
}
