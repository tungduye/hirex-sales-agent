import "server-only";

interface BuildMimeInput {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  rfcMessageId: string;
  sendRequestId: string;
}

const HEADER_LINE_BREAK = /[\r\n]/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENCODED_WORD_MAX_BYTES = 42;

export function buildPlainTextGmailMessage(input: BuildMimeInput) {
  for (const headerValue of [input.from, input.to, input.subject, input.rfcMessageId, input.sendRequestId]) {
    if (!headerValue || HEADER_LINE_BREAK.test(headerValue)) {
      throw new Error("MIME_HEADER_INVALID");
    }
  }
  if (!UUID_PATTERN.test(input.sendRequestId)) throw new Error("SEND_REQUEST_ID_INVALID");

  const encodedSubject = encodeSubject(input.subject);
  const encodedBody = wrapBase64(Buffer.from(input.bodyText, "utf8").toString("base64"));
  const mime = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodedSubject}`,
    `Message-ID: ${input.rfcMessageId}`,
    `X-HireX-Send-Request-ID: ${input.sendRequestId.toLowerCase()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody,
    "",
  ].join("\r\n");

  return Buffer.from(mime, "utf8").toString("base64url");
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function encodeSubject(subject: string) {
  const chunks: string[] = [];
  let chunk = "";
  let chunkBytes = 0;

  for (const codePoint of subject) {
    const codePointBytes = Buffer.byteLength(codePoint, "utf8");
    if (chunk && chunkBytes + codePointBytes > ENCODED_WORD_MAX_BYTES) {
      chunks.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += codePoint;
    chunkBytes += codePointBytes;
  }
  if (chunk) chunks.push(chunk);

  return chunks
    .map((value) => `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`)
    .join("\r\n ");
}
