import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  executeReplySend,
  ReplyGmailAmbiguousError,
  ReplyGmailDefinitiveError,
} from "../src/modules/integrations/gmail/domain/execute-reply-send.ts";

const input = {
  sendRequestId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  emailAccountId: "33333333-3333-4333-8333-333333333333",
};
const lock = "44444444-4444-4444-8444-444444444444";
const replyTarget = "55555555-5555-4555-8555-555555555555";
const credentials = {
  accessToken: "internal-access-token",
  emailAddress: "sender@gmail.com",
  emailAccountId: input.emailAccountId,
  workspaceId: input.workspaceId,
};
const claim = [{
  request_id: input.sendRequestId,
  workspace_id: input.workspaceId,
  email_account_id: input.emailAccountId,
  reply_to_email_message_id: replyTarget,
  send_lock_id: lock,
  attempt_count: 1,
}];
const plan = {
  ...input,
  sendLockId: lock,
  replyToEmailMessageId: replyTarget,
  recipientEmail: "buyer@example.com",
  subject: "Re: Proposal",
  bodyText: "Thanks.",
  providerThreadId: "gmail_thread-1",
  parentRfcMessageId: "<parent@mail.gmail.com>",
};
const plannerReady = {
  status: "READY",
  reason: "READY_FOR_REPLY_MIME",
  sendRequestId: input.sendRequestId,
  plan,
};
const mimeReady = {
  status: "READY",
  reason: "READY_FOR_GMAIL_REPLY_SEND",
  raw: "cmF3LW1pbWU",
  providerThreadId: plan.providerThreadId,
  sendRequestId: input.sendRequestId,
};
const providerSuccess = {
  providerMessageId: "gmail_message-1",
  providerThreadId: plan.providerThreadId,
};

let fixtureCount = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  fixtureCount += 1;
}

function setup(overrides = {}) {
  const calls = { credentials: [], lock: [], claim: [], planner: [], mime: [], gmail: [], sent: [], failed: [] };
  const invoke = (name, fallback) => (...args) => {
    calls[name].push(args);
    const selected = Object.hasOwn(overrides, name) ? overrides[name] : fallback;
    return typeof selected === "function" ? selected(...args) : selected;
  };
  return {
    calls,
    dependencies: {
      loadCredentials: invoke("credentials", Promise.resolve(credentials)),
      generateLock: invoke("lock", lock),
      claim: invoke("claim", Promise.resolve(claim)),
      prepare: invoke("planner", Promise.resolve(plannerReady)),
      buildMime: invoke("mime", mimeReady),
      sendGmail: invoke("gmail", Promise.resolve(providerSuccess)),
      finalizeSent: invoke("sent", Promise.resolve(true)),
      finalizeFailed: invoke("failed", Promise.resolve(true)),
    },
  };
}

async function run(overrides = {}, runtimeInput = input) {
  const configured = setup(overrides);
  const result = await executeReplySend(runtimeInput, configured.dependencies);
  return { ...configured, result };
}

for (const [name, runtimeInput] of [
  ["bad request UUID", { ...input, sendRequestId: "bad" }],
  ["bad workspace UUID", { ...input, workspaceId: "bad" }],
  ["bad account UUID", { ...input, emailAccountId: "bad" }],
  ["extra input key", { ...input, raw: "caller-controlled" }],
]) {
  const test = await run({}, runtimeInput);
  check(`${name} status`, test.result.status, "INVALID_INPUT");
  check(`${name} invokes zero dependencies`, Object.values(test.calls).flat().length, 0);
}

for (const [name, value] of [
  ["credential exception", () => { throw new Error("credential unavailable"); }],
  ["malformed credentials", Promise.resolve({ accessToken: "token" })],
  ["extra credential field", Promise.resolve({ ...credentials, refreshToken: "must-not-pass" })],
  ["mismatched credential account", Promise.resolve({ ...credentials, emailAccountId: replyTarget })],
  ["mismatched credential workspace", Promise.resolve({ ...credentials, workspaceId: replyTarget })],
  ["blank credential token", Promise.resolve({ ...credentials, accessToken: " " })],
]) {
  const test = await run({ credentials: value });
  check(`${name} unavailable`, test.result.reason, "CREDENTIALS_UNAVAILABLE");
  check(`${name} does not claim`, test.calls.claim.length, 0);
  check(`${name} does not call Gmail`, test.calls.gmail.length, 0);
}

