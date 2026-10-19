import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { DEFAULT_CONTENT_SETTINGS, mergeContentSettings, type ContentSettings, type OptionRow } from "@/modules/content/core/content-settings";

/** The workspace's Bộ phận / Định dạng / Ngôn ngữ / Phong cách (built-ins + its own rows). */
export async function loadContentSettings(): Promise<ContentSettings> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return DEFAULT_CONTENT_SETTINGS;
  const { data, error } = await (await createClient()).from("content_options")
    .select("kind, code, label, abbr, sort, active, word_min, word_max, guide").eq("workspace_id", account.workspaceId).limit(500);
  return error ? DEFAULT_CONTENT_SETTINGS : mergeContentSettings((data ?? []) as OptionRow[]);
}
