import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { enqueueAssistantBotInbound } from "@/modules/assistant/server/zalo-bot";

// Called by scripts/sync-zalo-recent-messages.mjs for messages it saved straight from Zalo (group chats
// arrive this way, not through the webhook), so the Zalo Trợ lý also sees them.
function equal(left: string, right: string) { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
const bodySchema = z.object({ workspaceId: z.string().uuid(), channelAccountId: z.string().uuid(), conversationId: z.string().uuid(), messageId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
  if (!expected || !equal(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const db = createPrivilegedClient();
  const [{ data: message }, { data: conversation }] = await Promise.all([
    db.from("omnichannel_messages").select("text_content,sender_external_id,direction").eq("id", parsed.data.messageId).eq("workspace_id", parsed.data.workspaceId).eq("conversation_id", parsed.data.conversationId).maybeSingle(),
    db.from("omnichannel_conversations").select("provider_conversation_id,metadata").eq("id", parsed.data.conversationId).eq("workspace_id", parsed.data.workspaceId).eq("channel_account_id", parsed.data.channelAccountId).maybeSingle(),
  ]);
  if (!message || !conversation || message.direction !== "INBOUND") return Response.json({ queued: false });
  await enqueueAssistantBotInbound({ workspaceId: parsed.data.workspaceId, channelAccountId: parsed.data.channelAccountId, conversationId: parsed.data.conversationId, messageId: parsed.data.messageId, text: message.text_content as string | null, senderExternalId: String(message.sender_external_id), providerConversationId: String(conversation.provider_conversation_id), conversationMetadata: conversation.metadata });
  return Response.json({ queued: true });
}
