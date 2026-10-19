import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { ContentCategory } from "@/modules/content/core/content-category";

/** Every "Phân loại" of the workspace (a short list). */
export async function listCategories(): Promise<ContentCategory[]> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return [];
  const { data } = await (await createClient()).from("content_categories").select("id, department, name, active, sort, abbr, guide")
    .eq("workspace_id", account.workspaceId).order("department").order("sort").order("name").limit(500);
  return ((data ?? []) as ContentCategory[]);
}
