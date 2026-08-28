import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareReplyExecutionWithDependencies } from "../src/modules/integrations/gmail/domain/prepare-reply-execution-plan.ts";

const sendRequestId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const emailAccountId = "33333333-3333-4333-8333-333333333333";
const sendLockId = "44444444-4444-4444-8444-444444444444";
const replyToEmailMessageId = "55555555-5555-4555-8555-555555555555";
const otherId = "66666666-6666-4666-8666-666666666666";
const input = { sendRequestId, workspaceId, emailAccountId, sendLockId };
const row = {
  id: sendRequestId, workspace_id: workspaceId, email_account_id: emailAccountId,
  send_type: "REPLY", status: "SENDING", attempt_count: 1,
  last_attempt_at: "2026-08-28T01:00:00.000Z", safe_error_code: null,
  send_lock_id: sendLockId, send_lock_at: "2026-08-28T01:00:00.000Z",
  reply_to_email_message_id: replyToEmailMessageId, to_addresses: ["buyer@example.com"],
  cc_addresses: [], bcc_addresses: [], subject: "Re: Proposal",
  body_text: "Thanks.\nLet's talk.", body_html: null, send_after: null,
  provider_message_id: null, provider_thread_id: null, rfc_message_id: null, sent_at: null,
};
const evaluation = {
  classification: "SAFE_REPLY_TARGET", reason: "SAFE_CANONICAL_REPLY_TARGET",
  workspaceId, emailAccountId, replyToEmailMessageId, recipientEmail: "buyer@example.com",
  subject: "Re: Proposal", providerThreadId: "gmail-thread-1",
  parentRfcMessageId: "<canonical@mail.gmail.com>",
};

function makeRun(options = {}) {
  const calls = { load: 0, evaluate: 0 };
  const runtimeInput = options.input ?? input;
  const runtimeRow = Object.hasOwn(options, "row") ? options.row : row;
  const runtimeEvaluation = Object.hasOwn(options, "evaluation") ? options.evaluation : evaluation;
  return {
    calls,
    execute: () => prepareReplyExecutionWithDependencies(runtimeInput, {
      async loadClaimedRequest() {
        calls.load += 1;
        if (options.loadThrows) throw new Error("sensitive database detail");
        return runtimeRow;
      },
      async evaluateCanonicalTarget() {
        calls.evaluate += 1;
        if (options.evaluatorThrows) throw new Error("sensitive evaluator detail");
        return runtimeEvaluation;
      },
    }),
  };
}

