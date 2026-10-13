import 'server-only';
import { createPrivilegedSupabaseClient } from '@/modules/integrations/gmail/server/privileged-supabase';
import { isGmailQuotaNotice } from '@/modules/campaigns/domain/gmail-quota';
import type { ParsedGmailMessage } from '@/modules/integrations/gmail/types/gmail-message';

export async function reconcileQuotaNotice(workspaceId:string,accountId:string,message:ParsedGmailMessage) {
  if(!isGmailQuotaNotice(message.fromEmail,message.bodyText??message.snippet)) return;
  // Never guess by subject or mark every sent message failed. Require an exact RFC parent.
  const parent=message.inReplyTo?.trim();
  if(!parent || !/^<[^<>\s]+>$/.test(parent)) return;
  const db=createPrivilegedSupabaseClient();
  let matches=await db.from('email_campaign_recipient_steps').select('id,recipient_id,sent_at')
    .eq('workspace_id',workspaceId).eq('sender_email_account_id',accountId)
    .eq('rfc_message_id',parent).in('status',['SENT','FAILED']).limit(2);
  if(matches.error) throw new Error('QUOTA_CORRELATION_FAILED');
  // Gmail may replace the supplied RFC Message-ID. A provider thread containing
  // exactly one campaign delivery is also unambiguous; never pick among follow-ups.
  if(!matches.data?.length && message.providerThreadId) {
    const threadMatches=await db.from('email_campaign_recipient_steps').select('id,recipient_id,sent_at,status')
      .eq('workspace_id',workspaceId).eq('sender_email_account_id',accountId)
      .eq('provider_thread_id',message.providerThreadId).limit(2);
    if(threadMatches.error) throw new Error('QUOTA_CORRELATION_FAILED');
    if(threadMatches.data?.length===1 && ['SENT','FAILED'].includes(threadMatches.data[0].status)) matches=threadMatches;
  }
  if(matches.data?.length!==1) return;
  const match=matches.data[0];
  if(match.sent_at && (!message.receivedAt || Date.parse(message.receivedAt)<Date.parse(match.sent_at))) return;
  const code='GMAIL_RATE_LIMITED_APPROVAL_REQUIRED';
  const step=await db.from('email_campaign_recipient_steps').update({status:'FAILED',safe_error_code:code})
    .eq('workspace_id',workspaceId).eq('id',match.id).in('status',['SENT','FAILED']);
  if(step.error) throw new Error('QUOTA_STEP_UPDATE_FAILED');
  const recipient=await db.from('email_campaign_recipients').update({status:'FAILED',sent_at:null,failed_at:new Date().toISOString(),safe_error_code:code,engagement_status:'CANCELLED',stopped_reason:code})
    .eq('workspace_id',workspaceId).eq('id',match.recipient_id).in('status',['PENDING','SENT','FAILED'])
    .in('engagement_status',['ACTIVE','COMPLETED','CANCELLED']);
  if(recipient.error) throw new Error('QUOTA_RECIPIENT_UPDATE_FAILED');
  const pending=await db.from('email_campaign_recipient_steps').update({status:'CANCELLED',safe_error_code:code})
    .eq('workspace_id',workspaceId).eq('recipient_id',match.recipient_id).eq('status','PENDING');
  if(pending.error) throw new Error('QUOTA_FOLLOWUP_HOLD_FAILED');
}
