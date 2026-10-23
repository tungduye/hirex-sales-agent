// Thông tin ứng viên tự ghi (migration 141): what the server asks the model to read in a candidate chat, and the
// checks on its answer. Pure; covered by tests/candidate-facts.test.mjs.
// Rules: only the candidate's own messages count; every value needs a quote that is really in one of them; a value
// only changes when the candidate said something different; nothing is erased.
import { FACT_FIELDS, FACT_KEYS, type FactKey, type Facts } from "./rec-flow.ts";

export interface ChatLine { id: string; direction: "INBOUND" | "OUTBOUND"; text: string; at: string }
export interface FactFinding { key: FactKey; value: string; quote: string }
export interface FactChange { key: FactKey; value: string; previous: string | null; quote: string; messageId: string }

const squash = (value: string) => value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
/** For comparing: no marks, no case, no punctuation. */
export const foldFact = (value: string) => squash(value).normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export const FACT_INSTRUCTIONS = [
  "Bạn đọc đoạn chat giữa recruiter (OUTBOUND) và ứng viên (INBOUND) để ghi lại thông tin ỨNG VIÊN tự nói về mình.",
  "Chỉ ghi điều ứng viên nói rõ trong tin INBOUND trong phần TIN_MOI. Câu hỏi hay thông tin do recruiter nói không tính. Không đoán, không suy luận.",
  "Một câu trả lời ngắn cho câu hỏi của recruiter vẫn tính (recruiter hỏi 'anh quan tâm hướng nào', ứng viên trả lời 'BrsE em nhé' → careerTrack = BrSE).",
  "value: ngắn gọn, giữ đúng chữ/số ứng viên dùng (60tr giữ là 60tr). quote: trích NGUYÊN VĂN một đoạn trong đúng tin INBOUND đó (copy y hệt, không sửa chính tả), đủ để thấy thông tin.",
  "Chỉ trả những trường có thông tin MỚI hoặc KHÁC với DA_BIET. Không có gì mới thì facts = [].",
  "Các trường: " + FACT_FIELDS.map((field) => `${field.key} (${field.label}: ${field.hint})`).join("; ") + ".",
].join("\n");

export const FACT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["facts"],
  properties: { facts: { type: "array", maxItems: 16, items: { type: "object", additionalProperties: false, required: ["key", "value", "quote"],
    properties: { key: { type: "string", enum: FACT_KEYS }, value: { type: "string" }, quote: { type: "string" } } } } },
} as const;

/** What the model reads: the earlier chat for context, the new lines to file, and what is already known. */
export function factPromptInput(lines: ChatLine[], since: string | null, known: Facts) {
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const isNew = (line: ChatLine) => !Number.isFinite(sinceMs) || Date.parse(line.at) > sinceMs;
  const show = (line: ChatLine) => `${line.direction === "INBOUND" ? "UNG_VIEN" : "RECRUITER"}: ${squash(line.text).slice(0, 800)}`;
  return JSON.stringify({ DA_BIET: known, TIN_TRUOC: lines.filter((line) => !isNew(line)).slice(-12).map(show), TIN_MOI: lines.filter(isNew).map(show) });
}

/** The model's answer → the changes to file: known keys, a real quote from a new candidate message, a different value. */
export function factChanges(raw: unknown, lines: ChatLine[], since: string | null, known: Facts): FactChange[] {
  const facts = raw && typeof raw === "object" && Array.isArray((raw as { facts?: unknown }).facts) ? (raw as { facts: unknown[] }).facts : [];
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const candidate = lines.filter((line) => line.direction === "INBOUND" && (!Number.isFinite(sinceMs) || Date.parse(line.at) > sinceMs));
  const changes = new Map<FactKey, FactChange>();
  for (const item of facts) {
    if (!item || typeof item !== "object") continue;
    const { key, value, quote } = item as Record<string, unknown>;
    if (typeof key !== "string" || !(FACT_KEYS as string[]).includes(key) || typeof value !== "string" || typeof quote !== "string") continue;
    const cleanValue = squash(value).slice(0, 120), cleanQuote = squash(quote).slice(0, 400);
    if (!cleanValue || foldFact(cleanQuote).length < 2) continue;
    // The quote must really be in one of the candidate's new messages (the newest one when it appears in several).
    const source = [...candidate].reverse().find((line) => foldFact(line.text).includes(foldFact(cleanQuote)));
    if (!source) continue;
    const previous = known[key as FactKey] ?? null;
    if (previous && foldFact(previous) === foldFact(cleanValue)) continue;
    changes.set(key as FactKey, { key: key as FactKey, value: cleanValue, previous, quote: cleanQuote, messageId: source.id });
  }
  return [...changes.values()];
}

/** Facts after a member's edit (or a sent draft) compared with before: what changed, for the history. */
export function editedFacts(before: Facts, after: Facts) {
  return FACT_KEYS.flatMap((key) => {
    const old = before[key] ?? null, next = after[key] ?? null;
    return (old ? foldFact(old) : "") === (next ? foldFact(next) : "") ? [] : [{ key, value: next, previous: old }];
  });
}
