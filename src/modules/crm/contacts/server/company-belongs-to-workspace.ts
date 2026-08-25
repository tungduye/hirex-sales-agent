import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export async function companyBelongsToWorkspace(
  supabase: SupabaseClient,
  companyId: string,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  return !error && Boolean(data);
}
