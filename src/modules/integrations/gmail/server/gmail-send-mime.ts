import "server-only";

interface BuildMimeInput {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  rfcMessageId: string;
  sendRequestId: string;
  attachments?: readonly MimeAttachment[];
}

export interface MimeAttachment { filename:string; mimeType:string; bytes:Buffer }

interface ThreadedBuildMimeInput extends BuildMimeInput { inReplyTo: string; references: string }

const HEADER_LINE_BREAK = /[\r\n]/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENCODED_WORD_MAX_BYTES = 42;

export function buildPlainTextGmailMessage(input: BuildMimeInput) {
  return buildMessage(input, []);
}

export function buildPlainTextGmailThreadedMessage(input: ThreadedBuildMimeInput) {
  for(const value of [input.inReplyTo,input.references])if(!/^<[^<>\s@]+@[^<>\s@]+>$/.test(value)||HEADER_LINE_BREAK.test(value))throw new Error("MIME_THREAD_HEADER_INVALID");
  return buildMessage(input,[`In-Reply-To: ${input.inReplyTo}`,`References: ${input.references}`]);
}

function buildMessage(input:BuildMimeInput,threadHeaders:string[]) {
  for (const headerValue of [input.from, input.to, input.subject, input.rfcMessageId, input.sendRequestId]) {
    if (!headerValue || HEADER_LINE_BREAK.test(headerValue)) {
      throw new Error("MIME_HEADER_INVALID");
    }
  }
  if (!UUID_PATTERN.test(input.sendRequestId)) throw new Error("SEND_REQUEST_ID_INVALID");

  const encodedSubject = encodeSubject(input.subject);
  const encodedBody = wrapBase64(Buffer.from(input.bodyText, "utf8").toString("base64"));
  const baseHeaders = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodedSubject}`,
    `Message-ID: ${input.rfcMessageId}`,
    `X-HireX-Send-Request-ID: ${input.sendRequestId.toLowerCase()}`,
    ...threadHeaders,
    "MIME-Version: 1.0",
  ];
  const attachments=input.attachments??[];
  const mime=attachments.length===0?[...baseHeaders,"Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",encodedBody,""].join("\r\n"):buildMultipart(baseHeaders,encodedBody,attachments);

  return Buffer.from(mime, "utf8").toString("base64url");
}

function buildMultipart(headers:string[],body:string,attachments:readonly MimeAttachment[]){
  const boundary=`hirex-${headers.length}-${attachments.length}-${Buffer.from(headers.join(""),"utf8").toString("base64url").slice(0,24)}`;
  const parts=[...headers,`Content-Type: multipart/mixed; boundary="${boundary}"`,"",`--${boundary}`,"Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",body];
  for(const item of attachments){if(!item.filename||/[\r\n\u0000-\u001f\u007f-\u009f]/.test(item.filename)||!item.mimeType||/[\r\n]/.test(item.mimeType))throw new Error("MIME_ATTACHMENT_INVALID");const encodedName=`UTF-8''${encodeURIComponent(item.filename)}`;parts.push(`--${boundary}`,`Content-Type: ${item.mimeType}`,`Content-Disposition: attachment; filename*=UTF-8''${encodedName.slice(7)}`,"Content-Transfer-Encoding: base64","",wrapBase64(item.bytes.toString("base64")));}
  parts.push(`--${boundary}--`,"");return parts.join("\r\n");
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
