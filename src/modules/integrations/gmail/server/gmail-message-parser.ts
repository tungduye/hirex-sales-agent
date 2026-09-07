import "server-only";

import type { GmailHeader, GmailMessageResource, GmailPart, ParsedGmailMessage } from "@/modules/integrations/gmail/types/gmail-message";
import { parseDeliveryStatusText } from "@/modules/campaigns/domain/campaign-signals";

export function parseGmailMessage(message: GmailMessageResource, connectedEmail: string): ParsedGmailMessage | null {
  if (!message.id || !message.threadId) return null;
  const headers = headerMap(message.payload?.headers ?? []);
  const from = parseMailbox(headers.get("from") ?? "");
  const labels = [...new Set(message.labelIds ?? [])];
  const direction = labels.includes("SENT") || from.email === connectedEmail.trim().toLowerCase() ? "OUTBOUND" : "INBOUND";
  const internalDate = parseInternalDate(message.internalDate);
  const body = collectBody(message.payload);
  const delivery = collectDeliveryStatus(message.payload);

  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId,
    providerHistoryId: clean(message.historyId),
    rfcMessageId: clean(headers.get("message-id")),
    hirexSendRequestId: parseHirexSendRequestId(headers.get("x-hirex-send-request-id")),
    inReplyTo: clean(headers.get("in-reply-to")),
    referencesHeader: clean(headers.get("references")),
    direction,
    fromEmail: from.email,
    fromName: from.name,
    toEmails: parseAddressList(headers.get("to")),
    ccEmails: parseAddressList(headers.get("cc")),
    bccEmails: parseAddressList(headers.get("bcc")),
    subject: clean(headers.get("subject")),
    snippet: clean(message.snippet),
    bodyText: body.text,
    bodyHtml: body.html,
    labels,
    isUnread: labels.includes("UNREAD"),
    isStarred: labels.includes("STARRED"),
    sentAt: direction === "OUTBOUND" ? internalDate : null,
    receivedAt: direction === "INBOUND" ? internalDate : null,
    providerInternalDate: internalDate,
    hasAttachments: body.attachmentCount > 0,
    attachmentCount: body.attachmentCount,
    autoSubmitted: clean(headers.get("auto-submitted")),
    reportType: parseReportType(message.payload?.headers ?? []),
    failedRecipients: parseAddressList(headers.get("x-failed-recipients")),
    dsnFinalRecipient: delivery.finalRecipient,
    dsnOriginalRecipient: delivery.originalRecipient,
    dsnAction: delivery.action,
    dsnStatus: delivery.status,
    dsnDiagnosticCode: delivery.diagnosticCode,
    isMailerDaemon: /mailer-daemon|postmaster/i.test(from.email ?? ""),
  };
}

function parseReportType(headers:GmailHeader[]){const contentType=headers.find(h=>h.name?.toLowerCase()==="content-type")?.value??"";return clean(contentType.match(/report-type\s*=\s*"?([^;"\s]+)/i)?.[1]);}

function collectDeliveryStatus(root?:GmailPart){let raw:string|null=null;function visit(part?:GmailPart){if(!part||raw)return;if(part.mimeType?.toLowerCase()==="message/delivery-status")raw=decodeBase64Url(part.body?.data);for(const child of part.parts??[])visit(child);}visit(root);return parseDeliveryStatusText(raw);}

function headerMap(headers: GmailHeader[]) {
  const result = new Map<string, string>();
  for (const header of headers) if (header.name && header.value) result.set(header.name.toLowerCase(), header.value);
  return result;
}

function parseMailbox(value: string) {
  const angle = value.match(/^(.*)<([^<>]+)>\s*$/);
  const email = (angle?.[2] ?? value).trim().replace(/^mailto:/i, "").toLowerCase();
  const name = angle?.[1]?.trim().replace(/^['"]|['"]$/g, "") || null;
  return { email: /^[^\s@<>]+@[^\s@<>]+$/.test(email) ? email : null, name };
}

function parseAddressList(value?: string) {
  if (!value) return [];
  const addresses = value.match(/(?:[^,\"]|\"[^\"]*\")+/g) ?? [];
  return [...new Set(addresses.map((address) => parseMailbox(address).email).filter((email): email is string => Boolean(email)))];
}

function collectBody(root?: GmailPart) {
  let text: string | null = null;
  let html: string | null = null;
  let attachmentCount = 0;

  function visit(part?: GmailPart) {
    if (!part) return;
    const isAttachment = Boolean(part.filename?.trim() || part.body?.attachmentId);
    if (isAttachment) {
      attachmentCount += 1;
      return;
    }
    const decoded = decodeBase64Url(part.body?.data);
    if (decoded && part.mimeType?.toLowerCase() === "text/plain" && text === null) text = decoded;
    if (decoded && part.mimeType?.toLowerCase() === "text/html" && html === null) html = decoded;
    for (const child of part.parts ?? []) visit(child);
  }
  visit(root);
  return { text, html, attachmentCount };
}

function decodeBase64Url(value?: string) {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch { return null; }
}

function parseInternalDate(value?: string) {
  if (!value || !/^\d+$/.test(value)) return null;
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseHirexSendRequestId(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

function clean(value?: string) { const result = value?.trim(); return result ? result : null; }
