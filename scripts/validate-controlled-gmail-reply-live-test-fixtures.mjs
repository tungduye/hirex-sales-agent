import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runControlledReplyLiveTestCli } from "../src/modules/integrations/gmail/domain/controlled-reply-live-test.ts";

const input = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  emailAccountId: "22222222-2222-4222-8222-222222222222",
  emailMessageId: "33333333-3333-4333-8333-333333333333",
  bodyText: "Thank you for the update.",
  idempotencyKey: "44444444-4444-4444-8444-444444444444",
  expectedRecipient: "buyer@example.com",
  expectedSubject: "Re: Proposal",
  expectedProviderThreadId: "gmail_thread-1",
  expectedParentRfcMessageId: "<parent@mail.gmail.com>",
};
const sendRequestId = "55555555-5555-4555-8555-555555555555";
const providerMessageId = "gmail_message-1";
const args = [
  "--workspace-id", input.workspaceId, "--email-account-id", input.emailAccountId,
  "--email-message-id", input.emailMessageId, "--body-text", input.bodyText,
  "--idempotency-key", input.idempotencyKey, "--expected-recipient", input.expectedRecipient,
  "--expected-subject", input.expectedSubject, "--expected-provider-thread-id", input.expectedProviderThreadId,
  "--expected-parent-rfc-message-id", input.expectedParentRfcMessageId,
  "--confirm-send-one-reply", "SEND_ONE_CONTROLLED_REPLY",
];
const preflight = {
  status: "READY_FOR_CONTROLLED_REPLY_TEST", reason: "SAFE_CANONICAL_REPLY_TARGET",
  workspaceId: input.workspaceId, emailAccountId: input.emailAccountId, emailMessageId: input.emailMessageId,
  recipientEmail: input.expectedRecipient, subject: input.expectedSubject,
  providerThreadId: input.expectedProviderThreadId, parentRfcMessageId: input.expectedParentRfcMessageId,
};
const creation = {
  status: "CREATED", reason: "REPLY_REQUEST_CREATED", sendRequestId,
  replyToEmailMessageId: input.emailMessageId,
};
const pending = {
  id: sendRequestId, workspace_id: input.workspaceId, email_account_id: input.emailAccountId,
  send_type: "REPLY", status: "PENDING", attempt_count: 0, last_attempt_at: null,
  safe_error_code: null, send_lock_id: null, send_lock_at: null,
  reply_to_email_message_id: input.emailMessageId, to_addresses: [input.expectedRecipient],
  cc_addresses: [], bcc_addresses: [], subject: input.expectedSubject, body_text: input.bodyText,
  body_html: null, send_after: null, idempotency_key: input.idempotencyKey,
  provider_message_id: null, provider_thread_id: null, rfc_message_id: null, sent_at: null,
};
const sent = {
  ...pending, status: "SENT", attempt_count: 1, last_attempt_at: "2026-08-28T01:00:00.000Z",
  provider_message_id: providerMessageId, provider_thread_id: input.expectedProviderThreadId,
  sent_at: "2026-08-28T01:00:01.000Z",
};
const sentExecution = {
  status: "SENT", reason: "SENT", sendRequestId,
  providerMessageId, providerThreadId: input.expectedProviderThreadId,
};

let assertionCount = 0;
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); assertionCount += 1; }
function replaceArg(flag, value, source = args) {
  const copy = [...source]; copy[copy.indexOf(flag) + 1] = value; return copy;
}
function clone(value) { return structuredClone(value); }
async function run(options = {}) {
  const calls = { preflight: [], create: [], inspect: [], execute: [] };
  let inspectionIndex = 0;
  const inspections = options.inspections ?? [pending, sent];
  const invoke = async (configured, fallback, callValue, bucket) => {
    calls[bucket].push(callValue);
    const value = configured === undefined ? fallback : configured;
    if (typeof value === "function") return value(callValue);
    return clone(value);
  };
  const result = await runControlledReplyLiveTestCli(
    options.argv ?? args,
    options.env ?? { HIREX_ENABLE_CONTROLLED_REPLY_LIVE_TEST: "1" },
    {
      preflight: (value) => invoke(options.preflight, preflight, value, "preflight"),
      createRequest: (value) => invoke(options.creation, creation, value, "create"),
      inspectRequest: async (value) => {
        calls.inspect.push(value);
        const configured = inspections[Math.min(inspectionIndex, inspections.length - 1)];
        inspectionIndex += 1;
        if (typeof configured === "function") return configured(value);
        return clone(configured);
      },
      executeRequest: (value) => invoke(options.execution, sentExecution, value, "execute"),
    },
  );
  return { result, calls };
}
function dependencyCounts(test) {
  return [test.calls.preflight.length, test.calls.create.length, test.calls.inspect.length, test.calls.execute.length];
}

