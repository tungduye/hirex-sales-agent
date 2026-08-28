import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyReplyTarget, evaluateReplyTargetEvidence } from "../src/modules/integrations/gmail/domain/classify-reply-target.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const emailAccountId = "22222222-2222-4222-8222-222222222222";
const emailMessageId = "33333333-3333-4333-8333-333333333333";
const emailThreadId = "44444444-4444-4444-8444-444444444444";
const otherWorkspaceId = "55555555-5555-4555-8555-555555555555";
const otherAccountId = "66666666-6666-4666-8666-666666666666";
const input = { workspaceId, emailAccountId, emailMessageId };
const message = {
  id: emailMessageId, workspaceId, emailAccountId, emailThreadId, provider: "GMAIL",
  providerMessageId: "gmail-message-1", providerThreadId: "gmail-thread-1",
  rfcMessageId: "<canonical-message@mail.gmail.com>", direction: "INBOUND",
  fromEmail: "buyer@example.com", subject: "Proposal", labels: ["INBOX"],
};
const account = { id: emailAccountId, workspaceId, provider: "GMAIL", status: "CONNECTED", emailAddress: "seller@gmail.com" };
const thread = { id: emailThreadId, workspaceId, emailAccountId, provider: "GMAIL", providerThreadId: "gmail-thread-1" };

function classify(overrides = {}) {
  return classifyReplyTarget(input, { message, account, thread, ...overrides });
}

const cases = [
  ["safe inbound", () => classify(), "SAFE_REPLY_TARGET", "SAFE_CANONICAL_REPLY_TARGET"],
  ["message absent", () => classify({ message: null }), "NOT_REPLYABLE", "MESSAGE_NOT_FOUND"],
  ["cross workspace", () => classify({ message: { ...message, workspaceId: otherWorkspaceId } }), "NOT_REPLYABLE", "EVIDENCE_SCOPE_MISMATCH"],
  ["wrong account", () => classify({ message: { ...message, emailAccountId: otherAccountId } }), "NOT_REPLYABLE", "EVIDENCE_SCOPE_MISMATCH"],
  ["outbound", () => classify({ message: { ...message, direction: "OUTBOUND" } }), "NOT_REPLYABLE", "MESSAGE_NOT_INBOUND"],
  ["spam", () => classify({ message: { ...message, labels: ["SPAM"] } }), "NOT_REPLYABLE", "SPAM_OR_TRASH_MESSAGE"],
  ["trash", () => classify({ message: { ...message, labels: ["TRASH"] } }), "NOT_REPLYABLE", "SPAM_OR_TRASH_MESSAGE"],
  ["missing sender", () => classify({ message: { ...message, fromEmail: null } }), "NOT_REPLYABLE", "SENDER_UNAVAILABLE"],
  ["malformed sender", () => classify({ message: { ...message, fromEmail: "one@example.com, two@example.com" } }), "NOT_REPLYABLE", "SENDER_UNAVAILABLE"],
  ["sender is mailbox", () => classify({ message: { ...message, fromEmail: " SELLER@GMAIL.COM " } }), "NOT_REPLYABLE", "SENDER_IS_CONNECTED_ACCOUNT"],
  ["disconnected account", () => classify({ account: { ...account, status: "DISCONNECTED" } }), "NOT_REPLYABLE", "ACCOUNT_NOT_CONNECTED"],
  ["non Gmail account", () => classify({ account: { ...account, provider: "OTHER" } }), "NOT_REPLYABLE", "ACCOUNT_NOT_CONNECTED"],
  ["missing provider message id", () => classify({ message: { ...message, providerMessageId: null } }), "NOT_REPLYABLE", "PROVIDER_MESSAGE_ID_UNAVAILABLE"],
  ["missing provider thread id", () => classify({ message: { ...message, providerThreadId: null } }), "NOT_REPLYABLE", "PROVIDER_THREAD_ID_UNAVAILABLE"],
  ["missing RFC Message-ID", () => classify({ message: { ...message, rfcMessageId: null } }), "NOT_REPLYABLE", "RFC_MESSAGE_ID_UNAVAILABLE"],
  ["malformed RFC Message-ID", () => classify({ message: { ...message, rfcMessageId: "bad-id" } }), "NOT_REPLYABLE", "RFC_MESSAGE_ID_UNAVAILABLE"],
  ["RFC Message-ID with NUL", () => classify({ message: { ...message, rfcMessageId: "<canonical\u0000@mail.gmail.com>" } }), "NOT_REPLYABLE", "RFC_MESSAGE_ID_UNAVAILABLE"],
  ["RFC Message-ID with DEL", () => classify({ message: { ...message, rfcMessageId: "<canonical\u007f@mail.gmail.com>" } }), "NOT_REPLYABLE", "RFC_MESSAGE_ID_UNAVAILABLE"],
  ["RFC Message-ID with C1 control", () => classify({ message: { ...message, rfcMessageId: "<canonical\u0085@mail.gmail.com>" } }), "NOT_REPLYABLE", "RFC_MESSAGE_ID_UNAVAILABLE"],
  ["thread absent", () => classify({ thread: null }), "AMBIGUOUS", "CANONICAL_THREAD_UNAVAILABLE"],
  ["thread wrong workspace", () => classify({ thread: { ...thread, workspaceId: otherWorkspaceId } }), "NOT_REPLYABLE", "EVIDENCE_SCOPE_MISMATCH"],
  ["thread wrong account", () => classify({ thread: { ...thread, emailAccountId: otherAccountId } }), "NOT_REPLYABLE", "EVIDENCE_SCOPE_MISMATCH"],
  ["malformed message", () => classify({ message: { ...message, labels: null } }), "AMBIGUOUS", "EVALUATION_UNAVAILABLE"],
  ["malformed account", () => classify({ account: { ...account, emailAddress: null } }), "AMBIGUOUS", "EVALUATION_UNAVAILABLE"],
  ["ambiguous message evidence", () => classify({ message: [message, message] }), "AMBIGUOUS", "EVALUATION_UNAVAILABLE"],
  ["existing Re normalized", () => classify({ message: { ...message, subject: "Re: Re: Proposal" } }), "SAFE_REPLY_TARGET", "SAFE_CANONICAL_REPLY_TARGET"],
  ["normal subject normalized", () => classify(), "SAFE_REPLY_TARGET", "SAFE_CANONICAL_REPLY_TARGET"],
  ["blank subject", () => classify({ message: { ...message, subject: "  " } }), "NOT_REPLYABLE", "SUBJECT_UNAVAILABLE"],
  ["header injection subject", () => classify({ message: { ...message, subject: "Hello\r\nBcc: victim@example.com" } }), "NOT_REPLYABLE", "SUBJECT_UNAVAILABLE"],
  ["subject with NUL", () => classify({ message: { ...message, subject: "Proposal\u0000Hidden" } }), "NOT_REPLYABLE", "SUBJECT_UNAVAILABLE"],
  ["subject with C1 control", () => classify({ message: { ...message, subject: "Proposal\u0085Hidden" } }), "NOT_REPLYABLE", "SUBJECT_UNAVAILABLE"],
  ["sender with syntax delimiter", () => classify({ message: { ...message, fromEmail: "foo:bar@example.com" } }), "NOT_REPLYABLE", "SENDER_UNAVAILABLE"],
  ["sender with consecutive dots", () => classify({ message: { ...message, fromEmail: "a..b@example.com" } }), "NOT_REPLYABLE", "SENDER_UNAVAILABLE"],
  ["sender with control", () => classify({ message: { ...message, fromEmail: "buyer\u0000@example.com" } }), "NOT_REPLYABLE", "SENDER_UNAVAILABLE"],
  ["normal sender remains safe", () => classify({ message: { ...message, fromEmail: "buyer@example.com" } }), "SAFE_REPLY_TARGET", "SAFE_CANONICAL_REPLY_TARGET"],
  ["canonical RFC Message-ID remains safe", () => classify({ message: { ...message, rfcMessageId: "<canonical-message@mail.gmail.com>" } }), "SAFE_REPLY_TARGET", "SAFE_CANONICAL_REPLY_TARGET"],
  ["thread provider mismatch", () => classify({ thread: { ...thread, providerThreadId: "other-thread" } }), "NOT_REPLYABLE", "PROVIDER_THREAD_ID_UNAVAILABLE"],
];

