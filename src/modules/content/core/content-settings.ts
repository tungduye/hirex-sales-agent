// "Cài đặt Kho content": the workspace's lists of Bộ phận, Định dạng, Ngôn ngữ and Phong cách.
// The app ships built-in entries (content-options.ts); rows in content_options override their label,
// abbr, order, on/off and word range, or add new ones. Pure module, shared by UI, server and tests.
import { z } from "zod";
import { CONTENT_DEPARTMENTS, CONTENT_FORMATS, CONTENT_LANGUAGES, CONTENT_STYLES } from "./content-options.ts";

export const OPTION_KINDS = ["DEPARTMENT", "FORMAT", "LANGUAGE", "STYLE"] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];
export const OPTION_KIND_LABEL: Record<OptionKind, string> = { DEPARTMENT: "Bộ phận", FORMAT: "Định dạng", LANGUAGE: "Ngôn ngữ", STYLE: "Phong cách" };

export interface ContentOption {
  kind: OptionKind;
  code: string;
  label: string;
  /** Short code used in content codes (261019_REC_DCT_GT_VI_01). Styles have none. */
  abbr: string | null;
  sort: number;
  active: boolean;
  /** Định dạng only: words per language. */
  wordMin: number | null;
  wordMax: number | null;
  /** Note for the AI (Bộ phận: who reads it, goal, voice, CTA). */
  guide: string | null;
  builtIn: boolean;
}

export interface ContentSettings { departments: ContentOption[]; formats: ContentOption[]; languages: ContentOption[]; styles: ContentOption[] }

const BUILTIN_ABBR: Record<string, string> = {
  "DEPARTMENT:REC": "REC", "DEPARTMENT:HR": "HR", "DEPARTMENT:SALE": "SALE", "DEPARTMENT:MEDIA": "MEDIA", "DEPARTMENT:NOTICE": "TB", "DEPARTMENT:CTV": "CTV",
  "FORMAT:EMAIL": "MAIL", "FORMAT:POST_LONG": "DCT", "FORMAT:POST_MEDIUM": "DTB", "FORMAT:POST_SHORT": "DV", "FORMAT:COMMENT": "CMT",
  "LANGUAGE:VI": "VI", "LANGUAGE:EN": "EN", "LANGUAGE:JA": "JA", "LANGUAGE:VI_EN": "VIEN", "LANGUAGE:VI_JA": "VIJA", "LANGUAGE:EN_JA": "ENJA",
};
export const BUILTIN_WORDS: Record<string, [number, number]> = { EMAIL: [120, 200], POST_LONG: [180, 300], POST_MEDIUM: [80, 120], POST_SHORT: [25, 50], COMMENT: [10, 30] };
const DEPARTMENT_ORDER = ["REC", "SALE", "HR", "MEDIA", "NOTICE", "CTV"];

function builtIns(): ContentOption[] {
  const make = (kind: OptionKind, value: string, label: string, sort: number): ContentOption => ({
    kind, code: value, label, abbr: BUILTIN_ABBR[`${kind}:${value}`] ?? null, sort, active: true,
    wordMin: kind === "FORMAT" ? BUILTIN_WORDS[value]?.[0] ?? null : null, wordMax: kind === "FORMAT" ? BUILTIN_WORDS[value]?.[1] ?? null : null,
    guide: null, builtIn: true,
  });
  return [
    ...CONTENT_DEPARTMENTS.map((item) => make("DEPARTMENT", item.value, item.label, DEPARTMENT_ORDER.indexOf(item.value) + 1)),
    ...CONTENT_FORMATS.map((item, index) => make("FORMAT", item.value, item.label, index + 1)),
    ...CONTENT_LANGUAGES.map((item, index) => make("LANGUAGE", item.value, item.label, index + 1)),
    ...CONTENT_STYLES.map((item, index) => make("STYLE", item.value, item.label, index + 1)),
  ];
}

export interface OptionRow { kind: string; code: string; label: string; abbr: string | null; sort: number; active: boolean; word_min: number | null; word_max: number | null; guide: string | null }

/** Built-in entries, overridden or extended by the workspace's rows; each list in display order. */
export function mergeContentSettings(rows: OptionRow[]): ContentSettings {
  const all = new Map(builtIns().map((option) => [`${option.kind}:${option.code}`, option]));
  for (const row of rows) {
    if (!(OPTION_KINDS as readonly string[]).includes(row.kind)) continue;
    const key = `${row.kind}:${row.code}`;
    const base = all.get(key);
    all.set(key, { kind: row.kind as OptionKind, code: row.code, label: row.label, abbr: row.abbr, sort: row.sort, active: row.active,
      wordMin: row.word_min ?? base?.wordMin ?? null, wordMax: row.word_max ?? base?.wordMax ?? null, guide: row.guide, builtIn: Boolean(base?.builtIn) });
  }
  const list = (kind: OptionKind) => [...all.values()].filter((option) => option.kind === kind).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, "vi"));
  return { departments: list("DEPARTMENT"), formats: list("FORMAT"), languages: list("LANGUAGE"), styles: list("STYLE") };
}

