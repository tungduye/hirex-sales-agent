// Choosing sample templates for a batch, title prefix and blocked-term rules.
// Ported from Content Factory V1.9.1 / Content Engine V2.0.4 (n8n + Google Sheets). Pure; unit-tested.
import type { ContentDepartment, ContentLanguage } from "./content-options.ts";

export interface TemplateSample {
  id: string;
  code: string;
  department: string;
  language: string;
  groupName: string | null;
  tone: string | null;
  cta: string | null;
  body: string;
  weight: number;
  active: boolean;
  /** "Định dạng" of the sample (templates written before migration 081 default to POST_LONG). */
  format?: string;
  /** "Phân loại" of the sample. */
  categoryId?: string | null;
}

function hash(text: string) {
  let value = 0;
  for (const char of text) { value = ((value << 5) - value) + char.charCodeAt(0); value |= 0; }
  return Math.abs(value);
}

function languageScore(template: string, content: ContentLanguage) {
  if (template === content) return 2;
  const parts = new Set(content.split("_"));
  return template.split("_").some((part) => parts.has(part)) ? 1 : 0;
}

/**
 * Templates for this batch. Chosen templates are used as given (in the order picked). Otherwise
 * the active templates of the department are ranked by language fit and weight, with a per-job
 * rotation among equals so two jobs do not always get the same samples.
 */
export function pickTemplates({ chosen, candidates, department, language, quantity, seed, format, categoryId }: {
  chosen: TemplateSample[];
  candidates: TemplateSample[];
  department: ContentDepartment;
  language: ContentLanguage;
  quantity: number;
  seed: string;
  /** Prefer samples of this format and category ("Phân loại") when given. */
  format?: string;
  categoryId?: string | null;
}): TemplateSample[] {
  if (chosen.length > 0) return chosen;
  const salt = hash(seed);
  const fit = (template: TemplateSample) => (categoryId && template.categoryId === categoryId ? 2 : 0) + (format && (template.format ?? "POST_LONG") === format ? 1 : 0);
  return candidates
    .filter((template) => template.active && template.department === department)
    .map((template) => ({ template, order: [fit(template), languageScore(template.language, language), template.weight, hash(`${salt}:${template.code}`)] }))
    .sort((a, b) => b.order[0] - a.order[0] || b.order[1] - a.order[1] || b.order[2] - a.order[2] || a.order[3] - b.order[3])
    .slice(0, Math.min(quantity, 10))
    .map((entry) => entry.template);
}

/**
 * Template per item. Round-robin, so consecutive items use different templates (any N in a row
 * differ when N templates are available); rewrite rounds start further along the list.
 */
export function assignTemplates<T>(templates: T[], count: number, round: number): (T | null)[] {
  if (templates.length === 0) return Array.from({ length: count }, () => null);
  return Array.from({ length: count }, (_, index) => templates[(round * count + index) % templates.length]);
}

const LOCATION_LABELS: { pattern: RegExp; label: string }[] = [
  { pattern: /(hà nội|ha noi|hanoi)/i, label: "Hà Nội" },
  { pattern: /(hồ chí minh|ho chi minh|\bhcm\b|tp\.?\s*hcm|tphcm|sài gòn|sai gon)/i, label: "HCM" },
  { pattern: /(đà nẵng|da nang|danang)/i, label: "Đà Nẵng" },
  { pattern: /(tokyo|東京)/i, label: "Tokyo" },
  { pattern: /(osaka|大阪)/i, label: "Osaka" },
  { pattern: /(nagoya|名古屋)/i, label: "Nagoya" },
  { pattern: /(fukuoka|福岡)/i, label: "Fukuoka" },
];

/** Short place name for the title prefix, e.g. "Cầu Giấy, Hà Nội" → "Hà Nội". Null when unknown. */
export function titleLocation(location: string | null): string | null {
  const text = (location ?? "").replace(/^\[|\]$/g, "").trim();
  if (!text) return null;
  for (const { pattern, label } of LOCATION_LABELS) if (pattern.test(text)) return label;
  if (text.length <= 28 && !text.includes(",")) return text;
  const tail = text.split(",").map((part) => part.trim()).filter(Boolean).pop() ?? "";
  return tail && tail.length <= 28 ? tail : null;
}

