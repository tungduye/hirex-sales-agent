import "server-only";
import { randomUUID } from "node:crypto";
import { buildCampaignPersonalization,normalizeCampaignEmail,renderCampaignTemplate,validateRenderedCampaignMessage } from "@/modules/campaigns/domain/campaign-rules";
import { isSafeThreadMetadata } from "@/modules/campaigns/domain/sequence-rules";
import { createCampaignAttachmentLoader } from "@/modules/campaigns/server/campaign-attachment-loader";
import { createUnsubscribeUrl } from "@/modules/campaigns/server/unsubscribe-token";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import { sendOneNewGmailMessage } from "@/modules/integrations/gmail/server/send-one-new-message";

interface Claim{delivery_id:string;recipient_id:string;step_order:number;email:string;display_name:string|null;company:string|null;recipient_position:string|null;personalization_json:Record<string,unknown>;sender_email_account_id:string;idempotency_key:string;subject_template:string;body_text_template:string;previous_provider_thread_id:string|null;previous_rfc_message_id:string|null}
const ATTACHMENT_FAILURES=new Set(["ATTACHMENT_FETCH_FAILED","ATTACHMENT_INTEGRITY_FAILED","ATTACHMENT_MISSING","ATTACHMENT_SIZE_LIMIT","ATTACHMENT_INVALID"]);

