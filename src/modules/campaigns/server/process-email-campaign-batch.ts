import "server-only";

import { randomUUID } from "node:crypto";
import { buildCampaignPersonalization, MAX_RECIPIENTS_PER_WORKER_RUN, normalizeCampaignEmail, renderCampaignTemplate, validateRenderedCampaignMessage } from "@/modules/campaigns/domain/campaign-rules";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import { sendOneNewGmailMessage } from "@/modules/integrations/gmail/server/send-one-new-message";
import { createUnsubscribeUrl, validateCampaignWorkerConfig } from "@/modules/campaigns/server/unsubscribe-token";

interface Claim { recipient_id:string;workspace_id:string;campaign_id:string;email:string;display_name:string|null;company:string|null;recipient_position:string|null;personalization_json:Record<string,unknown>;sender_email_account_id:string;idempotency_key:string;claim_token:string;subject_template:string;body_text_template:string }
export interface CampaignWorkerResult { success:boolean;code:"OK"|"CONFIG_UNAVAILABLE"|"DATABASE_UNAVAILABLE"|"MALFORMED_CLAIM"|"CAMPAIGN_FINALIZATION_UNAVAILABLE";campaignsConsidered:number; recipientsProcessed:number; sent:number; failed:number; deliveryUnknown:number }

export async function activateDueEmailCampaigns(limit = 10): Promise<number> {
  const db=createPrivilegedSupabaseClient(); const now=new Date().toISOString();
  const {data,error}=await db.from("email_campaigns").select("id,workspace_id").eq("status","SCHEDULED").lte("scheduled_at",now).order("scheduled_at").limit(Math.min(Math.max(limit,1),25));if(error)throw new Error("CAMPAIGN_ACTIVATION_UNAVAILABLE");
  let activated=0;
  for(const row of data??[]){ const {data:updated,error:updateError}=await db.from("email_campaigns").update({status:"RUNNING",started_at:now,paused_at:null}).eq("id",row.id).eq("workspace_id",row.workspace_id).eq("status","SCHEDULED").select("id").maybeSingle();if(updateError)throw new Error("CAMPAIGN_ACTIVATION_UNAVAILABLE");if(updated){activated+=1;const {error:eventError}=await db.from("email_campaign_events").insert({workspace_id:row.workspace_id,campaign_id:row.id,event_type:"CAMPAIGN_STARTED"});if(eventError)throw new Error("CAMPAIGN_ACTIVATION_UNAVAILABLE");}}
  return activated;
}

