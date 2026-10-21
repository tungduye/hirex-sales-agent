import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
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
  /** "Đã đăng ở…" marks, newest first. */
  posts: Array<{ id: string; channel: string; place: string; postedAt: string; postedByName: string | null }>;
  copyCount: number;
  /** Made for a job of Bảng Job that is no longer open. */
  jobClosed: boolean;
}

export interface ListContentResult {
  items: ContentListItem[];
  /** The signed-in user's batches from the last 24 hours, newest first. */
  batches: ContentBatchSummary[];
  total: number;
  libraryTotal: number;
  /** Every item matching the search and language (bộ phận / phân loại / định dạng only), for the folder tree counts. */
  treeEntries: Array<{ department: string; categoryId: string | null; format: string | null }>;
  query: ContentListQuery;
  error: string | null;
}

interface BatchRow {
  id: string; job_title: string; quantity: number; status: string; saved_count: number; rejected_count: number; error_code: string | null; created_at: string;
}

interface ContentRow {
  id: string; code: string; title: string; body: string; job_title: string; content_language: string; content_format: string;
  department: string; category_id: string | null; style: string; max_similarity: number | string; created_at: string; created_by: string; template_id: string | null;
  job_id: string | null; copy_count: number;
}

export async function listContent(raw: Record<string, string | string[] | undefined> = {}): Promise<ListContentResult> {
  const query = normalizeContentListQuery(raw);
  const account = await getAccountContext();
  if (!account?.workspaceId) return { items: [], batches: [], total: 0, libraryTotal: 0, treeEntries: [], query, error: null };

  const supabase = await createClient();
  let itemsQuery = supabase
    .from("content_items")
    .select("id, code, title, body, job_title, content_language, content_format, department, category_id, style, max_similarity, created_at, created_by, template_id, job_id, copy_count", { count: "exact" })
    .eq("workspace_id", account.workspaceId);
  const pattern = contentSearchPattern(query.q);
  if (pattern) itemsQuery = itemsQuery.or(["code", "title", "job_title", "body"].map((column) => `${column}.ilike.${pattern}`).join(","));
  if (query.language !== "ALL") itemsQuery = itemsQuery.eq("content_language", query.language);
  if (query.format !== "ALL") itemsQuery = itemsQuery.eq("content_format", query.format);
  if (query.department !== "ALL") itemsQuery = itemsQuery.eq("department", query.department);
  if (query.category === "NONE") itemsQuery = itemsQuery.is("category_id", null);
  else if (query.category !== "ALL") itemsQuery = itemsQuery.eq("category_id", query.category);
  let treeQuery = supabase.from("content_items").select("department, category_id, content_format").eq("workspace_id", account.workspaceId);
  if (pattern) treeQuery = treeQuery.or(["code", "title", "job_title", "body"].map((column) => `${column}.ilike.${pattern}`).join(","));
  if (query.language !== "ALL") treeQuery = treeQuery.eq("content_language", query.language);
  const from = (query.page - 1) * query.pageSize;

  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [itemsResult, totalResult, batchesResult, treeResult] = await Promise.all([
    itemsQuery.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, from + query.pageSize - 1),
    supabase.from("content_items").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId),
    supabase.from("content_batches").select("id, job_title, quantity, status, saved_count, rejected_count, error_code, created_at")
      .eq("workspace_id", account.workspaceId).eq("created_by", account.userId).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(5),
    treeQuery.limit(20000),
  ]);
  if (itemsResult.error) return { items: [], batches: [], total: 0, libraryTotal: 0, treeEntries: [], query, error: "Không tải được kho content. Vui lòng thử lại." };
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
  const rowIds = rows.map((row) => row.id);
  const jobIds = [...new Set(rows.flatMap((row) => row.job_id ? [row.job_id] : []))];
  const templateIds = [...new Set(rows.flatMap((row) => row.template_id ? [row.template_id] : []))];
  // The lookups for the shown items are independent: run them together (they used to run one after another).
  const [creators, usages, postRows, jobs, templates] = await Promise.all([
    creatorIds.length ? supabase.from("profiles").select("id, full_name").in("id", creatorIds) : Promise.resolve({ data: [] }),
    rowIds.length ? supabase.from("content_item_usages").select("content_item_id").in("content_item_id", rowIds) : Promise.resolve({ data: [] }),
    rowIds.length ? supabase.from("content_item_posts").select("id, content_item_id, channel, place, posted_at, posted_by").eq("workspace_id", account.workspaceId)
      .in("content_item_id", rowIds).order("posted_at", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
    // Job status needs no jobs.view: only whether the job is still open.
    jobIds.length ? createPrivilegedClient().from("recruitment_jobs").select("id, status").eq("workspace_id", account.workspaceId).in("id", jobIds) : Promise.resolve({ data: [] }),
    templateIds.length ? supabase.from("content_templates").select("id, code").in("id", templateIds) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map<string, string>();
  for (const profile of (creators.data ?? []) as { id: string; full_name: string | null }[]) if (profile.full_name) names.set(profile.id, profile.full_name);
  const usedIds = new Set(((usages.data ?? []) as { content_item_id: string }[]).map((usage) => usage.content_item_id));
  const postList = (postRows.data ?? []) as Array<{ id: string; content_item_id: string; channel: string; place: string; posted_at: string; posted_by: string | null }>;
  const posterIds = [...new Set(postList.flatMap((post) => typeof post.posted_by === "string" && !names.has(post.posted_by) ? [post.posted_by] : []))];
  if (posterIds.length) {
    const { data: people } = await supabase.from("profiles").select("id, full_name").in("id", posterIds);
    for (const profile of (people ?? []) as { id: string; full_name: string | null }[]) if (profile.full_name) names.set(profile.id, profile.full_name);
  }
  const posts = new Map<string, ContentListItem["posts"]>();
  for (const post of postList) {
    posts.set(post.content_item_id, [...(posts.get(post.content_item_id) ?? []), { id: post.id, channel: post.channel, place: post.place, postedAt: post.posted_at, postedByName: post.posted_by ? names.get(post.posted_by) ?? null : null }]);
  }
  const closedJobs = new Set(((jobs.data ?? []) as { id: string; status: string }[]).filter((job) => job.status !== "OPEN").map((job) => job.id));
  const templateCodes = new Map(((templates.data ?? []) as { id: string; code: string }[]).map((template) => [template.id, template.code]));

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
      posts: posts.get(row.id) ?? [],
      copyCount: Number(row.copy_count ?? 0),
      jobClosed: Boolean(row.job_id && closedJobs.has(row.job_id)),
    })),
    batches,
    total: itemsResult.count ?? rows.length,
    libraryTotal: totalResult.count ?? itemsResult.count ?? rows.length,
    treeEntries: ((treeResult.data ?? []) as Array<{ department: string; category_id: string | null; content_format: string | null }>).map((row) => ({ department: row.department, categoryId: row.category_id, format: row.content_format })),
    query,
    error: null,
  };
}
