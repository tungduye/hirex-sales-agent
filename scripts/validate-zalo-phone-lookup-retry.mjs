#!/usr/bin/env node
import assert from "node:assert/strict";
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
const credential = { bridgeBaseUrl: "https://zalo-bridge.hirexmkt.online", bridgeAccountId: "fixture", signingSecret: "fixture-signing-secret-at-least-32" };
const createAdapter = (request) => new ZaloBridgeAdapter("workspace", "account", credential, { request }, () => 1_800_000_000_000);
const lookup = (adapter) => adapter.findUserByPhone("+84907896363", "fixture-idempotency");
const errorCode = (code, retryable) => (error) => error?.code === code && error?.retryable === retryable;

const found = await lookup(createAdapter(async () => ({ status: 200, body: { status: "FOUND", userId: "private-fixture-id", displayName: "Fixture", avatarUrl: null, isFriend: false } })));
assert.deepEqual(found, { userId: "private-fixture-id", displayName: "Fixture", avatarUrl: null, isFriend: false });
assert.equal(await lookup(createAdapter(async () => ({ status: 200, body: { status: "NOT_FOUND" } }))), null);
await assert.rejects(() => lookup(createAdapter(async () => ({ status: 429, body: {} }))), errorCode("RATE_LIMITED", true));
await assert.rejects(() => lookup(createAdapter(async () => ({ status: 409, body: { status: "BLOCKED", errorCode: "ACCOUNT_BUSY" } }))), errorCode("ACCOUNT_BUSY", true));
await assert.rejects(() => lookup(createAdapter(async () => ({ status: 200, body: { status: "BLOCKED", errorCode: "ACCOUNT_BUSY" } }))), errorCode("ACCOUNT_BUSY", true));
await assert.rejects(() => lookup(createAdapter(async () => ({ status: 200, body: { status: "FAILED", errorCode: "RATE_LIMITED" } }))), errorCode("RATE_LIMITED", true));
await assert.rejects(() => lookup(createAdapter(async () => ({ status: 200, body: { status: "FAILED", errorCode: "ACCOUNT_UNAVAILABLE" } }))), errorCode("ACCOUNT_UNAVAILABLE", true));
await assert.rejects(() => lookup(createAdapter(async () => ({ status: 503, body: {} }))), errorCode("ACCOUNT_UNAVAILABLE", true));
await assert.rejects(() => lookup(createAdapter(async () => { throw new Error("private transport detail"); })), errorCode("ACCOUNT_UNAVAILABLE", true));
await assert.rejects(() => lookup(createAdapter(async () => ({ status: 403, body: {} }))), errorCode("PERMISSION_DENIED", false));

console.log("ZALO_PHONE_LOOKUP_RETRY_PASS scenarios=10");
