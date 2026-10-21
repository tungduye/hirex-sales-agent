import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { postOpenAIResponse, responseOutputText } from "@/lib/openai/responses";
import { INSIGHT_INSTRUCTIONS, INSIGHT_SCHEMA, parseInsights, transcript, type ChatLine } from "@/modules/campaigns/core/interactions";

// Reads what candidates meant after replying to a Zalo / Facebook cá nhân campaign (Quan tâm / Không quan tâm /
// Chưa rõ) and keeps it in campaign_reply_insights. A reply is read again only when the candidate wrote
// something new. Runs from the alerts worker (every few minutes) and after Soda is asked, a few dozen at a time.

type Queued = { workspace_id: string; recipient_id: string; conversation_id: string; reply_message_at: string; last_inbound_at: string };
const BATCH = 8;
let running: Promise<number> | null = null;

function insightModel() {
  return process.env.CAMPAIGN_INSIGHT_MODEL?.trim() || process.env.ASSISTANT_AI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || null;
}

function files(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const list = (metadata as { attachments?: unknown }).attachments;
  return Array.isArray(list) ? list.flatMap((item) => item && typeof item === "object" && typeof (item as { filename?: unknown }).filename === "string" ? [String((item as { filename: string }).filename).slice(0, 80)] : ["tệp"]) : [];
}

async function chatOf(db: ReturnType<typeof createPrivilegedClient>, item: Queued): Promise<string> {
  // The campaign message just before the reply (context) and up to 16 messages from the reply on.
  const [before, after] = await Promise.all([
    db.from("omnichannel_messages").select("direction,text_content,metadata,created_at").eq("workspace_id", item.workspace_id).eq("conversation_id", item.conversation_id)
      .eq("direction", "OUTBOUND").lt("created_at", item.reply_message_at).order("created_at", { ascending: false }).limit(1),
    db.from("omnichannel_messages").select("direction,text_content,metadata,created_at").eq("workspace_id", item.workspace_id).eq("conversation_id", item.conversation_id)
      .gte("created_at", item.reply_message_at).order("created_at", { ascending: true }).limit(16),
  ]);
  const lines: ChatLine[] = [...(before.data ?? []), ...(after.data ?? [])].map((row) => ({ direction: String(row.direction), text: typeof row.text_content === "string" ? row.text_content : null, files: files(row.metadata) }));
  return transcript(lines);
}

async function classifyBatch(db: ReturnType<typeof createPrivilegedClient>, apiKey: string, model: string, items: Queued[]) {
  const chats = await Promise.all(items.map(async (item) => ({ item, chat: await chatOf(db, item) })));
  const usable = chats.filter((entry) => entry.chat.trim());
  if (!usable.length) return 0;
  const input = usable.map((entry) => `### id: ${entry.item.recipient_id}\n${entry.chat}`).join("\n\n");
  const response = await postOpenAIResponse({
    apiKey, timeoutMs: 60_000,
    body: {
      model, instructions: INSIGHT_INSTRUCTIONS, max_output_tokens: 2500,
      input: [{ role: "user", content: `Xếp loại từng đoạn chat (giữ nguyên id):\n\n${input}` }],
      text: { format: { type: "json_schema", name: "campaign_reply_insights", strict: true, schema: INSIGHT_SCHEMA } },
    },
  });
  if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);
  const results = parseInsights(responseOutputText(await response.json()), usable.map((entry) => entry.item.recipient_id));
  if (!results.length) return 0;
  const byId = new Map(items.map((item) => [item.recipient_id, item]));
  const { error } = await db.from("campaign_reply_insights").upsert(results.map((result) => ({
    recipient_id: result.id, workspace_id: byId.get(result.id)!.workspace_id, interest: result.interest, reason: result.reason || null,
    last_inbound_at: byId.get(result.id)!.last_inbound_at, classified_at: new Date().toISOString(),
  })), { onConflict: "recipient_id" });
  if (error) throw new Error("INSIGHT_SAVE_FAILED");
  return results.length;
}

async function run(limit: number) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = insightModel();
  if (!apiKey || !model) return 0;
  const db = createPrivilegedClient();
  const { data, error } = await db.rpc("campaign_replies_to_classify", { p_limit: limit });
  if (error) throw new Error("INSIGHT_QUEUE_FAILED");
  const queue = (data ?? []) as Queued[];
  let done = 0;
  for (let offset = 0; offset < queue.length; offset += BATCH) {
    try { done += await classifyBatch(db, apiKey, model, queue.slice(offset, offset + BATCH)); }
    catch (failure) { console.error("[campaigns] reply reading failed", failure instanceof Error ? failure.message : failure); break; }
  }
  return done;
}

/** Reads up to `limit` new or changed replies (all workspaces). One run at a time; returns how many were read. */
export function classifyCampaignReplies(limit = 48): Promise<number> {
  if (running) return running;
  running = run(limit).finally(() => { running = null; });
  return running;
}
