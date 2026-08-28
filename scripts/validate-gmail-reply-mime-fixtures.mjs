import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGmailReplyMime } from "../src/modules/integrations/gmail/domain/build-gmail-reply-mime.ts";

const plan = {
  sendRequestId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  emailAccountId: "33333333-3333-4333-8333-333333333333",
  sendLockId: "44444444-4444-4444-8444-444444444444",
  replyToEmailMessageId: "55555555-5555-4555-8555-555555555555",
  recipientEmail: "buyer@example.com",
  subject: "Re: Proposal",
  bodyText: "Thanks.\nLet's talk.",
  providerThreadId: "gmail-thread-1",
  parentRfcMessageId: "<canonical@mail.gmail.com>",
};
const senderEmail = "seller@gmail.com";

function build(overrides = {}) {
  const runtimePlan = overrides.plan ?? plan;
  const runtimeSender = Object.hasOwn(overrides, "senderEmail") ? overrides.senderEmail : senderEmail;
  const input = overrides.input ?? { plan: runtimePlan, senderEmail: runtimeSender };
  return buildGmailReplyMime(input);
}

function decodeRaw(raw) { return Buffer.from(raw, "base64url").toString("utf8"); }
function bodyFromMime(mime) {
  const separator = mime.indexOf("\r\n\r\n");
  assert.notEqual(separator, -1, "MIME body separator");
  const encoded = mime.slice(separator + 4).replace(/\r\n$/, "").replace(/\r\n/g, "");
  return Buffer.from(encoded, "base64").toString("utf8");
}
function headerCount(mime, name) { return mime.split("\r\n").filter((line) => line.startsWith(`${name}:`)).length; }

const ascii = build();
assert.equal(ascii.status, "READY");
const mime = decodeRaw(ascii.raw);

