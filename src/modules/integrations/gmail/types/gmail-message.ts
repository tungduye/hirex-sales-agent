export interface GmailHeader { name?: string; value?: string }
export interface GmailBody { data?: string; attachmentId?: string; size?: number }
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPart[];
}

export interface GmailMessageResource {
  id?: string;
  threadId?: string;
  historyId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export interface ParsedGmailMessage {
  providerMessageId: string;
  providerThreadId: string;
  providerHistoryId: string | null;
  rfcMessageId: string | null;
  hirexSendRequestId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  direction: "INBOUND" | "OUTBOUND";
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  labels: string[];
  isUnread: boolean;
  isStarred: boolean;
  sentAt: string | null;
  receivedAt: string | null;
  providerInternalDate: string | null;
  hasAttachments: boolean;
  attachmentCount: number;
}