export const DEFAULT_CONTENT_SETTINGS = mergeContentSettings([]);

export function optionsOf(settings: ContentSettings, kind: OptionKind) {
  return kind === "DEPARTMENT" ? settings.departments : kind === "FORMAT" ? settings.formats : kind === "LANGUAGE" ? settings.languages : settings.styles;
}
/** Entries offered for new content/templates (on, in order). */
export function activeOptions(list: ContentOption[]) { return list.filter((option) => option.active); }
export function findOption(list: ContentOption[], code: string | null | undefined) { return list.find((option) => option.code === code) ?? null; }
/** Label of a code; unknown codes show as they are. */
export function optionLabel(list: ContentOption[], code: string | null | undefined) { return findOption(list, code)?.label ?? code ?? ""; }
export function wordRangeLabel(option: ContentOption | null) { return option?.wordMin && option.wordMax ? `${option.wordMin}–${option.wordMax} chữ` : null; }

/** Initials without Vietnamese marks: "Giới thiệu job" → GTJ (same as public.content_initials). */
export function suggestAbbr(label: string) {
  const plain = label.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/đ/giu, "d").toLowerCase();
  return plain.split(/[^a-z0-9]+/u).filter(Boolean).map((word) => word[0]).join("").toUpperCase().slice(0, 8);
}

/** Code for a new option, from its abbr or label: "Account Manager" → ACCOUNT_MANAGER. */
export function codeFromLabel(label: string, abbr: string | null) {
  const plain = label.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/đ/giu, "d").toUpperCase().replace(/[^A-Z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  const code = (abbr || plain || "X").slice(0, 20);
  return /^[A-Z]/u.test(code) ? code : `X${code}`.slice(0, 20);
}

/** What a new content's code will start with (the database adds _01, _02…): 261019_REC_DCT_GT_VI. */
export function contentCodePrefix(input: { date: Date; department: string; format: string; categoryAbbr: string | null; language: string }, settings: ContentSettings) {
  const vietnam = new Date(input.date.getTime() + 7 * 3600_000).toISOString();
  const day = `${vietnam.slice(2, 4)}${vietnam.slice(5, 7)}${vietnam.slice(8, 10)}`;
  const abbr = (list: ContentOption[], code: string) => findOption(list, code)?.abbr ?? code.replace(/[^A-Z0-9]/gu, "").slice(0, 8);
  return [day, abbr(settings.departments, input.department), abbr(settings.formats, input.format), input.categoryAbbr || "CHUNG", abbr(settings.languages, input.language)].join("_");
}

const abbrSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/u, "Mã viết tắt: 1–8 chữ in hoa hoặc số, không dấu");
const optionalAbbr = z.string().trim().toUpperCase().transform((value) => value || null).pipe(abbrSchema.nullable());
const guideSchema = z.string().trim().max(1000, "Tối đa 1000 ký tự").transform((value) => value || null);

export const contentOptionInputSchema = z.object({
  kind: z.enum(OPTION_KINDS),
  /** Empty for a new entry. */
  code: z.string().trim().regex(/^([A-Z][A-Z0-9_]{0,19})?$/u, "Mã không hợp lệ"),
  label: z.string().trim().min(1, "Nhập tên").max(60, "Tối đa 60 ký tự"),
  abbr: optionalAbbr,
  active: z.boolean(),
  wordMin: z.coerce.number().int().min(1).max(2000).nullable(),
  wordMax: z.coerce.number().int().min(1).max(3000).nullable(),
  guide: guideSchema,
}).superRefine((value, context) => {
  if (value.kind !== "STYLE" && !value.abbr) context.addIssue({ code: "custom", path: ["abbr"], message: "Nhập mã viết tắt" });
  if (value.kind === "FORMAT") {
    if (!value.wordMin || !value.wordMax) context.addIssue({ code: "custom", path: ["wordMin"], message: "Nhập số chữ tối thiểu và tối đa" });
    else if (value.wordMax < value.wordMin) context.addIssue({ code: "custom", path: ["wordMax"], message: "Tối đa phải lớn hơn tối thiểu" });
  }
});
export type ContentOptionInput = z.infer<typeof contentOptionInputSchema>;

export const categoryInputSchema = z.object({
  id: z.string().trim().regex(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/iu, "Phân loại không hợp lệ"),
  department: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,19}$/u, "Bộ phận không hợp lệ"),
  name: z.string().trim().min(1, "Nhập tên phân loại").max(60, "Tối đa 60 ký tự"),
  abbr: abbrSchema,
  active: z.boolean(),
  guide: guideSchema,
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;
