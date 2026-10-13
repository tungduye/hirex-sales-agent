import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { ChannelAdapterRegistry } from "@/modules/channels/core/channel-adapter-registry";
import { executeChannelOutboundAction } from "@/modules/channels/server/execute-channel-outbound-action";
import { loadChannelAdapterByAccountId } from "@/modules/channels/server/load-channel-adapter";

const bodySchema=z.object({actionId:z.string().uuid()}).strict();
function equal(left:string,right:string){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b)}

export async function POST(request:Request){
  const expected=process.env.AUTOMATION_CRON_SECRET?.trim(),supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/iu,"")??"";
  if(!expected||!equal(supplied,expected))return Response.json({error:"Unauthorized"},{status:401});
  const parsed=bodySchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:"Invalid request"},{status:400});
  const db=createPrivilegedClient(),{data:action}=await db.from("channel_outbound_actions")
    .select("id,workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,text_content,attachment_ids,status,safe_error_code,provider_message_id,dispatch_source,idempotency_key,policy_decision_id,attempt_count,proposed_by,approved_by,reconciliation_status")
    .eq("id",parsed.data.actionId).maybeSingle();
  if(!action)return Response.json({result:"NOT_ELIGIBLE",reason:"ACTION_NOT_FOUND"},{status:409});
  const retryableFailure=action.status==="FAILED"&&action.safe_error_code==="ACCOUNT_BUSY"&&action.attempt_count<=2;
  const restoredLegacyAttempt=action.status==="APPROVED"&&action.safe_error_code===null&&action.attempt_count===1;
  const acknowledgedUnknown=action.status==="DELIVERY_UNKNOWN"&&action.safe_error_code==="DELIVERY_UNKNOWN"&&action.reconciliation_status==="ACKNOWLEDGED_NO_RETRY";
  if((!retryableFailure&&!restoredLegacyAttempt&&!acknowledgedUnknown)||action.provider_message_id!==null||
    action.dispatch_source!=="AI_AUTOMATION"||typeof action.idempotency_key!=="string"||!action.idempotency_key.startsWith("ai-recruiter:")||
    typeof action.conversation_id!=="string"||typeof action.channel_account_id!=="string"||typeof action.policy_decision_id!=="string")
    return Response.json({result:"NOT_ELIGIBLE",reason:"ACTION_STATE"},{status:409});
  const {data:existingSuccessfulRetry}=await db.from("channel_outbound_actions").select("id,provider_message_id")
    .eq("workspace_id",action.workspace_id).eq("status","SENT").like("idempotency_key",`${action.idempotency_key}:retry:%`).limit(1).maybeSingle();
  if(existingSuccessfulRetry)return Response.json({result:"ALREADY_SENT",actionId:existingSuccessfulRetry.id});
  const [{data:conversation},{data:policy}]=await Promise.all([
    db.from("omnichannel_conversations").select("id,status,takeover_mode,metadata").eq("id",action.conversation_id).eq("workspace_id",action.workspace_id).maybeSingle(),
    db.from("channel_policy_decisions").select("id,allowed,expires_at").eq("id",action.policy_decision_id).eq("workspace_id",action.workspace_id).maybeSingle(),
  ]);
  const metadata=conversation?.metadata&&typeof conversation.metadata==="object"&&!Array.isArray(conversation.metadata)?conversation.metadata:null;
  if(!conversation||!["OPEN","PENDING"].includes(conversation.status)||conversation.takeover_mode!=="BOT_ALLOWED"||
    !metadata||String(metadata.aiRecruiterModeOverride??"").toUpperCase()!=="AUTO"||!policy?.allowed||
    typeof policy.expires_at!=="string")return Response.json({
      result:"NOT_ELIGIBLE",reason:"CONVERSATION_OR_POLICY",
      checks:{conversationFound:Boolean(conversation),conversationStatus:conversation?.status,takeoverMode:conversation?.takeover_mode,
        autoOverride:metadata?String(metadata.aiRecruiterModeOverride??"").toUpperCase():null,policyAllowed:policy?.allowed,
        policyExpiresAt:policy?.expires_at??null},
    },{status:409});
  let policyDecisionId=action.policy_decision_id;
  if(Date.parse(policy.expires_at)<=Date.now()){
    if(action.channel_type!=="ZALO"||typeof action.recipient_external_id!=="string")return Response.json({result:"NOT_ELIGIBLE",reason:"POLICY_REAUTH_SCOPE"},{status:409});
    const normalizedRecipient=action.recipient_external_id.trim().toLowerCase();
    const {count,error:suppressionError}=await db.from("channel_suppressions").select("id",{count:"exact",head:true})
      .eq("workspace_id",action.workspace_id).eq("channel_type","ZALO").eq("normalized_recipient",normalizedRecipient);
    if(suppressionError)return Response.json({result:"UNAVAILABLE"},{status:503});
    if((count??0)>0)return Response.json({result:"NOT_ELIGIBLE",reason:"SUPPRESSED"},{status:409});
    const {data:freshPolicy,error:freshPolicyError}=await db.from("channel_policy_decisions").insert({
      workspace_id:action.workspace_id,conversation_id:action.conversation_id,channel_account_id:action.channel_account_id,
      channel_type:"ZALO",normalized_recipient:normalizedRecipient,allowed:true,
      reason_codes:["AI_AUTOMATION_OPERATOR_REAUTHORIZED"],expires_at:new Date(Date.now()+10*60_000).toISOString(),
    }).select("id").single();
    if(freshPolicyError||typeof freshPolicy?.id!=="string")return Response.json({result:"UNAVAILABLE"},{status:503});
    policyDecisionId=freshPolicy.id;
  }
  if(restoredLegacyAttempt)await db.from("channel_outbound_actions").update({status:"FAILED",safe_error_code:"ACCOUNT_BUSY"}).eq("id",action.id).eq("status","APPROVED");
  const retryIdempotencyKey=`${action.idempotency_key}:retry:${randomUUID()}`;
  const {data:retryAction,error:retryError}=await db.from("channel_outbound_actions").insert({
    workspace_id:action.workspace_id,conversation_id:action.conversation_id,channel_account_id:action.channel_account_id,
    channel_type:action.channel_type,recipient_external_id:action.recipient_external_id,text_content:action.text_content,
    attachment_ids:action.attachment_ids,status:"APPROVED",idempotency_key:retryIdempotencyKey,policy_decision_id:policyDecisionId,
    proposed_by:action.proposed_by,approved_by:action.approved_by,approved_at:new Date().toISOString(),dispatch_source:"AI_AUTOMATION",
  }).select("id").single();
  if(retryError||typeof retryAction?.id!=="string")return Response.json({result:"UNAVAILABLE"},{status:503});
  try{
    const loaded=await loadChannelAdapterByAccountId(action.channel_account_id),registry=new ChannelAdapterRegistry();registry.register(loaded.adapter);
    const result=await executeChannelOutboundAction(retryAction.id,registry);
    return Response.json({
      result:result.status,actionId:retryAction.id,
      safeErrorCode:result.status==="FAILED"?result.safeErrorCode:null,
    });
  }catch{return Response.json({result:"UNAVAILABLE"},{status:503})}
}
