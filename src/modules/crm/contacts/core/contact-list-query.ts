// URL state for the contacts list: ?q=&status=&page=. Pure, so it can be unit-tested.
import { LEAD_STATUSES, type LeadStatus } from "../../../../types/crm.ts";

export const CONTACT_PAGE_SIZE = 50;

export interface ContactListQuery {
  q: string;
  status: LeadStatus | "ALL";
  page: number;
  pageSize: number;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeContactListQuery(raw: Record<string, string | string[] | undefined>): ContactListQuery {
  const q = (first(raw.q) ?? "").trim().slice(0, 100);
  const statusValue = (first(raw.status) ?? "ALL").toUpperCase();
  const status = (LEAD_STATUSES as readonly string[]).includes(statusValue) ? (statusValue as LeadStatus) : "ALL";
  const pageNumber = Number.parseInt(first(raw.page) ?? "1", 10);
  const page = Number.isFinite(pageNumber) && pageNumber >= 1 ? Math.min(pageNumber, 10_000) : 1;
  return { q, status, page, pageSize: CONTACT_PAGE_SIZE };
}

/**
 * ILIKE pattern for PostgREST `or=` filters. Characters that PostgREST treats as syntax
 * (`,` `(` `)` `"` `\`) and SQL wildcards are replaced by a single-character wildcard, so user
 * input can never change the filter structure. Returns null when there is nothing to search for.
 */
export function contactSearchPattern(q: string): string | null {
  const cleaned = q.replace(/[,()"\\%_*]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return `*${cleaned.replace(/ /g, "*")}*`;
}

export function contactListHref(query: Pick<ContactListQuery, "q" | "status" | "page">) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status !== "ALL") params.set("status", query.status);
  if (query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `/contacts?${search}` : "/contacts";
}

export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}
