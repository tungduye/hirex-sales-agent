import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mapZaloHistoryRow } from "./zalo-history-backfill.mjs";

const positiveId = /^[1-9][0-9]*$/u;
const cursorId = /^(?:0|[1-9][0-9]*)$/u;
const timestampSql = "case when m.timestamp < 100000000000 then m.timestamp * 1000 else m.timestamp end";

export function loadRecentState(statePath, sourcePath, since = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(since))) throw new Error("RECENT_SINCE_INVALID");
  if (!existsSync(statePath)) return { version: 1, sourcePath: path.resolve(sourcePath), since: new Date(since).toISOString(), accounts: {} };
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (state?.version !== 1 || state.sourcePath !== path.resolve(sourcePath) || !Number.isFinite(Date.parse(state.since)) ||
      !state.accounts || typeof state.accounts !== "object" || Array.isArray(state.accounts)) throw new Error("RECENT_STATE_INVALID");
  for (const [accountId, value] of Object.entries(state.accounts)) {
    if (!positiveId.test(accountId) || !value || !cursorId.test(value.lastRowId)) throw new Error("RECENT_STATE_INVALID");
  }
  return state;
}

export function saveRecentState(statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify(state));
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, statePath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

// Prevent a manual invocation racing the supervisor and regressing checkpoints.
export function acquireRecentLock(lockPath) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try { descriptor = openSync(lockPath, "wx", 0o600); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      try { owner = JSON.parse(readFileSync(lockPath, "utf8")); } catch { return null; }
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error("RECENT_LOCK_INVALID");
      try { process.kill(owner.pid, 0); return null; }
      catch (probeError) {
        if (probeError.code !== "ESRCH") return null;
        unlinkSync(lockPath);
        continue;
      }
    }
    const token = randomUUID();
    try { writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token })); }
    finally { closeSync(descriptor); }
    return () => {
      if (existsSync(lockPath) && JSON.parse(readFileSync(lockPath, "utf8")).token === token) unlinkSync(lockPath);
    };
  }
  throw new Error("RECENT_LOCK_UNAVAILABLE");
}

export function selectRecentAccounts(database, remoteAccounts) {
  const localIds = new Set(database.prepare("select cast(zalo_id as text) account_id from accounts where channel='zalo' and is_active=1").all()
    .map((row) => row.account_id));
  const seen = new Set();
  return remoteAccounts.filter((account) => account.channel_type === "ZALO" && account.provider === "ZALO_BRIDGE" &&
    account.status === "CONNECTED" && account.operator_enabled === true && account.deleted_at === null && localIds.has(account.external_account_id))
    .map((account) => {
      if (!positiveId.test(account.external_account_id) || typeof account.id !== "string" || typeof account.workspace_id !== "string" || seen.has(account.external_account_id))
        throw new Error("RECENT_ACCOUNT_MAPPING_INVALID");
      seen.add(account.external_account_id);
      return account;
    });
}

export function countRecentPending(database, accountId, cursor, since) {
  return Number(database.prepare(`select count(*) total from messages m where m.channel='zalo' and m.owner_zalo_id=? and m.id>? and ${timestampSql}>=?`)
    .get(accountId, BigInt(cursor), Date.parse(since)).total);
}

function recentBatch(database, accountId, cursor, upper, since, batchSize) {
  return database.prepare(`select cast(m.id as text) local_row_id, cast(m.owner_zalo_id as text) account_id,
    cast(m.msg_id as text) provider_message_id, cast(m.thread_id as text) thread_id, m.thread_type,
    cast(m.sender_id as text) sender_id, m.content, m.msg_type, cast(m.timestamp as text) timestamp_text,
    m.is_sent, m.attachments, m.local_paths, c.display_name conversation_name, c.avatar_url
    from messages m left join contacts c on c.owner_zalo_id=m.owner_zalo_id and c.contact_id=m.thread_id
    where m.channel='zalo' and m.owner_zalo_id=? and m.id>? and m.id<=? and ${timestampSql}>=?
    order by m.id asc limit ?`).all(accountId, BigInt(cursor), BigInt(upper), Date.parse(since), batchSize);
}

export async function reconcileRecentMessages({ database, accounts, state, profileRoot, persist, checkpoint,
  batchSize = 100, maxPerAccount = 1000 }) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500 || !Number.isSafeInteger(maxPerAccount) || maxPerAccount < batchSize)
    throw new Error("RECENT_BATCH_CONFIGURATION_INVALID");
  const summary = { accounts: accounts.length, processed: 0, failedAccounts: 0, pending: 0, failures: [] };
  for (const account of accounts) {
    const externalId = account.external_account_id;
    const cursor = state.accounts[externalId] ??= { lastRowId: "0" };
    const upper = database.prepare("select cast(coalesce(max(id),0) as text) upper_id from messages where channel='zalo' and owner_zalo_id=?").get(externalId).upper_id;
    let processed = 0;
    try {
      if (BigInt(upper) < BigInt(cursor.lastRowId)) throw new Error("RECENT_SOURCE_REWOUND");
      while (processed < maxPerAccount) {
        const rows = recentBatch(database, externalId, cursor.lastRowId, upper, state.since, Math.min(batchSize, maxPerAccount - processed));
        if (rows.length === 0) {
          cursor.lastRowId = upper;
          delete cursor.failure;
          await checkpoint(state);
          break;
        }
        for (const row of rows) {
          const mapped = mapZaloHistoryRow(row, profileRoot);
          if (!mapped.ok) throw new Error("RECENT_ROW_INVALID");
          await persist(account, mapped.value);
          cursor.lastRowId = row.local_row_id;
          cursor.lastSuccessAt = new Date().toISOString();
          delete cursor.failure;
          // The remote insert is idempotent; a crash before this rename replays
          // the row. A failed row never moves the cursor past that row.
          await checkpoint(state);
          processed += 1;
          summary.processed += 1;
        }
      }
    } catch (error) {
      // Only stable internal codes enter state/logs, never message content or tokens.
      const code = /^[A-Z][A-Z0-9_]{0,100}$/u.test(error.message) ? error.message : "RECENT_PERSIST_FAILED";
      cursor.failure = { code, at: new Date().toISOString() };
      await checkpoint(state);
      summary.failedAccounts += 1;
      summary.failures.push({ accountId: account.id, code });
    }
    summary.pending += countRecentPending(database, externalId, cursor.lastRowId, state.since);
  }
  return summary;
}
