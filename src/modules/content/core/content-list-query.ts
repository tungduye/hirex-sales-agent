// URL state for the content library: ?q=&lang=&format=&page=. Pure, so it can be unit-tested.
import { CONTENT_FORMATS, CONTENT_LANGUAGES, type ContentFormat, type ContentLanguage } from "./content-options.ts";

export const CONTENT_PAGE_SIZE = 30;

export interface ContentListQuery {
  q: string;
  language: ContentLanguage | "ALL";
  format: ContentFormat | "ALL";
  page: number;
  pageSize: number;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeContentListQuery(raw: Record<string, string | string[] | undefined>): ContentListQuery {
  const q = (first(raw.q) ?? "").trim().slice(0, 100);
  const lang = (first(raw.lang) ?? "").toUpperCase();
  const format = (first(raw.format) ?? "").toUpperCase();
  const pageNumber = Number.parseInt(first(raw.page) ?? "1", 10);
  return {
    q,
    language: CONTENT_LANGUAGES.some((item) => item.value === lang) ? (lang as ContentLanguage) : "ALL",
    format: CONTENT_FORMATS.some((item) => item.value === format) ? (format as ContentFormat) : "ALL",
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

export function contentListHref(query: Pick<ContentListQuery, "q" | "language" | "format" | "page">) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.language !== "ALL") params.set("lang", query.language);
  if (query.format !== "ALL") params.set("format", query.format);
  if (query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `/content?${search}` : "/content";
}
