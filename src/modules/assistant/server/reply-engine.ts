import "server-only";

import { postOpenAIResponse } from "@/lib/openai/responses";
import { runAssistant, type InputItem } from "@/modules/assistant/core/assistant-loop";
import { parseModelReply } from "@/modules/assistant/core/assistant-instructions";
import { openAiToolSpecs, toolsFor } from "@/modules/assistant/core/assistant-tools";
import { cleanDraft, draftRequest, REPLY_ENGINE_TOOLS, replyWriterInstructions } from "@/modules/assistant/core/reply-engine-core";
import { runAssistantTool, runReadTool } from "@/modules/assistant/server/assistant-tool-runner";
import type { ActionContext } from "@/modules/assistant/server/assistant-proposals";

// Shared reply engine ("Hole"). Same model, tools and permission rules as Trợ lý HireX, limited to
// read-only lookups, and it only returns a DRAFT: sending is always done by a person (or, later, by
// AI Recruiter through its own gates). The caller has already checked the member may reply in the
// conversation.

export type DraftResult = { ok: true; text: string; toolsUsed: string[] } | { ok: false; message: string };

/** brief: extra guidance, data and read-only tools for one kind of chat (e.g. a candidate chat). */
export type DraftBrief = { instructions: string; context: unknown; tools?: string[] };

export async function draftReply(input: { conversationId: string; instruction: string; context: ActionContext; staffName: string | null; apiKey: string; model: string; brief?: DraftBrief }): Promise<DraftResult> {
  const { context } = input;
  const scope = { workspaceId: context.workspaceId, userId: context.userId, context, proposals: [] };
  // Start from the conversation and the customer's record so most replies need no extra lookups.
  const conversation = await runReadTool("chi_tiet_hoi_thoai", { conversation_id: input.conversationId }, scope) as Record<string, unknown>;
  if (!conversation || "loi" in conversation) return { ok: false, message: "Không đọc được hội thoại này." };
  const contactId = (conversation.lien_he as { id?: string } | null)?.id;
  const contact = contactId && (context.isAdmin || context.permissions.includes("contacts.view"))
    ? await runReadTool("chi_tiet_lien_he", { contact_id: contactId }, scope).catch(() => null)
    : null;

  const allowed = new Set<string>([...REPLY_ENGINE_TOOLS, ...(input.brief?.tools ?? [])]);
  const tools = toolsFor(context.permissions, context.isAdmin).filter((tool) => allowed.has(tool.name) && !tool.proposal);
  const specs = openAiToolSpecs(tools);
  const instructions = [replyWriterInstructions({ now: new Date(), staffName: input.staffName, channel: typeof conversation.kenh === "string" ? conversation.kenh : null }), input.brief?.instructions].filter(Boolean).join("\n");

  const result = await runAssistant({
    question: draftRequest({ hoi_thoai: conversation, khach: contact, ...(input.brief ? { tuyen_dung: input.brief.context } : {}) }, input.instruction),
    history: [],
    tools,
    deps: {
      async callModel(items: InputItem[], allowTools: boolean) {
        const response = await postOpenAIResponse({
          apiKey: input.apiKey, timeoutMs: 60_000,
          body: { model: input.model, instructions, input: items, max_output_tokens: 1500, ...(specs.length ? { tools: specs, tool_choice: allowTools ? "auto" : "none", parallel_tool_calls: true } : {}) },
        });
        if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);
        return parseModelReply(await response.json());
      },
      runTool: (tool, args) => runAssistantTool(tool, args, scope),
    },
  });
  const text = cleanDraft(result.answer);
  if (!text || text === "Em chưa có câu trả lời cho yêu cầu này.") return { ok: false, message: "Hole chưa soạn được nháp, thử lại nhé." };
  return { ok: true, text, toolsUsed: result.toolsUsed };
}
