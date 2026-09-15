#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    const file = [base, `${base}.ts`].find(existsSync);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

const { ZaloBridgeAdapter } = await import("../src/modules/channels/adapters/zalo/zalo-bridge-adapter.ts");
const { FetchChannelTransport } = await import("../src/modules/channels/core/channel-transport.ts");
const { signZaloBridgeRequest } = await import("../src/modules/channels/adapters/zalo/zalo-bridge-signing.ts");

const port = 18787;
const baseUrl = `http://127.0.0.1:${port}`;
const accountId = "mock-zalo-account-001";
const secret = randomBytes(32).toString("base64url");
let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const ok = (value) => { assert.ok(value); assertions += 1; };

const child = spawn(process.execPath, ["tools/mock-zalo-bridge/server.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, MOCK_ZALO_BRIDGE_PORT: String(port), MOCK_ZALO_ACCOUNT_ID: accountId, MOCK_ZALO_SIGNING_SECRET: secret },
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitUntilReady() {
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  for (let index = 0; index < 100; index += 1) {
    if (output.includes("MOCK_ZALO_BRIDGE_READY")) return;
    if (child.exitCode !== null) throw new Error("MOCK_BRIDGE_START_FAILED");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("MOCK_BRIDGE_START_TIMEOUT");
}

async function control(input) {
  const response = await fetch(`${baseUrl}/__mock/state`, { method: "POST", headers: { "content-type": "application/json", "x-mock-control-secret": secret }, body: JSON.stringify(input) });
  equal(response.status, 200);
}

async function metrics() {
  const response = await fetch(`${baseUrl}/__mock/metrics`, { headers: { "x-mock-control-secret": secret } });
  equal(response.status, 200);
  return response.json();
}

const adapter = new ZaloBridgeAdapter("workspace", "channel-account", { bridgeBaseUrl: baseUrl, bridgeAccountId: accountId, signingSecret: secret }, new FetchChannelTransport());
const command = { actionId: "action", workspaceId: "workspace", channelAccountId: "channel-account", channelType: "ZALO", providerConversationId: "mock-zalo-thread-001", recipientExternalId: "mock-zalo-user-001", text: "Mock Zalo outbound", attachments: [], idempotencyKey: "stable-mock-idempotency-key", policyDecisionId: "policy" };

try {
  await waitUntilReady();
  await control({ reset: true, healthMode: "NORMAL", health: "HEALTHY", sendMode: "SENT" });

  for (const status of ["HEALTHY", "DEGRADED", "DISCONNECTED", "AUTH_REQUIRED", "UNKNOWN"]) {
    await control({ healthMode: "NORMAL", health: status });
    equal(await adapter.healthCheck(), status);
  }
  await control({ healthMode: "MALFORMED" });
  equal(await adapter.healthCheck(), "UNKNOWN");
  await control({ healthMode: "HTTP_ERROR" });
  equal(await adapter.healthCheck(), "UNKNOWN");
  await control({ healthMode: "TIMEOUT" });
  equal(await adapter.healthCheck(), "UNKNOWN");
  await control({ healthMode: "NORMAL", health: "HEALTHY" });

  const path = `/v1/accounts/${accountId}/health`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const validSignature = signZaloBridgeRequest(secret, { method: "GET", path, timestamp, body: "", idempotencyKey: "" });
  const valid = await fetch(`${baseUrl}${path}`, { headers: { "x-hirex-timestamp": timestamp, "x-hirex-signature": validSignature } });
  equal(valid.status, 200);
  const badSignature = `${validSignature.slice(0, -1)}${validSignature.endsWith("0") ? "1" : "0"}`;
  const bad = await fetch(`${baseUrl}${path}`, { headers: { "x-hirex-timestamp": timestamp, "x-hirex-signature": badSignature } });
  equal(bad.status, 401);
  const staleTimestamp = String(Number(timestamp) - 301);
  const staleSignature = signZaloBridgeRequest(secret, { method: "GET", path, timestamp: staleTimestamp, body: "", idempotencyKey: "" });
  const stale = await fetch(`${baseUrl}${path}`, { headers: { "x-hirex-timestamp": staleTimestamp, "x-hirex-signature": staleSignature } });
  equal(stale.status, 401);

  await control({ reset: true, healthMode: "NORMAL", health: "HEALTHY", sendMode: "SENT" });
  const sent = await adapter.sendMessage(command);
  ok(sent.providerMessageId.startsWith("mock-"));
  equal(sent.providerConversationId, "mock-zalo-thread-001");
  const replay = await adapter.sendMessage(command);
  equal(replay.providerMessageId, sent.providerMessageId);
  let current = await metrics();
  equal(current.sendCalls, 2);
  equal(current.deliveries, 1);

  await control({ reset: true, sendMode: "FAILED" });
  await assert.rejects(() => adapter.sendMessage({ ...command, idempotencyKey: "failed-key" }), /DELIVERY_REJECTED/); assertions += 1;
  current = await metrics(); equal(current.sendCalls, 1); equal(current.deliveries, 0);

  await control({ reset: true, sendMode: "UNKNOWN" });
  await assert.rejects(() => adapter.sendMessage({ ...command, idempotencyKey: "unknown-key" }), /DELIVERY_UNKNOWN/); assertions += 1;
  current = await metrics(); equal(current.sendCalls, 1); equal(current.deliveries, 0);

  await control({ reset: true, sendMode: "MALFORMED" });
  await assert.rejects(() => adapter.sendMessage({ ...command, idempotencyKey: "malformed-key" }), /DELIVERY_UNKNOWN/); assertions += 1;
  current = await metrics(); equal(current.sendCalls, 1); equal(current.deliveries, 0);

  await control({ reset: true, sendMode: "TIMEOUT_AFTER_ACCEPT" });
  await assert.rejects(() => adapter.sendMessage({ ...command, idempotencyKey: "timeout-after-accept-key" }), /Abort|abort/u); assertions += 1;
  current = await metrics(); equal(current.sendCalls, 1); equal(current.deliveries, 1);

  const inboundBody = JSON.stringify({ eventId: "mock-event-001", accountId, threadId: "mock-zalo-thread-001", messageId: "mock-inbound-001", senderId: "mock-zalo-user-001", recipientIds: [accountId], text: "Test HireX mock Zalo inbound 01", attachments: [], occurredAt: new Date().toISOString() });
  const inboundTimestamp = Math.floor(Date.now() / 1000).toString();
  const { createHmac } = await import("node:crypto");
  const inboundSignature = createHmac("sha256", secret).update(`${inboundTimestamp}.${inboundBody}`).digest("hex");
  const verified = await adapter.verifyWebhook({ headers: { "x-hirex-timestamp": inboundTimestamp, "x-hirex-signature": inboundSignature }, body: inboundBody });
  const normalized = await adapter.normalizeInbound(verified);
  equal(normalized.length, 1); equal(normalized[0].channelType, "ZALO"); equal(normalized[0].sender.externalId, "mock-zalo-user-001");
  await assert.rejects(() => adapter.verifyWebhook({ headers: { "x-hirex-timestamp": inboundTimestamp, "x-hirex-signature": "bad" }, body: inboundBody })); assertions += 1;
  await assert.rejects(() => adapter.verifyWebhook({ headers: { "x-hirex-timestamp": String(Number(inboundTimestamp) - 301), "x-hirex-signature": inboundSignature }, body: inboundBody })); assertions += 1;

  console.log(`PHASE6_MOCK_ZALO_BRIDGE_E2E_PASS assertions=${assertions} port=${port} realProviderCalls=0 deliveries=${current.deliveries}`);
} finally {
  child.kill("SIGTERM");
  if (child.exitCode === null) await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
}
