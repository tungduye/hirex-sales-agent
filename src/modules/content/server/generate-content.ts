import "server-only";

import { postOpenAIResponse, responseOutputText } from "@/lib/openai/responses";
import { buildContentRequest, parseGeneratedBatch, type ContentRoundInput, type GeneratedItem } from "@/modules/content/core/content-prompt";

export function contentModel() {
  return process.env.CONTENT_AI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || null;
}

/** One OpenAI call that returns up to `count` drafts. Throws AI_* error codes. */
export async function generateContentRound(input: ContentRoundInput & { model: string }): Promise<GeneratedItem[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");
  const request = buildContentRequest(input);
  const response = await postOpenAIResponse({
    apiKey,
    timeoutMs: 150_000,
    body: {
      model: input.model,
      max_output_tokens: request.maxOutputTokens,
      instructions: request.instructions,
      input: request.input,
      text: { format: { type: "json_schema", name: "content_batch", strict: true, schema: request.schema } },
    },
  });
  if (!response.ok) throw new Error("AI_UNAVAILABLE");
  const raw = responseOutputText(await response.json()).trim();
  if (!raw) throw new Error("AI_INVALID_OUTPUT");
  try {
    return parseGeneratedBatch(raw);
  } catch {
    throw new Error("AI_INVALID_OUTPUT");
  }
}
