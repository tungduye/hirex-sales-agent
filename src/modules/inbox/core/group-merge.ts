// One Zalo group, several of our nicks in it: each nick has its own copy of the conversation, so
// the list showed the same group once per nick. These helpers fold the copies into one row. Pure;
// unit-tested.
//
// Zalo gives every nick a different id for the same group, so copies are matched by group name.
// Safety: a name that one nick has twice (two different groups with the same name) is never
// merged. One-to-one chats are never merged (two nicks talking to the same person are two chats).

export interface GroupCopy {
  id: string;
  channelAccountId: string;
  channelType: string;
  isGroup: boolean;
  subject: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isPinned: boolean;
  latestText: string | null;
  latestDirection: "INBOUND" | "OUTBOUND" | null;
  senderExternalId: string | null;
  lastInboundAt: string | null;
}

export function normalizeGroupName(name: string | null | undefined) {
  return (name ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
}

/** Key shared by every copy of the same group; null when the row is not a mergeable group. */
export function groupKeyOf(item: Pick<GroupCopy, "channelType" | "isGroup" | "subject">): string | null {
  const name = normalizeGroupName(item.subject);
  return item.channelType === "ZALO" && item.isGroup && name ? `ZALO:${name}` : null;
}

function later(a: string | null | undefined, b: string | null | undefined) {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** Group names (as keys) that one nick has more than once, from {subject, channel account} rows. */
export function ambiguousGroupKeys(rows: ReadonlyArray<{ subject: string | null; channelAccountId: string }>) {
  const seen = new Set<string>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    const name = normalizeGroupName(row.subject);
    if (!name) continue;
    const key = `ZALO:${name}`;
    const pair = `${key}\u0000${row.channelAccountId}`;
    if (seen.has(pair)) ambiguous.add(key); else seen.add(pair);
  }
  return ambiguous;
}

/** True when the copies are one per nick (no nick has two groups with this name). */
export function oneCopyPerNick(accountIds: readonly string[]) {
  return new Set(accountIds).size === accountIds.length;
}

/**
 * Folds copies of the same group into one row, kept where the newest copy was (the list is newest
 * first). The row opens the copy of the nick that last wrote in the group (lastOutboundAt), or the
 * newest copy when none of our nicks wrote yet (so it also shows that nick's name). Preview and time
 * come from the newest copy; unread is the highest of the copies (they hold the same messages, so
 * adding would double count). ambiguousKeys: names some nick has twice anywhere (not only on
 * this page); those are never merged.
 */
export function mergeGroupCopies<T extends GroupCopy>(items: readonly T[], lastOutboundAt: ReadonlyMap<string, string>, ambiguousKeys: ReadonlySet<string> = new Set()): Array<T & { groupKey: string | null; copyIds: string[]; copyAccountIds: string[] }> {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const key = groupKeyOf(item);
    if (key && !ambiguousKeys.has(key)) byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  for (const [key, copies] of byKey) if (!oneCopyPerNick(copies.map((copy) => copy.channelAccountId))) byKey.delete(key);
  const result: Array<T & { groupKey: string | null; copyIds: string[]; copyAccountIds: string[] }> = [];
  const placed = new Set<string>();
  for (const item of items) {
    const key = groupKeyOf(item);
    const copies = key ? byKey.get(key) : undefined;
    if (!key || !copies) { result.push({ ...item, groupKey: null, copyIds: [item.id], copyAccountIds: [item.channelAccountId] }); continue; }
    if (placed.has(key)) continue;
    placed.add(key);
    if (copies.length === 1) { result.push({ ...item, groupKey: key, copyIds: [item.id], copyAccountIds: [item.channelAccountId] }); continue; }
    let chosen = copies[0]!;
    let chosenAt: string | null = lastOutboundAt.get(chosen.id) ?? null;
    for (const copy of copies.slice(1)) {
      const at = lastOutboundAt.get(copy.id) ?? null;
      if (at && (!chosenAt || Date.parse(at) > Date.parse(chosenAt))) { chosen = copy; chosenAt = at; }
    }
    const newest = copies[0]!;
    const ordered = [chosen, ...copies.filter((copy) => copy.id !== chosen.id)];
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
      copyIds: ordered.map((copy) => copy.id),
      copyAccountIds: ordered.map((copy) => copy.channelAccountId),
    });
  }
  return result;
}

/** Adds rows from a later page: a copy of a group that is already listed joins that row (one per nick). */
export function appendPage<T extends { id: string; groupKey: string | null; copyIds: string[]; copyAccountIds: string[] }>(current: readonly T[], incoming: readonly T[]): T[] {
  const ids = new Set(current.flatMap((item) => item.copyIds.length ? item.copyIds : [item.id]));
  const next = [...current];
  for (const item of incoming) {
    // Pages can overlap (rows with the same time), so copies already listed are dropped first.
    const fresh = item.copyIds.map((id, index) => ({ id, accountId: item.copyAccountIds[index] ?? "" })).filter((copy) => !ids.has(copy.id));
    if (fresh.length === 0) continue;
    const index = item.groupKey ? next.findIndex((row) => row.groupKey === item.groupKey) : -1;
    const row = index >= 0 ? next[index]! : null;
    if (row && oneCopyPerNick([...row.copyAccountIds, ...fresh.map((copy) => copy.accountId)])) {
      next[index] = { ...row, copyIds: [...row.copyIds, ...fresh.map((copy) => copy.id)], copyAccountIds: [...row.copyAccountIds, ...fresh.map((copy) => copy.accountId)] };
    } else if (ids.has(item.id)) {
      // The row this page would open is already listed elsewhere; list its new copies on their own.
      for (const copy of fresh) next.push({ ...item, id: copy.id, groupKey: null, copyIds: [copy.id], copyAccountIds: [copy.accountId] });
    } else next.push(row ? { ...item, groupKey: null, copyIds: fresh.map((copy) => copy.id), copyAccountIds: fresh.map((copy) => copy.accountId) } : item);
    for (const copy of fresh) ids.add(copy.id);
  }
  return next;
}

/** The listed row a message or conversation update belongs to (any copy of a merged group). */
export function rowIndexFor<T extends { id: string; copyIds: string[] }>(items: readonly T[], conversationId: string): number {
  return items.findIndex((item) => item.id === conversationId || item.copyIds.includes(conversationId));
}