let test = await run();
check("exact four-field credential result accepted", test.result.status, "SENT");
check("credential evidence has exact reviewed keys", Object.keys(credentials).sort(),
  ["accessToken", "emailAccountId", "emailAddress", "workspaceId"]);
check("credentials called once", test.calls.credentials.length, 1);
check("credentials exact scope input", test.calls.credentials[0][0], input);
check("lock generated once", test.calls.lock.length, 1);
check("generated lock reaches claim", test.calls.claim[0][0].sendLockId, lock);

test = await run({ lock: "bad" });
check("malformed generated lock rejected", test.result.reason, "LOCK_GENERATION_FAILED");
check("malformed lock prevents claim", test.calls.claim.length, 0);
test = await run({ lock: () => { throw new Error("rng unavailable"); } });
check("lock exception fail closed", test.result.reason, "LOCK_GENERATION_FAILED");
check("lock exception prevents claim", test.calls.claim.length, 0);

const malformedClaims = [
  ["non-array claim", {}],
  ["multiple claim rows", [claim[0], claim[0]]],
  ["wrong request claim", [{ ...claim[0], request_id: replyTarget }]],
  ["wrong workspace claim", [{ ...claim[0], workspace_id: replyTarget }]],
  ["wrong account claim", [{ ...claim[0], email_account_id: replyTarget }]],
  ["wrong lock claim", [{ ...claim[0], send_lock_id: replyTarget }]],
  ["wrong attempt claim", [{ ...claim[0], attempt_count: 2 }]],
  ["malformed target claim", [{ ...claim[0], reply_to_email_message_id: "bad" }]],
  ["extra claim field", [{ ...claim[0], status: "SENDING" }]],
];
for (const [name, value] of malformedClaims) {
  test = await run({ claim: Promise.resolve(value) });
  check(`${name} unavailable`, test.result.reason, "CLAIM_UNAVAILABLE");
  check(`${name} prevents planner`, test.calls.planner.length, 0);
  check(`${name} prevents Gmail`, test.calls.gmail.length, 0);
}
test = await run({ claim: Promise.resolve([]) });
check("zero-row claim not eligible", test.result.status, "NOT_ELIGIBLE");
check("zero-row claim reason", test.result.reason, "REQUEST_NOT_ELIGIBLE");
check("zero-row claim no planner", test.calls.planner.length, 0);
test = await run({ claim: () => { throw new Error("rpc unavailable"); } });
check("claim exception unavailable", test.result.reason, "CLAIM_UNAVAILABLE");
check("claim exception called once", test.calls.claim.length, 1);
check("claim exception does not call Gmail", test.calls.gmail.length, 0);

for (const [name, planner, code] of [
  ["evidence changed", { status: "EVIDENCE_CHANGED", reason: "CANONICAL_REPLY_TARGET_CHANGED", sendRequestId: input.sendRequestId, plan: null }, "REPLY_TARGET_CHANGED"],
  ["not replyable", { status: "NOT_REPLYABLE", reason: "REPLY_TARGET_NOT_SAFE", sendRequestId: input.sendRequestId, plan: null }, "REPLY_TARGET_NOT_REPLYABLE"],
]) {
  test = await run({ planner: Promise.resolve(planner) });
  check(`${name} becomes failed`, test.result.status, "FAILED");
  check(`${name} exact code`, test.calls.failed[0][0].safeErrorCode, code);
  check(`${name} no MIME`, test.calls.mime.length, 0);
  check(`${name} no Gmail`, test.calls.gmail.length, 0);
  check(`${name} same lock finalizer`, test.calls.failed[0][0].sendLockId, lock);
}

