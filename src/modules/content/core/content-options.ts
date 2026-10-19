// Choices offered in the "Tạo content" popup and the template library, their labels, and
// validation of the brief. Pure module (zod only): shared by the UI, the server and the unit tests.
import { z } from "zod";

export const CONTENT_LANGUAGES = [
  { value: "VI", label: "Tiếng Việt" },
  { value: "EN", label: "Tiếng Anh" },
  { value: "JA", label: "Tiếng Nhật" },
  { value: "VI_EN", label: "Song ngữ Việt – Anh" },
  { value: "VI_JA", label: "Song ngữ Việt – Nhật" },
  { value: "EN_JA", label: "Song ngữ Nhật – Anh" },
] as const;

/** Templates use the same languages as content. */
export const TEMPLATE_LANGUAGES = CONTENT_LANGUAGES;

/** "Định dạng". Lengths are per language (a bilingual content has both versions). */
export const CONTENT_FORMATS = [
  { value: "EMAIL", label: "Mail", hint: "Tiêu đề ≤ 70 ký tự; thư 120–200 chữ: chào, nội dung, lời kêu gọi, ký tên" },
  { value: "POST_LONG", label: "Đăng chi tiết", hint: "Bài đăng đầy đủ 180–300 chữ: tiêu đề, các ý chính, CTA" },
  { value: "POST_MEDIUM", label: "Đăng trung bình", hint: "Bài đăng 80–120 chữ: tiêu đề và 2–3 ý mạnh nhất" },
  { value: "POST_SHORT", label: "Đăng vắn", hint: "Bài đăng ngắn 25–50 chữ, 1–3 câu" },
  { value: "COMMENT", label: "Comment", hint: "Bình luận 10–30 chữ, 1–2 câu tự nhiên" },
] as const;

/** "Bộ phận". Codes are stored in the database; labels are what people see. */
export const CONTENT_DEPARTMENTS = [
  { value: "SALE", label: "Sale" },
  { value: "HR", label: "Tuyển nội bộ" },
  { value: "REC", label: "Tuyển dự án" },
  { value: "MEDIA", label: "Truyền thông" },
  { value: "NOTICE", label: "Thông báo" },
  { value: "CTV", label: "CTV" },
] as const;

/** Format codes used before migration 081 and their replacement (old links, pending requests). */
export const LEGACY_FORMAT_CODES: Record<string, string> = { POST: "POST_LONG", STORY: "POST_LONG", ESSAY_100: "POST_MEDIUM", SUMMARY_50: "POST_SHORT" };

export const CONTENT_STYLES = [
  { value: "PROFESSIONAL", label: "Chuyên nghiệp" },
  { value: "FRIENDLY", label: "Thân thiện, gần gũi" },
  { value: "YOUTHFUL", label: "Trẻ trung, năng động" },
  { value: "INSPIRING", label: "Truyền cảm hứng" },
  { value: "CONCISE", label: "Ngắn gọn, súc tích" },
  { value: "STORYTELLING", label: "Kể chuyện" },
] as const;

/** Value used in the style select for "Khác" (free text in the field next to it). */
export const OTHER_OPTION = "OTHER";
export const MAX_CONTENT_QUANTITY = 10;
export const MAX_TEMPLATES_PER_BATCH = 5;

/** Codes: the built-in ones above, or ones added in "Cài đặt Kho content" (checked on the server). */
export type ContentLanguage = string;
export type TemplateLanguage = string;
export type ContentFormat = string;
export type ContentDepartment = string;
export type BuiltinFormat = (typeof CONTENT_FORMATS)[number]["value"];
export type BuiltinDepartment = (typeof CONTENT_DEPARTMENTS)[number]["value"];

const OPTION_CODE = /^[A-Z][A-Z0-9_]{0,19}$/u;
const codeSchema = (message: string) => z.string().trim().regex(OPTION_CODE, message);

function labelOf(options: readonly { value: string; label: string }[], value: string) {
  return options.find((item) => item.value === value)?.label ?? value;
}
export const languageLabel = (value: string) => labelOf(TEMPLATE_LANGUAGES, value);
export const formatLabel = (value: string) => labelOf(CONTENT_FORMATS, LEGACY_FORMAT_CODES[value] ?? value);
export const departmentLabel = (value: string) => labelOf(CONTENT_DEPARTMENTS, value);
/** Styles are stored as preset codes or as the free text typed under "Khác". */
export const styleLabel = (value: string) => labelOf(CONTENT_STYLES, value);

