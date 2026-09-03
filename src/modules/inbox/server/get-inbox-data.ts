import "server-only";

import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { createClient } from "@/lib/supabase/server";
import { listEmailAccounts } from "@/modules/integrations/gmail/server/list-email-accounts";
import type { InboxData, InboxThread } from "@/modules/inbox/types/inbox";

interface ThreadRow {
  id: string; email_account_id: string; subject: string | null; snippet: string | null;
  last_message_at: string | null; message_count: number; is_unread: boolean; is_starred: boolean;
  labels: string[]; contact_id: string | null;
}
interface SenderRow {
  email_thread_id: string; from_email: string | null; from_name: string | null;
  provider_internal_date: string | null;
}

export async function getInboxData(requestedAccountId?: string): Promise<InboxData> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return { accounts: [], threads: [], selectedAccountId: null, error: "Inbox could not be loaded." };
  const supabase = await createClient();
  const accountResult = await listEmailAccounts();
  if (accountResult.error) return { accounts: [], threads: [], selectedAccountId: null, error: accountResult.error };
  const accounts = accountResult.accounts.map((item) => ({ id: item.id, emailAddress: item.emailAddress,
    displayName: item.displayName, status: item.status, sendEnabled: item.sendEnabled }));
  const selectedAccountId = requestedAccountId && accounts.some((account) => account.id === requestedAccountId)
    ? requestedAccountId
    : null;

  let threadQuery = supabase.from("email_threads")
    .select("id, email_account_id, subject, snippet, last_message_at, message_count, is_unread, is_starred, labels, contact_id")
    .eq("workspace_id", account.workspaceId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50);
  if (selectedAccountId) threadQuery = threadQuery.eq("email_account_id", selectedAccountId);
  const { data: threadData, error: threadError } = await threadQuery;
  if (threadError) return { accounts, threads: [], selectedAccountId, error: "Inbox could not be loaded. Please try again." };

  const rows = threadData as ThreadRow[];
  if (rows.length === 0) return { accounts, threads: [], selectedAccountId, error: null };
  const threadIds = rows.map((thread) => thread.id);
  const { data: senderData, error: senderError } = await supabase.from("email_messages")
    .select("email_thread_id, from_email, from_name, provider_internal_date")
    .in("email_thread_id", threadIds)
    .order("provider_internal_date", { ascending: false, nullsFirst: false });
  if (senderError) return { accounts, threads: rows.map((row) => mapThread(row, null)), selectedAccountId, error: null };

  const latestSenderByThread = new Map<string, SenderRow>();
  for (const sender of senderData as SenderRow[]) {
    if (!latestSenderByThread.has(sender.email_thread_id)) latestSenderByThread.set(sender.email_thread_id, sender);
  }
  return {
    accounts,
    threads: rows.map((row) => mapThread(row, latestSenderByThread.get(row.id) ?? null)),
    selectedAccountId,
    error: null,
  };
}

function mapThread(row: ThreadRow, sender: SenderRow | null): InboxThread {
  return {
    id: row.id, emailAccountId: row.email_account_id, subject: row.subject, snippet: row.snippet,
    lastMessageAt: row.last_message_at, messageCount: row.message_count, isUnread: row.is_unread,
    isStarred: row.is_starred, labels: row.labels, contactId: row.contact_id,
    senderName: sender?.from_name ?? null, senderEmail: sender?.from_email ?? null,
  };
}
