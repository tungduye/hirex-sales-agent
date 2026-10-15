// URL state for the content library: ?q=&lang=&format=&dept=&cat=&page=. Pure, so it can be unit-tested.
import { CONTENT_DEPARTMENTS, CONTENT_FORMATS, CONTENT_LANGUAGES, LEGACY_FORMAT_CODES, type ContentDepartment, type ContentFormat, type ContentLanguage } from "./content-options.ts";

export const CONTENT_PAGE_SIZE = 30;

export interface ContentListQuery {
  q: string;
  language: ContentLanguage | "ALL";
  format: ContentFormat | "ALL";
  department: ContentDepartment | "ALL";
  /** "Phân loại" id, or ALL. */
  category: string | "ALL";
  page: number;
  pageSize: number;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeContentListQuery(raw: Record<string, string | string[] | undefined>): ContentListQuery {
  const q = (first(raw.q) ?? "").trim().slice(0, 100);
  const lang = (first(raw.lang) ?? "").toUpperCase();
  const rawFormat = (first(raw.format) ?? "").toUpperCase();
  const format = LEGACY_FORMAT_CODES[rawFormat] ?? rawFormat;
  const category = (first(raw.cat) ?? "").toLowerCase();
  const department = (first(raw.dept) ?? "").toUpperCase();
  const pageNumber = Number.parseInt(first(raw.page) ?? "1", 10);
  return {
    q,
    language: CONTENT_LANGUAGES.some((item) => item.value === lang) ? (lang as ContentLanguage) : "ALL",
    format: CONTENT_FORMATS.some((item) => item.value === format) ? (format as ContentFormat) : "ALL",
    department: CONTENT_DEPARTMENTS.some((item) => item.value === department) ? (department as ContentDepartment) : "ALL",
    category: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(category) ? category : "ALL",
    page: Number.isFinite(pageNumber) && pageNumber >= 1 ? Math.min(pageNumber, 10_000) : 1,
    pageSize: CONTENT_PAGE_SIZE,
  };
}

/** ILIKE pattern safe for PostgREST `or=` filters (see contact-list-query.ts). Null when empty. */
export function contentSearchPattern(q: string): string | null {
  const cleaned = q.replace(/[,()"\\%_*]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return `*${cleaned.replace(/ /g, "*")}*`;
}

export function contentListHref(query: Pick<ContentListQuery, "q" | "language" | "format" | "department" | "page"> & { category?: string }) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.language !== "ALL") params.set("lang", query.language);
  if (query.format !== "ALL") params.set("format", query.format);
  if (query.department !== "ALL") params.set("dept", query.department);
  if (query.category && query.category !== "ALL") params.set("cat", query.category);
  if (query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `/content?${search}` : "/content";
}