export async function processEmailCampaignBatch(limit = 10): Promise<CampaignWorkerResult> {
  const ceiling=Math.min(Math.max(limit,1),MAX_RECIPIENTS_PER_WORKER_RUN,25);
  const result:CampaignWorkerResult={success:true,code:"OK",campaignsConsidered:0,recipientsProcessed:0,sent:0,failed:0,deliveryUnknown:0};
  if(!validateCampaignWorkerConfig())return {...result,success:false,code:"CONFIG_UNAVAILABLE"};
  const db=createPrivilegedSupabaseClient();
  const {data:campaigns,error:campaignError}=await db.from("email_campaigns").select("id,workspace_id").eq("status","RUNNING").eq("sequence_enabled",false).order("started_at").limit(25);if(campaignError)return {...result,success:false,code:"DATABASE_UNAVAILABLE"};
  result.campaignsConsidered=campaigns?.length??0;
  let consecutiveEmpty=0;
  for(let index=0;index<ceiling;index+=1){
    const campaign=campaigns?.[index%(campaigns?.length||1)]; if(!campaign) break; const token=randomUUID();
    const {data,error}=await db.rpc("claim_email_campaign_recipients",{p_workspace_id:campaign.workspace_id,p_campaign_id:campaign.id,p_claim_token:token,p_limit:1});if(error)return {...result,success:false,code:"DATABASE_UNAVAILABLE"};
    const raw=data?.[0]??null;if(!raw){consecutiveEmpty+=1;if(consecutiveEmpty>=result.campaignsConsidered)break;continue;}consecutiveEmpty=0;
    if(!isClaim(raw,campaign.id,campaign.workspace_id,token))return {...result,success:false,code:"MALFORMED_CLAIM"};const claim=raw;
    result.recipientsProcessed+=1;
    const custom=Object.fromEntries(Object.entries(claim.personalization_json).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
    const values=buildCampaignPersonalization({email:claim.email,displayName:claim.display_name,company:claim.company,position:claim.recipient_position,custom});
    const subject=renderCampaignTemplate(claim.subject_template,values).rendered; let body=renderCampaignTemplate(claim.body_text_template,values).rendered;
    body=`${body}\n\nUnsubscribe: ${createUnsubscribeUrl(claim.workspace_id,claim.email)}`;
    const invalid=validateRenderedCampaignMessage(subject,body);
    if(invalid){if(!await finalize(db,claim,"FAILED",null,invalid))return {...result,success:false,code:"CAMPAIGN_FINALIZATION_UNAVAILABLE"};result.failed+=1;continue;}
    const send=await sendOneNewGmailMessage({emailAccountId:claim.sender_email_account_id,idempotencyKey:claim.idempotency_key,to:claim.email,subject,bodyText:body},campaign.workspace_id);
    if(send.success&&send.code==="SENT"){if(!await finalize(db,claim,"SENT",send.sendRequestId,null))return {...result,success:false,code:"CAMPAIGN_FINALIZATION_UNAVAILABLE"};result.sent+=1;}
    else if(send.code==="DELIVERY_STATUS_UNKNOWN"||send.code==="SEND_IN_PROGRESS"){if(!await finalize(db,claim,"DELIVERY_UNKNOWN",send.sendRequestId,"DELIVERY_STATUS_UNKNOWN"))return {...result,success:false,code:"CAMPAIGN_FINALIZATION_UNAVAILABLE"};result.deliveryUnknown+=1;}
    else {if(!await finalize(db,claim,"FAILED",send.sendRequestId,send.code))return {...result,success:false,code:"CAMPAIGN_FINALIZATION_UNAVAILABLE"};result.failed+=1;}
  }
  for(const campaign of campaigns??[]){
    const {data,error}=await db.rpc("complete_email_campaign_if_idle",{p_workspace_id:campaign.workspace_id,p_campaign_id:campaign.id});if(error||typeof data!=="boolean")return {...result,success:false,code:"DATABASE_UNAVAILABLE"};
  }
  return result;
}

async function finalize(db:ReturnType<typeof createPrivilegedSupabaseClient>,claim:Claim,status:"SENT"|"FAILED"|"DELIVERY_UNKNOWN",sendRequestId:string|null,code:string|null){
  const {data,error}=await db.rpc("finalize_email_campaign_recipient",{p_workspace_id:claim.workspace_id,p_recipient_id:claim.recipient_id,p_claim_token:claim.claim_token,p_status:status,p_send_request_id:sendRequestId,p_safe_error_code:code});return !error&&data===true;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isClaim(value:unknown,campaignId:string,workspaceId:string,token:string):value is Claim{if(!value||typeof value!=="object"||Array.isArray(value))return false;const row=value as Record<string,unknown>;const nullable=(v:unknown)=>v===null||typeof v==="string";return UUID.test(String(row.recipient_id))&&row.workspace_id===workspaceId&&row.campaign_id===campaignId&&normalizeCampaignEmail(row.email)===row.email&&nullable(row.display_name)&&nullable(row.company)&&nullable(row.recipient_position)&&row.personalization_json!==null&&typeof row.personalization_json==="object"&&!Array.isArray(row.personalization_json)&&UUID.test(String(row.sender_email_account_id))&&UUID.test(String(row.idempotency_key))&&row.claim_token===token&&typeof row.subject_template==="string"&&typeof row.body_text_template==="string";}
