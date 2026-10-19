// Zalo's six quick reactions, as HireX shows and sends them. "icon" is the name the Zalo bridge understands.

export const QUICK_REACTIONS = [
  { icon: "HEART", emoji: "❤️", label: "Thả tim" },
  { icon: "LIKE", emoji: "👍", label: "Thích" },
  { icon: "HAHA", emoji: "😆", label: "Haha" },
  { icon: "WOW", emoji: "😮", label: "Ngạc nhiên" },
  { icon: "CRY", emoji: "😭", label: "Buồn" },
  { icon: "ANGRY", emoji: "😡", label: "Phẫn nộ" },
] as const;
export type QuickReactionIcon = (typeof QUICK_REACTIONS)[number]["icon"];

export interface MessageReaction { emoji: string; count: number; mine: boolean }

export function isQuickReactionIcon(value: unknown): value is QuickReactionIcon {
  return QUICK_REACTIONS.some((item) => item.icon === value);
}

/** Reactions as stored for one message ({summary, mine}) -> what the bubble shows. */
export function toMessageReactions(summary: unknown, mine: unknown): MessageReaction[] {
  if (!Array.isArray(summary)) return [];
  const own = new Set(Array.isArray(mine) ? mine.filter((item): item is string => typeof item === "string") : []);
  return summary.flatMap((item) => item && typeof item === "object" && typeof (item as { emoji?: unknown }).emoji === "string" &&
    Number.isSafeInteger((item as { count?: unknown }).count) && (item as { count: number }).count > 0
    ? [{ emoji: (item as { emoji: string }).emoji, count: (item as { count: number }).count, mine: own.has((item as { emoji: string }).emoji) }] : []);
}

/** Shown right away after the nick reacted (Zalo counts every tap, like the app). */
export function withMyReaction(reactions: readonly MessageReaction[], emoji: string): MessageReaction[] {
  const index = reactions.findIndex((item) => item.emoji === emoji);
  if (index < 0) return [...reactions, { emoji, count: 1, mine: true }];
  return reactions.map((item, position) => position === index ? { ...item, count: item.count + 1, mine: true } : item);
}
