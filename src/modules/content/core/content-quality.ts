// Title rule and draft scoring for new content. Pure module (unit-tested in tests/content-quality.test.mjs).
//  * Title: "[ĐỊA ĐIỂM] VỊ TRÍ – điểm nhấn", all capitals (Japanese: 【場所】職種), enforced after the AI writes.
//  * Score: how well a draft fits (length in range, title length, distance from the library), so a
//    batch can write a few extra drafts and keep the best ones.
import { titleLocation } from "./template-plan.ts";

/** Words of a text (Japanese counts characters / 2.2, roughly a word each). */
export function wordCount(text: string) {
  const cjk = (text.match(/[぀-ヿ㐀-鿿]/gu) ?? []).length;
  const latin = text.replace(/[぀-ヿ㐀-鿿]/gu, " ").split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  return latin + Math.round(cjk / 2.2);
}

/** "[HÀ NỘI] BRSE" / "【東京】BrSE"; null when neither place nor position is known (or for comments). */
export function titleLead(input: { location: string | null; position: string | null; jobTitle?: string | null; japanese: boolean }) {
  const place = titleLocation(input.location);
  const position = (input.position ?? "").trim() || null;
  if (!place && !position) return null;
  if (input.japanese) return `${place ? `【${place}】` : ""}${position ?? ""}`.trim();
  return [place ? `[${place.toLocaleUpperCase("vi")}]` : null, position?.toLocaleUpperCase("vi")].filter(Boolean).join(" ");
}

const fold = (text: string) => text.normalize("NFC").toLocaleUpperCase("vi").replace(/\s+/gu, " ").trim();

/** The final title: starts with the lead, never repeats it, all capitals except Japanese. */
export function finalizeTitle(title: string, lead: string | null, japanese: boolean) {
  let rest = title.replace(/\s+/gu, " ").trim();
  if (lead) {
    // Drop any place block the AI wrote ("[Hà Nội]" / "【東京】") and a repeated position.
    rest = rest.replace(/^(\[[^\]]{1,40}\]|【[^】]{1,40}】)\s*/u, "");
    const position = lead.replace(/^(\[[^\]]*\]|【[^】]*】)\s*/u, "");
    if (position && fold(rest).startsWith(fold(position))) rest = rest.slice(position.length);
    rest = rest.replace(/^[\s:–\-|,.]+/u, "").trim();
    rest = rest ? `${lead} – ${rest}` : lead;
  }
  return (japanese ? rest : rest.toLocaleUpperCase("vi")).slice(0, 300);
}

/**
 * 0–10: length inside the format's range (per language) counts most, then a readable title length,
 * then being far from the closest existing content.
 */
export function scoreDraft(draft: { title: string; body: string; similarity: number }, input: { wordRange: [number, number] | null; languageCount: number; isComment: boolean }) {
  let score = 0;
  if (input.wordRange) {
    const [min, max] = input.wordRange.map((value) => value * input.languageCount);
    const words = wordCount(draft.body);
    const off = words < min ? (min - words) / min : words > max ? (words - max) / max : 0;
    score += Math.max(0, 5 - off * 10);
  } else score += 5;
  const titleLength = draft.title.length;
  score += input.isComment || (titleLength >= 20 && titleLength <= 110) ? 2 : 0.5;
  score += Math.max(0, 3 - draft.similarity * 6);
  return Math.round(score * 100) / 100;
}

const MONEY = /(?:\$\s?(\d[\d.,]*))|(\d[\d.,]*)\s?(?:m\b|tr\b|triệu|man\b|万|usd|\$|k\b|yên|円)/giu;
const digits = (value: string) => value.replace(/[^\d]/gu, "").replace(/^0+/u, "");

/** Money figures in the draft that the brief never gave (a made-up salary). */
export function inventedMoney(text: string, facts: string) {
  const known = new Set([...facts.matchAll(/\d[\d.,]*/gu)].map((match) => digits(match[0])).filter(Boolean));
  const found: string[] = [];
  for (const match of text.matchAll(MONEY)) {
    const value = digits(match[1] ?? match[2] ?? "");
    if (value && !known.has(value)) found.push(value);
  }
  return [...new Set(found)];
}

/**
 * Last check before a draft is saved (the batch then writes a replacement): length clearly outside the
 * format's range, or a salary figure not in the brief. Returns the reason, or null when it passes.
 */
export function draftProblem(draft: { title: string; body: string }, input: { wordRange: [number, number] | null; languageCount: number; facts: string; isComment: boolean }) {
  if (input.wordRange && !input.isComment) {
    const [min, max] = input.wordRange.map((value) => value * input.languageCount);
    const words = wordCount(draft.body);
    if (words < min * 0.6) return "TOO_SHORT";
    if (words > max * 1.5) return "TOO_LONG";
  }
  if (inventedMoney(`${draft.title}\n${draft.body}`, input.facts).length > 0) return "INVENTED_MONEY";
  return null;
}
