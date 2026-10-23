"use server";

import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { canAccessChannelAccount, hasPermission, isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { draftReply } from "@/modules/assistant/server/reply-engine";
import { candidateReplyGuide } from "@/modules/assistant/core/reply-engine-core";
import { assistantModel } from "@/modules/assistant/server/run-assistant-request";
import { FACT_FIELDS, normalizeFlow, offerMissing, REC_STEPS, type RecFlowState } from "@/modules/rec-flow/core/rec-flow";
import { draftRecReply } from "@/modules/rec-flow/server/rec-draft";
import { flowConversation, readFlow } from "@/modules/rec-flow/server/rec-flow-store";

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
    const context = { workspaceId: account.workspaceId, userId: account.userId, permissions: account.permissions, isAdmin: await isWorkspaceAdmin() };
    // One-to-one Zalo/Facebook chat with a candidate: Hole writes with the same engine as Trợ lý HireX (reads the
    // whole chat, looks up real jobs, answers the concern first). The Rec flow is only a hint here; the fast
    // Hola model runs alongside to keep the "Bước x/8" bar and what is known about the candidate up to date.
    const flowScope = await flowConversation(parsed.data.conversationId, "inbox.reply");
    if (flowScope) {
      const { state } = await readFlow(flowScope.db, flowScope.conversation);
      const known = Object.fromEntries(FACT_FIELDS.flatMap((field) => state.facts[field.key] ? [[field.label, state.facts[field.key]]] : []));
      const brief = { instructions: candidateReplyGuide(), tools: ["bang_job"], context: {
        da_biet: known, con_co_the_hoi: offerMissing(state.facts), buoc: REC_STEPS[state.step - 1]?.label ?? null,
        da_gioi_thieu_job: state.offeredJobIds.length, ket_qua: state.outcome,
      } };
      const fastModel = process.env.OPENAI_MODEL;
      const [result, tracked] = await Promise.all([
        draftReply({ conversationId: parsed.data.conversationId, instruction: parsed.data.instruction, context, staffName: account.fullName, apiKey, model, brief }),
        fastModel ? draftRecReply({ scope: flowScope, instruction: "", mode: "hola", apiKey, model: fastModel }).catch(() => null) : Promise.resolve(null),
      ]);
      if (!result.ok) return { draftText: null, message: result.message };
      // Only what the candidate said is taken from the tracker (facts, early steps); offers stay as they were,
      // since Hole's own text decides whether a job was offered.
      const flow = tracked?.ok ? normalizeFlow({ ...state, facts: tracked.flow.facts, step: tracked.flow.step <= 4 ? Math.max(state.step, tracked.flow.step) : state.step }) : undefined;
      return { draftText: result.text, message: "Hole đã soạn nháp, sửa lại rồi bấm Gửi.", flow };
    }
    const result = await draftReply({ conversationId: parsed.data.conversationId, instruction: parsed.data.instruction, context, staffName: account.fullName, apiKey, model });
    return result.ok ? { draftText: result.text, message: "Hole đã soạn nháp, sửa lại rồi bấm Gửi." } : { draftText: null, message: result.message };
  } catch (error) {
    console.error("[hole] draft failed", error instanceof Error ? error.message.slice(0, 60) : "UNKNOWN");
    return { draftText: null, message: "Hole chưa kết nối được AI, thử lại sau." };
  }
}
