import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  runControlledReplyRequestCreationCli,
} from "../src/modules/integrations/gmail/domain/controlled-reply-request-creation.ts";

const input = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  emailAccountId: "22222222-2222-4222-8222-222222222222",
  emailMessageId: "33333333-3333-4333-8333-333333333333",
  bodyText: "Thanks for your reply.",
  idempotencyKey: "44444444-4444-4444-8444-444444444444",
};
const sendRequestId = "55555555-5555-4555-8555-555555555555";
const args = [
  "--workspace-id", input.workspaceId,
  "--email-account-id", input.emailAccountId,
  "--email-message-id", input.emailMessageId,
  "--body-text", input.bodyText,
  "--idempotency-key", input.idempotencyKey,
];
const created = {
  status: "CREATED", reason: "REPLY_REQUEST_CREATED", sendRequestId,
  replyToEmailMessageId: input.emailMessageId,
};
let fixtureCount = 0;
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); fixtureCount += 1; }
async function run({ argv = args, env = { HIREX_ENABLE_CONTROLLED_REPLY_REQUEST_CREATE: "1" }, creation = created } = {}) {
  const calls = [];
  const result = await runControlledReplyRequestCreationCli(argv, env, {
    create: async (value) => {
      calls.push(value);
      if (typeof creation === "function") return creation();
      return creation;
    },
  });
  return { result, calls };
}

let test = await run({ env: {} });
check("missing guard refused", test.result.status, "REFUSED");
check("missing guard zero creation", test.calls.length, 0);
test = await run({ env: { HIREX_ENABLE_CONTROLLED_REPLY_REQUEST_CREATE: "true" } });
check("wrong guard refused", test.result.reason, "CONTROLLED_REPLY_REQUEST_CREATE_DISABLED");
check("wrong guard zero creation", test.calls.length, 0);

for (const [name, argv] of [
  ["bad workspace", args.map((value, index) => index === 1 ? "bad" : value)],
  ["bad account", args.map((value, index) => index === 3 ? "bad" : value)],
  ["bad message", args.map((value, index) => index === 5 ? "bad" : value)],
  ["v6 workspace", args.map((value, index) => index === 1 ? "11111111-1111-6111-8111-111111111111" : value)],
  ["v7 account", args.map((value, index) => index === 3 ? "22222222-2222-7222-8222-222222222222" : value)],
  ["v8 message", args.map((value, index) => index === 5 ? "33333333-3333-8333-8333-333333333333" : value)],
  ["missing flag", args.slice(0, 8)],
  ["duplicate flag", ["--workspace-id", input.workspaceId, "--workspace-id", input.workspaceId, ...args.slice(4)]],
  ["extra flag", [...args, "--subject", "caller subject"]],
  ["blank body", args.map((value, index) => index === 7 ? "   " : value)],
  ["oversized body", args.map((value, index) => index === 7 ? "a".repeat(100_001) : value)],
  ["NUL body", args.map((value, index) => index === 7 ? "body\u0000text" : value)],
  ["blank idempotency", args.map((value, index) => index === 9 ? "" : value)],
  ["bad idempotency", args.map((value, index) => index === 9 ? "bad" : value)],
  ["v7 idempotency", args.map((value, index) => index === 9 ? "44444444-4444-7444-8444-444444444444" : value)],
  ["v8 idempotency", args.map((value, index) => index === 9 ? "44444444-4444-8444-8444-444444444444" : value)],
  ["caller recipient", [...args, "--recipient", "victim@example.com"]],
  ["caller thread", [...args, "--provider-thread-id", "thread"]],
]) {
  test = await run({ argv });
  check(`${name} invalid`, test.result.status, "INVALID_INPUT");
  check(`${name} zero creation`, test.calls.length, 0);
}

test = await run();
check("v4 identifiers accepted", test.result.status, "CREATED");
check("creation called once", test.calls.length, 1);
check("mapped workspace exact", test.calls[0].workspaceId, input.workspaceId);
check("mapped account exact", test.calls[0].emailAccountId, input.emailAccountId);
check("message maps to reply target", test.calls[0].replyToEmailMessageId, input.emailMessageId);
check("mapped body exact", test.calls[0].bodyText, input.bodyText);
check("mapped idempotency exact", test.calls[0].idempotencyKey, input.idempotencyKey);
check("creation input exact keys", Object.keys(test.calls[0]).sort(), ["bodyText", "emailAccountId", "idempotencyKey", "replyToEmailMessageId", "workspaceId"]);
check("created status", test.result.status, "CREATED");
check("created request pending", test.result.requestStatus, "PENDING");
check("created send type", test.result.sendType, "REPLY");

test = await run({ creation: { status: "EXISTING", reason: "EXISTING_IDEMPOTENT_REPLY_REQUEST", sendRequestId, replyToEmailMessageId: input.emailMessageId } });
check("compatible existing accepted", test.result.status, "EXISTING");
check("existing remains pending", test.result.requestStatus, "PENDING");
check("existing send type REPLY", test.result.sendType, "REPLY");
test = await run({ creation: { status: "IDEMPOTENCY_CONFLICT", reason: "IDEMPOTENCY_KEY_REUSED", sendRequestId, replyToEmailMessageId: input.emailMessageId } });
check("idempotency conflict preserved", test.result.status, "IDEMPOTENCY_CONFLICT");
check("conflict not represented pending", test.result.requestStatus, null);

for (const [name, creation] of [
  ["null result", null],
  ["malformed CREATED ID", { ...created, sendRequestId: "bad" }],
  ["mismatched target", { ...created, replyToEmailMessageId: input.workspaceId }],
  ["unknown status", { ...created, status: "SENT" }],
  ["extra result field", { ...created, body: "sensitive" }],
]) {
  test = await run({ creation });
  check(`${name} unavailable`, test.result.status, "UNAVAILABLE");
  check(`${name} hides request state`, test.result.requestStatus, null);
}
test = await run({ creation: () => { throw new Error("sensitive database detail"); } });
check("creation exception unavailable", test.result.status, "UNAVAILABLE");
check("creation exception safe reason", test.result.reason, "REPLY_REQUEST_UNAVAILABLE");

for (const forbidden of ["bodyText", "recipient", "subject", "providerThreadId", "raw", "accessToken", "sendLockId"]) {
  check(`result excludes ${forbidden}`, Object.hasOwn((await run()).result, forbidden), false);
}

const sources = [
  readFileSync(new URL("./create-controlled-gmail-reply-request.mjs", import.meta.url), "utf8"),
  readFileSync(new URL("../src/modules/integrations/gmail/domain/controlled-reply-request-creation.ts", import.meta.url), "utf8"),
].join("\n");
for (const forbidden of [
  "sendOneReplyMessage", "executeReplySend", "sendRawGmailMessage", "claim_reply_email_send_request",
  "finalize_reply_email_send_request_sent", "finalize_reply_email_send_request_failed",
  ".insert(", ".update(", ".delete(", ".upsert(",
]) check(`static audit excludes ${forbidden}`, sources.includes(forbidden), false);

process.stdout.write(`controlled-gmail-reply-request-creation fixtures: ${fixtureCount} passed\n`);
