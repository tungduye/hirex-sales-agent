import "server-only";

import type { createPrivilegedClient } from "@/lib/supabase/privileged";
import { conversationTitle } from "@/modules/assistant/core/assistant-conversation";

type Db = ReturnType<typeof createPrivilegedClient>;

/**
 * Saves one question and its answer. A missing or foreign conversationId starts a new conversation named
 * after the question. Never throws: saving must not cost the member their answer.
 */
export async function saveAssistantTurn(db: Db, input: { workspaceId: string; userId: string; conversationId: string | null; question: string; answer: string; toolsUsed: string[]; actionIds: string[]; isError: boolean }): Promise<{ conversationId: string; title: string } | null> {
  try {
    let conversation: { id: string; title: string } | null = null;
    if (input.conversationId) {
      const { data } = await db.from("assistant_conversations").select("id,title").eq("id", input.conversationId).eq("workspace_id", input.workspaceId).eq("user_id", input.userId).maybeSingle();
      conversation = data ? { id: data.id as string, title: data.title as string } : null;
    }
    if (!conversation) {
      const { data, error } = await db.from("assistant_conversations").insert({ workspace_id: input.workspaceId, user_id: input.userId, title: conversationTitle(input.question) }).select("id,title").single();
      if (error || !data) return null;
      conversation = { id: data.id as string, title: data.title as string };
    }
    const base = { workspace_id: input.workspaceId, conversation_id: conversation.id, user_id: input.userId };
    await db.from("assistant_messages").insert({ ...base, role: "user", content: input.question.slice(0, 20000) });
    await db.from("assistant_messages").insert({ ...base, role: "assistant", content: input.answer.slice(0, 20000), tools_used: input.toolsUsed.slice(0, 30), action_ids: input.actionIds.slice(0, 20), is_error: input.isError });
    await db.from("assistant_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversation.id);
    return { conversationId: conversation.id, title: conversation.title };
  } catch {
    return null;
  }
}