for (const [name, planner] of [
  ["planner not eligible", { status: "NOT_ELIGIBLE", reason: "REQUEST_NOT_CLAIMED", sendRequestId: input.sendRequestId, plan: null }],
  ["planner unavailable", { status: "UNAVAILABLE", reason: "REPLY_EXECUTION_UNAVAILABLE", sendRequestId: input.sendRequestId, plan: null }],
  ["malformed planner", { status: "READY", reason: "READY_FOR_REPLY_MIME", sendRequestId: input.sendRequestId, plan: null }],
  ["mismatched planner request", { ...plannerReady, sendRequestId: replyTarget }],
]) {
  test = await run({ planner: Promise.resolve(planner) });
  check(`${name} no Gmail`, test.calls.gmail.length, 0);
  check(`${name} no failed finalizer`, test.calls.failed.length, 0);
  if (name === "planner not eligible") {
    check("post-claim not eligible becomes unavailable", test.result.status, "UNAVAILABLE");
    check("post-claim not eligible reason", test.result.reason, "EXECUTION_UNAVAILABLE");
    check("post-claim not eligible no MIME", test.calls.mime.length, 0);
  }
}
test = await run({ planner: () => { throw new Error("planner unavailable"); } });
check("planner exception unavailable", test.result.status, "UNAVAILABLE");
check("planner exception once", test.calls.planner.length, 1);

for (const [name, malformedPlan] of [
  ["malformed recipient plan", { ...plan, recipientEmail: "bad" }],
  ["CRLF subject plan", { ...plan, subject: "Reply\r\nBcc: victim@example.com" }],
  ["blank body plan", { ...plan, bodyText: "   " }],
  ["NUL body plan", { ...plan, bodyText: "hello\u0000world" }],
  ["oversized body plan", { ...plan, bodyText: "a".repeat(100_001) }],
  ["malformed parent RFC plan", { ...plan, parentRfcMessageId: "not-an-id" }],
  ["control parent RFC plan", { ...plan, parentRfcMessageId: "<bad\u007f@mail.gmail.com>" }],
]) {
  test = await run({ planner: Promise.resolve({ ...plannerReady, plan: malformedPlan }) });
  check(`${name} unavailable`, test.result.status, "UNAVAILABLE");
  check(`${name} execution reason`, test.result.reason, "EXECUTION_UNAVAILABLE");
  check(`${name} stops before MIME`, test.calls.mime.length, 0);
  check(`${name} stops before Gmail`, test.calls.gmail.length, 0);
  check(`${name} does not finalize FAILED`, test.calls.failed.length, 0);
}

test = await run({ planner: Promise.resolve({ status: "EVIDENCE_CHANGED", reason: "CANONICAL_REPLY_TARGET_CHANGED", sendRequestId: input.sendRequestId, plan: null }), failed: Promise.resolve(false) });
check("local finalizer false unavailable", test.result.status, "UNAVAILABLE");
check("local finalizer false once", test.calls.failed.length, 1);
test = await run({ planner: Promise.resolve({ status: "NOT_REPLYABLE", reason: "REPLY_TARGET_NOT_SAFE", sendRequestId: input.sendRequestId, plan: null }), failed: () => { throw new Error("finalizer unavailable"); } });
check("local finalizer exception unavailable", test.result.status, "UNAVAILABLE");
check("local finalizer exception no Gmail", test.calls.gmail.length, 0);