const cases = [
  ["ASCII reply", () => ascii.status, "READY"],
  ["Unicode body", () => build({ plan: { ...plan, bodyText: "Cảm ơn bạn 😊\nHẹn gặp lại." } }).status, "READY"],
  ["Unicode subject", () => build({ plan: { ...plan, subject: "Re: Báo giá tháng tám 😊" } }).status, "READY"],
  ["multiline body", () => bodyFromMime(decodeRaw(build({ plan: { ...plan, bodyText: "one\ntwo\r\nthree" } }).raw)), "one\ntwo\r\nthree"],
  ["thread returned", () => ascii.providerThreadId, plan.providerThreadId],
  ["send request returned", () => ascii.sendRequestId, plan.sendRequestId],
  ["From exact", () => mime.includes(`From: ${senderEmail}\r\n`), true],
  ["To exact", () => mime.includes(`To: ${plan.recipientEmail}\r\n`), true],
  ["In-Reply-To exact", () => mime.includes(`In-Reply-To: ${plan.parentRfcMessageId}\r\n`), true],
  ["References exact", () => mime.includes(`References: ${plan.parentRfcMessageId}\r\n`), true],
  ["correlation exact", () => mime.includes(`X-HireX-Send-Request-ID: ${plan.sendRequestId}\r\n`), true],
  ["malformed sender", () => build({ senderEmail: "bad" }).status, "INVALID_INPUT"],
  ["malformed recipient", () => build({ plan: { ...plan, recipientEmail: "bad" } }).status, "INVALID_INPUT"],
  ["malformed request UUID", () => build({ plan: { ...plan, sendRequestId: "bad" } }).status, "INVALID_INPUT"],
  ["malformed workspace UUID", () => build({ plan: { ...plan, workspaceId: "bad" } }).status, "INVALID_INPUT"],
  ["malformed account UUID", () => build({ plan: { ...plan, emailAccountId: "bad" } }).status, "INVALID_INPUT"],
  ["malformed lock UUID", () => build({ plan: { ...plan, sendLockId: "bad" } }).status, "INVALID_INPUT"],
  ["malformed target UUID", () => build({ plan: { ...plan, replyToEmailMessageId: "bad" } }).status, "INVALID_INPUT"],
  ["extra plan key", () => build({ plan: { ...plan, extraHeader: "X-Evil: yes" } }).status, "INVALID_INPUT"],
  ["extra input key", () => build({ input: { plan, senderEmail, messageId: "caller-value" } }).status, "INVALID_INPUT"],
  ["sender CRLF", () => build({ senderEmail: "seller@gmail.com\r\nBcc: victim@example.com" }).status, "INVALID_INPUT"],
  ["recipient CRLF", () => build({ plan: { ...plan, recipientEmail: "buyer@example.com\r\nBcc: victim@example.com" } }).status, "INVALID_INPUT"],
  ["subject CRLF", () => build({ plan: { ...plan, subject: "Re: Hi\r\nBcc: victim@example.com" } }).status, "INVALID_INPUT"],
  ["subject control", () => build({ plan: { ...plan, subject: "Re: Hi\u0000Hidden" } }).status, "INVALID_INPUT"],
  ["malformed parent RFC", () => build({ plan: { ...plan, parentRfcMessageId: "bad-id" } }).status, "INVALID_INPUT"],
  ["parent RFC control", () => build({ plan: { ...plan, parentRfcMessageId: "<bad\u007f@example.com>" } }).status, "INVALID_INPUT"],
  ["malformed provider thread", () => build({ plan: { ...plan, providerThreadId: "thread with spaces" } }).status, "INVALID_INPUT"],
  ["provider thread control", () => build({ plan: { ...plan, providerThreadId: "thread\u0085id" } }).status, "INVALID_INPUT"],
  ["empty body", () => build({ plan: { ...plan, bodyText: "" } }).status, "INVALID_INPUT"],
  ["whitespace body", () => build({ plan: { ...plan, bodyText: " \r\n\t" } }).status, "INVALID_INPUT"],
  ["NUL body", () => build({ plan: { ...plan, bodyText: "hello\u0000world" } }).status, "INVALID_INPUT"],
  ["maximum body", () => build({ plan: { ...plan, bodyText: "a".repeat(100_000) } }).status, "READY"],
  ["oversized body", () => build({ plan: { ...plan, bodyText: "a".repeat(100_001) } }).status, "INVALID_INPUT"],
  ["decoded UTF-8", () => { const text = "Xin chào 🌍\nDòng hai"; return bodyFromMime(decodeRaw(build({ plan: { ...plan, bodyText: text } }).raw)); }, "Xin chào 🌍\nDòng hai"],
  ["body base64 width", () => { const built = build({ plan: { ...plan, bodyText: "a".repeat(500) } }); const body = decodeRaw(built.raw).split("\r\n\r\n")[1].trimEnd(); return body.split("\r\n").every((line) => line.length <= 76); }, true],
  ["no Cc", () => headerCount(mime, "Cc"), 0],
  ["no Bcc", () => headerCount(mime, "Bcc"), 0],
  ["no HTML", () => /text\/html/i.test(mime), false],
  ["no multipart", () => /multipart\//i.test(mime), false],
  ["no attachment", () => /content-disposition:\s*attachment/i.test(mime), false],
  ["no Message-ID", () => headerCount(mime, "Message-ID"), 0],
  ["MIME version", () => headerCount(mime, "MIME-Version"), 1],
  ["plain UTF-8", () => mime.includes("Content-Type: text/plain; charset=UTF-8\r\n"), true],
  ["base64 transfer", () => mime.includes("Content-Transfer-Encoding: base64\r\n"), true],
  ["Gmail base64url", () => /^[A-Za-z0-9_-]+$/.test(ascii.raw), true],
  ["no base64url plus", () => ascii.raw.includes("+"), false],
  ["no base64url slash", () => ascii.raw.includes("/"), false],
  ["no base64url padding", () => ascii.raw.includes("="), false],
  ["one correlation header", () => headerCount(mime, "X-HireX-Send-Request-ID"), 1],
  ["request UUID in correlation", () => mime.match(/^X-HireX-Send-Request-ID: (.+)$/m)?.[1].replace(/\r$/, ""), plan.sendRequestId],
  ["logical ASCII body", () => bodyFromMime(mime), plan.bodyText],
];

for (const [name, run, expected] of cases) assert.deepEqual(run(), expected, name);

const unicodeSubjectMime = decodeRaw(build({ plan: { ...plan, subject: "Re: Báo giá rất dài 😊 ".repeat(10) } }).raw);
const subjectLines = unicodeSubjectMime.split("\r\n").filter((line) => line.startsWith("Subject:") || line.startsWith(" =?UTF-8?B?"));
assert.ok(subjectLines.length > 1, "long Unicode subject is folded");
assert.ok(subjectLines.every((line) => line.length <= 78), "folded subject lines are RFC-safe");

const productionSource = readFileSync(new URL("../src/modules/integrations/gmail/domain/build-gmail-reply-mime.ts", import.meta.url), "utf8");
for (const forbidden of [".from(", ".select(", ".insert(", ".update(", ".delete(", ".rpc(", "fetch(", "sendRawGmailMessage", "evaluateReplyTarget", "prepareClaimedReplyExecution", "claim_reply_email_send_request", "claim_email_send_request", "finalize_email_send_request", "finalize_reconciled_email_send_request", "createReplySendRequest", "runManualSendReconciliation"]) {
  assert.equal(productionSource.includes(forbidden), false, `forbidden production dependency: ${forbidden}`);
}

process.stdout.write(`gmail-reply-mime fixtures: ${cases.length + 3} passed\n`);
