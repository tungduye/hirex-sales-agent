"use server";

import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { canAccessChannelAccount, hasPermission, isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { draftReply } from "@/modules/assistant/server/reply-engine";
import { assistantModel } from "@/modules/assistant/server/run-assistant-request";
import type { RecFlowState } from "@/modules/rec-flow/core/rec-flow";
import { draftRecReply } from "@/modules/rec-flow/server/rec-draft";
import { flowConversation } from "@/modules/rec-flow/server/rec-flow-store";

// "Hole" button in the Suối Nguồn composer: a careful draft from the shared reply engine. Same checks as
// "Hola" (reply permission + access to the conversation's account). Not counted in the Trợ lý daily
// limit; a short per-member burst limit keeps double clicks and loops from running up cost.

export interface HoleDraftResult { draftText: string | null; message: string; /** Rec flow state to save once the draft is sent (one-to-one candidate chats). */ flow?: RecFlowState }
const schema = z.object({ conversationId: z.string().uuid(), instruction: z.string().max(1000).refine((value) => !value.includes("\u0000")) });
const recent = new Map<string, number[]>();
const PER_MINUTE = 6;

export async function generateHoleDraft(input: { conversationId: string; instruction: string }): Promise<HoleDraftResult> {
  const parsed = schema.safeParse(input);
  const account = await getAccountContext();
  if (!parsed.success || !account?.workspaceId || !account.configurationComplete) return { draftText: null, message: "Hole chưa soạn được nháp." };
  if (!await hasPermission("inbox.reply")) return { draftText: null, message: "Bạn không có quyền soạn trả lời cho hội thoại." };
  const { data: conversation } = await createPrivilegedClient().from("omnichannel_conversations").select("channel_account_id").eq("id", parsed.data.conversationId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (!conversation || !await canAccessChannelAccount(conversation.channel_account_id)) return { draftText: null, message: "Bạn không có quyền truy cập hội thoại này." };
  const apiKey = process.env.OPENAI_API_KEY;
  const model = assistantModel();
  if (!apiKey || !model) return { draftText: null, message: "Hole chưa được cấu hình." };

  const key = `${account.workspaceId}:${account.userId}`;
  const now = Date.now();
  const calls = (recent.get(key) ?? []).filter((at) => now - at < 60_000);
  if (calls.length >= PER_MINUTE) return { draftText: null, message: "Hole đang bận, thử lại sau ít giây nhé." };
  recent.set(key, [...calls, now]);

  try {
    // One-to-one Zalo/Facebook chat with a candidate: Hole works the Rec flow freely, pulling toward the CV.
    const flowScope = await flowConversation(parsed.data.conversationId, "inbox.reply");
    if (flowScope) {
      const flowResult = await draftRecReply({ scope: flowScope, instruction: parsed.data.instruction, mode: "hole", apiKey, model });
      return flowResult.ok ? { draftText: flowResult.draft, message: "Hole đã soạn nháp, sửa lại rồi bấm Gửi.", flow: flowResult.flow } : { draftText: null, message: flowResult.message };
    }
    const result = await draftReply({
      conversationId: parsed.data.conversationId, instruction: parsed.data.instruction,
      context: { workspaceId: account.workspaceId, userId: account.userId, permissions: account.permissions, isAdmin: await isWorkspaceAdmin() },
      staffName: account.fullName, apiKey, model,
    });
    return result.ok ? { draftText: result.text, message: "Hole đã soạn nháp, sửa lại rồi bấm Gửi." } : { draftText: null, message: result.message };
  } catch (error) {
    console.error("[hole] draft failed", error instanceof Error ? error.message.slice(0, 60) : "UNKNOWN");
    return { draftText: null, message: "Hole chưa kết nối được AI, thử lại sau." };
  }
}
