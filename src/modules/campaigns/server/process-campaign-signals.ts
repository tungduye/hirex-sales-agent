import "server-only";
import { classifyHardBounce } from "@/modules/campaigns/domain/campaign-signals";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

/**
 * Replies: every sent campaign thread is checked for an inbound mail from that recipient after we sent
 * (find_email_campaign_reply_candidates). Only unhandled recipients come back, so nothing is missed when
 * many other mails arrive between runs. `limit` caps how many are applied in one run.
 */
export async function processPersistedCampaignReplies(limit=200,campaignId?:string){
  const db=createPrivilegedSupabaseClient();
  const {data,error}=await db.rpc("find_email_campaign_reply_candidates",{p_limit:Math.min(Math.max(limit,1),2000),p_campaign_id:campaignId??null});
  if(error)return{repliedStopped:0,error:true};
  let stopped=0;
  for(const row of (data??[]) as Array<{workspace_id:string;recipient_id:string;email_message_id:string}>){
    const {data:applied}=await db.rpc("apply_email_campaign_signal",{p_workspace_id:row.workspace_id,p_recipient_id:row.recipient_id,p_signal_type:"REPLY",p_source_key:`message:${row.email_message_id}`,p_email_message_id:row.email_message_id,p_diagnostic:null});
    if(applied===true)stopped+=1;
  }
  return{repliedStopped:stopped,error:false};
}

/** Hard bounces: delivery-failure reports naming a recipient we sent to from that mailbox (last 60 days). */
export async function processPersistedCampaignBounces(limit=200){
  const db=createPrivilegedSupabaseClient();
  const {data,error}=await db.rpc("find_email_campaign_bounce_candidates",{p_limit:Math.min(Math.max(limit,1),2000),p_days:60});
  if(error)return{bouncedStopped:0,error:true};
  let stopped=0;const done=new Set<string>();
  for(const row of (data??[]) as Array<{workspace_id:string;recipient_id:string;normalized_email:string;email_message_id:string;dsn_report_type:string|null;dsn_status:string|null;dsn_action:string|null;dsn_final_recipient:string|null;dsn_original_recipient:string|null;failed_recipients:string[]|null;dsn_diagnostic_code:string|null}>){
    if(done.has(row.recipient_id))continue;
    const failed=Array.isArray(row.failed_recipients)?row.failed_recipients:[];
    if(!classifyHardBounce({contentType:row.dsn_report_type==="delivery-status"?"message/delivery-status":null,status:row.dsn_status,action:row.dsn_action,finalRecipient:row.dsn_final_recipient??row.dsn_original_recipient,failedRecipients:failed,diagnosticCode:row.dsn_diagnostic_code},row.normalized_email))continue;
    const {data:applied}=await db.rpc("apply_email_campaign_signal",{p_workspace_id:row.workspace_id,p_recipient_id:row.recipient_id,p_signal_type:"HARD_BOUNCE",p_source_key:`message:${row.email_message_id}`,p_email_message_id:row.email_message_id,p_diagnostic:"PERMANENT_DSN"});
    if(applied===true){stopped+=1;done.add(row.recipient_id);}
  }
  return{bouncedStopped:stopped,error:false};
}
