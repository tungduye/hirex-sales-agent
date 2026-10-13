import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { acquireRecentLock, loadRecentState, reconcileRecentMessages, saveRecentState, selectRecentAccounts } from "./lib/zalo-recent-reconciliation.mjs";
import { persistHistoryMessage } from "./lib/zalo-history-remote-writer.mjs";

const since = "2026-09-24T07:50:00.000Z";
const profileRoot = path.join(tmpdir(), "hirex-recent-fixture");
function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`create table accounts (zalo_id text,channel text,is_active integer);
    create table messages (id integer primary key autoincrement,owner_zalo_id text,msg_id text,thread_id text,thread_type integer,
      sender_id text,content text,msg_type text,timestamp integer,is_sent integer,attachments text,local_paths text,channel text);
    create table contacts (owner_zalo_id text,contact_id text,display_name text,avatar_url text);
    insert into accounts values ('111','zalo',1),('222','zalo',1),('333','zalo',0),('444','zalo',1);`);
  const add = (accountId, id, timestamp = Date.parse(since) + id) => database.prepare(`insert into messages
    (owner_zalo_id,msg_id,thread_id,thread_type,sender_id,content,msg_type,timestamp,is_sent,attachments,local_paths,channel)
    values (?,?,'999',0,'999','test','webchat',?,0,'[]','{}','zalo')`).run(accountId, String(id), timestamp);
  const remote = ["111", "222", "333", "444"].map((id) => ({ id: `remote-${id}`, workspace_id: "workspace", external_account_id: id,
    channel_type: "ZALO", provider: "ZALO_BRIDGE", status: "CONNECTED", operator_enabled: true, deleted_at: id === "444" ? since : null }));
  const state = { version: 1, sourcePath: "fixture", since, accounts: {} };
  return { database, add, remote, state };
}

test("drains over 200 messages for every account, even with nonmonotonic timestamps", async () => {
  const { database, add, remote, state } = fixture();
  try {
    add("111", 1, Date.parse(since) - 1); // historical data stays outside this worker's scope
    for (let i = 2; i <= 451; i += 1) { add("111", i); add("222", i, Date.parse(since) + (452 - i)); }
    add("333", 2); add("444", 2);
    const messages = [];
    const summary = await reconcileRecentMessages({ database, accounts: selectRecentAccounts(database, remote), state, profileRoot,
      persist: async (account, message) => messages.push(`${account.external_account_id}:${message.providerMessageId}`), checkpoint: async () => {} });
    assert.equal(summary.accounts, 2);
    assert.equal(summary.processed, 900);
    assert.equal(summary.pending, 0);
    assert.equal(new Set(messages).size, 900);
    assert.equal(messages.filter((id) => id.startsWith("111:")).length, 450);
    assert.equal(messages.filter((id) => id.startsWith("222:")).length, 450);
    assert.equal(state.accounts["333"], undefined);
    assert.equal(state.accounts["444"], undefined);
  } finally { database.close(); }
});

