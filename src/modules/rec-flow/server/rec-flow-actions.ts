"use server";

import { z } from "zod";
import { editedFacts } from "../core/candidate-facts";
import { FACT_KEYS, normalizeFlow, type FactKey, type RecFlowState } from "../core/rec-flow";
import { flowConversation, readFlow, writeFlow, type Db, type FlowConversation } from "./rec-flow-store";

const uuid = z.string().uuid();

/** The Rec flow of a one-to-one Zalo/Facebook chat (null when the chat does not use it or the member may not see it). */
export async function loadRecFlow(conversationId: string): Promise<RecFlowState | null> {
  if (!uuid.safeParse(conversationId).success) return null;
  const scope = await flowConversation(conversationId, "inbox.view");
  if (!scope) return null;
  return (await readFlow(scope.db, scope.conversation)).state;
}

/**
 * Saves the flow after a draft was sent (source "draft": the model's reading, not confirmed), or after a member
 * corrected it by hand (source "edit": confirmed by that member). Changed values go to the history.
 */
export async function saveRecFlow(input: { conversationId: string; flow: unknown; source?: "draft" | "edit" }): Promise<RecFlowState | null> {
  if (!uuid.safeParse(input.conversationId).success) return null;
  const scope = await flowConversation(input.conversationId, "inbox.reply");
  if (!scope) return null;
  const state = normalizeFlow(input.flow);
  const before = await readFlow(scope.db, scope.conversation);
  if (!await writeFlow(scope.db, scope.conversation, scope.userId, state)) return null;
  const changes = editedFacts(before.state.facts, state.facts);
  if (changes.length) await scope.db.from("candidate_fact_history").insert(changes.map((change) => ({
    ...owner(scope.conversation), field_key: change.key, value: change.value, previous_value: change.previous,
    source: input.source === "draft" ? "AI_DRAFT" : "MEMBER", confirmed: input.source !== "draft", created_by: scope.userId,
  })));
  return state;
}

export type FactSource = { value: string | null; quote: string | null; source: "AI_CHAT" | "AI_DRAFT" | "MEMBER"; confirmed: boolean; at: string; by: string | null;
  previous: Array<{ value: string | null; at: string }> };

/** Where each value of the flow came from: the candidate's words (with the quote), a draft, or a member; and earlier values. */
export async function loadRecFactSources(conversationId: string): Promise<Partial<Record<FactKey, FactSource>> | null> {
  if (!uuid.safeParse(conversationId).success) return null;
  const scope = await flowConversation(conversationId, "inbox.view");
  if (!scope) return null;
  return await sources(scope.db, scope.conversation);
}

/** "✓ Đúng": a member confirms the current value of one field. */
export async function confirmRecFact(input: { conversationId: string; key: string }): Promise<Partial<Record<FactKey, FactSource>> | null> {
  if (!uuid.safeParse(input.conversationId).success || !(FACT_KEYS as string[]).includes(input.key)) return null;
  const scope = await flowConversation(input.conversationId, "inbox.reply");
  if (!scope) return null;
  const value = (await readFlow(scope.db, scope.conversation)).state.facts[input.key as FactKey];
  if (!value) return null;
  const { error } = await scope.db.from("candidate_fact_history").insert({ ...owner(scope.conversation), field_key: input.key, value, previous_value: value,
    source: "MEMBER", confirmed: true, created_by: scope.userId });
  if (error) return null;
  return await sources(scope.db, scope.conversation);
}

function owner(conversation: FlowConversation) {
  return { workspace_id: conversation.workspaceId, contact_id: conversation.contactId, conversation_id: conversation.id };
}

async function sources(db: Db, conversation: FlowConversation) {
  let query = db.from("candidate_fact_history").select("field_key,value,quote,source,confirmed,created_at,created_by")
    .eq("workspace_id", conversation.workspaceId).order("created_at", { ascending: false }).limit(300);
  query = conversation.contactId ? query.eq("contact_id", conversation.contactId) : query.eq("conversation_id", conversation.id).is("contact_id", null);
  const { data } = await query;
  const rows = (data ?? []) as Array<{ field_key: string; value: string | null; quote: string | null; source: FactSource["source"]; confirmed: boolean; created_at: string; created_by: string | null }>;
  const names = new Map<string, string>();
  const people = [...new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)))];
  if (people.length) for (const person of (await db.from("profiles").select("id,full_name").in("id", people)).data ?? []) names.set(String(person.id), String(person.full_name ?? ""));
  const result: Partial<Record<FactKey, FactSource>> = {};
  for (const row of rows) {
    if (!(FACT_KEYS as string[]).includes(row.field_key)) continue;
    const key = row.field_key as FactKey, entry = result[key];
    if (!entry) { result[key] = { value: row.value, quote: row.quote, source: row.source, confirmed: row.confirmed, at: row.created_at, by: row.created_by ? names.get(row.created_by) ?? null : null, previous: [] }; continue; }
    // A confirmation of the same value keeps the quote of the candidate's words it confirms.
    if (!entry.quote && row.quote && row.value === entry.value) entry.quote = row.quote;
    if (row.value !== entry.value && !entry.previous.some((item) => item.value === row.value) && entry.previous.length < 3) entry.previous.push({ value: row.value, at: row.created_at });
  }
  return result;
}
