// One Zalo group, several of our nicks in it: each nick has its own copy of the conversation, so
// the list showed the same group once per nick. These helpers fold the copies into one row. Pure;
// unit-tested. One-to-one chats are never merged (two nicks talking to the same person are two
// different chats).

export interface GroupCopy {
  id: string;
  channelType: string;
  isGroup: boolean;
  providerConversationId: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isPinned: boolean;
  latestText: string | null;
  latestDirection: "INBOUND" | "OUTBOUND" | null;
  senderExternalId: string | null;
  lastInboundAt: string | null;
}

/** Key shared by every copy of the same group; null when the row is not a mergeable group. */
export function groupKeyOf(item: Pick<GroupCopy, "channelType" | "isGroup" | "providerConversationId">): string | null {
  return item.channelType === "ZALO" && item.isGroup && item.providerConversationId ? `ZALO:${item.providerConversationId}` : null;
}

function later(a: string | null | undefined, b: string | null | undefined) {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Folds copies of the same group into one row, kept where the newest copy was (the list is newest
 * first). The row opens the copy of the nick that last wrote in the group (lastOutboundAt), or the
 * newest copy when none of our nicks wrote yet (so it also shows that nick's name). Preview and time
 * come from the newest copy; unread
 * is the highest of the copies (they hold the same messages, so adding would double count).
 */
export function mergeGroupCopies<T extends GroupCopy>(items: readonly T[], lastOutboundAt: ReadonlyMap<string, string>): Array<T & { groupKey: string | null; copyIds: string[] }> {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const key = groupKeyOf(item);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  const result: Array<T & { groupKey: string | null; copyIds: string[] }> = [];
  const placed = new Set<string>();
  for (const item of items) {
    const key = groupKeyOf(item);
    if (!key) { result.push({ ...item, groupKey: null, copyIds: [item.id] }); continue; }
    if (placed.has(key)) continue;
    placed.add(key);
    const copies = byKey.get(key)!;
    if (copies.length === 1) { result.push({ ...item, groupKey: key, copyIds: [item.id] }); continue; }
    let chosen = copies[0]!;
    let chosenAt: string | null = lastOutboundAt.get(chosen.id) ?? null;
    for (const copy of copies.slice(1)) {
      const at = lastOutboundAt.get(copy.id) ?? null;
      if (at && (!chosenAt || Date.parse(at) > Date.parse(chosenAt))) { chosen = copy; chosenAt = at; }
    }
    const newest = copies[0]!;
    result.push({
      ...chosen,
      latestText: newest.latestText,
      latestDirection: newest.latestDirection,
      senderExternalId: newest.senderExternalId,
      lastInboundAt: copies.reduce<string | null>((value, copy) => later(value, copy.lastInboundAt), null),
      lastMessageAt: copies.reduce<string | null>((value, copy) => later(value, copy.lastMessageAt), null),
      unreadCount: Math.max(...copies.map((copy) => copy.unreadCount)),
      isPinned: copies.some((copy) => copy.isPinned),
      groupKey: key,
      copyIds: [chosen.id, ...copies.filter((copy) => copy.id !== chosen.id).map((copy) => copy.id)],
    });
  }
  return result;
}

/** Adds rows from a later page: a copy of a group that is already listed joins that row. */
export function appendPage<T extends { id: string; groupKey: string | null; copyIds: string[] }>(current: readonly T[], incoming: readonly T[]): T[] {
  const ids = new Set(current.flatMap((item) => item.copyIds.length ? item.copyIds : [item.id]));
  const next = [...current];
  for (const item of incoming) {
    if (ids.has(item.id)) continue;
    const index = item.groupKey ? next.findIndex((row) => row.groupKey === item.groupKey) : -1;
    if (index >= 0) {
      const row = next[index]!;
      next[index] = { ...row, copyIds: [...row.copyIds, ...item.copyIds.filter((id) => !row.copyIds.includes(id))] };
    } else next.push(item);
    for (const id of item.copyIds) ids.add(id);
  }
  return next;
}

/** The listed row a message or conversation update belongs to (any copy of a merged group). */
export function rowIndexFor<T extends { id: string; copyIds: string[] }>(items: readonly T[], conversationId: string): number {
  return items.findIndex((item) => item.id === conversationId || item.copyIds.includes(conversationId));
}