let test = await run({ env: {} });
check("missing guard refused", test.result.status, "REFUSED");
check("missing guard reason", test.result.reason, "CONTROLLED_REPLY_LIVE_TEST_DISABLED");
check("missing guard all dependencies zero", dependencyCounts(test), [0, 0, 0, 0]);
test = await run({ env: { HIREX_ENABLE_CONTROLLED_REPLY_LIVE_TEST: "true" } });
check("wrong guard refused", test.result.status, "REFUSED");
check("wrong guard all dependencies zero", dependencyCounts(test), [0, 0, 0, 0]);

const invalidInputs = [
  ["bad workspace", replaceArg("--workspace-id", "bad")],
  ["v6 workspace", replaceArg("--workspace-id", "11111111-1111-6111-8111-111111111111")],
  ["v7 account", replaceArg("--email-account-id", "22222222-2222-7222-8222-222222222222")],
  ["v8 message", replaceArg("--email-message-id", "33333333-3333-8333-8333-333333333333")],
  ["v7 idempotency", replaceArg("--idempotency-key", "44444444-4444-7444-8444-444444444444")],
  ["unknown flag", [...args.slice(0, -2), "--unknown", "value"]],
  ["duplicate flag", ["--workspace-id", input.workspaceId, "--workspace-id", input.workspaceId, ...args.slice(4)]],
  ["missing flag", args.slice(0, -2)],
  ["blank body", replaceArg("--body-text", "   ")],
  ["oversized body", replaceArg("--body-text", "a".repeat(100_001))],
  ["NUL body", replaceArg("--body-text", "a\u0000b")],
  ["unsafe recipient", replaceArg("--expected-recipient", "Buyer <buyer@example.com>")],
  ["CRLF subject", replaceArg("--expected-subject", "Re: valid\r\nBcc: victim@example.com")],
  ["malformed thread", replaceArg("--expected-provider-thread-id", "thread/value")],
  ["malformed RFC", replaceArg("--expected-parent-rfc-message-id", "parent@mail.gmail.com")],
  ["wrong confirmation", replaceArg("--confirm-send-one-reply", "SEND_TWO_REPLIES")],
];
for (const [name, argv] of invalidInputs) {
  test = await run({ argv });
  check(`${name} invalid`, test.result.status, "INVALID_INPUT");
  check(`${name} reason`, test.result.reason, "INVALID_ARGUMENTS");
  check(`${name} dependencies zero`, dependencyCounts(test), [0, 0, 0, 0]);
  check(`${name} no request`, test.result.sendRequestId, null);
}

test = await run();
check("happy sent verified", test.result.status, "VERIFIED_SENT");
check("happy preflight once", test.calls.preflight.length, 1);
check("happy create once", test.calls.create.length, 1);
check("happy inspect twice", test.calls.inspect.length, 2);
check("happy execute once", test.calls.execute.length, 1);
check("preflight exact scope", test.calls.preflight[0], {
  workspaceId: input.workspaceId, emailAccountId: input.emailAccountId, emailMessageId: input.emailMessageId,
});
check("create exact input", test.calls.create[0], {
  workspaceId: input.workspaceId, emailAccountId: input.emailAccountId,
  replyToEmailMessageId: input.emailMessageId, bodyText: input.bodyText, idempotencyKey: input.idempotencyKey,
});
check("executor exact input", test.calls.execute[0], {
  sendRequestId, workspaceId: input.workspaceId, emailAccountId: input.emailAccountId,
});
check("executor has only three IDs", Object.keys(test.calls.execute[0]).sort(), ["emailAccountId", "sendRequestId", "workspaceId"]);

