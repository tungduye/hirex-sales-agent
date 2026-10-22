import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";

/** Phiên bản AI the Suối Nguồn menu can pick: the workspace's enabled bots, and which bot each of my nicks uses. */
export async function GET() {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.permissions.includes("inbox.view")) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const db = createPrivilegedClient();
  const accessible = await getAccessibleChannelAccountIds();
  let bindingQuery = db.from("ai_recruiter_channel_bindings").select("bot_id,channel_account_id").eq("workspace_id", account.workspaceId).eq("enabled", true);
  if (accessible) bindingQuery = bindingQuery.in("channel_account_id", accessible.length ? accessible : ["00000000-0000-0000-0000-000000000000"]);
  const [{ data: bots, error }, { data: bindings }] = await Promise.all([
    db.from("ai_recruiter_bots").select("id,name,bot_type").eq("workspace_id", account.workspaceId).eq("enabled", true).order("name"),
    bindingQuery,
  ]);
  if (error) return Response.json({ error: "Chưa tải được phiên bản AI." }, { status: 500 });
  return Response.json({
    bots: (bots ?? []).map((bot) => ({ id: String(bot.id), name: String(bot.name), botType: String(bot.bot_type) })),
    bindings: Object.fromEntries((bindings ?? []).map((row) => [String(row.channel_account_id), String(row.bot_id)])),
  }, { headers: { "Cache-Control": "private, max-age=60" } });
}
