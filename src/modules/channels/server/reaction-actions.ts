"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { canAccessChannelAccount, hasPermission } from "@/modules/access/server/access-control";
import { ZaloBridgeAdapter } from "../adapters/zalo/zalo-bridge-adapter";
import { QUICK_REACTIONS } from "../core/zalo-reactions";
import { loadChannelAdapterByAccountId } from "./load-channel-adapter";

const input = z.object({
  conversationId: z.string().uuid(),
  providerMessageId: z.string().regex(/^[1-9][0-9]{0,39}$/u),
  icon: z.enum(QUICK_REACTIONS.map((item) => item.icon) as [string, ...string[]]),
});

/** React to one Zalo message as the conversation's nick. Same rights as replying in that conversation. */
export async function reactToZaloMessage(raw: { conversationId: string; providerMessageId: string; icon: string }): Promise<{ ok: boolean; message?: string }> {
  const parsed = input.safeParse(raw);
  const account = await getAccountContext();
  if (!parsed.success || !account?.configurationComplete || !account.workspaceId) return { ok: false, message: "Không thể thả cảm xúc." };
  if (!await hasPermission("inbox.reply")) return { ok: false, message: "Tài khoản của bạn không có quyền trả lời hội thoại." };
  const client = createPrivilegedClient();
  const { data: conversation } = await client.from("omnichannel_conversations").select("id,channel_account_id,channel_type,provider_conversation_id")
    .eq("id", parsed.data.conversationId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (!conversation || conversation.channel_type !== "ZALO" || !await canAccessChannelAccount(conversation.channel_account_id))
    return { ok: false, message: "Bạn chưa được cấp quyền sử dụng nick Zalo của hội thoại này." };
  // Only a message of this very conversation (received, or sent from HireX).
  const [received, sent] = await Promise.all([
    client.from("omnichannel_messages").select("id").eq("workspace_id", account.workspaceId).eq("conversation_id", conversation.id)
      .eq("provider_message_id", parsed.data.providerMessageId).limit(1),
    client.from("channel_outbound_actions").select("id").eq("workspace_id", account.workspaceId).eq("conversation_id", conversation.id)
      .eq("provider_message_id", parsed.data.providerMessageId).eq("status", "SENT").limit(1),
  ]);
  if (!(received.data?.length || sent.data?.length)) return { ok: false, message: "Không tìm thấy tin nhắn này." };
  const { data: isGroup, error: groupError } = await client.rpc("is_zalo_group_conversation", { p_conversation_id: conversation.id });
  if (groupError) return { ok: false, message: "Không thể thả cảm xúc lúc này." };
  try {
    const loaded = await loadChannelAdapterByAccountId(conversation.channel_account_id);
    if (!(loaded.adapter instanceof ZaloBridgeAdapter)) return { ok: false, message: "Nick Zalo này chưa hỗ trợ thả cảm xúc." };
    const ok = await loaded.adapter.addReaction({ threadId: conversation.provider_conversation_id, threadType: isGroup === true ? "GROUP" : "USER",
      messageId: parsed.data.providerMessageId, icon: parsed.data.icon }, randomUUID());
    return ok ? { ok: true } : { ok: false, message: "Zalo chưa nhận cảm xúc này, thử lại sau." };
  } catch {
    return { ok: false, message: "Không kết nối được nick Zalo, thử lại sau." };
  }
}
