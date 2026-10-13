// Choices offered in the "Tạo content" popup, their labels, and validation of the brief.
// Pure module (zod only): shared by the dialog, the server action and the unit tests.
import { z } from "zod";

export const CONTENT_LANGUAGES = [
  { value: "VI", label: "Tiếng Việt" },
  { value: "EN", label: "Tiếng Anh" },
  { value: "VI_EN", label: "Song ngữ Việt – Anh" },
  { value: "VI_JA", label: "Song ngữ Việt – Nhật" },
  { value: "EN_JA", label: "Song ngữ Anh – Nhật" },
] as const;

export const CONTENT_FORMATS = [
  { value: "EMAIL", label: "Email", hint: "Email có tiêu đề, lời chào, nội dung và lời kêu gọi" },
  { value: "ESSAY_100", label: "Bài luận ~100 chữ", hint: "Một đoạn khoảng 100 chữ" },
  { value: "SUMMARY_50", label: "Bài tóm tắt ~50 chữ", hint: "Tóm tắt khoảng 50 chữ" },
  { value: "STORY", label: "Câu chuyện", hint: "Kể một câu chuyện ngắn dẫn tới vị trí" },
] as const;

export const CONTENT_DEPARTMENTS = [
  { value: "RECRUITING", label: "Content tuyển dụng" },
  { value: "SHARING", label: "Content chia sẻ" },
  { value: "BRANDING", label: "Content thương hiệu" },
  { value: "SALES", label: "Content bán hàng / B2B" },
] as const;

export const CONTENT_STYLES = [
  { value: "PROFESSIONAL", label: "Chuyên nghiệp" },
  { value: "FRIENDLY", label: "Thân thiện, gần gũi" },
  { value: "YOUTHFUL", label: "Trẻ trung, năng động" },
  { value: "INSPIRING", label: "Truyền cảm hứng" },
  { value: "CONCISE", label: "Ngắn gọn, súc tích" },
  { value: "STORYTELLING", label: "Kể chuyện" },
] as const;

/** Value used in the selects for "Khác" (free text in the field next to it). */
export const OTHER_OPTION = "OTHER";
export const MAX_CONTENT_QUANTITY = 10;

export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number]["value"];
export type ContentFormat = (typeof CONTENT_FORMATS)[number]["value"];

const languageValues = CONTENT_LANGUAGES.map((item) => item.value) as [ContentLanguage, ...ContentLanguage[]];
const formatValues = CONTENT_FORMATS.map((item) => item.value) as [ContentFormat, ...ContentFormat[]];

function labelOf(options: readonly { value: string; label: string }[], value: string) {
  return options.find((item) => item.value === value)?.label ?? value;
}
export const languageLabel = (value: string) => labelOf(CONTENT_LANGUAGES, value);
export const formatLabel = (value: string) => labelOf(CONTENT_FORMATS, value);
/** Departments and styles are stored as preset codes or as the free text typed under "Khác". */
export const departmentLabel = (value: string) => labelOf(CONTENT_DEPARTMENTS, value);
export const styleLabel = (value: string) => labelOf(CONTENT_STYLES, value);

const optionalText = (max: number) => z.string().trim().max(max, `Tối đa ${max} ký tự`).transform((value) => value || null);

/** Preset code, or free text when "Khác" is chosen. */
function presetOrOther(presets: readonly { value: string }[], label: string) {
  return z.object({ choice: z.string(), other: z.string().trim().max(100, "Tối đa 100 ký tự") }).transform((value, context) => {
    if (value.choice === OTHER_OPTION) {
      if (!value.other) { context.addIssue({ code: "custom", message: `Nhập ${label}` }); return z.NEVER; }
      return value.other;
    }
    if (!presets.some((item) => item.value === value.choice)) { context.addIssue({ code: "custom", message: `Chọn ${label}` }); return z.NEVER; }
    return value.choice;
  });
}

export const contentBriefSchema = z.object({
  jobTitle: z.string().trim().min(1, "Nhập tên job").max(200, "Tối đa 200 ký tự"),
  position: optionalText(200),
  location: optionalText(200),
  languagesRequired: optionalText(200),
  techSkills: optionalText(1000),
  salary: optionalText(200),
  highlights: optionalText(2000),
  style: presetOrOther(CONTENT_STYLES, "phong cách"),
  styleNote: optionalText(500),
  sampleContent: optionalText(6000),
  contentLanguage: z.enum(languageValues, { message: "Chọn ngôn ngữ" }),
  contentFormat: z.enum(formatValues, { message: "Chọn định dạng" }),
  department: presetOrOther(CONTENT_DEPARTMENTS, "bộ phận"),
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
    style: { choice: text("style"), other: text("styleOther") },
    styleNote: text("styleNote"),
    sampleContent: text("sampleContent"),
    contentLanguage: text("contentLanguage"),
    contentFormat: text("contentFormat"),
    department: { choice: text("department"), other: text("departmentOther") },
    quantity: text("quantity"),
  };
}
