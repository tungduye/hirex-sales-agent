// Settles Zalo nicks that the adapter keeps locked after a send ended "delivery unknown" (the adapter does
// not know whether Zalo got the message, so it refuses every later send from that nick until someone decides).
// Pure helpers over the two local SQLite files; unit-tested. The script reconcile-zalo-send-locks.mjs runs them.
//
//   * The message shows up in Deplao's own sent history (same nick, same chat, right time, same text)
//     -> it was delivered: record it as SENT and free the nick.
//   * It does not show up after WAIT_MS while Deplao kept recording that nick's messages (or after
//     GIVE_UP_MS at the latest) -> most likely never delivered: free the nick without sending it again.
// Nothing here ever sends a message.

export const WAIT_MS = 30 * 60_000;
export const GIVE_UP_MS = 6 * 60 * 60_000;
const BEFORE_MS = 60_000, AFTER_MS = 15 * 60_000;

/** Nicks currently locked in the adapter, with the send that holds each lock. */
export function selectHeldLocks(adapterDb) {
  return adapterDb.prepare(`select g.account_id accountId, s.hirex_idempotency_key idempotencyKey, s.thread_id threadId, s.state state,
      s.reconciliation_status reconciliationStatus, coalesce(s.provider_invoked_at, s.execution_started_at, s.started_at, s.created_at) invokedAt
    from account_gates g join send_ledger s on s.id = g.active_ledger_id order by g.account_id`).all()
    .map((row) => ({ ...row }));
}

export function normalizeText(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** Deplao keeps plain text for text messages; some message kinds store JSON with the text inside. */
export function messageText(content) {
  const text = String(content ?? "");
  if (!text.startsWith("{")) return text;
  try {
    const parsed = JSON.parse(text);
    for (const key of ["msg", "text", "title", "content"]) if (typeof parsed?.[key] === "string") return parsed[key];
  } catch { /* plain text that starts with a brace */ }
  return text;
}

/**
 * The message a locked send produced, if Deplao recorded it: sent by the same nick into the same chat between
 * one minute before and fifteen minutes after the send. With the HireX text known, the text must match;
 * without it (attachment only) there must be exactly one such message.
 */
export function findSentMessage(deplaoDb, lock, text) {
  const at = Date.parse(lock.invokedAt);
  if (!Number.isFinite(at)) return null;
  const rows = deplaoDb.prepare(`select msg_id msgId, thread_id threadId, content, timestamp from messages
    where owner_zalo_id = ? and thread_id = ? and is_sent = 1 and timestamp between ? and ? and coalesce(msg_id, '') <> ''
    order by timestamp`).all(lock.accountId, lock.threadId, at - BEFORE_MS, at + AFTER_MS);
  const wanted = normalizeText(text);
  if (wanted) {
    const match = rows.find((row) => normalizeText(messageText(row.content)) === wanted);
    return match ? { msgId: String(match.msgId), threadId: String(match.threadId), timestamp: Number(match.timestamp) } : null;
  }
  return rows.length === 1 ? { msgId: String(rows[0].msgId), threadId: String(rows[0].threadId), timestamp: Number(rows[0].timestamp) } : null;
}

/** True when Deplao recorded any message of this nick well after the send (so it was listening and would have seen it). */
export function recordedLaterActivity(deplaoDb, lock) {
  const at = Date.parse(lock.invokedAt);
  if (!Number.isFinite(at)) return false;
  return Boolean(deplaoDb.prepare("select 1 from messages where owner_zalo_id = ? and timestamp > ? limit 1").get(lock.accountId, at + AFTER_MS));
}

/** CONFIRM (found), RELEASE (free without resending), or WAIT. Only "delivery unknown" locks are settled. */
export function decide(lock, found, laterActivity, now) {
  if (lock.state !== "UNKNOWN") return "WAIT";
  if (found) return "CONFIRM";
  const age = now - Date.parse(lock.invokedAt);
  if (!Number.isFinite(age)) return "WAIT";
  if ((age >= WAIT_MS && laterActivity) || age >= GIVE_UP_MS) return "RELEASE";
  return "WAIT";
}

/** When a waiting lock will be released at the latest if the message never shows up. */
export function autoReleaseAt(lock) {
  const at = Date.parse(lock.invokedAt);
  return lock.state === "UNKNOWN" && Number.isFinite(at) ? new Date(at + WAIT_MS).toISOString() : null;
}
