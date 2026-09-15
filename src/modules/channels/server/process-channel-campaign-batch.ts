import "server-only";
import { randomUUID } from "node:crypto";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { ChannelAdapterRegistry } from "../core/channel-adapter-registry";
import { executeChannelOutboundAction } from "./execute-channel-outbound-action";
import { loadChannelAdapterByAccountId } from "./load-channel-adapter";
import { projectChannelCampaign } from "./project-channel-campaign";

interface ClaimRow { recipient_step_id: unknown; channel_account_id: unknown; channel_type: unknown; recipient_external_id: unknown; claim_lock_id: unknown }
function uuid(value:unknown):value is string{return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)}

export async function processChannelCampaignBatch(input:{workspaceId:string;campaignId:string;maximumActions?:number;dryRun?:boolean}){
  if(!uuid(input.workspaceId)||!uuid(input.campaignId))throw new Error("CHANNEL_CAMPAIGN_INPUT_INVALID"); const maximum=Math.min(Math.max(input.maximumActions??10,1),25);
  // Both modes evaluate the same read-only candidate snapshot first. The claim RPC
  // remains authoritative and rechecks eligibility under its transaction lock.
  const projection = await projectChannelCampaign({workspaceId:input.workspaceId,campaignId:input.campaignId,maximumActions:maximum});
  if(input.dryRun)return {...projection,claimed:0,sent:0,failed:0,deliveryUnknown:0,remaining:projection.eligibleRecipientCount>projection.projectedActions};
  if(projection.projectedActions===0)return {claimed:0,sent:0,failed:0,deliveryUnknown:0,remaining:false};
  const client=createPrivilegedClient(); let claimed=0,sent=0,failed=0,deliveryUnknown=0;
  for(let index=0;index<maximum;index+=1){
    const lockId=randomUUID(); const claimResult=await client.rpc("claim_channel_campaign_recipient_step",{p_workspace_id:input.workspaceId,p_campaign_id:input.campaignId,p_claim_lock_id:lockId});
    const row=(Array.isArray(claimResult.data)?claimResult.data[0]:null) as ClaimRow|undefined;
    if(claimResult.error||!row){if(claimResult.error)throw new Error("CHANNEL_CAMPAIGN_CLAIM_FAILED");break}
    if(!uuid(row.recipient_step_id)||!uuid(row.channel_account_id)||row.claim_lock_id!==lockId)throw new Error("CHANNEL_CAMPAIGN_CLAIM_INVALID"); claimed+=1;
    const materialized=await client.rpc("materialize_channel_campaign_action",{p_workspace_id:input.workspaceId,p_campaign_id:input.campaignId,p_recipient_step_id:row.recipient_step_id,p_claim_lock_id:lockId});
    if(materialized.error||!uuid(materialized.data)){failed+=1;continue}
    if(row.channel_type==="FACEBOOK"){
      if(typeof row.recipient_external_id!=="string"||!row.recipient_external_id.trim())throw new Error("CHANNEL_CAMPAIGN_CONVERSATION_UNAVAILABLE");
      const {data:conversations,error:conversationError}=await client.from("omnichannel_conversations").select("id")
        .eq("workspace_id",input.workspaceId).eq("channel_account_id",row.channel_account_id)
        .eq("provider_conversation_id",row.recipient_external_id).in("status",["OPEN","PENDING"])
        .gte("last_message_at",new Date(Date.now()-23*60*60*1000).toISOString()).limit(2);
      if(conversationError||conversations?.length!==1||!uuid(conversations[0].id))throw new Error("CHANNEL_CAMPAIGN_CONVERSATION_UNAVAILABLE");
      const {data:bound,error:bindError}=await client.from("channel_outbound_actions").update({conversation_id:conversations[0].id})
        .eq("id",materialized.data).eq("workspace_id",input.workspaceId).eq("channel_account_id",row.channel_account_id)
        .eq("recipient_external_id",row.recipient_external_id).eq("status","QUEUED").is("conversation_id",null).select("id").maybeSingle();
      if(bindError||bound?.id!==materialized.data)throw new Error("CHANNEL_CAMPAIGN_CONVERSATION_UNAVAILABLE");
    }
    const loaded=await loadChannelAdapterByAccountId(row.channel_account_id); const registry=new ChannelAdapterRegistry(); registry.register(loaded.adapter);
    const result=await executeChannelOutboundAction(materialized.data,registry);
    const finalized=await client.rpc("finalize_channel_campaign_recipient_step",{p_workspace_id:input.workspaceId,p_campaign_id:input.campaignId,p_recipient_step_id:row.recipient_step_id,p_outbound_action_id:materialized.data});
    if(finalized.error||finalized.data!==true)throw new Error("CHANNEL_CAMPAIGN_FINALIZATION_FAILED");
    if(result.status==="SENT")sent+=1; else if(result.status==="FAILED")failed+=1; else if(result.status==="DELIVERY_UNKNOWN")deliveryUnknown+=1; else failed+=1;
    if(result.status==="DELIVERY_UNKNOWN")break;
  }
  return {claimed,sent,failed,deliveryUnknown,remaining:claimed===maximum};
}
