// Choices offered in the "Tạo content" popup and the template library, their labels, and
// validation of the brief. Pure module (zod only): shared by the UI, the server and the unit tests.
import { z } from "zod";

export const CONTENT_LANGUAGES = [
  { value: "VI", label: "Tiếng Việt" },
  { value: "EN", label: "Tiếng Anh" },
  { value: "VI_EN", label: "Song ngữ Việt – Anh" },
  { value: "VI_JA", label: "Song ngữ Việt – Nhật" },
  { value: "EN_JA", label: "Song ngữ Anh – Nhật" },
] as const;

/** Templates may also be written only in Japanese. */
export const TEMPLATE_LANGUAGES = [
  { value: "VI", label: "Tiếng Việt" },
  { value: "EN", label: "Tiếng Anh" },
  { value: "JA", label: "Tiếng Nhật" },
  { value: "VI_EN", label: "Song ngữ Việt – Anh" },
  { value: "VI_JA", label: "Song ngữ Việt – Nhật" },
  { value: "EN_JA", label: "Song ngữ Anh – Nhật" },
] as const;

export const CONTENT_FORMATS = [
  { value: "POST", label: "Bài đăng Facebook/Zalo", hint: "Bài đăng có tiêu đề, thân bài và lời kêu gọi" },
  { value: "EMAIL", label: "Email", hint: "Email có tiêu đề, lời chào, nội dung và lời kêu gọi" },
  { value: "ESSAY_100", label: "Bài luận ~100 chữ", hint: "Một đoạn khoảng 100 chữ" },
  { value: "SUMMARY_50", label: "Bài tóm tắt ~50 chữ", hint: "Tóm tắt khoảng 50 chữ" },
  { value: "STORY", label: "Câu chuyện", hint: "Kể một câu chuyện ngắn dẫn tới vị trí" },
] as const;

export const CONTENT_DEPARTMENTS = [
  { value: "REC", label: "Content Rec" },
  { value: "HR", label: "Content HR nội bộ" },
  { value: "SALE", label: "Content Sale" },
  { value: "CTV", label: "Content CTV" },
] as const;

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

export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number]["value"];
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number]["value"];
export type ContentFormat = (typeof CONTENT_FORMATS)[number]["value"];
export type ContentDepartment = (typeof CONTENT_DEPARTMENTS)[number]["value"];

const languageValues = CONTENT_LANGUAGES.map((item) => item.value) as [ContentLanguage, ...ContentLanguage[]];
const templateLanguageValues = TEMPLATE_LANGUAGES.map((item) => item.value) as [TemplateLanguage, ...TemplateLanguage[]];
const formatValues = CONTENT_FORMATS.map((item) => item.value) as [ContentFormat, ...ContentFormat[]];
const departmentValues = CONTENT_DEPARTMENTS.map((item) => item.value) as [ContentDepartment, ...ContentDepartment[]];

function labelOf(options: readonly { value: string; label: string }[], value: string) {
  return options.find((item) => item.value === value)?.label ?? value;
}
export const languageLabel = (value: string) => labelOf(TEMPLATE_LANGUAGES, value);
export const formatLabel = (value: string) => labelOf(CONTENT_FORMATS, value);
export const departmentLabel = (value: string) => labelOf(CONTENT_DEPARTMENTS, value);
/** Styles are stored as preset codes or as the free text typed under "Khác". */
export const styleLabel = (value: string) => labelOf(CONTENT_STYLES, value);

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
    if (!CONTENT_STYLES.some((item) => item.value === value.choice)) { context.addIssue({ code: "custom", message: "Chọn phong cách" }); return z.NEVER; }
    return value.choice;
  }),
  styleNote: optionalText(500),
  sampleContent: optionalText(6000),
  contentLanguage: z.enum(languageValues, { message: "Chọn ngôn ngữ" }),
  contentFormat: z.enum(formatValues, { message: "Chọn định dạng" }),
  department: z.enum(departmentValues, { message: "Chọn bộ phận" }),
  templateIds: z.array(z.string().regex(UUID, "Mẫu không hợp lệ")).transform((ids) => [...new Set(ids)])
    .pipe(z.array(z.string()).max(MAX_TEMPLATES_PER_BATCH, `Chọn tối đa ${MAX_TEMPLATES_PER_BATCH} mẫu`)),
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
    templateIds: formData.getAll("templateId").filter((value): value is string => typeof value === "string"),
    quantity: text("quantity"),
  };
}

export const contentTemplateSchema = z.object({
  department: z.enum(departmentValues, { message: "Chọn bộ phận" }),
  language: z.enum(templateLanguageValues, { message: "Chọn ngôn ngữ" }),
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
