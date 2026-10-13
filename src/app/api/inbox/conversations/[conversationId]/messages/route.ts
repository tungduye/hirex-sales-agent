import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { canAccessChannelAccount } from "@/modules/access/server/access-control";
import type { ChannelType } from "@/modules/channels/core/channel-contracts";
import type { OmnichannelInboxMessage } from "@/modules/inbox/types/omnichannel-inbox";

const PAGE_SIZE = 40;

export async function GET(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await context.params;
  const url = new URL(request.url);
  let before = url.searchParams.get("before");
  const anchor = url.searchParams.get("anchor");
  if (!z.uuid().safeParse(conversationId).success || (!before && !z.uuid().safeParse(anchor).success)) return Response.json({ error: "INVALID_CURSOR" }, { status: 400 });
  const account = await getAccountContext();
  if (!account?.workspaceId) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const supabase = await createClient();
  const { data: conversation } = await supabase.from("omnichannel_conversations").select("channel_account_id,channel_type")
    .eq("workspace_id", account.workspaceId).eq("id", conversationId).maybeSingle();
  if (!conversation || !await canAccessChannelAccount(conversation.channel_account_id)) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const privileged = createPrivilegedClient();
  let offset = 0;
  if (!before && anchor) {
    const { data: anchorRow } = await privileged.from("omnichannel_messages").select("created_at")
      .eq("workspace_id", account.workspaceId).eq("conversation_id", conversationId).eq("id", anchor).maybeSingle();
    before = anchorRow?.created_at ?? new Date().toISOString();
    // The anchor itself is excluded below, so skip the other 39 messages that
    // were included in the initial 40-message server render.
    offset = PAGE_SIZE - 1;
  }
  if (!before || !Number.isFinite(Date.parse(before))) return Response.json({ error: "INVALID_CURSOR" }, { status: 400 });
  const startedAt = performance.now();
  const { data, error } = await privileged.from("omnichannel_messages")
    .select("id,conversation_id,channel_type,direction,sender_external_id,text_content,provider_message_id,attachment_count,received_at,sent_at,created_at")
    .eq("workspace_id", account.workspaceId).eq("conversation_id", conversationId).lt("created_at", before)
    .order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE);
  const durationMs = Math.round(performance.now() - startedAt);
  if (durationMs > 250) console.warn("[slow-query] older inbox messages", { durationMs, conversationId, pageSize: PAGE_SIZE });
  if (error) return Response.json({ error: "LOAD_FAILED" }, { status: 500 });
  const rows = data ?? [];
  const pageRows = rows.slice(0, PAGE_SIZE);
  const messages: OmnichannelInboxMessage[] = pageRows.reverse().map((row) => ({
    id: row.id, conversationId: row.conversation_id, channelType: row.channel_type as ChannelType, direction: row.direction as "INBOUND" | "OUTBOUND",
    senderExternalId: row.sender_external_id, text: row.text_content, timestamp: row.received_at ?? row.sent_at ?? row.created_at,
    providerMessageId: row.provider_message_id, attachmentCount: row.attachment_count, attachments: [],
    deliveryStatus: row.direction === "OUTBOUND" ? "SENT" : "RECEIVED",
  }));
  return Response.json({ messages, hasMore: rows.length > PAGE_SIZE, nextBefore: pageRows.at(0)?.created_at ?? null });
}
