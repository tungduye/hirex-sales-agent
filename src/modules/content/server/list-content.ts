import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { ContentBatchSummary } from "@/modules/content/core/batch-status";
import { contentSearchPattern, normalizeContentListQuery, type ContentListQuery } from "@/modules/content/core/content-list-query";

export interface ContentListItem {
  id: string;
  code: string;
  title: string;
  body: string;
  jobTitle: string;
  language: string;
  format: string;
  department: string;
  categoryId: string | null;
  style: string;
  maxSimilarity: number;
  createdAt: string;
  createdByName: string | null;
  /** Code of the sample template this content was written from. */
  templateCode: string | null;
  /** Already used by a campaign (each content serves one campaign). */
  used: boolean;
}

export interface ListContentResult {
  items: ContentListItem[];
  /** The signed-in user's batches from the last 24 hours, newest first. */
  batches: ContentBatchSummary[];
  total: number;
  libraryTotal: number;
  query: ContentListQuery;
  error: string | null;
}

interface BatchRow {
  id: string; job_title: string; quantity: number; status: string; saved_count: number; rejected_count: number; error_code: string | null; created_at: string;
}

interface ContentRow {
  id: string; code: string; title: string; body: string; job_title: string; content_language: string; content_format: string;
  department: string; category_id: string | null; style: string; max_similarity: number | string; created_at: string; created_by: string; template_id: string | null;
}

export async function listContent(raw: Record<string, string | string[] | undefined> = {}): Promise<ListContentResult> {
  const query = normalizeContentListQuery(raw);
  const account = await getAccountContext();
  if (!account?.workspaceId) return { items: [], batches: [], total: 0, libraryTotal: 0, query, error: null };

  const supabase = await createClient();
  let itemsQuery = supabase
    .from("content_items")
    .select("id, code, title, body, job_title, content_language, content_format, department, category_id, style, max_similarity, created_at, created_by, template_id", { count: "exact" })
    .eq("workspace_id", account.workspaceId);
  const pattern = contentSearchPattern(query.q);
  if (pattern) itemsQuery = itemsQuery.or(["code", "title", "job_title", "body"].map((column) => `${column}.ilike.${pattern}`).join(","));
  if (query.language !== "ALL") itemsQuery = itemsQuery.eq("content_language", query.language);
  if (query.format !== "ALL") itemsQuery = itemsQuery.eq("content_format", query.format);
  if (query.department !== "ALL") itemsQuery = itemsQuery.eq("department", query.department);
  if (query.category !== "ALL") itemsQuery = itemsQuery.eq("category_id", query.category);
  const from = (query.page - 1) * query.pageSize;

  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [itemsResult, totalResult, batchesResult] = await Promise.all([
    itemsQuery.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, from + query.pageSize - 1),
    supabase.from("content_items").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId),
    supabase.from("content_batches").select("id, job_title, quantity, status, saved_count, rejected_count, error_code, created_at")
      .eq("workspace_id", account.workspaceId).eq("created_by", account.userId).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(5),
  ]);
  if (itemsResult.error) return { items: [], batches: [], total: 0, libraryTotal: 0, query, error: "Không tải được kho content. Vui lòng thử lại." };
  const batches = ((batchesResult.data ?? []) as BatchRow[]).map((row) => ({
    id: row.id,
    jobTitle: row.job_title,
    quantity: row.quantity,
    status: row.status,
    savedCount: row.saved_count,
    rejectedCount: row.rejected_count,
    errorCode: row.error_code,
    createdAt: row.created_at,
  }));

  const rows = itemsResult.data as ContentRow[];
  const creatorIds = [...new Set(rows.map((row) => row.created_by))];
  const names = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", creatorIds);
    for (const profile of (data ?? []) as { id: string; full_name: string | null }[]) if (profile.full_name) names.set(profile.id, profile.full_name);
  }

  const usedIds = new Set<string>();
  if (rows.length > 0) {
    const { data } = await supabase.from("content_item_usages").select("content_item_id").in("content_item_id", rows.map((row) => row.id));
    for (const usage of (data ?? []) as { content_item_id: string }[]) usedIds.add(usage.content_item_id);
  }

  const templateIds = [...new Set(rows.flatMap((row) => row.template_id ? [row.template_id] : []))];
  const templateCodes = new Map<string, string>();
  if (templateIds.length > 0) {
    const { data } = await supabase.from("content_templates").select("id, code").in("id", templateIds);
    for (const template of (data ?? []) as { id: string; code: string }[]) templateCodes.set(template.id, template.code);
  }

  return {
    items: rows.map((row) => ({
      id: row.id,
      code: row.code,
      title: row.title,
      body: row.body,
      jobTitle: row.job_title,
      language: row.content_language,
      format: row.content_format,
      department: row.department,
      categoryId: row.category_id,
      style: row.style,
      maxSimilarity: Number(row.max_similarity),
      createdAt: row.created_at,
      createdByName: names.get(row.created_by) ?? null,
      templateCode: row.template_id ? templateCodes.get(row.template_id) ?? null : null,
      used: usedIds.has(row.id),
    })),
    batches,
    total: itemsResult.count ?? rows.length,
    libraryTotal: totalResult.count ?? itemsResult.count ?? rows.length,
    query,
    error: null,
  };
}
