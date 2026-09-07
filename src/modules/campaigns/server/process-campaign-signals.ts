import "server-only";
import { classifyHardBounce,isStrongCampaignReply } from "@/modules/campaigns/domain/campaign-signals";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

export async function processPersistedCampaignReplies(limit=50,campaignId?:string){
  const db=createPrivilegedSupabaseClient();
  const {data:messages,error}=await db.from("email_messages").select("id,workspace_id,email_account_id,email_thread_id,from_email,direction,received_at,auto_submitted,email_threads(provider_thread_id)").eq("direction","INBOUND").order("received_at",{ascending:false}).limit(Math.min(Math.max(limit,1),100));
  if(error)return{repliedStopped:0,error:true};let stopped=0;
  for(const message of messages??[]){const thread=message.email_threads as unknown as {provider_thread_id:string}|null;if(!thread?.provider_thread_id||!message.from_email||!message.received_at)continue;
    let candidateQuery=db.from("email_campaign_recipient_steps").select("recipient_id,workspace_id,sender_email_account_id,provider_thread_id,sent_at,email_campaign_recipients!inner(normalized_email,engagement_status)").eq("workspace_id",message.workspace_id).eq("sender_email_account_id",message.email_account_id).eq("provider_thread_id",thread.provider_thread_id).eq("status","SENT");if(campaignId)candidateQuery=candidateQuery.eq("campaign_id",campaignId);const {data:candidates}=await candidateQuery.order("sent_at",{ascending:false}).limit(5);
    for(const candidate of candidates??[]){const recipient=candidate.email_campaign_recipients as unknown as {normalized_email:string;engagement_status:string};if(!["ACTIVE","COMPLETED"].includes(recipient.engagement_status)||!candidate.sent_at)continue;
      if(!isStrongCampaignReply({workspaceId:message.workspace_id,emailAccountId:message.email_account_id,providerThreadId:thread.provider_thread_id,direction:message.direction,fromEmail:message.from_email,receivedAt:message.received_at,autoSubmitted:message.auto_submitted},{workspaceId:candidate.workspace_id,emailAccountId:candidate.sender_email_account_id!,providerThreadId:candidate.provider_thread_id!,recipientEmail:recipient.normalized_email,sentAt:candidate.sent_at}))continue;
      const {data}=await db.rpc("apply_email_campaign_signal",{p_workspace_id:message.workspace_id,p_recipient_id:candidate.recipient_id,p_signal_type:"REPLY",p_source_key:`message:${message.id}`,p_email_message_id:message.id,p_diagnostic:null});if(data===true)stopped+=1;break;
    }
  }
  return{repliedStopped:stopped,error:false};
}

export async function processPersistedCampaignBounces(limit=50){
  const db=createPrivilegedSupabaseClient();const {data:messages,error}=await db.from("email_messages").select("id,workspace_id,email_account_id,received_at,auto_submitted,dsn_report_type,failed_recipients,dsn_final_recipient,dsn_original_recipient,dsn_action,dsn_status,dsn_diagnostic_code,is_mailer_daemon").eq("direction","INBOUND").order("received_at",{ascending:false}).limit(Math.min(Math.max(limit,1),100));if(error)return{bouncedStopped:0,error:true};let stopped=0;
  for(const message of messages??[]){const recipients=[message.dsn_final_recipient,message.dsn_original_recipient,...(Array.isArray(message.failed_recipients)?message.failed_recipients:[])].filter((value):value is string=>typeof value==="string");for(const email of new Set(recipients)){
      if(!classifyHardBounce({contentType:message.dsn_report_type==="delivery-status"?"message/delivery-status":null,status:message.dsn_status,action:message.dsn_action,finalRecipient:message.dsn_final_recipient??message.dsn_original_recipient,failedRecipients:Array.isArray(message.failed_recipients)?message.failed_recipients:[],diagnosticCode:message.dsn_diagnostic_code},email))continue;
      const {data:candidates}=await db.from("email_campaign_recipient_steps").select("recipient_id,email_campaign_recipients!inner(normalized_email,engagement_status)").eq("workspace_id",message.workspace_id).eq("sender_email_account_id",message.email_account_id).eq("status","SENT").lt("sent_at",message.received_at??new Date().toISOString()).limit(20);
      for(const candidate of candidates??[]){const recipient=candidate.email_campaign_recipients as unknown as {normalized_email:string;engagement_status:string};if(recipient.engagement_status!=="ACTIVE"||recipient.normalized_email!==email.trim().toLowerCase())continue;const {data}=await db.rpc("apply_email_campaign_signal",{p_workspace_id:message.workspace_id,p_recipient_id:candidate.recipient_id,p_signal_type:"HARD_BOUNCE",p_source_key:`message:${message.id}`,p_email_message_id:message.id,p_diagnostic:"PERMANENT_DSN"});if(data===true)stopped+=1;break;}
    }}return{bouncedStopped:stopped,error:false};
}
