import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyExistingReplyRequest,
  createReplySendRequestWithDependencies,
  prepareReplySendRequest,
} from "../src/modules/integrations/gmail/domain/prepare-reply-send-request.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const emailAccountId = "22222222-2222-4222-8222-222222222222";
const replyToEmailMessageId = "33333333-3333-4333-8333-333333333333";
const idempotencyKey = "44444444-4444-4444-8444-444444444444";
const sendRequestId = "55555555-5555-4555-8555-555555555555";
const otherId = "66666666-6666-4666-8666-666666666666";
const input = { workspaceId, emailAccountId, replyToEmailMessageId, bodyText: "Thanks for your reply.\nLet's talk.", idempotencyKey };
const safeEvaluation = {
  classification: "SAFE_REPLY_TARGET", reason: "SAFE_CANONICAL_REPLY_TARGET", workspaceId, emailAccountId,
  replyToEmailMessageId, recipientEmail: "buyer@example.com", subject: "Re: Proposal",
  providerThreadId: "gmail-thread-1", parentRfcMessageId: "<canonical@mail.gmail.com>",
};
const prepared = prepareReplySendRequest(input, safeEvaluation);
assert.ok(prepared.payload);
const payload = prepared.payload;
const existing = {
  id: sendRequestId, workspace_id: workspaceId, email_account_id: emailAccountId, send_type: "REPLY",
  status: "PENDING", attempt_count: 0, send_after: null,
  reply_to_email_message_id: replyToEmailMessageId, to_addresses: ["buyer@example.com"], cc_addresses: [],
  bcc_addresses: [], subject: "Re: Proposal", body_text: input.bodyText, body_html: null, idempotency_key: idempotencyKey,
};

const fixtures = [
  ["safe plan prepares payload", () => prepared.result.status, "CREATED"],
  ["invalid workspace UUID", () => prepareReplySendRequest({ ...input, workspaceId: "bad" }, safeEvaluation).result.status, "INVALID_INPUT"],
  ["invalid account UUID", () => prepareReplySendRequest({ ...input, emailAccountId: "bad" }, safeEvaluation).result.status, "INVALID_INPUT"],
  ["invalid reply UUID", () => prepareReplySendRequest({ ...input, replyToEmailMessageId: "bad" }, safeEvaluation).result.status, "INVALID_INPUT"],
  ["empty body", () => prepareReplySendRequest({ ...input, bodyText: " \r\n " }, safeEvaluation).result.status, "INVALID_INPUT"],
  ["oversized body", () => prepareReplySendRequest({ ...input, bodyText: "a".repeat(100_001) }, safeEvaluation).result.status, "INVALID_INPUT"],
  ["malformed idempotency", () => prepareReplySendRequest({ ...input, idempotencyKey: "bad" }, safeEvaluation).result.status, "INVALID_INPUT"],
  ["NOT_REPLYABLE evaluator", () => prepareReplySendRequest(input, { ...safeEvaluation, classification: "NOT_REPLYABLE", reason: "MESSAGE_NOT_INBOUND" }).result.status, "NOT_REPLYABLE"],
  ["AMBIGUOUS evaluator", () => prepareReplySendRequest(input, { ...safeEvaluation, classification: "AMBIGUOUS", reason: "EVALUATION_UNAVAILABLE" }).result.status, "UNAVAILABLE"],
  ["UNAVAILABLE evaluator", () => prepareReplySendRequest(input, { ...safeEvaluation, classification: "UNAVAILABLE", reason: "EVALUATION_UNAVAILABLE" }).result.status, "UNAVAILABLE"],
  ["malformed evaluator", () => prepareReplySendRequest(input, null).result.status, "UNAVAILABLE"],
  ["evaluator workspace mismatch", () => prepareReplySendRequest(input, { ...safeEvaluation, workspaceId: otherId }).result.status, "UNAVAILABLE"],
  ["evaluator account mismatch", () => prepareReplySendRequest(input, { ...safeEvaluation, emailAccountId: otherId }).result.status, "UNAVAILABLE"],
  ["evaluator message mismatch", () => prepareReplySendRequest(input, { ...safeEvaluation, replyToEmailMessageId: otherId }).result.status, "UNAVAILABLE"],
  ["malformed recipient", () => prepareReplySendRequest(input, { ...safeEvaluation, recipientEmail: "Buyer <buyer@example.com>" }).result.status, "UNAVAILABLE"],
  ["unsafe subject", () => prepareReplySendRequest(input, { ...safeEvaluation, subject: "Hi\r\nBcc: victim@example.com" }).result.status, "UNAVAILABLE"],
  ["malformed parent RFC id", () => prepareReplySendRequest(input, { ...safeEvaluation, parentRfcMessageId: "bad" }).result.status, "UNAVAILABLE"],
  ["empty provider thread", () => prepareReplySendRequest(input, { ...safeEvaluation, providerThreadId: "" }).result.status, "UNAVAILABLE"],
  ["payload send type", () => payload.send_type, "REPLY"],
  ["payload pending", () => payload.status, "PENDING"],
  ["payload attempt count", () => payload.attempt_count, 0],
  ["one recipient", () => payload.to_addresses.length, 1],
  ["canonical recipient", () => payload.to_addresses[0], "buyer@example.com"],
  ["cc empty", () => payload.cc_addresses.length, 0],
  ["bcc empty", () => payload.bcc_addresses.length, 0],
  ["html null", () => payload.body_html, null],
  ["send after null", () => payload.send_after, null],
  ["no lock fields", () => Object.keys(payload).some((key) => key.startsWith("send_lock")), false],
  ["no provider result IDs", () => Object.keys(payload).some((key) => key.startsWith("provider_")), false],
  ["no RFC result ID", () => "rfc_message_id" in payload, false],
  ["existing PENDING compatible", () => classifyExistingReplyRequest(input, payload, existing).status, "EXISTING"],
  ["same intent SENDING conflict", () => classifyExistingReplyRequest(input, payload, { ...existing, status: "SENDING" }).status, "IDEMPOTENCY_CONFLICT"],
  ["same intent SENT conflict", () => classifyExistingReplyRequest(input, payload, { ...existing, status: "SENT" }).status, "IDEMPOTENCY_CONFLICT"],
  ["same intent FAILED conflict", () => classifyExistingReplyRequest(input, payload, { ...existing, status: "FAILED" }).status, "IDEMPOTENCY_CONFLICT"],
  ["same intent CANCELLED conflict", () => classifyExistingReplyRequest(input, payload, { ...existing, status: "CANCELLED" }).status, "IDEMPOTENCY_CONFLICT"],
  ["PENDING attempted conflict", () => classifyExistingReplyRequest(input, payload, { ...existing, attempt_count: 1 }).status, "IDEMPOTENCY_CONFLICT"],
  ["PENDING scheduled conflict", () => classifyExistingReplyRequest(input, payload, { ...existing, send_after: "2026-08-28T00:00:00.000Z" }).status, "IDEMPOTENCY_CONFLICT"],
  ["malformed status unavailable", () => classifyExistingReplyRequest(input, payload, { ...existing, status: null }).status, "UNAVAILABLE"],
  ["malformed attempt count unavailable", () => classifyExistingReplyRequest(input, payload, { ...existing, attempt_count: "0" }).status, "UNAVAILABLE"],
  ["different target conflict", () => classifyExistingReplyRequest(input, payload, { ...existing, reply_to_email_message_id: otherId }).status, "IDEMPOTENCY_CONFLICT"],
  ["different body conflict", () => classifyExistingReplyRequest(input, payload, { ...existing, body_text: "Different" }).status, "IDEMPOTENCY_CONFLICT"],
  ["NEW request conflict", () => classifyExistingReplyRequest(input, payload, { ...existing, send_type: "NEW" }).status, "IDEMPOTENCY_CONFLICT"],
  ["different recipient conflict", () => classifyExistingReplyRequest(input, payload, { ...existing, to_addresses: ["other@example.com"] }).status, "IDEMPOTENCY_CONFLICT"],
  ["different subject conflict", () => classifyExistingReplyRequest(input, payload, { ...existing, subject: "Different" }).status, "IDEMPOTENCY_CONFLICT"],
  ["malformed existing unavailable", () => classifyExistingReplyRequest(input, payload, null).status, "UNAVAILABLE"],
  ["body line breaks preserved", () => payload.body_text, input.bodyText],
];

