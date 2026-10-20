/** Saved Trợ lý conversations: shapes shared by the API and the chat screens. */

export interface ConversationSummary { id: string; title: string; pinned: boolean; updatedAt: string }
export interface ActionPreview { title: string; lines: string[]; warning?: string | null; link?: string | null; editableText?: string; editableKind?: "message" | "note" }
export type CardState = "pending" | "running" | "done" | "failed" | "cancelled";
export interface CardAction { id: string; preview: ActionPreview; expiresAt: string; state: CardState; result?: string; link?: string | null }
export interface ChatMessage { role: "user" | "assistant"; content: string; toolsUsed?: string[]; error?: boolean; actions?: CardAction[] }

/** First line of the first question, tidied, as the conversation's name. */
export function conversationTitle(question: string): string {
  const line = question.split(/\r?\n/u).map((part) => part.trim()).find(Boolean) ?? "";
  const clean = line.replace(/\s+/gu, " ").replace(/^[#>*\-\s]+/u, "").trim();
  if (!clean) return "Cuộc trò chuyện mới";
  return clean.length > 60 ? `${clean.slice(0, 57).trimEnd()}…` : clean;
}

/** How a saved proposal card looks now, from its row in assistant_actions. */
export function cardStateFromStatus(status: string): CardState {
  return status === "EXECUTED" ? "done" : status === "FAILED" ? "failed" : status === "CANCELLED" || status === "EXPIRED" ? "cancelled" : status === "EXECUTING" ? "running" : "pending";
}

/** "Hôm nay", "Hôm qua", "7 ngày qua", "30 ngày qua", "Cũ hơn" (Vietnam time). */
export function recencyGroup(iso: string, now: number): string {
  const day = (time: number) => Math.floor((time + 7 * 3_600_000) / 86_400_000);
  const diff = day(now) - day(Date.parse(iso));
  return diff <= 0 ? "Hôm nay" : diff === 1 ? "Hôm qua" : diff < 7 ? "7 ngày qua" : diff < 30 ? "30 ngày qua" : "Cũ hơn";
}