const cases = [
  ["exact claim ready", {}, "READY", "READY_FOR_REPLY_MIME"],
  ["exact equal claim timestamps ready", { row: { ...row, send_lock_at: "2026-08-28T01:00:00.000Z", last_attempt_at: "2026-08-28T01:00:00.000Z" } }, "READY", "READY_FOR_REPLY_MIME"],
  ["invalid request UUID", { input: { ...input, sendRequestId: "bad" } }, "INVALID_INPUT", "INVALID_REPLY_EXECUTION_INPUT"],
  ["invalid workspace UUID", { input: { ...input, workspaceId: "bad" } }, "INVALID_INPUT", "INVALID_REPLY_EXECUTION_INPUT"],
  ["invalid account UUID", { input: { ...input, emailAccountId: "bad" } }, "INVALID_INPUT", "INVALID_REPLY_EXECUTION_INPUT"],
  ["invalid lock UUID", { input: { ...input, sendLockId: "bad" } }, "INVALID_INPUT", "INVALID_REPLY_EXECUTION_INPUT"],
  ["caller evidence rejected", { input: { ...input, recipientEmail: "attacker@example.com" } }, "INVALID_INPUT", "INVALID_REPLY_EXECUTION_INPUT"],
  ["request absent", { row: null }, "NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED"],
  ["wrong request", { row: { ...row, id: otherId } }, "NOT_ELIGIBLE", "CLAIM_OWNERSHIP_MISMATCH"],
  ["wrong workspace", { row: { ...row, workspace_id: otherId } }, "NOT_ELIGIBLE", "CLAIM_OWNERSHIP_MISMATCH"],
  ["wrong account", { row: { ...row, email_account_id: otherId } }, "NOT_ELIGIBLE", "CLAIM_OWNERSHIP_MISMATCH"],
  ["wrong lock", { row: { ...row, send_lock_id: otherId } }, "NOT_ELIGIBLE", "CLAIM_OWNERSHIP_MISMATCH"],
  ["null lock", { row: { ...row, send_lock_id: null } }, "NOT_ELIGIBLE", "CLAIM_OWNERSHIP_MISMATCH"],
  ["PENDING", { row: { ...row, status: "PENDING" } }, "NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED"],
  ["SENT", { row: { ...row, status: "SENT" } }, "NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED"],
  ["FAILED", { row: { ...row, status: "FAILED" } }, "NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED"],
  ["NEW type", { row: { ...row, send_type: "NEW" } }, "NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED"],
  ["attempt zero", { row: { ...row, attempt_count: 0 } }, "NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED"],
  ["attempt above one", { row: { ...row, attempt_count: 2 } }, "NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED"],
  ["missing lock timestamp", { row: { ...row, send_lock_at: null } }, "NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED"],
  ["malformed lock timestamp", { row: { ...row, send_lock_at: "not-a-time" } }, "NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED"],
  ["missing attempt timestamp", { row: { ...row, last_attempt_at: null } }, "NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED"],
  ["different valid claim timestamps", { row: { ...row, last_attempt_at: "2026-08-28T01:00:01.000Z" } }, "NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED"],
  ["safe error present", { row: { ...row, safe_error_code: "GMAIL_TEMPORARY_ERROR" } }, "NOT_ELIGIBLE", "REQUEST_NOT_CLAIMED"],
  ["missing target", { row: { ...row, reply_to_email_message_id: null } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["zero recipients", { row: { ...row, to_addresses: [] } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["multiple recipients", { row: { ...row, to_addresses: ["buyer@example.com", "two@example.com"] } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["malformed recipient", { row: { ...row, to_addresses: ["Buyer <buyer@example.com>"] } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["nonempty CC", { row: { ...row, cc_addresses: ["cc@example.com"] } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["nonempty BCC", { row: { ...row, bcc_addresses: ["bcc@example.com"] } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["blank subject", { row: { ...row, subject: "  " } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["unsafe subject", { row: { ...row, subject: "Hi\r\nBcc: victim@example.com" } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["blank body", { row: { ...row, body_text: " \r\n " } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["HTML body", { row: { ...row, body_html: "<p>reply</p>" } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["scheduled", { row: { ...row, send_after: "2026-08-29T00:00:00.000Z" } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["provider message populated", { row: { ...row, provider_message_id: "message" } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["provider thread populated", { row: { ...row, provider_thread_id: "thread" } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["RFC result populated", { row: { ...row, rfc_message_id: "<result@example.com>" } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["sent timestamp populated", { row: { ...row, sent_at: "2026-08-28T01:01:00.000Z" } }, "NOT_ELIGIBLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["malformed runtime type", { row: { ...row, attempt_count: "1" } }, "UNAVAILABLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["extra DB field", { row: { ...row, unexpected: true } }, "UNAVAILABLE", "REQUEST_SHAPE_UNAVAILABLE"],
  ["evaluator NOT_REPLYABLE", { evaluation: { ...evaluation, classification: "NOT_REPLYABLE", reason: "MESSAGE_NOT_INBOUND" } }, "NOT_REPLYABLE", "REPLY_TARGET_NOT_SAFE"],
  ["evaluator AMBIGUOUS", { evaluation: { ...evaluation, classification: "AMBIGUOUS", reason: "EVALUATION_UNAVAILABLE" } }, "UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE"],
  ["evaluator UNAVAILABLE", { evaluation: { ...evaluation, classification: "UNAVAILABLE", reason: "EVALUATION_UNAVAILABLE" } }, "UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE"],
  ["malformed evaluator", { evaluation: null }, "UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE"],
  ["evaluator workspace mismatch", { evaluation: { ...evaluation, workspaceId: otherId } }, "UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE"],
  ["evaluator account mismatch", { evaluation: { ...evaluation, emailAccountId: otherId } }, "UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE"],
  ["target changed", { evaluation: { ...evaluation, replyToEmailMessageId: otherId } }, "EVIDENCE_CHANGED", "CANONICAL_REPLY_TARGET_CHANGED"],
  ["recipient changed", { evaluation: { ...evaluation, recipientEmail: "other@example.com" } }, "EVIDENCE_CHANGED", "CANONICAL_REPLY_TARGET_CHANGED"],
  ["subject changed", { evaluation: { ...evaluation, subject: "Re: Changed" } }, "EVIDENCE_CHANGED", "CANONICAL_REPLY_TARGET_CHANGED"],
  ["malformed provider thread", { evaluation: { ...evaluation, providerThreadId: "\u0000thread" } }, "UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE"],
  ["malformed parent RFC id", { evaluation: { ...evaluation, parentRfcMessageId: "bad-id" } }, "UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE"],
  ["database error", { loadThrows: true }, "UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE"],
  ["evaluator throw", { evaluatorThrows: true }, "UNAVAILABLE", "REPLY_EXECUTION_UNAVAILABLE"],
];

for (const [name, options, expectedStatus, expectedReason] of cases) {
  const fixture = makeRun(options);
  const actual = await fixture.execute();
  assert.equal(actual.status, expectedStatus, `${name}: status`);
  assert.equal(actual.reason, expectedReason, `${name}: reason`);
  if (expectedStatus === "INVALID_INPUT") assert.deepEqual(fixture.calls, { load: 0, evaluate: 0 }, `${name}: dependency calls`);
  if (expectedStatus === "NOT_ELIGIBLE"
    || expectedReason === "REQUEST_SHAPE_UNAVAILABLE"
    || options.loadThrows) {
    assert.equal(fixture.calls.evaluate, 0, `${name}: evaluator calls before eligibility`);
  }
}

const readyFixture = makeRun();
const ready = await readyFixture.execute();
assert.deepEqual(readyFixture.calls, { load: 1, evaluate: 1 });
assert.deepEqual(ready.plan, {
  sendRequestId, workspaceId, emailAccountId, sendLockId, replyToEmailMessageId,
  recipientEmail: "buyer@example.com", subject: "Re: Proposal", bodyText: row.body_text,
  providerThreadId: "gmail-thread-1", parentRfcMessageId: "<canonical@mail.gmail.com>",
});
assert.equal(ready.plan.bodyText, row.body_text, "body preserved exactly");

const serverSource = readFileSync(new URL("../src/modules/integrations/gmail/server/prepare-claimed-reply-execution.ts", import.meta.url), "utf8");
const domainSource = readFileSync(new URL("../src/modules/integrations/gmail/domain/prepare-reply-execution-plan.ts", import.meta.url), "utf8");
const productionSource = `${serverSource}\n${domainSource}`;
for (const forbidden of [".insert(", ".update(", ".delete(", ".rpc(", "fetch(", "sendRawGmailMessage", "claim_reply_email_send_request", "claim_email_send_request", "finalize_email_send_request", "finalize_reconciled_email_send_request", "createReplySendRequest", "runManualSendReconciliation"]) {
  assert.equal(productionSource.includes(forbidden), false, `forbidden production dependency: ${forbidden}`);
}
assert.equal((productionSource.match(/evaluateReplyTarget/g) ?? []).length, 1, "one authoritative evaluator dependency path");

const total = cases.length + 4;
process.stdout.write(`gmail-reply-execution-plan fixtures: ${total} passed\n`);