export async function processEmailCampaignSequenceBatch(limit=10,campaignId?:string){
  const loadCampaignDeliveryAttachments=createCampaignAttachmentLoader();
  const db=createPrivilegedSupabaseClient();
  const result={campaignsConsidered:0,deliveriesProcessed:0,sent:0,failed:0,deliveryUnknown:0,suppressed:0,repliedStopped:0,bouncedStopped:0,unsubscribedStopped:0};
  let query=db.from("email_campaigns").select("id,workspace_id").eq("status","RUNNING").eq("sequence_enabled",true);
  if(campaignId)query=query.eq("id",campaignId);
  const {data:campaigns,error}=await query.order("started_at").limit(campaignId?1:25);
  if(error)return {...result,success:false,code:"DATABASE_UNAVAILABLE" as const};
  result.campaignsConsidered=campaigns?.length??0;let remaining=Math.min(Math.max(limit,1),25);
  for(const campaign of campaigns??[]){
    if(remaining<=0)break;
    await db.rpc("initialize_email_campaign_sequence",{p_workspace_id:campaign.workspace_id,p_campaign_id:campaign.id});
    const token=randomUUID();
    const {data,error:claimError}=await db.rpc("claim_email_campaign_sequence_steps",{p_workspace_id:campaign.workspace_id,p_campaign_id:campaign.id,p_claim_token:token,p_limit:remaining});
    if(claimError)return {...result,success:false,code:"DATABASE_UNAVAILABLE" as const};
    for(const raw of data??[]){
      if(!isClaim(raw))return {...result,success:false,code:"MALFORMED_CLAIM" as const};
      const claim=raw;remaining-=1;result.deliveriesProcessed+=1;
      const custom=Object.fromEntries(Object.entries(claim.personalization_json).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
      const values=buildCampaignPersonalization({email:claim.email,displayName:claim.display_name,company:claim.company,position:claim.recipient_position,custom});
      const subject=renderCampaignTemplate(claim.subject_template,values).rendered;
      const body=`${renderCampaignTemplate(claim.body_text_template,values).rendered}\n\nUnsubscribe: ${createUnsubscribeUrl(campaign.workspace_id,claim.email)}`;
      const invalid=validateRenderedCampaignMessage(subject,body);
      if(invalid){if(!await finalize(db,campaign.workspace_id,claim,token,"FAILED",null,invalid))return {...result,success:false,code:"CAMPAIGN_FINALIZATION_UNAVAILABLE" as const};result.failed+=1;continue;}
      let thread:{providerThreadId:string;parentRfcMessageId:string}|undefined;
      if(claim.step_order>0){if(!isSafeThreadMetadata(claim.previous_provider_thread_id)||!isRfcMessageId(claim.previous_rfc_message_id)){if(!await finalize(db,campaign.workspace_id,claim,token,"FAILED",null,"THREAD_METADATA_UNAVAILABLE"))return {...result,success:false,code:"CAMPAIGN_FINALIZATION_UNAVAILABLE" as const};result.failed+=1;continue;}thread={providerThreadId:claim.previous_provider_thread_id,parentRfcMessageId:claim.previous_rfc_message_id};}
      const loaded=await loadCampaignDeliveryAttachments(campaign.workspace_id,campaign.id,claim.delivery_id);
      if(!loaded.ok){const code=ATTACHMENT_FAILURES.has(loaded.code)?loaded.code:"ATTACHMENT_FETCH_FAILED";if(!await finalize(db,campaign.workspace_id,claim,token,"FAILED",null,code))return {...result,success:false,code:"CAMPAIGN_FINALIZATION_UNAVAILABLE" as const};result.failed+=1;continue;}
      const send=await sendOneNewGmailMessage({emailAccountId:claim.sender_email_account_id,idempotencyKey:claim.idempotency_key,to:claim.email,subject,bodyText:body},campaign.workspace_id,thread,loaded.attachments);
      if(send.success&&send.code==="SENT"){if(!await finalize(db,campaign.workspace_id,claim,token,"SENT",send.sendRequestId,null))return {...result,success:false,code:"CAMPAIGN_FINALIZATION_UNAVAILABLE" as const};result.sent+=1;}
      else if(send.code==="DELIVERY_STATUS_UNKNOWN"||send.code==="SEND_IN_PROGRESS"){if(!await finalize(db,campaign.workspace_id,claim,token,"DELIVERY_UNKNOWN",send.sendRequestId,"DELIVERY_STATUS_UNKNOWN"))return {...result,success:false,code:"CAMPAIGN_FINALIZATION_UNAVAILABLE" as const};result.deliveryUnknown+=1;}
      else{if(!await finalize(db,campaign.workspace_id,claim,token,"FAILED",send.sendRequestId,send.code))return {...result,success:false,code:"CAMPAIGN_FINALIZATION_UNAVAILABLE" as const};result.failed+=1;}
    }
  }
  return {...result,success:true,code:"OK" as const};
}
async function finalize(db:ReturnType<typeof createPrivilegedSupabaseClient>,workspaceId:string,claim:Claim,token:string,status:string,request:string|null,code:string|null){const {data,error}=await db.rpc("finalize_email_campaign_sequence_step",{p_workspace_id:workspaceId,p_delivery_id:claim.delivery_id,p_claim_token:token,p_status:status,p_send_request_id:request,p_safe_error_code:code});return !error&&data===true;}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;const nullable=(v:unknown)=>v===null||typeof v==="string";
function isClaim(value:unknown):value is Claim{if(!value||typeof value!=="object"||Array.isArray(value))return false;const r=value as Record<string,unknown>;return UUID.test(String(r.delivery_id))&&UUID.test(String(r.recipient_id))&&Number.isInteger(r.step_order)&&Number(r.step_order)>=0&&Number(r.step_order)<=5&&normalizeCampaignEmail(r.email)===r.email&&nullable(r.display_name)&&nullable(r.company)&&nullable(r.recipient_position)&&!!r.personalization_json&&typeof r.personalization_json==="object"&&!Array.isArray(r.personalization_json)&&UUID.test(String(r.sender_email_account_id))&&UUID.test(String(r.idempotency_key))&&typeof r.subject_template==="string"&&typeof r.body_text_template==="string"&&nullable(r.previous_provider_thread_id)&&nullable(r.previous_rfc_message_id);}
function isRfcMessageId(value:unknown):value is string{return typeof value==="string"&&!/[\u0000-\u001f\u007f-\u009f]/.test(value)&&/^<[^<>\s@]+@[^<>\s@]+>$/.test(value);}