for (const [name, changed] of [
  ["recipient confirmation", { recipientEmail: "other@example.com" }],
  ["subject confirmation", { subject: "Re: Other" }],
  ["thread confirmation", { providerThreadId: "other_thread" }],
  ["RFC confirmation", { parentRfcMessageId: "<other@mail.gmail.com>" }],
]) {
  test = await run({ preflight: { ...preflight, ...changed } });
  check(`${name} mismatch refused`, test.result.status, "REFUSED");
  check(`${name} mismatch reason`, test.result.reason, "LIVE_TARGET_CONFIRMATION_MISMATCH");
  check(`${name} preflight once`, test.calls.preflight.length, 1);
  check(`${name} no later dependencies`, [test.calls.create.length, test.calls.inspect.length, test.calls.execute.length], [0, 0, 0]);
}

for (const [name, altered, expectedStatus] of [
  ["not replyable", { status: "NOT_REPLYABLE", reason: "MESSAGE_NOT_INBOUND", recipientEmail: null,
    subject: null, providerThreadId: null, parentRfcMessageId: null }, "NOT_REPLYABLE"],
  ["ambiguous", { status: "AMBIGUOUS", reason: "CANONICAL_THREAD_UNAVAILABLE", recipientEmail: null,
    subject: null, providerThreadId: null, parentRfcMessageId: null }, "UNAVAILABLE"],
  ["unavailable", { status: "UNAVAILABLE", reason: "EVALUATION_UNAVAILABLE", recipientEmail: null,
    subject: null, providerThreadId: null, parentRfcMessageId: null }, "UNAVAILABLE"],
  ["malformed", { accessToken: "secret" }, "UNAVAILABLE"],
]) {
  test = await run({ preflight: { ...preflight, ...altered } });
  check(`${name} status`, test.result.status, expectedStatus);
  check(`${name} preflight once`, test.calls.preflight.length, 1);
  check(`${name} creation zero`, test.calls.create.length, 0);
  check(`${name} executor zero`, test.calls.execute.length, 0);
}
test = await run({ preflight: () => { throw new Error("raw provider detail"); } });
check("preflight throw unavailable", test.result.status, "UNAVAILABLE");
check("preflight throw safe reason", test.result.reason, "PREFLIGHT_UNAVAILABLE");
check("preflight throw no creation/executor", [test.calls.create.length, test.calls.execute.length], [0, 0]);

const creationStops = [
  ["conflict", { status: "IDEMPOTENCY_CONFLICT", reason: "IDEMPOTENCY_KEY_REUSED", sendRequestId,
    replyToEmailMessageId: input.emailMessageId }, "IDEMPOTENCY_CONFLICT"],
  ["not replyable", { status: "NOT_REPLYABLE", reason: "REPLY_TARGET_NOT_SAFE", sendRequestId: null,
    replyToEmailMessageId: input.emailMessageId }, "NOT_REPLYABLE"],
  ["unavailable", { status: "UNAVAILABLE", reason: "REPLY_REQUEST_UNAVAILABLE", sendRequestId: null,
    replyToEmailMessageId: input.emailMessageId }, "UNAVAILABLE"],
  ["malformed", { ...creation, status: "CREATED", sendRequestId: "bad" }, "UNAVAILABLE"],
];
for (const [name, creationValue, expectedStatus] of creationStops) {
  test = await run({ creation: creationValue });
  check(`creation ${name} mapped`, test.result.status, expectedStatus);
  check(`creation ${name} called once`, test.calls.create.length, 1);
  check(`creation ${name} no inspection`, test.calls.inspect.length, 0);
  check(`creation ${name} executor zero`, test.calls.execute.length, 0);
}
test = await run({ creation: { ...creation, status: "EXISTING", reason: "EXISTING_IDEMPOTENT_REPLY_REQUEST" } });
check("compatible existing proceeds", test.result.status, "VERIFIED_SENT");
check("compatible existing status recorded", test.result.requestCreationStatus, "EXISTING");
check("compatible existing executor once", test.calls.execute.length, 1);

