import 'server-only';
import { createPrivilegedSupabaseClient } from '@/modules/integrations/gmail/server/privileged-supabase';
import { isGmailQuotaNotice, vietnamDayStart } from '@/modules/campaigns/domain/gmail-quota';

// Evidence stays in the mailbox for auditing. The hold expires at midnight Vietnam time.
// Fail closed if evidence cannot be read; never swap to a different sender to evade a limit.
export async function gmailQuotaReached(workspaceId: string, accountId: string) {
  const db = createPrivilegedSupabaseClient();
  let after: string | null = null;
  for (;;) {
    let query = db.from('email_messages').select('id,from_email,body_text,snippet')
      .eq('workspace_id',workspaceId).eq('email_account_id',accountId)
      .eq('direction','INBOUND').eq('is_mailer_daemon',true)
      .gte('received_at',vietnamDayStart()).order('id').limit(500);
    if(after) query=query.gt('id',after);
    const page=await query;
    if(page.error) throw new Error('QUOTA_EVIDENCE_UNAVAILABLE');
    if(page.data?.some(row=>isGmailQuotaNotice(row.from_email,row.body_text??row.snippet))) return true;
    if(!page.data?.length) break;
    after=page.data[page.data.length-1].id;
  }
  const failures=await db.from('email_send_requests').select('id',{count:'exact',head:true})
    .eq('workspace_id',workspaceId).eq('email_account_id',accountId)
    .eq('safe_error_code','GMAIL_RATE_LIMITED').gte('updated_at',vietnamDayStart());
  if(failures.error) throw new Error('QUOTA_EVIDENCE_UNAVAILABLE');
  return (failures.count??0)>0;
}

export async function campaignHasQuotaHold(workspaceId:string,campaignId:string) {
  const db=createPrivilegedSupabaseClient();
  const senders=await db.from('email_campaign_senders').select('email_account_id')
    .eq('workspace_id',workspaceId).eq('campaign_id',campaignId).eq('enabled',true);
  if(senders.error) throw new Error('QUOTA_SENDERS_UNAVAILABLE');
  for(const sender of senders.data??[]) if(await gmailQuotaReached(workspaceId,sender.email_account_id)) return true;
  return false;
}