for (const [name, run, classification, reason] of cases) {
  assert.doesNotThrow(() => {
    const actual = run();
    assert.equal(actual.classification, classification, `${name}: classification`);
    assert.equal(actual.reason, reason, `${name}: reason`);
  }, `${name}: unexpected throw`);
}

const reSubject = classify({ message: { ...message, subject: "Re: Re: Proposal" } });
assert.equal(reSubject.subject, "Re: Proposal");
assert.equal(classify().subject, "Re: Proposal");
assert.deepEqual(Object.keys(classify()).sort(), [
  "classification", "emailAccountId", "parentRfcMessageId", "providerThreadId", "reason",
  "recipientEmail", "replyToEmailMessageId", "subject", "workspaceId",
].sort());

const loaderFailure = await evaluateReplyTargetEvidence(input, async () => { throw new Error("sensitive database detail"); });
assert.equal(loaderFailure.classification, "UNAVAILABLE");
assert.equal(loaderFailure.reason, "EVALUATION_UNAVAILABLE");

const production = readFileSync(new URL("../src/modules/integrations/gmail/server/evaluate-reply-target.ts", import.meta.url), "utf8");
for (const forbidden of [".insert(", ".update(", ".delete(", ".rpc(", "fetch(", "sendRawGmailMessage", "runManualSendReconciliation", "reconcileAmbiguousSend", "finalize_reconciled_email_send_request"]) {
  assert.equal(production.includes(forbidden), false, `forbidden production dependency: ${forbidden}`);
}

process.stdout.write(`gmail-reply-target fixtures: ${cases.length + 3} passed\n`);
