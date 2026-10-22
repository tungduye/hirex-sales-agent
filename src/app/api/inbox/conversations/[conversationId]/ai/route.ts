import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { canAccessChannelAccount, hasPermission } from "@/modules/access/server/access-control";

const schema = z.object({ enabled: z.boolean(), botId: z.string().uuid().nullable() });

/** Phiên bản AI of one conversation: off (staff take over), or on with the nick's bot (botId null) or a chosen bot. */
export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(conversationId).success) return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 400 });
  const account = await getAccountContext();
  if (!account?.workspaceId) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!await hasPermission("inbox.update")) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const { data: conversation } = await createPrivilegedClient().from("omnichannel_conversations").select("channel_account_id").eq("id", conversationId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (!conversation || !await canAccessChannelAccount(conversation.channel_account_id)) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  const client = await createClient();
  const { data, error } = await client.rpc("set_inbox_conversation_ai", { p_conversation_id: conversationId, p_enabled: parsed.data.enabled, p_bot_id: parsed.data.enabled ? parsed.data.botId : null });
  if (error || data !== true) return Response.json({ error: "Chưa đổi được phiên bản AI." }, { status: 403 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
