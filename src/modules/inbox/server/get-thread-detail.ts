import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { InboxMessage, ThreadDetailResult } from "@/modules/inbox/types/inbox";

interface MessageRow {
  id: string; email_thread_id: string; direction: "INBOUND" | "OUTBOUND";
  from_email: string | null; from_name: string | null; to_emails: string[]; cc_emails: string[]; bcc_emails: string[];
  subject: string | null; snippet: string | null; body_text: string | null; labels: string[];
  is_unread: boolean; is_starred: boolean; sent_at: string | null; received_at: string | null;
  provider_internal_date: string | null; has_attachments: boolean; attachment_count: number; rfc_message_id: string | null;
}

export async function getThreadDetail(threadId: string, selectedAccountId: string | null): Promise<ThreadDetailResult> {
  if (!z.uuid().safeParse(threadId).success) return { status: "not_found", messages: [] };
  const account = await getAccountContext();
  if (!account?.workspaceId) return { status: "not_found", messages: [] };
  const supabase = await createClient();
  let threadQuery = supabase.from("email_threads").select("id").eq("id", threadId).eq("workspace_id", account.workspaceId);
  if (selectedAccountId) threadQuery = threadQuery.eq("email_account_id", selectedAccountId);
  const { data: thread, error: threadError } = await threadQuery.maybeSingle();
  if (threadError) return { status: "error", messages: [] };
  if (!thread) return { status: "not_found", messages: [] };

  let messageQuery = supabase.from("email_messages")
    .select("id, email_thread_id, direction, from_email, from_name, to_emails, cc_emails, bcc_emails, subject, snippet, body_text, labels, is_unread, is_starred, sent_at, received_at, provider_internal_date, has_attachments, attachment_count, rfc_message_id")
    .eq("email_thread_id", threadId)
    .eq("workspace_id", account.workspaceId)
    .order("provider_internal_date", { ascending: true, nullsFirst: false });
  if (selectedAccountId) messageQuery = messageQuery.eq("email_account_id", selectedAccountId);
  const { data, error } = await messageQuery;
  if (error) return { status: "error", messages: [] };
  return { status: "ready", messages: (data as MessageRow[]).map(mapMessage) };
}

function mapMessage(row: MessageRow): InboxMessage {
  return {
    id: row.id, emailThreadId: row.email_thread_id, direction: row.direction,
    fromEmail: row.from_email, fromName: row.from_name, toEmails: row.to_emails,
    ccEmails: row.cc_emails, bccEmails: row.bcc_emails, subject: row.subject,
    snippet: row.snippet, bodyText: row.body_text, labels: row.labels,
    isUnread: row.is_unread, isStarred: row.is_starred, sentAt: row.sent_at,
    receivedAt: row.received_at, providerInternalDate: row.provider_internal_date,
    hasAttachments: row.has_attachments, attachmentCount: row.attachment_count,
    rfcMessageId: row.rfc_message_id,
  };
}
