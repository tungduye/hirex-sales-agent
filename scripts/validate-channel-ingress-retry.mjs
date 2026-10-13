#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exercise the real ingestion function with a failure-injecting persistence
// double. No provider calls, credentials, or production rows are used.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  if (specifier === "@/lib/supabase/privileged") return {
    url: "data:text/javascript,export const createPrivilegedClient=()=>globalThis.__ingressClient;", shortCircuit: true,
  };
  if (specifier === "./run-channel-automations") return {
    url: "data:text/javascript,export const runMessageReceivedAutomations=(input)=>globalThis.__ingressAutomations(input);", shortCircuit: true,
  };
  if (specifier.startsWith("@/") || (specifier.startsWith(".") && context.parentURL?.startsWith("file:"))) {
    const base = specifier.startsWith("@/")
      ? fileURLToPath(new URL(`../src/${specifier.slice(2)}`, import.meta.url))
      : fileURLToPath(new URL(specifier, context.parentURL));
    const file = [base, `${base}.ts`].find(existsSync);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

const { ingestChannelWebhook } = await import("../src/modules/channels/server/ingest-channel-webhook.ts");
let assertions = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };

class Database {
  clock = 1_800_000_000_000;
  sequence = 0;
  fail = null;
  storage = { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) };
  tables = new Map([["channel_accounts", [{ id: "account", workspace_id: "workspace", external_account_id: "self",
    status: "CONNECTED", channel_type: "ZALO", operator_enabled: true, provider_health_status: "HEALTHY" }]]]);
  rows(table) { if (!this.tables.has(table)) this.tables.set(table, []); return this.tables.get(table); }
  from(table) { return new Query(this, table); }
  rpc(name, input) {
    assert.equal(name, "claim_channel_inbound_event");
    let event = this.rows("channel_inbound_events").find(row => row.provider_event_id === input.p_provider_event_id);
    if (!event) {
      event = { id: `event-${++this.sequence}`, provider_event_id: input.p_provider_event_id, status: "RECEIVED" };
      this.rows("channel_inbound_events").push(event);
    }
    let claim_status = "CLAIMED";
    if (event.status === "PROCESSED") claim_status = "PROCESSED";
    else if (event.status === "PROCESSING" && event.processing_lease_expires_at > this.clock) claim_status = "BUSY";
    else Object.assign(event, { status: "PROCESSING", processing_token: `token-${++this.sequence}`,
      processing_lease_expires_at: this.clock + 300_000 });
    return { single: async () => ({ data: { event_id: event.id, claim_status,
      claim_token: claim_status === "CLAIMED" ? event.processing_token : null }, error: null }) };
  }
}

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.operation = "select"; }
  select() { return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  limit() { return this; }
  upsert(value, options = {}) { this.operation = "upsert"; this.value = value; this.options = options; return this; }
  insert(value) { this.operation = "insert"; this.value = value; return this; }
  update(value) { this.operation = "update"; this.value = value; return this; }
  delete() { this.operation = "delete"; return this; }
  async execute(single = false) {
    if (this.db.fail?.(this)) { this.db.fail = null; return { data: null, error: { code: "INJECTED_OUTAGE" } }; }
    let matched;
    const rows = this.db.rows(this.table);
    if (this.operation === "upsert") {
      const keys = (this.options.onConflict ?? "id").split(",");
      const existing = rows.find(row => keys.every(key => row[key] === this.value[key]));
      if (existing) {
        matched = this.options.ignoreDuplicates ? [] : [Object.assign(existing, this.value)];
      } else {
        const created = { id: `row-${++this.db.sequence}`, ...this.value };
        rows.push(created); matched = [created];
      }
    } else if (this.operation === "insert") {
      const created = { id: `row-${++this.db.sequence}`, ...this.value };
      rows.push(created); matched = [created];
    } else {
      matched = rows.filter(row => this.filters.every(predicate => predicate(row)));
      if (this.operation === "update") for (const row of matched) Object.assign(row, this.value);
      if (this.operation === "delete") this.db.tables.set(this.table, rows.filter(row => !matched.includes(row)));
    }
    return { data: single ? matched[0] ?? null : matched, error: null };
  }
  maybeSingle() { return this.execute(true); }
  single() { return this.execute(true); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

function fixture(channelType = "ZALO") {
  const database = new Database();
  database.rows("channel_accounts")[0].channel_type = channelType;
  globalThis.__ingressClient = database;
  const automationRuns = new Set();
  globalThis.__ingressAutomations = async input => { automationRuns.add(input.messageId); };
  const message = {
    workspaceId: "workspace", channelAccountId: "account", channelType, providerConversationId: "thread",
    providerMessageId: "message", providerEventId: "event", direction: "INBOUND", sender: { externalId: "peer", displayName: null },
    recipients: [{ externalId: "self", displayName: null }], text: "fixture", occurredAt: "2026-09-24T00:00:00Z",
    attachments: [], rawPayloadReference: null,
  };
  const adapter = {
    verifyWebhook: async () => ({ channelAccountId: "account", receivedAt: "2026-09-24T00:00:01Z" }),
    normalizeInbound: async () => [message],
  };
  return { database, automationRuns, message, run: () => ingestChannelWebhook({ adapter, channelAccountId: "account", channelType, headers: {}, body: "{}" }) };
}

// Fail at three separate persistence boundaries. The same provider event must
// be retained and retried, rather than falsely acknowledged as a duplicate.
for (const table of ["contacts", "omnichannel_conversations", "omnichannel_messages"]) {
  const test = fixture();
  test.database.fail = query => query.table === table && query.operation === "upsert";
  await assert.rejects(test.run()); assertions += 1;
  eq(test.database.rows("channel_inbound_events")[0].status, "FAILED");
  eq(await test.run(), { accepted: 1 });
  eq(test.database.rows("omnichannel_messages").length, 1);
  eq(test.database.rows("channel_inbound_events")[0].status, "PROCESSED");
  eq(await test.run(), { accepted: 0 });
  eq(test.automationRuns.size, 1);
}

// If completion cannot be saved, return a failure even though the message was
// saved. A retry must not create another message or another automation run.
{
  const test = fixture();
  test.database.fail = query => query.table === "channel_inbound_events" && query.value?.status === "PROCESSED";
  await assert.rejects(test.run(), /INBOUND_EVENT_UNAVAILABLE/); assertions += 1;
  eq(test.database.rows("omnichannel_messages").length, 1);
  eq(await test.run(), { accepted: 1 });
  eq(test.database.rows("omnichannel_messages").length, 1);
  eq(test.automationRuns.size, 1);
}

// An active worker's event cannot be ACKed by a second callback. An expired
// worker (or a pre-migration PROCESSING row) can be recovered by replay.
for (const expiry of [null, 1_799_999_999_999]) {
  const test = fixture();
  test.database.rows("channel_inbound_events").push({ id: "abandoned", provider_event_id: "event", status: "PROCESSING",
    processing_token: "old", processing_lease_expires_at: expiry });
  eq(await test.run(), { accepted: 1 });
  eq(test.database.rows("omnichannel_messages").length, 1);
}
{
  const test = fixture();
  test.database.rows("channel_inbound_events").push({ id: "active", provider_event_id: "event", status: "PROCESSING",
    processing_token: "other-worker", processing_lease_expires_at: test.database.clock + 300_000 });
  await assert.rejects(test.run(), /INBOUND_EVENT_UNAVAILABLE/); assertions += 1;
  eq(test.database.rows("omnichannel_messages").length, 0);
  eq(test.database.rows("channel_inbound_events")[0].processing_token, "other-worker");
}

// A worker whose lease was taken over cannot complete or fail the newer claim.
{
  const test = fixture();
  globalThis.__ingressAutomations = async () => {
    test.database.rows("channel_inbound_events")[0].processing_token = "new-worker";
  };
  await assert.rejects(test.run(), /INBOUND_EVENT_UNAVAILABLE/); assertions += 1;
  eq(test.database.rows("channel_inbound_events")[0].status, "PROCESSING");
  eq(test.database.rows("channel_inbound_events")[0].processing_token, "new-worker");
}

// Resume attachment persistence after the message and first attachment have
// succeeded; do not duplicate the first attachment or silently omit the second.
{
  const test = fixture("FACEBOOK_PROFILE");
  test.message.attachments = Array.from({ length: 2 }, () => ({ filename: "fixture.png", providerUrl: "data:image/png;base64,aGVsbG8=" }));
  test.database.fail = query => query.table === "channel_message_attachments" && query.operation === "insert" && query.value.position === 1;
  await assert.rejects(test.run(), /ATTACHMENT_PERSISTENCE_FAILED/); assertions += 1;
  eq(test.database.rows("channel_message_attachments").length, 1);
  eq(await test.run(), { accepted: 1 });
  eq(test.database.rows("omnichannel_messages").length, 1);
  eq(test.database.rows("channel_message_attachments").length, 2);
  eq(test.database.rows("channel_attachments").length, 2);
}

delete globalThis.__ingressClient;
delete globalThis.__ingressAutomations;
console.log(`CHANNEL_INGRESS_RETRY_PASS assertions=${assertions} remoteCalls=0 providerCalls=0`);
