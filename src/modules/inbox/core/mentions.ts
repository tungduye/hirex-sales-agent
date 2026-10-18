// Highlighting "@Name" mentions in Zalo group messages. Pure; unit-tested.
// Zalo sends mentions as plain "@Display name" text, so they are found by the group's member names.

export interface TextPart { text: string; mention: boolean; mine: boolean }

const EVERYONE = ["All", "all", "Tất cả", "tất cả"];

/**
 * Splits text into plain parts and "@Name" mentions of known members (longest name first, so "@Lan Anh" wins over
 * "@Lan"). `mine` marks a mention of the member's own nick (or @All), shown more strongly.
 */
export function splitMentions(text: string, names: readonly string[], mineNames: readonly string[]): TextPart[] {
  const candidates = [...new Set([...names, ...EVERYONE].map((name) => name.trim()).filter((name) => name.length > 0 && name.length <= 80))]
    .sort((a, b) => b.length - a.length);
  const mine = new Set([...mineNames.map((name) => name.trim().toLocaleLowerCase("vi")).filter(Boolean), ...EVERYONE.map((name) => name.toLocaleLowerCase("vi"))]);
  const parts: TextPart[] = [];
  let plain = "";
  let index = 0;
  const lower = text.toLocaleLowerCase("vi");
  while (index < text.length) {
    if (text[index] === "@") {
      // The name must end at a word boundary: "@All" is not a mention inside "@Allen".
      const found = candidates.find((name) => lower.startsWith(name.toLocaleLowerCase("vi"), index + 1)
        && !/[\p{L}\p{N}]/u.test(text[index + 1 + name.length] ?? ""));
      if (found) {
        if (plain) { parts.push({ text: plain, mention: false, mine: false }); plain = ""; }
        const value = text.slice(index, index + 1 + found.length);
        parts.push({ text: value, mention: true, mine: mine.has(found.toLocaleLowerCase("vi")) });
        index += 1 + found.length;
        continue;
      }
    }
    plain += text[index];
    index += 1;
  }
  if (plain) parts.push({ text: plain, mention: false, mine: false });
  return parts;
}
