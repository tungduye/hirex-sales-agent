import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  runControlledReplyPreflightCli,
} from "../src/modules/integrations/gmail/domain/controlled-reply-preflight.ts";

const input = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  emailAccountId: "22222222-2222-4222-8222-222222222222",
  emailMessageId: "33333333-3333-4333-8333-333333333333",
};
const args = [
  "--workspace-id", input.workspaceId,
  "--email-account-id", input.emailAccountId,
  "--email-message-id", input.emailMessageId,
];
const safe = {
  classification: "SAFE_REPLY_TARGET",
  reason: "SAFE_CANONICAL_REPLY_TARGET",
  workspaceId: input.workspaceId,
  emailAccountId: input.emailAccountId,
  replyToEmailMessageId: input.emailMessageId,
  recipientEmail: "buyer@example.com",
  subject: "Re: Proposal",
  providerThreadId: "gmail_thread-1",
  parentRfcMessageId: "<parent@mail.gmail.com>",
};
let fixtureCount = 0;
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); fixtureCount += 1; }
async function run({ argv = args, env = { HIREX_ENABLE_CONTROLLED_REPLY_PREFLIGHT: "1" }, evaluation = safe } = {}) {
  const calls = [];
  const result = await runControlledReplyPreflightCli(argv, env, {
    evaluate: async (value) => {
      calls.push(value);
      if (typeof evaluation === "function") return evaluation();
      return evaluation;
    },
  });
  return { result, calls };
}

let test = await run({ env: {} });
check("missing guard refused", test.result.status, "REFUSED");
check("missing guard zero evaluator", test.calls.length, 0);
test = await run({ env: { HIREX_ENABLE_CONTROLLED_REPLY_PREFLIGHT: "true" } });
check("non-exact guard refused", test.result.reason, "CONTROLLED_REPLY_PREFLIGHT_DISABLED");

for (const [name, argv] of [
  ["malformed workspace", ["--workspace-id", "bad", "--email-account-id", input.emailAccountId, "--email-message-id", input.emailMessageId]],
  ["malformed account", ["--workspace-id", input.workspaceId, "--email-account-id", "bad", "--email-message-id", input.emailMessageId]],
  ["malformed message", ["--workspace-id", input.workspaceId, "--email-account-id", input.emailAccountId, "--email-message-id", "bad"]],
  ["extra argument", [...args, "--recipient", "victim@example.com"]],
  ["missing argument", args.slice(0, 4)],
  ["duplicate flag", ["--workspace-id", input.workspaceId, "--workspace-id", input.workspaceId, "--email-message-id", input.emailMessageId]],
]) {
  test = await run({ argv });
  check(`${name} invalid`, test.result.status, "INVALID_INPUT");
  check(`${name} zero evaluator`, test.calls.length, 0);
}

test = await run();
check("safe status", test.result.status, "READY_FOR_CONTROLLED_REPLY_TEST");
check("safe evaluator once", test.calls.length, 1);
check("safe evaluator exact input", test.calls[0], input);
check("safe recipient", test.result.recipientEmail, safe.recipientEmail);
check("safe subject", test.result.subject, safe.subject);
check("safe thread", test.result.providerThreadId, safe.providerThreadId);
check("safe parent RFC", test.result.parentRfcMessageId, safe.parentRfcMessageId);

for (const [classification, reason, expected] of [
  ["NOT_REPLYABLE", "MESSAGE_NOT_INBOUND", "NOT_REPLYABLE"],
  ["AMBIGUOUS", "CANONICAL_THREAD_UNAVAILABLE", "AMBIGUOUS"],
  ["UNAVAILABLE", "EVALUATION_UNAVAILABLE", "UNAVAILABLE"],
]) {
  test = await run({ evaluation: { ...safe, classification, reason, recipientEmail: null, subject: null, providerThreadId: null, parentRfcMessageId: null } });
  check(`${classification} mapped`, test.result.status, expected);
  check(`${classification} hides metadata`, [test.result.recipientEmail, test.result.subject, test.result.providerThreadId, test.result.parentRfcMessageId], [null, null, null, null]);
}

for (const [name, evaluation] of [
  ["null evaluator", null],
  ["unknown classification", { ...safe, classification: "UNKNOWN" }],
  ["mismatched scope", { ...safe, workspaceId: input.emailMessageId }],
  ["malformed safe recipient", { ...safe, recipientEmail: "bad" }],
  ["safe result extra field", { ...safe, accessToken: "forbidden" }],
  ["impossible reason", { ...safe, classification: "NOT_REPLYABLE", reason: "SAFE_CANONICAL_REPLY_TARGET", recipientEmail: null, subject: null, providerThreadId: null, parentRfcMessageId: null }],
]) {
  test = await run({ evaluation });
  check(`${name} unavailable`, test.result.status, "UNAVAILABLE");
  check(`${name} no metadata`, test.result.recipientEmail, null);
}
test = await run({ evaluation: () => { throw new Error("fixture evaluator failure"); } });
check("evaluator exception unavailable", test.result.status, "UNAVAILABLE");
check("evaluator exception safe reason", test.result.reason, "EVALUATION_UNAVAILABLE");

for (const forbidden of ["accessToken", "refreshToken", "ciphertext", "raw", "body", "sendLockId", "supabaseSecret"]) {
  check(`safe output excludes ${forbidden}`, Object.hasOwn((await run()).result, forbidden), false);
}

const sources = [
  readFileSync(new URL("./preflight-controlled-gmail-reply.mjs", import.meta.url), "utf8"),
  readFileSync(new URL("../src/modules/integrations/gmail/domain/controlled-reply-preflight.ts", import.meta.url), "utf8"),
].join("\n");
for (const forbidden of [
  "sendOneReplyMessage", "executeReplySend", "sendRawGmailMessage", "createReplySendRequest",
  "claim_reply_email_send_request", "finalize_reply_email_send_request_sent",
  "finalize_reply_email_send_request_failed", ".insert(", ".update(", ".delete(", ".upsert(",
]) check(`static audit excludes ${forbidden}`, sources.includes(forbidden), false);

process.stdout.write(`controlled-gmail-reply-preflight fixtures: ${fixtureCount} passed\n`);