for (const [name, run, expected] of fixtures) {
  assert.doesNotThrow(() => assert.deepEqual(run(), expected, name), `${name}: unexpected throw`);
}

function dependencies(overrides = {}) {
  const calls = { evaluate: 0, insert: 0, load: 0 };
  return {
    calls,
    value: {
      async evaluateReplyTarget() { calls.evaluate += 1; return safeEvaluation; },
      async createRow() { calls.insert += 1; return { kind: "CREATED", sendRequestId }; },
      async loadByIdempotency() { calls.load += 1; return existing; },
      ...overrides,
    },
  };
}

const createdDeps = dependencies();
const created = await createReplySendRequestWithDependencies(input, createdDeps.value);
assert.equal(created.status, "CREATED");
assert.deepEqual(createdDeps.calls, { evaluate: 1, insert: 1, load: 0 });

const raceEquivalentDeps = dependencies({ async createRow() { return { kind: "UNIQUE_CONFLICT" }; } });
const raceEquivalent = await createReplySendRequestWithDependencies(input, raceEquivalentDeps.value);
assert.equal(raceEquivalent.status, "EXISTING");

const raceConflictDeps = dependencies({
  async createRow() { return { kind: "UNIQUE_CONFLICT" }; },
  async loadByIdempotency() { return { ...existing, body_text: "Different" }; },
});
const raceConflict = await createReplySendRequestWithDependencies(input, raceConflictDeps.value);
assert.equal(raceConflict.status, "IDEMPOTENCY_CONFLICT");

const databaseErrorDeps = dependencies({ async createRow() { return { kind: "ERROR" }; } });
assert.equal((await createReplySendRequestWithDependencies(input, databaseErrorDeps.value)).status, "UNAVAILABLE");

const evaluatorErrorDeps = dependencies({ async evaluateReplyTarget() { throw new Error("sensitive detail"); } });
assert.equal((await createReplySendRequestWithDependencies(input, evaluatorErrorDeps.value)).status, "UNAVAILABLE");

const serverSource = readFileSync(new URL("../src/modules/integrations/gmail/server/create-reply-send-request.ts", import.meta.url), "utf8");
const domainSource = readFileSync(new URL("../src/modules/integrations/gmail/domain/prepare-reply-send-request.ts", import.meta.url), "utf8");
const productionSource = `${serverSource}\n${domainSource}`;
assert.equal((productionSource.match(/\.insert\(/g) ?? []).length, 1, "one reviewed insert path");
for (const forbidden of [".update(", ".delete(", ".rpc(", "fetch(", "sendRawGmailMessage", "claim_email_send_request", "finalize_email_send_request", "runManualSendReconciliation"]) {
  assert.equal(productionSource.includes(forbidden), false, `forbidden production dependency: ${forbidden}`);
}

const total = fixtures.length + 6;
process.stdout.write(`gmail-reply-send-request fixtures: ${total} passed\n`);