test = await run({ mime: { status: "INVALID_INPUT", reason: "INVALID_REPLY_MIME_INPUT", raw: null, providerThreadId: null, sendRequestId: null } });
check("invalid MIME becomes failed", test.result.status, "FAILED");
check("invalid MIME exact code", test.calls.failed[0][0].safeErrorCode, "MIME_BUILD_FAILED");
check("invalid MIME no Gmail", test.calls.gmail.length, 0);
for (const [name, mime] of [
  ["MIME unavailable", { status: "UNAVAILABLE", reason: "REPLY_MIME_UNAVAILABLE", raw: null, providerThreadId: null, sendRequestId: null }],
  ["blank MIME raw", { ...mimeReady, raw: "" }],
  ["malformed MIME thread", { ...mimeReady, providerThreadId: "bad/thread" }],
  ["mismatched MIME request", { ...mimeReady, sendRequestId: replyTarget }],
]) {
  test = await run({ mime });
  check(`${name} unavailable`, test.result.status, "UNAVAILABLE");
  check(`${name} no Gmail`, test.calls.gmail.length, 0);
}
test = await run({ mime: { ...mimeReady, raw: "a" } });
check("modulo-1 raw unavailable", test.result.status, "UNAVAILABLE");
check("modulo-1 raw execution reason", test.result.reason, "EXECUTION_UNAVAILABLE");
check("modulo-1 raw no Gmail", test.calls.gmail.length, 0);
check("modulo-1 raw no finalizers", test.calls.sent.length + test.calls.failed.length, 0);
for (const [name, raw] of [
  ["modulo-2 Base64URL", "aa"],
  ["modulo-3 Base64URL", "aaa"],
  ["modulo-0 Base64URL", "aaaa"],
]) {
  test = await run({ mime: { ...mimeReady, raw } });
  check(`${name} accepted`, test.result.status, "SENT");
  check(`${name} reaches Gmail exactly once`, test.calls.gmail.length, 1);
}
for (const [name, raw] of [
  ["padded Base64URL", "aaa="],
  ["plus Base64URL", "aaa+"],
  ["slash Base64URL", "aaa/"],
]) {
  test = await run({ mime: { ...mimeReady, raw } });
  check(`${name} unavailable`, test.result.status, "UNAVAILABLE");
  check(`${name} no Gmail`, test.calls.gmail.length, 0);
}
test = await run({ mime: mimeReady });
check("reviewed MIME fixture remains accepted", test.result.status, "SENT");
test = await run({ mime: () => { throw new Error("builder unavailable"); } });
check("MIME exception unavailable", test.result.status, "UNAVAILABLE");
check("MIME exception no failed finalize", test.calls.failed.length, 0);

test = await run();
check("successful status", test.result.status, "SENT");
check("successful Gmail once", test.calls.gmail.length, 1);
check("Gmail access token internal", test.calls.gmail[0][0], credentials.accessToken);
check("Gmail raw exact", test.calls.gmail[0][1], mimeReady.raw);
check("Gmail requested thread exact", test.calls.gmail[0][2], mimeReady.providerThreadId);
check("SENT finalizer once", test.calls.sent.length, 1);
check("FAILED finalizer zero on success", test.calls.failed.length, 0);
check("returned message preserved", test.result.providerMessageId, providerSuccess.providerMessageId);
check("returned thread preserved", test.result.providerThreadId, providerSuccess.providerThreadId);
check("planner receives same lock", test.calls.planner[0][0].sendLockId, lock);
check("SENT finalizer receives same lock", test.calls.sent[0][0].sendLockId, lock);
check("MIME sender from credentials", test.calls.mime[0][0].senderEmail, credentials.emailAddress);
check("MIME called once", test.calls.mime.length, 1);
check("planner called once", test.calls.planner.length, 1);
check("claim called once", test.calls.claim.length, 1);
for (const forbidden of ["sendLockId", "accessToken", "raw", "senderEmail", "recipientEmail", "subject", "bodyText"]) {
  check(`public result excludes ${forbidden}`, Object.hasOwn(test.result, forbidden), false);
}

test = await run({ gmail: Promise.resolve({ providerMessageId: "gmail_message-1", providerThreadId: "different_thread" }) });
check("thread mismatch unknown", test.result.status, "DELIVERY_STATUS_UNKNOWN");
check("thread mismatch reason", test.result.reason, "PROVIDER_THREAD_MISMATCH");
check("thread mismatch no SENT finalize", test.calls.sent.length, 0);
check("thread mismatch no FAILED finalize", test.calls.failed.length, 0);
check("thread mismatch Gmail once", test.calls.gmail.length, 1);

for (const code of ["REAUTH_REQUIRED", "GMAIL_PERMISSION_DENIED", "GMAIL_RATE_LIMITED", "GMAIL_SEND_REJECTED"]) {
  test = await run({ gmail: () => { throw new ReplyGmailDefinitiveError(code); } });
  check(`${code} failed`, test.result.status, "FAILED");
  check(`${code} exact mapping`, test.calls.failed[0][0].safeErrorCode, code);
  check(`${code} Gmail once`, test.calls.gmail.length, 1);
  check(`${code} no SENT finalize`, test.calls.sent.length, 0);
}
test = await run({ gmail: () => { throw new ReplyGmailDefinitiveError("UNREVIEWED_RUNTIME_CODE"); } });
check("unreviewed definitive code stays unknown", test.result.status, "DELIVERY_STATUS_UNKNOWN");
check("unreviewed definitive code safe reason", test.result.reason, "GMAIL_DELIVERY_STATUS_UNKNOWN");
check("unreviewed definitive code no FAILED finalizer", test.calls.failed.length, 0);
check("unreviewed definitive code Gmail once", test.calls.gmail.length, 1);

