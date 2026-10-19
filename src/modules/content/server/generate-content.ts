import "server-only";

import { postOpenAIResponse, responseOutputText } from "@/lib/openai/responses";
import type { ContentBrief } from "@/modules/content/core/content-options";
import { buildContentRequest, buildRewriteRequest, buildTemplateItemRequest, parseGeneratedBatch, type ContentBriefWithCategory, type ContentRoundInput, type GeneratedItem } from "@/modules/content/core/content-prompt";
import type { TemplateSample } from "@/modules/content/core/template-plan";

export function contentModel() {
  // Content uses the strongest model configured: its own, else the assistant's, else the default.
  return process.env.CONTENT_AI_MODEL?.trim() || process.env.ASSISTANT_AI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || null;
}

async function callModel(model: string, request: { instructions: string; input: string; maxOutputTokens: number; schema: object }): Promise<GeneratedItem[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");
  const response = await postOpenAIResponse({
    apiKey,
    timeoutMs: 150_000,
    body: {
      model,
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

/** One call that returns up to `count` drafts (used when no sample template is available). */
export function generateContentRound(input: ContentRoundInput & { model: string }): Promise<GeneratedItem[]> {
  return callModel(input.model, buildContentRequest(input));
}

/** One draft written closely after one sample template. */
export async function generateFromTemplate(input: { brief: ContentBrief; template: TemplateSample; round: number; avoid: string[]; model: string }): Promise<GeneratedItem | null> {
  const items = await callModel(input.model, buildTemplateItemRequest(input));
  return items[0] ?? null;
}

/** One rewritten version of a saved content. */
export async function rewriteContent(input: { brief: ContentBriefWithCategory; title: string; body: string; note: string; model: string }): Promise<GeneratedItem | null> {
  const items = await callModel(input.model, buildRewriteRequest(input));
  return items[0] ?? null;
}
