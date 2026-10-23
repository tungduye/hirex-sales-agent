import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { postOpenAIResponse, responseOutputText } from "@/lib/openai/responses";
import { FACT_INSTRUCTIONS, FACT_SCHEMA, factChanges, factPromptInput, type ChatLine, type FactChange } from "../core/candidate-facts";
import { mergeFacts } from "../core/rec-flow";
import { readFlow, writeFlow, type Db, type FlowConversation } from "./rec-flow-store";

// Thông tin ứng viên tự ghi (migration 141). Each inbound message on a nick tuyển dụng queues its conversation a
// minute later; this reads the new candidate messages, asks the model what the candidate said about themselves, keeps
// only values quoted from those messages, and files them in Luồng Rec with their history. Runs from the AI Recruiter
// worker's poll (every few seconds), a couple of conversations at a time, never two batches at once in one server.

const FLOW_CHANNELS = ["ZALO", "FACEBOOK", "FACEBOOK_PROFILE"];
let running = false;
// The AI service said "no credit" / "slow down": leave the queue alone for a while (the jobs wait, they are not lost).
let pausedUntil = 0;

type Job = { conversation_id: string; workspace_id: string; processed_through: string | null; attempts: number };

export async function processCandidateFactJobs(limit = 2) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.CANDIDATE_FACTS_MODEL?.trim() || process.env.OPENAI_MODEL?.trim();
  if (running || !apiKey || !model || Date.now() < pausedUntil) return { processed: 0 };
  running = true;
  try {
    const db = createPrivilegedClient();
    const { data, error } = await db.rpc("claim_candidate_fact_jobs", { p_limit: limit });
    if (error || !Array.isArray(data) || !data.length) return { processed: 0 };
    await Promise.all((data as Job[]).map((job) => runJob(db, job, apiKey, model)));
    return { processed: data.length };
  } finally { running = false; }
}

async function finish(db: Db, conversationId: string, status: "DONE" | "SKIPPED" | "FAILED" | "WAIT", through: string | null, error: string | null = null) {
  await db.rpc("finish_candidate_fact_job", { p_conversation_id: conversationId, p_status: status, p_processed_through: through, p_error: error });
}

async function runJob(db: Db, job: Job, apiKey: string, model: string) {
  try {
    const { data: row } = await db.from("omnichannel_conversations").select("id,workspace_id,contact_id,channel_type,channel_account_id,metadata")
      .eq("id", job.conversation_id).eq("workspace_id", job.workspace_id).maybeSingle();
    if (!row || !FLOW_CHANNELS.includes(String(row.channel_type))) return await finish(db, job.conversation_id, "SKIPPED", null);
    const { data: nick } = await db.from("channel_accounts").select("candidate_facts_enabled").eq("id", row.channel_account_id).maybeSingle();
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {};
    const groupByMetadata = String(metadata.conversationKind ?? "").toUpperCase() === "GROUP" || String(metadata.threadType ?? "").toUpperCase() === "GROUP" || metadata.isGroup === true || typeof metadata.groupName === "string";
    if (!nick?.candidate_facts_enabled || groupByMetadata) return await finish(db, job.conversation_id, "SKIPPED", null);
    if (row.channel_type === "ZALO") {
      const { data: group, error } = await db.rpc("is_zalo_group_conversation", { p_conversation_id: row.id });
      if (error) throw new Error("GROUP_CHECK_FAILED");
      if (group !== false) return await finish(db, job.conversation_id, "SKIPPED", null);
    }
    const { data: messageRows } = await db.from("omnichannel_messages").select("id,direction,text_content,attachment_count,received_at,sent_at,created_at")
      .eq("workspace_id", job.workspace_id).eq("conversation_id", row.id).order("created_at", { ascending: false }).limit(40);
    const lines: ChatLine[] = (messageRows ?? []).reverse().flatMap((message) => {
      const text = typeof message.text_content === "string" && message.text_content.trim() ? message.text_content : Number(message.attachment_count) > 0 ? "[tệp đính kèm]" : "";
      const at = String(message.received_at ?? message.sent_at ?? message.created_at);
      return text && (message.direction === "INBOUND" || message.direction === "OUTBOUND") ? [{ id: String(message.id), direction: message.direction, text, at }] : [];
    });
    const latest = lines.at(-1)?.at ?? job.processed_through;
    const since = job.processed_through;
    const fresh = lines.some((line) => line.direction === "INBOUND" && line.text !== "[tệp đính kèm]" && (!since || Date.parse(line.at) > Date.parse(since)));
    if (!fresh) return await finish(db, job.conversation_id, "DONE", latest);
    const conversation: FlowConversation = { id: String(row.id), workspaceId: job.workspace_id, contactId: typeof row.contact_id === "string" ? row.contact_id : null,
      channelType: String(row.channel_type), channelAccountId: String(row.channel_account_id) };
    const before = await readFlow(db, conversation);
    const response = await postOpenAIResponse({ apiKey, timeoutMs: 40_000, body: {
      model, max_output_tokens: 900, instructions: FACT_INSTRUCTIONS, input: factPromptInput(lines, since, before.state.facts),
      text: { format: { type: "json_schema", name: "candidate_facts", strict: true, schema: FACT_SCHEMA } },
    } });
    if (response.status === 429 || response.status >= 500) {
      pausedUntil = Date.now() + (response.status === 429 ? 10 : 2) * 60_000;
      console.error("[candidate-facts] AI unavailable, waiting", response.status);
      return await finish(db, job.conversation_id, "WAIT", null, `AI_${response.status}`);
    }
    if (!response.ok) throw new Error(`AI_${response.status}`);
    const raw = JSON.parse(responseOutputText(await response.json()) || "{}") as unknown;
    const changes = factChanges(raw, lines, since, before.state.facts);
    if (changes.length) await file(db, conversation, changes);
    await finish(db, job.conversation_id, "DONE", latest);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message.slice(0, 60) : "UNKNOWN";
    console.error("[candidate-facts] job failed", code);
    await finish(db, job.conversation_id, "FAILED", null, code).catch(() => undefined);
  }
}

/** Files the changes: the current values in Luồng Rec (read again right before writing), and one history row each. */
async function file(db: Db, conversation: FlowConversation, changes: FactChange[]) {
  const current = await readFlow(db, conversation);
  const facts = mergeFacts(current.state.facts, Object.fromEntries(changes.map((change) => [change.key, change.value])));
  if (!await writeFlow(db, conversation, null, { ...current.state, facts })) throw new Error("FLOW_WRITE_FAILED");
  const { error } = await db.from("candidate_fact_history").insert(changes.map((change) => ({
    workspace_id: conversation.workspaceId, contact_id: conversation.contactId, conversation_id: conversation.id, field_key: change.key,
    value: change.value, previous_value: current.state.facts[change.key] ?? change.previous, quote: change.quote, source_message_id: change.messageId,
    source: "AI_CHAT", confirmed: false,
  })));
  if (error) throw new Error("HISTORY_WRITE_FAILED");
}
