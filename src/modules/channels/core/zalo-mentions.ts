// "@Name" tags in a Zalo group message, sent as real Zalo mentions (the tagged person gets notified).
// Zalo describes each one as {pos, len, uid}: where "@Name" starts in the text, its length (with the "@") and the
// member's id ("-1" = @All). Pure; unit-tested. The same rules are checked again by the Zalo bridge.

export interface ZaloMention { pos: number; len: number; uid: string }
export interface MentionPick { uid: string; name: string }

export const MENTION_ALL: MentionPick = { uid: "-1", name: "All" };
const MAX_MENTIONS = 50;

/**
 * Mentions for the final text: every "@Name" of a member picked from the suggestions (the picks survive edits as
 * long as the "@Name" text is still there). Longest names first so "@Lan Anh" is not cut to "@Lan".
 */
export function buildMentions(text: string, picks: readonly MentionPick[]): ZaloMention[] {
  const byName = [...new Map(picks.filter((pick) => pick.name.trim() && /^(-1|[0-9]{1,40})$/.test(pick.uid)).map((pick) => [pick.name.trim(), pick])).values()]
    .sort((a, b) => b.name.length - a.name.length);
  const taken: boolean[] = [];
  const mentions: ZaloMention[] = [];
  for (const pick of byName) {
    const needle = `@${pick.name.trim()}`;
    for (let pos = text.indexOf(needle); pos >= 0; pos = text.indexOf(needle, pos + needle.length)) {
      const end = pos + needle.length;
      if (/[\p{L}\p{N}]/u.test(text[end] ?? "")) continue;
      if (taken.slice(pos, end).some(Boolean)) continue;
      for (let index = pos; index < end; index++) taken[index] = true;
      mentions.push({ pos, len: needle.length, uid: pick.uid });
    }
  }
  return mentions.sort((a, b) => a.pos - b.pos).slice(0, MAX_MENTIONS);
}

/** Strict check of mentions received from the browser: shape, bounds, "@" at each start, no overlap. */
export function parseMentions(value: unknown, text: string): ZaloMention[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MENTIONS) return null;
  const mentions: ZaloMention[] = [];
  let lastEnd = -1;
  for (const item of [...value].sort((a, b) => (a?.pos ?? 0) - (b?.pos ?? 0))) {
    if (!item || typeof item !== "object" || Object.keys(item).sort().join(",") !== "len,pos,uid") return null;
    const { pos, len, uid } = item as Record<string, unknown>;
    if (!Number.isSafeInteger(pos) || !Number.isSafeInteger(len) || typeof uid !== "string" || !/^(-1|[0-9]{1,40})$/.test(uid)) return null;
    const start = pos as number, size = len as number;
    if (start < 0 || size < 2 || size > 101 || start + size > text.length || text[start] !== "@" || start < lastEnd) return null;
    lastEnd = start + size;
    mentions.push({ pos: start, len: size, uid });
  }
  return mentions;
}

/** The "@query" being typed right before the caret (null when the caret is not in a mention). */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /\s\s/.test(query) || (query.match(/\s/g)?.length ?? 0) > 3) return null;
  return { start: at, query };
}

function fold(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

/** Members whose name matches the query (accents ignored), best first; @All is offered when it matches. */
export function suggestMembers<T extends MentionPick>(members: readonly T[], query: string, limit = 8): Array<T | MentionPick> {
  const needle = fold(query.trim());
  const scored = members.filter((member) => !needle || fold(member.name).includes(needle))
    .map((member) => ({ member, score: fold(member.name).startsWith(needle) ? 0 : fold(member.name).split(/\s+/).some((word) => word.startsWith(needle)) ? 1 : 2 }))
    .sort((a, b) => a.score - b.score || a.member.name.localeCompare(b.member.name, "vi"));
  const all = !needle || "all".startsWith(needle) || "tat ca".startsWith(needle) ? [MENTION_ALL] : [];
  return [...all, ...scored.map((item) => item.member)].slice(0, limit);
}
