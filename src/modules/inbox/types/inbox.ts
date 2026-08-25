import type { EmailAccountStatus } from "@/modules/integrations/gmail/types/email-account";

export interface InboxAccount {
  id: string;
  emailAddress: string;
  displayName: string | null;
  status: EmailAccountStatus;
}

export interface InboxThread {
  id: string;
  emailAccountId: string;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  isUnread: boolean;
  isStarred: boolean;
  labels: string[];
  contactId: string | null;
  senderName: string | null;
  senderEmail: string | null;
}

export interface InboxMessage {
  id: string;
  emailThreadId: string;
  direction: "INBOUND" | "OUTBOUND";
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  labels: string[];
  isUnread: boolean;
  isStarred: boolean;
  sentAt: string | null;
  receivedAt: string | null;
  providerInternalDate: string | null;
  hasAttachments: boolean;
  attachmentCount: number;
  rfcMessageId: string | null;
}

export interface InboxData {
  accounts: InboxAccount[];
  threads: InboxThread[];
  selectedAccountId: string | null;
  error: string | null;
}

export type ThreadDetailResult =
  | { status: "ready"; messages: InboxMessage[] }
  | { status: "not_found"; messages: [] }
  | { status: "error"; messages: [] };
