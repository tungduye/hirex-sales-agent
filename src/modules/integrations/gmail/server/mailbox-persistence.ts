import "server-only";
import { reconcileQuotaNotice } from '@/modules/campaigns/server/reconcile-quota-notice';
import { isHiddenSystemEmail } from '@/modules/campaigns/domain/gmail-quota';

import type { SupabaseClient } from "@supabase/supabase-js";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import type { ParsedGmailMessage } from "@/modules/integrations/gmail/types/gmail-message";

interface Scope { workspaceId: string; emailAccountId: string }
interface LocalMessage { provider_internal_date: string | null; subject: string | null; snippet: string | null; labels: string[]; is_unread: boolean; is_starred: boolean }
interface MessageIdentity { email_thread_id: string }
interface ThreadIdentity { id: string }

export async function upsertMailboxMessage(scope: Scope, message: ParsedGmailMessage) {
  const supabase = createPrivilegedSupabaseClient();
  const { data: thread, error: threadError } = await supabase.from("email_threads").upsert({
    workspace_id: scope.workspaceId, email_account_id: scope.emailAccountId, provider: "GMAIL",
    provider_thread_id: message.providerThreadId, subject: message.subject, snippet: message.snippet,
  }, { onConflict: "workspace_id,email_account_id,provider,provider_thread_id" }).select("id").single();
  if (threadError || !thread) {
    console.error("[gmail-sync] thread upsert failed", {
      code: threadError?.code ?? null,
      message: threadError?.message ?? null,
      details: threadError?.details ?? null,
      hint: threadError?.hint ?? null,
    });
    throw new Error("THREAD_UPSERT_FAILED");
  }

  const { error: messageError } = await supabase.from("email_messages").upsert({
    workspace_id: scope.workspaceId, email_account_id: scope.emailAccountId, email_thread_id: thread.id, provider: "GMAIL",
    provider_message_id: message.providerMessageId, provider_history_id: message.providerHistoryId,
    rfc_message_id: message.rfcMessageId, hirex_send_request_id: message.hirexSendRequestId,
    in_reply_to: message.inReplyTo, references_header: message.referencesHeader,
    direction: message.direction, from_email: message.fromEmail, from_name: message.fromName,
    to_emails: message.toEmails, cc_emails: message.ccEmails, bcc_emails: message.bccEmails,
    subject: message.subject, snippet: message.snippet, body_text: message.bodyText, body_html: message.bodyHtml,
    labels: message.labels, is_unread: message.isUnread, is_starred: message.isStarred,
    sent_at: message.sentAt, received_at: message.receivedAt, provider_internal_date: message.providerInternalDate,
    has_attachments: message.hasAttachments, attachment_count: message.attachmentCount,
    auto_submitted:message.autoSubmitted,dsn_report_type:message.reportType,failed_recipients:message.failedRecipients,
    dsn_final_recipient:message.dsnFinalRecipient,dsn_original_recipient:message.dsnOriginalRecipient,dsn_action:message.dsnAction,
    dsn_status:message.dsnStatus,dsn_diagnostic_code:message.dsnDiagnosticCode,is_mailer_daemon:message.isMailerDaemon,
  }, { onConflict: "workspace_id,email_account_id,provider,provider_message_id" });
  if (messageError) {
    console.error("[gmail-sync] message upsert failed", {
      code: messageError.code,
      message: messageError.message,
      details: messageError.details,
      hint: messageError.hint,
    });
    throw new Error("MESSAGE_UPSERT_FAILED");
  }
  await reconcileQuotaNotice(scope.workspaceId,scope.emailAccountId,message);
  return thread.id as string;
}

export async function recomputeThreadAggregates(scope: Scope, threadIds: Set<string>) {
  const supabase = createPrivilegedSupabaseClient();
  for (const threadId of threadIds) await recomputeThread(supabase, scope, threadId);
}