for (const name of ["timeout", "network reset", "HTTP 408", "HTTP 5xx/malformed success"]) {
  test = await run({ gmail: () => { throw new ReplyGmailAmbiguousError(); } });
  check(`${name} unknown`, test.result.reason, "GMAIL_DELIVERY_STATUS_UNKNOWN");
  check(`${name} Gmail once`, test.calls.gmail.length, 1);
  check(`${name} no SENT finalize`, test.calls.sent.length, 0);
  check(`${name} no FAILED finalize`, test.calls.failed.length, 0);
}

test = await run({ gmail: Promise.resolve({ providerMessageId: "", providerThreadId: plan.providerThreadId }) });
check("malformed provider result unknown", test.result.reason, "GMAIL_DELIVERY_STATUS_UNKNOWN");
check("malformed provider result no finalizers", test.calls.sent.length + test.calls.failed.length, 0);
test = await run({ sent: Promise.resolve(false) });
check("SENT finalizer false unknown", test.result.reason, "SENT_FINALIZATION_UNCERTAIN");
check("SENT finalizer false no FAILED", test.calls.failed.length, 0);
check("SENT finalizer false no resend", test.calls.gmail.length, 1);
test = await run({ sent: () => { throw new Error("finalizer unavailable"); } });
check("SENT finalizer exception unknown", test.result.reason, "SENT_FINALIZATION_UNCERTAIN");
check("SENT finalizer exception no FAILED", test.calls.failed.length, 0);
check("SENT finalizer exception no resend", test.calls.gmail.length, 1);

test = await run({ gmail: () => { throw new ReplyGmailDefinitiveError("GMAIL_SEND_REJECTED"); }, failed: Promise.resolve(false) });
check("provider failure finalizer false unavailable", test.result.status, "UNAVAILABLE");
check("provider failure finalizer false Gmail once", test.calls.gmail.length, 1);
test = await run({ gmail: () => { throw new ReplyGmailDefinitiveError("GMAIL_SEND_REJECTED"); }, failed: () => { throw new Error("finalizer unavailable"); } });
check("provider failure finalizer exception unavailable", test.result.status, "UNAVAILABLE");
check("provider failure finalizer exception no resend", test.calls.gmail.length, 1);

const domainSource = readFileSync(new URL("../src/modules/integrations/gmail/domain/execute-reply-send.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../src/modules/integrations/gmail/server/send-one-reply-message.ts", import.meta.url), "utf8");
const credentialSource = readFileSync(new URL("../src/modules/integrations/gmail/server/send-credentials.ts", import.meta.url), "utf8");
for (const forbidden of ["while (", "while(", "setInterval(", "setTimeout(", "retry(", "batch", "campaign"]) {
  check(`executor excludes ${forbidden}`, (domainSource + serverSource).includes(forbidden), false);
}
const srcRoot = new URL("../src/", import.meta.url);
const productionSources = readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
  .filter((path) => /\.(?:ts|tsx)$/.test(path))
  .map((path) => readFileSync(new URL(path.replaceAll("\\", "/"), srcRoot), "utf8"))
  .join("\n");
check("executor has no production caller", (productionSources.match(/sendOneReplyMessage/g) ?? []).length, 1);
check("credential projection has no spread", credentialSource.includes("...credential"), false);
for (const field of ["accessToken: credential.accessToken", "emailAddress: credential.emailAddress", "emailAccountId: account.id", "workspaceId,"]) {
  check(`credential projection includes ${field}`, credentialSource.includes(field), true);
}

process.stdout.write(`gmail-reply-executor fixtures: ${fixtureCount} passed\n`);
