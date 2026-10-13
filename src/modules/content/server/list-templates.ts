import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { mapTemplateRow, TEMPLATE_COLUMNS, type ContentTemplate, type TemplateRow } from "@/modules/content/server/template-row";

/** Every template of the workspace (a few hundred at most), most useful first. */
export async function listTemplates({ activeOnly = false }: { activeOnly?: boolean } = {}): Promise<{ templates: ContentTemplate[]; error: string | null }> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return { templates: [], error: null };
  const supabase = await createClient();
  let query = supabase.from("content_templates").select(TEMPLATE_COLUMNS).eq("workspace_id", account.workspaceId);
  if (activeOnly) query = query.eq("active", true);
  const { data, error } = await query.order("department").order("weight", { ascending: false }).order("code").limit(1000);
  if (error) return { templates: [], error: "Không tải được kho mẫu. Vui lòng thử lại." };
  return { templates: ((data ?? []) as TemplateRow[]).map(mapTemplateRow), error: null };
}
