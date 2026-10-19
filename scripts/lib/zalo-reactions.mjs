// Reactions on Zalo messages, read from Deplao's messages.reactions JSON, e.g.
// {"total":2,"lastReact":"❤️","emoji":{"❤️":{"total":2,"users":{"<viewer-scoped id>":1}}}}
// Pure helpers; unit-tested. "mine" = emojis the nick itself added (its own id is the owner id).
import { createHash } from "node:crypto";

const MAX_EMOJI = 30;

export function summarizeReactions(raw, ownerZaloId) {
  let parsed;
  try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
  const emoji = parsed && typeof parsed === "object" && parsed.emoji && typeof parsed.emoji === "object" ? parsed.emoji : null;
  if (!emoji) return null;
  const summary = [], mine = [];
  for (const [key, value] of Object.entries(emoji)) {
    const label = String(key).trim();
    const count = Number(value?.total);
    if (!label || label.length > 16 || !Number.isSafeInteger(count) || count <= 0) continue;
    summary.push({ emoji: label, count });
    if (value?.users && typeof value.users === "object" && Number(value.users[ownerZaloId]) > 0) mine.push(label);
  }
  summary.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
  return summary.length ? { summary: summary.slice(0, MAX_EMOJI), mine: mine.slice(0, MAX_EMOJI) } : null;
}

export function reactionHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

/** Messages of this nick with reactions, newer than sinceMs. */
export function selectReactedMessages(database, ownerZaloId, sinceMs) {
  return database.prepare(`select msg_id msgId, reactions from messages
    where owner_zalo_id = ? and channel = 'zalo' and timestamp > ? and coalesce(msg_id, '') glob '[0-9]*'
      and reactions is not null and reactions not in ('', '{}', 'null')`).all(ownerZaloId, sinceMs);
}

/** Rows to write and message ids to clear, given the last written hashes {msgId: hash}. */
export function planReactionChanges(rows, ownerZaloId, previous) {
  const upserts = [], next = {};
  for (const row of rows) {
    const value = summarizeReactions(row.reactions, ownerZaloId);
    if (!value) continue;
    const hash = reactionHash(value);
    next[row.msgId] = hash;
    if (previous[row.msgId] !== hash) upserts.push({ msgId: String(row.msgId), ...value });
  }
  const removed = Object.keys(previous).filter((id) => !(id in next));
  return { upserts, removed, next };
}