export async function deleteMailboxMessage(
  scope: Scope,
  providerMessageId: string,
  providerThreadId: string | null,
) {
  const supabase = createPrivilegedSupabaseClient();
  const existing = await supabase.from("email_messages")
    .select("email_thread_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("email_account_id", scope.emailAccountId)
    .eq("provider", "GMAIL")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  if (existing.error) throw new Error("MESSAGE_DELETE_LOOKUP_FAILED");

  let threadId = (existing.data as MessageIdentity | null)?.email_thread_id ?? null;
  if (!threadId && providerThreadId) {
    const thread = await supabase.from("email_threads")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .eq("email_account_id", scope.emailAccountId)
      .eq("provider", "GMAIL")
      .eq("provider_thread_id", providerThreadId)
      .maybeSingle();
    if (thread.error) throw new Error("THREAD_DELETE_LOOKUP_FAILED");
    threadId = (thread.data as ThreadIdentity | null)?.id ?? null;
  }

  const deleted = await supabase.from("email_messages").delete()
    .eq("workspace_id", scope.workspaceId)
    .eq("email_account_id", scope.emailAccountId)
    .eq("provider", "GMAIL")
    .eq("provider_message_id", providerMessageId);
  if (deleted.error) throw new Error("MESSAGE_DELETE_FAILED");
  return threadId;
}

async function recomputeThread(supabase: SupabaseClient, scope: Scope, threadId: string) {
  const { data, error } = await supabase.from("email_messages")
    .select("provider_internal_date, subject, snippet, labels, is_unread, is_starred")
    .eq("workspace_id", scope.workspaceId).eq("email_account_id", scope.emailAccountId).eq("email_thread_id", threadId);
  if (error) throw new Error("THREAD_AGGREGATE_READ_FAILED");
  const messages = (data ?? []) as LocalMessage[];
  if (messages.length === 0) {
    const { error: deleteError } = await supabase.from("email_threads").delete()
      .eq("id", threadId).eq("workspace_id", scope.workspaceId).eq("email_account_id", scope.emailAccountId);
    if (deleteError) throw new Error("EMPTY_THREAD_DELETE_FAILED");
    return;
  }
  const dated = messages.filter((item) => item.provider_internal_date)
    .sort((a, b) => (a.provider_internal_date ?? "").localeCompare(b.provider_internal_date ?? ""));
  const latest = dated.at(-1) ?? messages.at(-1);
  const { error: updateError } = await supabase.from("email_threads").update({
    message_count: messages.length,
    first_message_at: dated.at(0)?.provider_internal_date ?? null,
    last_message_at: dated.at(-1)?.provider_internal_date ?? null,
    subject: latest?.subject ?? null,
    snippet: latest?.snippet ?? null,
    labels: [...new Set(messages.flatMap((item) => item.labels))],
    is_unread: messages.some((item) => item.is_unread),
    is_starred: messages.some((item) => item.is_starred),
  }).eq("id", threadId).eq("workspace_id", scope.workspaceId).eq("email_account_id", scope.emailAccountId);
  if (updateError) throw new Error("THREAD_AGGREGATE_UPDATE_FAILED");
  // Hide only system-only threads. Never hide a real customer's reply sharing a thread.
  const evidence=await supabase.from('email_messages').select('from_email,body_text,snippet,direction,auto_submitted')
    .eq('workspace_id',scope.workspaceId).eq('email_thread_id',threadId).limit(1000);
  if(evidence.error) throw new Error('SYSTEM_NOTICE_READ_FAILED');
  const inbound=(evidence.data??[]).filter(row=>row.direction==='INBOUND');
  if(inbound.length && (evidence.data?.length??0)<1000 && inbound.every(isHiddenSystemEmail)) {
    const conversation=await supabase.from('omnichannel_conversations').select('metadata')
      .eq('workspace_id',scope.workspaceId).eq('id',threadId).maybeSingle();
    if(conversation.error) throw new Error('SYSTEM_NOTICE_READ_FAILED');
    if(conversation.data){
      const hidden=await supabase.from('omnichannel_conversations').update({metadata:{...conversation.data.metadata,hidden:true,gmailDeliveryNotice:true}})
        .eq('workspace_id',scope.workspaceId).eq('id',threadId);
      if(hidden.error) throw new Error('SYSTEM_NOTICE_HIDE_FAILED');
    }
  } else if(inbound.some(row=>!isHiddenSystemEmail(row))) {
    const conversation=await supabase.from('omnichannel_conversations').select('metadata')
      .eq('workspace_id',scope.workspaceId).eq('id',threadId).maybeSingle();
    if(conversation.error) throw new Error('SYSTEM_NOTICE_READ_FAILED');
    const metadata=conversation.data?.metadata;
    if(metadata?.gmailDeliveryNotice===true || metadata?.gmailQuotaNotice===true){
      const restored={...metadata,hidden:false,gmailDeliveryNotice:false,gmailQuotaNotice:false};
      const update=await supabase.from('omnichannel_conversations').update({metadata:restored})
        .eq('workspace_id',scope.workspaceId).eq('id',threadId);
      if(update.error) throw new Error('SYSTEM_NOTICE_RESTORE_FAILED');
    }
  }
}