/** Rec, HR and Sale posts start with "[Địa điểm]" when a location is known; CTV, Truyền thông and Thông báo titles are free. */
export function titlePrefixFor(department: ContentDepartment, location: string | null): string | null {
  if (department === "CTV" || department === "MEDIA" || department === "NOTICE") return null;
  const place = titleLocation(location);
  return place ? `[${place}]` : null;
}

export function applyTitlePrefix(title: string, prefix: string | null): string {
  const trimmed = title.trim();
  if (!prefix || trimmed.startsWith(prefix)) return trimmed;
  return `${prefix} ${trimmed.replace(/^\[[^\]]{1,40}\]\s*/, "")}`.trim();
}

export function parseBlockedTerms(text: string | null): string[] {
  return [...new Set((text ?? "").split(/[;,\n]/).map((term) => term.trim()).filter((term) => term.length >= 2))];
}

/** First blocked term (client name, website…) that appears in the text, case-insensitively. */
export function findBlockedTerm(text: string, terms: string[]): string | null {
  const haystack = text.normalize("NFC").toLocaleLowerCase("vi");
  return terms.find((term) => haystack.includes(term.normalize("NFC").toLocaleLowerCase("vi"))) ?? null;
}

// --- Following a template closely ------------------------------------------------------------

export interface TemplateProfile {
  /** First line of the sample when it reads as a headline, else null. */
  title: string | null;
  titleUppercase: boolean;
  /** Characters of the sample without its title line. */
  bodyChars: number;
  paragraphs: number;
  lines: number;
  bulletLines: number;
  bulletMarker: string | null;
  emoji: number;
  /** A one- or two-line teaser rather than a full post. */
  teaser: boolean;
}

const BULLET = /^\s*([-+•*–]|\d+[.)])\s+/;
const EMOJI = /\p{Extended_Pictographic}/gu;

export function templateProfile(sample: string): TemplateProfile {
  const text = sample.replace(/\r\n?/g, "\n").trim();
  const allLines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const firstLine = allLines[0] ?? "";
  const hasTitle = allLines.length >= 2 && firstLine.length <= 140 && !BULLET.test(firstLine);
  const body = hasTitle ? text.slice(text.indexOf(firstLine) + firstLine.length).trim() : text;
  const bodyLines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const bulletLines = bodyLines.filter((line) => BULLET.test(line));
  const letters = (hasTitle ? firstLine : "").replace(/[^\p{L}]/gu, "");
  return {
    title: hasTitle ? firstLine : null,
    titleUppercase: letters.length >= 4 && letters === letters.toLocaleUpperCase("vi"),
    bodyChars: body.length,
    paragraphs: body ? body.split(/\n\s*\n/).filter((part) => part.trim()).length : 0,
    lines: bodyLines.length,
    bulletLines: bulletLines.length,
    bulletMarker: bulletLines[0]?.match(BULLET)?.[1] ?? null,
    emoji: (text.match(EMOJI) ?? []).length,
    teaser: allLines.length <= 2 && text.length <= 220,
  };
}

/** Allowed body length when following a sample: a teaser may be 1–2 lines, a full post 70–135%. */
export function lengthRange(profile: TemplateProfile, languageCount: number): [number, number] {
  if (profile.teaser || profile.bodyChars < 120) return [0, Math.max(400, profile.bodyChars * 3) * languageCount];
  return [Math.round(profile.bodyChars * 0.7 * languageCount), Math.round(profile.bodyChars * 1.35 * languageCount + 60)];
}

function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((value) => value.replace(/[.,]/g, "")).filter((value) => value !== "0" && value !== "1"));
}

/**
 * Numbers (salary, years, N-levels, headcount…) that the draft took from the sample instead of
 * from the brief. A draft with any of them is a fact leak and is not saved.
 */
export function leakedNumbers(draft: string, sample: string, briefText: string): string[] {
  const allowed = numbersIn(briefText);
  const fromSample = numbersIn(sample);
  return [...numbersIn(draft)].filter((value) => fromSample.has(value) && !allowed.has(value));
}