const pendingFailures = [
  ["wrong request", { id: input.workspaceId }], ["wrong workspace", { workspace_id: input.emailMessageId }],
  ["wrong account", { email_account_id: input.workspaceId }], ["not REPLY", { send_type: "NEW" }],
  ["not PENDING", { status: "SENDING" }], ["attempt nonzero", { attempt_count: 1 }],
  ["last attempt set", { last_attempt_at: "2026-08-28T00:00:00Z" }], ["safe error set", { safe_error_code: "ERROR" }],
  ["lock id present", { send_lock_id: input.workspaceId }], ["lock time present", { send_lock_at: "2026-08-28T00:00:00Z" }],
  ["wrong target", { reply_to_email_message_id: input.workspaceId }], ["wrong recipient", { to_addresses: ["other@example.com"] }],
  ["multiple recipients", { to_addresses: [input.expectedRecipient, "other@example.com"] }], ["cc present", { cc_addresses: ["cc@example.com"] }],
  ["bcc present", { bcc_addresses: ["bcc@example.com"] }], ["subject mismatch", { subject: "Re: Other" }],
  ["body mismatch", { body_text: "different" }], ["html present", { body_html: "<p>x</p>" }],
  ["scheduled", { send_after: "2026-08-29T00:00:00Z" }], ["idempotency mismatch", { idempotency_key: input.workspaceId }],
  ["provider message present", { provider_message_id: providerMessageId }], ["provider thread present", { provider_thread_id: input.expectedProviderThreadId }],
  ["RFC present", { rfc_message_id: "<out@mail.gmail.com>" }], ["sent at present", { sent_at: "2026-08-28T00:00:00Z" }],
];
for (const [name, patch] of pendingFailures) {
  test = await run({ inspections: [{ ...pending, ...patch }] });
  check(`pending ${name} unavailable`, test.result.status, "UNAVAILABLE");
  check(`pending ${name} safe reason`, test.result.reason, "PENDING_REQUEST_INSPECTION_FAILED");
  check(`pending ${name} inspected once`, test.calls.inspect.length, 1);
  check(`pending ${name} executor zero`, test.calls.execute.length, 0);
  check(`pending ${name} create once`, test.calls.create.length, 1);
}

const sentFailures = [
  ["stored thread mismatch", { provider_thread_id: "other_thread" }],
  ["missing provider message", { provider_message_id: null }],
  ["missing sent timestamp", { sent_at: null }],
  ["lock remains", { send_lock_id: input.workspaceId }],
  ["wrong attempt", { attempt_count: 2 }],
];
for (const [name, patch] of sentFailures) {
  test = await run({ inspections: [pending, { ...sent, ...patch }] });
  check(`sent ${name} unknown`, test.result.status, "DELIVERY_STATUS_UNKNOWN");
  check(`sent ${name} verification reason`, test.result.reason, "FINAL_STATE_VERIFICATION_FAILED");
  check(`sent ${name} executor once`, test.calls.execute.length, 1);
  check(`sent ${name} final inspection once`, test.calls.inspect.length, 2);
  check(`sent ${name} no second create`, test.calls.create.length, 1);
}
check("verified sent provider message", (await run()).result.providerMessageId, providerMessageId);
check("verified sent provider thread", (await run()).result.providerThreadId, input.expectedProviderThreadId);
test = await run({ inspections: [pending, () => { throw new Error("raw database failure"); }] });
check("sent final inspection throw unknown", test.result.status, "DELIVERY_STATUS_UNKNOWN");
check("sent final inspection throw safe reason", test.result.reason, "FINAL_STATE_VERIFICATION_FAILED");
check("sent final inspection throw executor once", test.calls.execute.length, 1);

const failedReason = "GMAIL_SEND_REJECTED";
const failedRow = { ...pending, status: "FAILED", attempt_count: 1,
  last_attempt_at: "2026-08-28T01:00:00.000Z", safe_error_code: failedReason };
const failedExecution = { status: "FAILED", reason: failedReason, sendRequestId,
  providerMessageId: null, providerThreadId: null };