/** "Phân loại": optional; empty means none. */
const categoryIdSchema = z.string().optional().transform((value) => value?.trim() || null).pipe(z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Phân loại không hợp lệ").nullable());
const formatSchema = z.preprocess((value) => typeof value === "string" ? LEGACY_FORMAT_CODES[value] ?? value : value, codeSchema("Chọn định dạng"));

const optionalText = (max: number) => z.string().trim().max(max, `Tối đa ${max} ký tự`).transform((value) => value || null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const contentBriefSchema = z.object({
  jobTitle: z.string().trim().min(1, "Nhập tên job / chủ đề").max(200, "Tối đa 200 ký tự"),
  position: optionalText(200),
  location: optionalText(200),
  languagesRequired: optionalText(200),
  techSkills: optionalText(1000),
  salary: optionalText(200),
  highlights: optionalText(2000),
  jdText: optionalText(8000),
  blockedTerms: optionalText(1000),
  style: z.object({ choice: z.string(), other: z.string().trim().max(100, "Tối đa 100 ký tự") }).transform((value, context) => {
    if (value.choice === OTHER_OPTION) {
      if (!value.other) { context.addIssue({ code: "custom", message: "Nhập phong cách" }); return z.NEVER; }
      return value.other;
    }
    if (!OPTION_CODE.test(value.choice)) { context.addIssue({ code: "custom", message: "Chọn phong cách" }); return z.NEVER; }
    return value.choice;
  }),
  styleNote: optionalText(500),
  sampleContent: optionalText(6000),
  contentLanguage: codeSchema("Chọn ngôn ngữ"),
  contentFormat: formatSchema,
  department: codeSchema("Chọn bộ phận"),
  categoryId: categoryIdSchema,
  templateIds: z.array(z.string().regex(UUID, "Mẫu không hợp lệ")).transform((ids) => [...new Set(ids)])
    .pipe(z.array(z.string()).max(MAX_TEMPLATES_PER_BATCH, `Chọn tối đa ${MAX_TEMPLATES_PER_BATCH} mẫu`)),
  /** Job of Bảng Job this brief is for (optional). */
  jobId: z.string().optional().transform((value) => value?.trim() || null).pipe(z.string().regex(UUID, "Job không hợp lệ").nullable()),
  quantity: z.coerce.number({ message: "Nhập số lượng" }).int("Số nguyên").min(1, "Ít nhất 1").max(MAX_CONTENT_QUANTITY, `Tối đa ${MAX_CONTENT_QUANTITY}`),
});

export type ContentBrief = z.infer<typeof contentBriefSchema>;

export function briefInputFromFormData(formData: FormData) {
  const text = (name: string) => { const value = formData.get(name); return typeof value === "string" ? value : ""; };
  return {
    jobTitle: text("jobTitle"),
    position: text("position"),
    location: text("location"),
    languagesRequired: text("languagesRequired"),
    techSkills: text("techSkills"),
    salary: text("salary"),
    highlights: text("highlights"),
    jdText: text("jdText"),
    blockedTerms: text("blockedTerms"),
    style: { choice: text("style"), other: text("styleOther") },
    styleNote: text("styleNote"),
    sampleContent: text("sampleContent"),
    contentLanguage: text("contentLanguage"),
    contentFormat: text("contentFormat"),
    department: text("department"),
    categoryId: text("categoryId"),
    templateIds: formData.getAll("templateId").filter((value): value is string => typeof value === "string"),
    jobId: text("jobId"),
    quantity: text("quantity"),
  };
}

export const contentTemplateSchema = z.object({
  department: codeSchema("Chọn bộ phận"),
  contentFormat: formatSchema,
  categoryId: categoryIdSchema,
  language: codeSchema("Chọn ngôn ngữ"),
  groupName: optionalText(100),
  tone: optionalText(200),
  cta: optionalText(200),
  tags: optionalText(500),
  note: optionalText(1000),
  weight: z.coerce.number({ message: "Nhập trọng số" }).int("Số nguyên").min(1, "Từ 1").max(10, "Đến 10"),
  active: z.boolean(),
  body: z.string().trim().min(1, "Nhập nội dung mẫu").max(8000, "Tối đa 8000 ký tự"),
});

export type ContentTemplateInput = z.infer<typeof contentTemplateSchema>;

export function templateInputFromFormData(formData: FormData) {
  const text = (name: string) => { const value = formData.get(name); return typeof value === "string" ? value : ""; };
  return {
    department: text("department"),
    contentFormat: text("contentFormat") || "POST_LONG",
    categoryId: text("categoryId"),
    language: text("language"),
    groupName: text("groupName"),
    tone: text("tone"),
    cta: text("cta"),
    tags: text("tags"),
    note: text("note"),
    weight: text("weight") || "3",
    active: formData.get("active") === "on",
    body: text("body"),
  };
}

/** Where a content can be marked as posted ("Đã đăng ở…"). */
export const POST_CHANNELS = [
  { value: "FACEBOOK_GROUP", label: "Nhóm Facebook" }, { value: "FACEBOOK_PAGE", label: "Page" }, { value: "FACEBOOK_PROFILE", label: "FB cá nhân" },
  { value: "ZALO_GROUP", label: "Nhóm Zalo" }, { value: "LINKEDIN", label: "LinkedIn" }, { value: "OTHER", label: "Khác" },
] as const;
