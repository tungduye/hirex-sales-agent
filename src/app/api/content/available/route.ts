import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/modules/access/server/access-control";
import { CONTENT_DEPARTMENTS, CONTENT_FORMATS, CONTENT_LANGUAGES } from "@/modules/content/core/content-options";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pick = (value: string | null, allowed: readonly { value: string }[]) => value && allowed.some((item) => item.value === value) ? value : null;

/** Unused library content matching the labels, plus the categories, for the campaign content picker. */
export async function GET(request: Request) {
  const account = await getAccountContext();
  if (!account?.workspaceId || !await hasPermission("content.view")) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.get("limit") ?? "20", 10) || 20));
  const category = query.get("cat");
  const supabase = await createClient();
  const [items, categories] = await Promise.all([
    supabase.rpc("get_available_content_items", {
      p_format: pick(query.get("format"), CONTENT_FORMATS),
      p_department: pick(query.get("dept"), CONTENT_DEPARTMENTS),
      p_category_id: category && UUID.test(category) ? category : null,
      p_language: pick(query.get("lang"), CONTENT_LANGUAGES),
      p_limit: limit,
    }),
    supabase.from("content_categories").select("id, department, name, active, sort").eq("workspace_id", account.workspaceId).order("sort"),
  ]);
  if (items.error) return Response.json({ error: "UNAVAILABLE" }, { status: 500 });
  return Response.json({ items: items.data ?? [], categories: categories.data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}
