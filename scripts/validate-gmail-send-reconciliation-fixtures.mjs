import assert from "node:assert/strict";
import { classifyAmbiguousSendEvidence } from "../src/modules/integrations/gmail/domain/classify-ambiguous-send.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const emailAccountId = "22222222-2222-4222-8222-222222222222";
const sendRequestId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";
const threadId = "55555555-5555-4555-8555-555555555555";

const baseRequest = {
  id: sendRequestId,
  workspaceId,
  emailAccountId,
  sendType: "NEW",
  status: "SENDING",
  toAddresses: ["buyer@example.com"],
  ccAddresses: [],
  bccAddresses: [],
  subject: "Hello",
  bodyText: "Plain body",
  bodyHtml: null,
  sendAfter: null,
  providerMessageId: null,
  providerThreadId: null,
};

const baseMessage = {
  id: messageId,
  workspaceId,
  emailAccountId,
  emailThreadId: threadId,
  providerMessageId: "gmail-message-1",
  hirexSendRequestId: sendRequestId,
  labels: ["SENT"],
  direction: "OUTBOUND",
  fromEmail: "sender@gmail.com",
  toEmails: ["buyer@example.com"],
  subject: "Hello",
  bodyText: "Plain body",
};

const baseThread = {
  id: threadId,
  workspaceId,
  emailAccountId,
  providerThreadId: "gmail-thread-1",
};

function classify(overrides = {}) {
  return classifyAmbiguousSendEvidence({
    request: baseRequest,
    connectedEmail: "sender@gmail.com",
    candidates: [baseMessage],
    thread: baseThread,
    expectedWorkspaceId: workspaceId,
    expectedEmailAccountId: emailAccountId,
    sendRequestId,
    ...overrides,
  });
}

const fixtures = [
  ["exact canonical SENT match", () => classify(), "SAFE_MATCH", "SAFE_EXACT_CANONICAL_MATCH"],
  ["no correlation", () => classify({ candidates: [] }), "NO_MATCH", "CORRELATION_NOT_FOUND"],
  ["duplicate correlation", () => classify({ candidates: [baseMessage, { ...baseMessage, id: "66666666-6666-4666-8666-666666666666" }] }), "AMBIGUOUS", "MULTIPLE_CORRELATION_MATCHES"],
  ["SENT label missing", () => classify({ candidates: [{ ...baseMessage, labels: [] }] }), "NO_MATCH", "SENT_LABEL_MISSING"],
  ["sender mismatch", () => classify({ candidates: [{ ...baseMessage, fromEmail: "other@gmail.com" }] }), "NO_MATCH", "SENDER_MISMATCH"],
  ["recipient mismatch", () => classify({ candidates: [{ ...baseMessage, toEmails: ["other@example.com"] }] }), "NO_MATCH", "RECIPIENT_MISMATCH"],
  ["subject mismatch", () => classify({ candidates: [{ ...baseMessage, subject: "Different" }] }), "NO_MATCH", "SUBJECT_MISMATCH"],
  ["body mismatch", () => classify({ candidates: [{ ...baseMessage, bodyText: "Different" }] }), "NO_MATCH", "BODY_MISMATCH"],
  ["provider message conflict", () => classify({ request: { ...baseRequest, providerMessageId: "other-provider-id" } }), "NO_MATCH", "PROVIDER_MESSAGE_ID_CONFLICT"],
  ["provider thread conflict", () => classify({ request: { ...baseRequest, providerThreadId: "other-thread-id" } }), "NO_MATCH", "PROVIDER_THREAD_ID_CONFLICT"],
  ["null provider IDs accepted", () => classify({ request: { ...baseRequest, providerMessageId: null, providerThreadId: null } }), "SAFE_MATCH", "SAFE_EXACT_CANONICAL_MATCH"],
  ["wrong workspace candidate", () => classify({ candidates: [{ ...baseMessage, workspaceId: "77777777-7777-4777-8777-777777777777" }] }), "NO_MATCH", "CORRELATION_NOT_FOUND"],
  ["wrong account candidate", () => classify({ candidates: [{ ...baseMessage, emailAccountId: "88888888-8888-4888-8888-888888888888" }] }), "NO_MATCH", "CORRELATION_NOT_FOUND"],
  ["request not SENDING", () => classify({ request: { ...baseRequest, status: "SENT" } }), "NO_MATCH", "REQUEST_NOT_ELIGIBLE"],
  ["unsupported request shape", () => classify({ request: { ...baseRequest, ccAddresses: ["cc@example.com"] } }), "NO_MATCH", "UNSUPPORTED_REQUEST_SHAPE"],
  ["missing canonical body", () => classify({ candidates: [{ ...baseMessage, bodyText: null }] }), "AMBIGUOUS", "BODY_COMPARISON_UNCERTAIN"],
  ["one terminal newline normalized", () => classify({ candidates: [{ ...baseMessage, bodyText: "Plain body\r\n" }] }), "SAFE_MATCH", "SAFE_EXACT_CANONICAL_MATCH"],
  ["Gmail account not connected", () => classify({ connectedEmail: null }), "NO_MATCH", "REQUEST_NOT_ELIGIBLE"],
  ["malformed request recipients", () => classify({ request: { ...baseRequest, toAddresses: null } }), "NO_MATCH", "UNSUPPORTED_REQUEST_SHAPE"],
  ["malformed message labels", () => classify({ candidates: [{ ...baseMessage, labels: null }] }), "AMBIGUOUS", "EVALUATION_UNAVAILABLE"],
  ["malformed message recipients", () => classify({ candidates: [{ ...baseMessage, toEmails: null }] }), "AMBIGUOUS", "EVALUATION_UNAVAILABLE"],
  ["malformed thread provider ID", () => classify({ thread: { ...baseThread, providerThreadId: null } }), "AMBIGUOUS", "CANONICAL_THREAD_UNAVAILABLE"],
];

for (const [name, evaluate, classification, reason] of fixtures) {
  assert.doesNotThrow(() => {
    const actual = evaluate();
    assert.equal(actual.classification, classification, `${name}: classification`);
    assert.equal(actual.reason, reason, `${name}: reason`);
  }, `${name}: unexpected throw`);
}

process.stdout.write(`gmail-send-reconciliation fixtures: ${fixtures.length} passed\n`);
