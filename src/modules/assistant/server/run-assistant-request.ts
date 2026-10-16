import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { postOpenAIResponse } from "@/lib/openai/responses";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { runAssistant, type ChatTurn, type InputItem } from "@/modules/assistant/core/assistant-loop";
import { assistantInstructions, pageContext, parseModelReply } from "@/modules/assistant/core/assistant-instructions";
import { openAiToolSpecs, toolsFor } from "@/modules/assistant/core/assistant-tools";
import { runAssistantTool } from "@/modules/assistant/server/assistant-tool-runner";
import type { PendingAction } from "@/modules/assistant/server/assistant-proposals";

/** allowDocuments: the admin switched on "Tài liệu" in the panel (consent to send passages to OpenAI). */
export interface AssistantRequest { question: string; history: ChatTurn[]; pagePath: string | null; allowDocuments?: boolean }
export type AssistantResponse =
  | { ok: true; answer: string; toolsUsed: string[]; remainingToday: number; pendingActions: PendingAction[] }
  | { ok: false; status: number; message: string };

export function assistantModel() {
  return process.env.ASSISTANT_AI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || null;
}

function dailyLimit() {
  const value = Number.parseInt(process.env.ASSISTANT_DAILY_LIMIT ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 100;
}

/** Start of today in Vietnam (UTC+7), as an ISO timestamp. */
function startOfVietnamDay(now: Date) {
  const shifted = new Date(now.getTime() + 7 * 3_600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 7 * 3_600_000).toISOString();
}

export async function runAssistantRequest(request: AssistantRequest): Promise<AssistantResponse> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return { ok: false, status: 401, message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." };
  const apiKey = process.env.OPENAI_API_KEY;
  const model = assistantModel();
  if (!apiKey || !model) return { ok: false, status: 503, message: "Máy chủ chưa cấu hình OpenAI cho Trợ lý." };

  const workspaceId = account.workspaceId;
  const db = createPrivilegedClient();
  const limit = dailyLimit();
  const { count } = await db.from("assistant_requests").select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId).eq("user_id", account.userId).gte("created_at", startOfVietnamDay(new Date())).neq("status", "RATE_LIMITED");
  const usedToday = count ?? 0;
  const log = (values: Record<string, unknown>) => db.from("assistant_requests").insert({
    workspace_id: workspaceId, user_id: account.userId, question: request.question.slice(0, 1000), page_path: request.pagePath?.slice(0, 300) ?? null, model, ...values,
  });
  if (usedToday >= limit) {
    await log({ status: "RATE_LIMITED" });
    return { ok: false, status: 429, message: `Anh/chị đã dùng hết ${limit} câu hỏi hôm nay. Trợ lý sẽ mở lại vào 0h.` };
  }

  const isAdmin = await isWorkspaceAdmin();
  const documents = !isAdmin ? "none" : request.allowDocuments ? "on" : "off";
  const tools = toolsFor(account.permissions, isAdmin, { documents: documents === "on" });
  const proposals: PendingAction[] = [];
  const actionContext = { workspaceId, userId: account.userId, permissions: account.permissions, isAdmin };
  const instructions = assistantInstructions({ fullName: account.fullName, now: new Date(), toolLabels: tools.map((tool) => tool.label), context: pageContext(request.pagePath), documents });
  const specs = openAiToolSpecs(tools);
  const started = Date.now();

  try {
    const result = await runAssistant({
      question: request.question,
      history: request.history,
      tools,
      deps: {
        async callModel(input: InputItem[], allowTools: boolean) {
          const response = await postOpenAIResponse({
            apiKey,
            timeoutMs: 60_000,
            body: {
              model,
              instructions,
              input,
              max_output_tokens: 2500,
              // Tools stay declared on the last round (earlier calls are in the input); "none" forces an answer.
              ...(specs.length > 0 ? { tools: specs, tool_choice: allowTools ? "auto" : "none", parallel_tool_calls: true } : {}),
            },
          });
          if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);
          return parseModelReply(await response.json());
        },
        runTool: (tool, args) => runAssistantTool(tool, args, { workspaceId, userId: account.userId, context: actionContext, proposals }),
      },
    });
    await log({ status: "ANSWERED", tools_used: result.toolsUsed, input_tokens: result.inputTokens, output_tokens: result.outputTokens, duration_ms: Date.now() - started });
    return { ok: true, answer: result.answer, toolsUsed: result.toolsUsed, remainingToday: Math.max(0, limit - usedToday - 1), pendingActions: proposals };
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 60) : "UNKNOWN";
    console.error("[assistant] request failed", code);
    await log({ status: "FAILED", error_code: code, duration_ms: Date.now() - started });
    return { ok: false, status: 502, message: "Trợ lý đang không phản hồi. Vui lòng thử lại sau ít phút." };
  }
}
