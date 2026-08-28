import type { ReplyExecutionPlan } from "@/modules/integrations/gmail/domain/prepare-reply-execution-plan";

const MAX_BODY_TEXT_LENGTH = 100_000;
const ENCODED_WORD_MAX_BYTES = 42;

export interface BuildGmailReplyMimeInput {
  plan: ReplyExecutionPlan;
  senderEmail: string;
}

export type BuildGmailReplyMimeResult =
  | {
    status: "READY";
    reason: "READY_FOR_GMAIL_REPLY_SEND";
    raw: string;
    providerThreadId: string;
    sendRequestId: string;
  }
  | {
    status: "INVALID_INPUT" | "UNAVAILABLE";
    reason: "INVALID_REPLY_MIME_INPUT" | "REPLY_MIME_UNAVAILABLE";
    raw: null;
    providerThreadId: null;
    sendRequestId: null;
  };

export function buildGmailReplyMime(input: BuildGmailReplyMimeInput): BuildGmailReplyMimeResult {
  if (!isExactInput(input)) return failure("INVALID_INPUT", "INVALID_REPLY_MIME_INPUT");

  try {
    const encodedSubject = encodeSubject(input.plan.subject);
    const encodedBody = wrapBase64(encodeUtf8Base64(input.plan.bodyText));
    const mime = [
      `From: ${input.senderEmail}`,
      `To: ${input.plan.recipientEmail}`,
      `Subject: ${encodedSubject}`,
      `In-Reply-To: ${input.plan.parentRfcMessageId}`,
      `References: ${input.plan.parentRfcMessageId}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      `X-HireX-Send-Request-ID: ${input.plan.sendRequestId}`,
      "",
      encodedBody,
      "",
    ].join("\r\n");

    return {
      status: "READY",
      reason: "READY_FOR_GMAIL_REPLY_SEND",
      raw: toBase64Url(encodeUtf8Base64(mime)),
      providerThreadId: input.plan.providerThreadId,
      sendRequestId: input.plan.sendRequestId,
    };
  } catch {
    return failure("UNAVAILABLE", "REPLY_MIME_UNAVAILABLE");
  }
}

function isExactInput(value: unknown): value is BuildGmailReplyMimeInput {
  return isRecord(value) && exactKeys(value, ["plan", "senderEmail"])
    && isConservativeEmail(value.senderEmail) && isExactPlan(value.plan);
}

function isExactPlan(value: unknown): value is ReplyExecutionPlan {
  if (!isRecord(value) || !exactKeys(value, [
    "sendRequestId", "workspaceId", "emailAccountId", "sendLockId", "replyToEmailMessageId",
    "recipientEmail", "subject", "bodyText", "providerThreadId", "parentRfcMessageId",
  ])) return false;
  return isUuid(value.sendRequestId) && isUuid(value.workspaceId) && isUuid(value.emailAccountId)
    && isUuid(value.sendLockId) && isUuid(value.replyToEmailMessageId)
    && isConservativeEmail(value.recipientEmail) && isSafeHeaderText(value.subject)
    && isPlainTextBody(value.bodyText) && isSafeProviderThreadId(value.providerThreadId)
    && isCanonicalRfcMessageId(value.parentRfcMessageId);
}

function encodeSubject(subject: string) {
  const chunks: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const codePoint of subject) {
    const codePointBytes = new TextEncoder().encode(codePoint).length;
    if (chunk && chunkBytes + codePointBytes > ENCODED_WORD_MAX_BYTES) {
      chunks.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += codePoint;
    chunkBytes += codePointBytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((value) => `=?UTF-8?B?${encodeUtf8Base64(value)}?=`).join("\r\n ");
}

function wrapBase64(value: string) { return value.match(/.{1,76}/g)?.join("\r\n") ?? ""; }
function encodeUtf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}
function toBase64Url(value: string) { return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function failure(status: "INVALID_INPUT" | "UNAVAILABLE", reason: "INVALID_REPLY_MIME_INPUT" | "REPLY_MIME_UNAVAILABLE"): BuildGmailReplyMimeResult {
  return { status, reason, raw: null, providerThreadId: null, sendRequestId: null };
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function hasControl(value: string) { return /[\u0000-\u001f\u007f-\u009f]/.test(value); }
function isSafeHeaderText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 998 && !hasControl(value); }
function isPlainTextBody(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_BODY_TEXT_LENGTH && !value.includes("\u0000"); }
function isSafeProviderThreadId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 512 && !/\s/.test(value) && !hasControl(value); }
function isCanonicalRfcMessageId(value: unknown): value is string { return typeof value === "string" && value.length <= 998 && !hasControl(value) && /^<[^<>\s@]+@[^<>\s@]+>$/.test(value); }

function isConservativeEmail(value: unknown): value is string {
  if (typeof value !== "string" || value !== value.trim().toLowerCase() || value.length > 254 || hasControl(value)
    || /[\s<>()[\]\\,;:"]/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain || local.length > 64 || domain.length > 253 || local.startsWith(".")
    || local.endsWith(".") || local.includes("..") || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => label.length > 0 && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}
