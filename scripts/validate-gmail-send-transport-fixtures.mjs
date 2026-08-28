import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const sourceUrl = new URL(
  "../src/modules/integrations/gmail/server/gmail-send-api.ts",
  import.meta.url,
);
const productionSource = readFileSync(sourceUrl, "utf8");
const testableSource = productionSource.replace('import "server-only";\n', "");
const compiled = ts.transpileModule(testableSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const transport = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const {
  GmailSendAmbiguousError,
  GmailSendDefinitiveError,
  sendRawGmailMessage,
} = transport;

const accessToken = "fixture-access-token";
const raw = "fixture-raw";
const requestedThreadId = "requested_thread-1";
let fixtureCount = 0;

async function fixture(name, run) {
  await run();
  fixtureCount += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function response(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function invoke({ threadId, mockFetch }) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return mockFetch(...args);
  };
  try {
    const result = await sendRawGmailMessage(accessToken, raw, threadId);
    return { result, error: null, calls };
  } catch (error) {
    return { result: null, error, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const success = () => response(200, { id: "returned_message-1", threadId: "returned_thread-1" });

await fixture("NEW body is exactly raw-only", async () => {
  const run = await invoke({ mockFetch: success });
  assert.deepEqual(JSON.parse(run.calls[0][1].body), { raw });
  assert.equal(Object.hasOwn(JSON.parse(run.calls[0][1].body), "threadId"), false);
});
await fixture("NEW success preserves provider message ID", async () => {
  const run = await invoke({ mockFetch: success });
  assert.equal(run.result.providerMessageId, "returned_message-1");
});
await fixture("NEW success preserves provider thread ID", async () => {
  const run = await invoke({ mockFetch: success });
  assert.equal(run.result.providerThreadId, "returned_thread-1");
});
await fixture("NEW definitive 400 remains rejected", async () => {
  const run = await invoke({ mockFetch: () => response(400, { error: "ignored" }) });
  assert.ok(run.error instanceof GmailSendDefinitiveError);
  assert.equal(run.error.safeCode, "GMAIL_SEND_REJECTED");
});
await fixture("NEW timeout remains ambiguous", async () => {
  const run = await invoke({ mockFetch: () => { throw new DOMException("timeout", "TimeoutError"); } });
  assert.ok(run.error instanceof GmailSendAmbiguousError);
});
await fixture("NEW performs exactly one fetch", async () => {
  const run = await invoke({ mockFetch: success });
  assert.equal(run.calls.length, 1);
});
await fixture("REPLY body is exactly raw plus threadId", async () => {
  const run = await invoke({ threadId: requestedThreadId, mockFetch: success });
  assert.deepEqual(JSON.parse(run.calls[0][1].body), { raw, threadId: requestedThreadId });
});
await fixture("REPLY provider message ID is preserved", async () => {
  const run = await invoke({ threadId: requestedThreadId, mockFetch: success });
  assert.equal(run.result.providerMessageId, "returned_message-1");
});
await fixture("REPLY provider thread ID is preserved", async () => {
  const run = await invoke({ threadId: requestedThreadId, mockFetch: success });
  assert.equal(run.result.providerThreadId, "returned_thread-1");
});
await fixture("requested thread ID does not replace returned thread ID", async () => {
  const run = await invoke({ threadId: requestedThreadId, mockFetch: success });
  assert.notEqual(run.result.providerThreadId, requestedThreadId);
});

for (const [name, threadId] of [
  ["empty thread ID", ""],
  ["whitespace thread ID", "   "],
  ["slash in thread ID", "thread/id"],
  ["colon in thread ID", "thread:id"],
  ["NUL in thread ID", "thread\u0000id"],
  ["LF in thread ID", "thread\nid"],
  ["513-character thread ID", "a".repeat(513)],
]) {
  await fixture(`${name} rejected before fetch`, async () => {
    const run = await invoke({ threadId, mockFetch: success });
    assert.ok(run.error instanceof GmailSendDefinitiveError);
    assert.equal(run.error.safeCode, "GMAIL_SEND_REJECTED");
    assert.equal(run.calls.length, 0);
  });
}

await fixture("512-character thread ID accepted", async () => {
  const threadId = "a".repeat(512);
  const run = await invoke({ threadId, mockFetch: success });
  assert.equal(run.error, null);
  assert.deepEqual(JSON.parse(run.calls[0][1].body), { raw, threadId });
});
await fixture("HTTP 401 remains REAUTH_REQUIRED", async () => {
  const run = await invoke({ mockFetch: () => response(401, {}) });
  assert.ok(run.error instanceof GmailSendDefinitiveError);
  assert.equal(run.error.safeCode, "REAUTH_REQUIRED");
});
await fixture("HTTP 403 remains permission denied", async () => {
  const run = await invoke({ mockFetch: () => response(403, {}) });
  assert.equal(run.error.safeCode, "GMAIL_PERMISSION_DENIED");
});
await fixture("HTTP 429 remains rate limited", async () => {
  const run = await invoke({ mockFetch: () => response(429, {}) });
  assert.equal(run.error.safeCode, "GMAIL_RATE_LIMITED");
});
await fixture("HTTP 408 remains ambiguous", async () => {
  const run = await invoke({ mockFetch: () => response(408, {}) });
  assert.ok(run.error instanceof GmailSendAmbiguousError);
});
await fixture("HTTP 500 remains ambiguous", async () => {
  const run = await invoke({ mockFetch: () => response(500, {}) });
  assert.ok(run.error instanceof GmailSendAmbiguousError);
});
await fixture("network failure remains ambiguous", async () => {
  const run = await invoke({ mockFetch: () => { throw new Error("fixture network failure"); } });
  assert.ok(run.error instanceof GmailSendAmbiguousError);
  assert.equal(run.calls.length, 1);
});
await fixture("ambiguous transport has no retry", async () => {
  const run = await invoke({ mockFetch: () => { throw new Error("fixture reset"); } });
  assert.equal(run.calls.length, 1);
});
await fixture("blank provider message ID fails closed", async () => {
  const run = await invoke({ mockFetch: () => response(200, { id: "", threadId: "thread" }) });
  assert.ok(run.error instanceof GmailSendAmbiguousError);
});
await fixture("blank provider thread ID fails closed", async () => {
  const run = await invoke({ mockFetch: () => response(200, { id: "message", threadId: "" }) });
  assert.ok(run.error instanceof GmailSendAmbiguousError);
});
await fixture("malformed provider message ID fails closed", async () => {
  const run = await invoke({ mockFetch: () => response(200, { id: "message/id", threadId: "thread" }) });
  assert.ok(run.error instanceof GmailSendAmbiguousError);
});
await fixture("malformed provider thread ID fails closed", async () => {
  const run = await invoke({ mockFetch: () => response(200, { id: "message", threadId: "thread/id" }) });
  assert.ok(run.error instanceof GmailSendAmbiguousError);
});
await fixture("malformed JSON remains ambiguous", async () => {
  const run = await invoke({ mockFetch: () => new Response("not-json", { status: 200 }) });
  assert.ok(run.error instanceof GmailSendAmbiguousError);
});
await fixture("different returned thread remains visible", async () => {
  const run = await invoke({
    threadId: requestedThreadId,
    mockFetch: () => response(200, { id: "message", threadId: "different_thread" }),
  });
  assert.equal(run.result.providerThreadId, "different_thread");
});

assert.equal((productionSource.match(/\bfetch\(/g) ?? []).length, 1, "exactly one production fetch path");
for (const forbidden of [
  "Supabase",
  ".rpc(",
  ".insert(",
  ".update(",
  ".delete(",
  "claim_reply_email_send_request",
  "prepareClaimedReplyExecution",
  "buildGmailReplyMime",
  "finalize_reply_email_send_request_sent",
  "finalize_email_send_request_failed",
  "setInterval(",
]) {
  assert.equal(productionSource.includes(forbidden), false, `forbidden transport dependency: ${forbidden}`);
}

process.stdout.write(`gmail-send-transport fixtures: ${fixtureCount} passed\n`);