test("a failed row keeps its account cursor, other accounts continue, restart retries without a gap", async () => {
  const { database, add, remote, state } = fixture();
  const directory = mkdtempSync(path.join(tmpdir(), "hirex-recent-state-"));
  const statePath = path.join(directory, "state.json");
  state.sourcePath = path.resolve("fixture");
  try {
    for (let i = 1; i <= 350; i += 1) add("111", i);
    add("222", 1);
    const accounts = selectRecentAccounts(database, remote);
    const first = [];
    let summary = await reconcileRecentMessages({ database, accounts, state, profileRoot,
      persist: async (account, message) => {
        if (account.external_account_id === "111" && message.providerMessageId === "221") throw new Error("TEST_REMOTE_UNAVAILABLE");
        first.push(`${account.external_account_id}:${message.providerMessageId}`);
      }, checkpoint: (value) => saveRecentState(statePath, value) });
    assert.equal(summary.failedAccounts, 1);
    assert.equal(summary.processed, 221);
    assert.equal(summary.pending, 130);
    const restored = loadRecentState(statePath, "fixture", "2026-09-25T00:00:00Z");
    assert.equal(restored.since, since);
    assert.equal(restored.accounts["111"].lastRowId, "220");
    const second = [];
    summary = await reconcileRecentMessages({ database, accounts, state: restored, profileRoot,
      persist: async (account, message) => second.push(`${account.external_account_id}:${message.providerMessageId}`),
      checkpoint: (value) => saveRecentState(statePath, value) });
    assert.equal(summary.processed, 130);
    assert.equal(summary.pending, 0);
    assert.equal(second[0], "111:221");
    assert.equal(new Set([...first, ...second]).size, 351);
    assert.equal(restored.accounts["111"].failure, undefined);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("bounded runs preserve pending work and catch messages inserted while the worker was stopped", async () => {
  const { database, add, remote, state } = fixture();
  try {
    for (let i = 1; i <= 250; i += 1) add("111", i);
    const input = { database, accounts: selectRecentAccounts(database, remote), state, profileRoot,
      persist: async () => {}, checkpoint: async () => {}, batchSize: 100, maxPerAccount: 200 };
    let summary = await reconcileRecentMessages(input);
    assert.equal(summary.processed, 200);
    assert.equal(summary.pending, 50);
    add("111", 251, Date.parse(since) + 1); // late arrival has older provider time but higher local ID
    summary = await reconcileRecentMessages(input);
    assert.equal(summary.processed, 51);
    assert.equal(summary.pending, 0);
    summary = await reconcileRecentMessages(input);
    assert.equal(summary.processed, 0);
  } finally { database.close(); }
});

test("invalid messages remain pending, and a replaced/rewound local database fails visibly", async () => {
  const { database, add, remote, state } = fixture();
  try {
    add("111", 1); add("111", 2);
    database.prepare("update messages set sender_id='' where id=1").run();
    const input = { database, accounts: selectRecentAccounts(database, remote), state, profileRoot,
      persist: async () => {}, checkpoint: async () => {} };
    let summary = await reconcileRecentMessages(input);
    assert.equal(summary.processed, 0);
    assert.equal(summary.pending, 2);
    assert.equal(summary.failures[0].code, "RECENT_ROW_INVALID");
    state.accounts["111"].lastRowId = "50";
    summary = await reconcileRecentMessages(input);
    assert.equal(summary.failures[0].code, "RECENT_SOURCE_REWOUND");
    assert.equal(state.accounts["111"].lastRowId, "50");
  } finally { database.close(); }
});

test("state creation is read-only until explicit checkpoint, and lock excludes overlapping runs", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "hirex-recent-lock-"));
  const statePath = path.join(directory, "state.json");
  try {
    const state = loadRecentState(statePath, "source.db", since);
    assert.throws(() => readFileSync(statePath), { code: "ENOENT" });
    saveRecentState(statePath, state);
    assert.deepEqual(loadRecentState(statePath, "source.db"), state);
    assert.throws(() => loadRecentState(statePath, "other.db"), /RECENT_STATE_INVALID/u);
    const release = acquireRecentLock(`${statePath}.lock`);
    assert.equal(typeof release, "function");
    assert.equal(acquireRecentLock(`${statePath}.lock`), null);
    release();
    const releaseAgain = acquireRecentLock(`${statePath}.lock`);
    assert.equal(typeof releaseAgain, "function");
    releaseAgain();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function fakeClient(responses) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, operation: "select", values: null };
    const query = {
      select() { return query; }, eq() { return query; }, is() { return query; },
      insert(values) { call.operation = "insert"; call.values = values; return query; },
      upsert(values) { call.operation = "upsert"; call.values = values; return query; },
      update(values) { call.operation = "update"; call.values = values; return query; },
      then(resolve, reject) { calls.push(call); const response = responses.shift(); return Promise.resolve(response ?? { data: null, error: null }).then(resolve, reject); },
      single() { return query; }, maybeSingle() { return query; },
    };
    return query;
  } };
}
const message = { accountId: "111", providerConversationId: "999", conversationKind: "USER", direction: "INBOUND", senderId: "999",
  conversationName: "Provider name", avatarUrl: null, occurredAt: since, attachmentCount: 0, media: [], providerMessageId: "123",
  idempotencyKey: "123", text: "hello", messageType: "webchat" };
const mapping = { workspaceId: "workspace", accounts: new Map([["111", "account"]]) };

test("recent writer accepts a simultaneous webhook message insert and preserves existing identity", async () => {
  const client = fakeClient([
    { data: { id: "account" } },
    { data: { id: "conversation", contact_id: "contact", last_message_at: since, metadata: { operatorLabel: "keep" } } },
    { data: null },
    { error: { code: "23505" } },
    { data: { id: "webhook-message", conversation_id: "conversation" } },
  ]);
  const result = await persistHistoryMessage(client, mapping, message, { reconcile: true, skipMedia: true });
  assert.equal(result.messageId, "webhook-message");
  assert.equal(client.calls.some((call) => call.operation === "update"), false);
  const inserted = client.calls.find((call) => call.table === "omnichannel_messages" && call.operation === "insert");
  assert.equal(inserted.values.metadata.syncSource, "recent-reconciliation");
  assert.equal(inserted.values.metadata.historical, undefined);
});

test("recent writer blocks accounts deleted or disabled after discovery", async () => {
  const client = fakeClient([{ data: null }]);
  await assert.rejects(persistHistoryMessage(client, mapping, message, { reconcile: true, skipMedia: true }), /CHANNEL_ACCOUNT_INACTIVE/u);
  assert.equal(client.calls.length, 1);
});
