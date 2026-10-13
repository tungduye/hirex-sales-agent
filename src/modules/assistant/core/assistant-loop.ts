// The question → tool calls → answer loop of Trợ lý HireX, independent of OpenAI and Supabase
// (both are injected), so the control flow is unit-tested in tests/assistant-loop.test.mjs.
import { parseToolCall, type AssistantToolDefinition } from "./assistant-tools.ts";

export const MAX_TOOL_ROUNDS = 4;
export const MAX_CALLS_PER_ROUND = 6;
export const MAX_TOOL_OUTPUT_CHARS = 12_000;
export const MAX_HISTORY_TURNS = 10;

export interface ChatTurn { role: "user" | "assistant"; content: string }

/** Items we send back to the Responses API (stateless: store=false, so the client keeps them). */
export type InputItem =
  | { role: "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export interface ModelFunctionCall { call_id: string; name: string; arguments: string }
export interface ModelReply { text: string; calls: ModelFunctionCall[]; inputTokens: number; outputTokens: number }

export interface RunAssistantDeps {
  /** One Responses API call. `allowTools=false` forces a text answer. */
  callModel: (input: InputItem[], allowTools: boolean) => Promise<ModelReply>;
  /** Runs a validated tool for the signed-in member. */
  runTool: (tool: AssistantToolDefinition, args: Record<string, unknown>) => Promise<unknown>;
}

export interface AssistantResult {
  answer: string;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
}

export function trimHistory(history: ChatTurn[]): ChatTurn[] {
  return history
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string" && turn.content.trim())
    .slice(-MAX_HISTORY_TURNS * 2)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 4000) }));
}

export function serializeToolOutput(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  return text.length <= MAX_TOOL_OUTPUT_CHARS ? text : `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}…(đã cắt bớt)`;
}

export async function runAssistant({ question, history, tools, deps }: { question: string; history: ChatTurn[]; tools: AssistantToolDefinition[]; deps: RunAssistantDeps }): Promise<AssistantResult> {
  const input: InputItem[] = [...trimHistory(history), { role: "user", content: question }];
  const toolsUsed: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const allowTools = round < MAX_TOOL_ROUNDS && tools.length > 0;
    const reply = await deps.callModel(input, allowTools);
    inputTokens += reply.inputTokens;
    outputTokens += reply.outputTokens;
    if (!allowTools || reply.calls.length === 0) {
      return { answer: reply.text.trim() || "Em chưa có câu trả lời cho yêu cầu này.", toolsUsed, inputTokens, outputTokens };
    }

    const calls = reply.calls.slice(0, MAX_CALLS_PER_ROUND);
    for (const call of reply.calls) input.push({ type: "function_call", call_id: call.call_id, name: call.name, arguments: call.arguments });
    const outputs = await Promise.all(calls.map(async (call) => {
      const parsed = parseToolCall(call.name, call.arguments, tools);
      if (!parsed.ok) return { call_id: call.call_id, value: { ok: false, error: parsed.error } };
      if (!toolsUsed.includes(parsed.tool.name)) toolsUsed.push(parsed.tool.name);
      try {
        return { call_id: call.call_id, value: { ok: true, data: await deps.runTool(parsed.tool, parsed.args) } };
      } catch {
        return { call_id: call.call_id, value: { ok: false, error: "Không lấy được dữ liệu lúc này." } };
      }
    }));
    for (const output of outputs) input.push({ type: "function_call_output", call_id: output.call_id, output: serializeToolOutput(output.value) });
    for (const call of reply.calls.slice(MAX_CALLS_PER_ROUND)) {
      input.push({ type: "function_call_output", call_id: call.call_id, output: serializeToolOutput({ ok: false, error: "Quá nhiều lệnh trong một lượt, hãy gọi lại nếu cần." }) });
    }
  }
  return { answer: "Em chưa có câu trả lời cho yêu cầu này.", toolsUsed, inputTokens, outputTokens };
}