test = await run({ execution: failedExecution, inspections: [pending, failedRow] });
check("failed verified", test.result.status, "VERIFIED_FAILED");
check("failed reason retained", test.result.reason, failedReason);
check("failed final status", test.result.finalRequestStatus, "FAILED");
check("failed executor once", test.calls.execute.length, 1);
check("failed no retry creation", test.calls.create.length, 1);
test = await run({ execution: failedExecution, inspections: [pending, { ...failedRow, safe_error_code: "REAUTH_REQUIRED" }] });
check("wrong failed code unavailable", test.result.status, "UNAVAILABLE");
check("wrong failed code no retry", test.calls.execute.length, 1);

const unknownExecution = { status: "DELIVERY_STATUS_UNKNOWN", reason: "GMAIL_DELIVERY_STATUS_UNKNOWN",
  sendRequestId, providerMessageId: null, providerThreadId: null };
const sendingRow = { ...pending, status: "SENDING", attempt_count: 1,
  last_attempt_at: "2026-08-28T01:00:00Z", send_lock_id: input.workspaceId,
  send_lock_at: "2026-08-28T01:00:00Z" };
test = await run({ execution: unknownExecution, inspections: [pending, sendingRow] });
check("ambiguous remains unknown", test.result.status, "DELIVERY_STATUS_UNKNOWN");
check("ambiguous final sending", test.result.finalRequestStatus, "SENDING");
check("ambiguous executor once", test.calls.execute.length, 1);
check("ambiguous creation once", test.calls.create.length, 1);
check("ambiguous inspections twice", test.calls.inspect.length, 2);

for (const [executorStatus, executorReason] of [["NOT_ELIGIBLE", "REQUEST_NOT_ELIGIBLE"],
  ["INVALID_INPUT", "INVALID_EXECUTOR_INPUT"], ["UNAVAILABLE", "EXECUTION_UNAVAILABLE"]]) {
  test = await run({ execution: { status: executorStatus, reason: executorReason, sendRequestId,
    providerMessageId: null, providerThreadId: null }, inspections: [pending, sendingRow] });
  check(`${executorStatus} safely unavailable`, test.result.status, "UNAVAILABLE");
  check(`${executorStatus} executor once`, test.calls.execute.length, 1);
  check(`${executorStatus} final inspection performed`, test.calls.inspect.length, 2);
  check(`${executorStatus} no retry`, test.calls.create.length, 1);
}

const safeResult = (await run()).result;
for (const forbidden of ["bodyText", "recipientEmail", "subject", "parentRfcMessageId", "accessToken",
  "refreshToken", "sendLockId", "raw", "credentials", "databaseRow"]) {
  check(`output excludes ${forbidden}`, Object.hasOwn(safeResult, forbidden), false);
}
check("output exact safe keys", Object.keys(safeResult).sort(), ["emailAccountId", "emailMessageId", "executorStatus",
  "finalRequestStatus", "providerMessageId", "providerThreadId", "reason", "requestCreationStatus",
  "sendRequestId", "status", "workspaceId"].sort());

const operatorSources = [
  readFileSync(new URL("./run-controlled-gmail-reply-live-test.mjs", import.meta.url), "utf8"),
  readFileSync(new URL("../src/modules/integrations/gmail/domain/controlled-reply-live-test.ts", import.meta.url), "utf8"),
  readFileSync(new URL("../src/modules/integrations/gmail/server/inspect-reply-send-request.ts", import.meta.url), "utf8"),
].join("\n");
for (const forbidden of ["sendRawGmailMessage", ".insert(", ".update(", ".delete(", ".upsert(",
  "setInterval", "setTimeout", "while (", "while(", "fetch(", "/api/", "scheduler", "campaign"])
  check(`static audit excludes ${forbidden}`, operatorSources.includes(forbidden), false);
check("operator references reviewed creation", operatorSources.includes("createReplySendRequest"), true);
check("operator references reviewed executor", operatorSources.includes("sendOneReplyMessage"), true);
check("operator has no production IDs", operatorSources.includes("da7cef02-036a-4ee9-b3d7-5c7df54c73a0"), false);

process.stdout.write(`controlled-gmail-reply-live-test fixtures: ${assertionCount} passed\n`);
