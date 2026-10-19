"use server";

import { z } from "zod";
import { normalizeFlow, type RecFlowState } from "../core/rec-flow";
import { flowConversation, readFlow, writeFlow } from "./rec-flow-store";

const uuid = z.string().uuid();

/** The Rec flow of a one-to-one Zalo/Facebook chat (null when the chat does not use it or the member may not see it). */
export async function loadRecFlow(conversationId: string): Promise<RecFlowState | null> {
  if (!uuid.safeParse(conversationId).success) return null;
  const scope = await flowConversation(conversationId, "inbox.view");
  if (!scope) return null;
  return (await readFlow(scope.db, scope.conversation)).state;
}

/** Saves the flow after a draft was sent, or after a member corrected it by hand. */
export async function saveRecFlow(input: { conversationId: string; flow: unknown }): Promise<RecFlowState | null> {
  if (!uuid.safeParse(input.conversationId).success) return null;
  const scope = await flowConversation(input.conversationId, "inbox.reply");
  if (!scope) return null;
  const state = normalizeFlow(input.flow);
  return await writeFlow(scope.db, scope.conversation, scope.userId, state) ? state : null;
}
