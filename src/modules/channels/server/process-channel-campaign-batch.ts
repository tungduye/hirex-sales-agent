import "server-only";
import { randomUUID } from "node:crypto";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { ChannelAdapterRegistry } from "../core/channel-adapter-registry";
import { executeChannelOutboundAction } from "./execute-channel-outbound-action";
import { loadChannelAdapterByAccountId } from "./load-channel-adapter";
import { projectChannelCampaign } from "./project-channel-campaign";
import { PROVIDER_HEALTH_STATUSES, type ProviderHealthStatus } from "../core/provider-health";
import { ChannelError } from "../core/channel-errors";

interface ClaimRow { recipient_step_id: unknown; channel_account_id: unknown; channel_type: unknown; recipient_external_id: unknown; claim_lock_id: unknown }
interface PacingRow { reserved: unknown; next_dispatch_at: unknown; reason: unknown; sent_today: unknown; batch_progress: unknown }
function uuid(value:unknown):value is string{return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)}

async function refreshCampaignSenderHealth(input:{workspaceId:string;campaignId:string}){
  const db=createPrivilegedClient();
  const {data:senders,error}=await db.from("channel_campaign_senders").select("channel_account_id,channel_accounts!inner(channel_type)")
    .eq("workspace_id",input.workspaceId).eq("campaign_id",input.campaignId).eq("enabled",true);
  if(error||!senders)throw new Error("CHANNEL_CAMPAIGN_SENDER_HEALTH_UNAVAILABLE");
  for(const sender of senders){
    const account=sender.channel_accounts as unknown as {channel_type:string}|Array<{channel_type:string}>;
    const channelType=Array.isArray(account)?account[0]?.channel_type:account?.channel_type;
    if(!["ZALO","FACEBOOK_PROFILE"].includes(channelType))continue;
    const loaded=await loadChannelAdapterByAccountId(sender.channel_account_id);
    const started=Date.now();
    const raw=await loaded.adapter.healthCheck();
    const status:ProviderHealthStatus=PROVIDER_HEALTH_STATUSES.includes(raw as ProviderHealthStatus)?raw as ProviderHealthStatus:"UNKNOWN";
    const recorded=await db.rpc("record_channel_account_provider_health",{p_workspace_id:input.workspaceId,p_channel_account_id:sender.channel_account_id,p_status:status,p_checked_at:new Date().toISOString(),p_safe_reason_code:status==="HEALTHY"?null:status,p_latency_ms:Math.min(Date.now()-started,60000)});
    if(recorded.error||recorded.data!==true)throw new Error("CHANNEL_CAMPAIGN_SENDER_HEALTH_UNAVAILABLE");
  }
}

async function resolvePendingZaloPhones(input:{workspaceId:string;campaignId:string;maximum:number}){
  const db=createPrivilegedClient();
  const now=new Date();
  const [{data:recipients,error:recipientError},{data:senders,error:senderError}]=await Promise.all([
    db.from("channel_campaign_recipients").select("id,contact_id,status").eq("workspace_id",input.workspaceId).eq("campaign_id",input.campaignId).eq("status","ACTIVE").lte("next_step_at",now.toISOString()).limit(input.maximum),
    db.from("channel_campaign_senders").select("channel_account_id,priority").eq("workspace_id",input.workspaceId).eq("campaign_id",input.campaignId).eq("enabled",true).order("priority").limit(25),
  ]);
  if(recipientError||senderError||!recipients||!senders?.length)throw new Error("ZALO_PHONE_RESOLUTION_UNAVAILABLE");
  const contactIds=recipients.map(row=>row.contact_id);
  if(!contactIds.length)return{resolved:0,notFound:0,failed:0,deferred:0,throttled:0};
  const {data:channels,error:channelError}=await db.from("contact_channels").select("id,contact_id,channel_type,channel_value,marketing_consent_status,marketing_consent_source,marketing_consent_recorded_at").eq("workspace_id",input.workspaceId).in("contact_id",contactIds).in("channel_type",["PHONE","ZALO"]);
  if(channelError||!channels)throw new Error("ZALO_PHONE_RESOLUTION_UNAVAILABLE");
  const zaloContacts=new Set(channels.filter(row=>row.channel_type==="ZALO").map(row=>row.contact_id));
  const phoneByContact=new Map<string,{phone:string;source:string;recordedAt:string}>();
  for(const row of channels){
    if(row.channel_type!=="PHONE"||row.marketing_consent_status!=="OPTED_IN"||typeof row.marketing_consent_source!=="string"||typeof row.marketing_consent_recorded_at!=="string")continue;
    phoneByContact.set(row.contact_id,{phone:row.channel_value,source:row.marketing_consent_source,recordedAt:row.marketing_consent_recorded_at});
  }
  const pending=recipients.filter(row=>!zaloContacts.has(row.contact_id)&&phoneByContact.has(row.contact_id));
  let resolved=0,notFound=0,failed=0,deferred=0,throttled=0;
  const blockedSenders=new Set<string>();
  for(let index=0;index<pending.length;index+=1){
    // A pause may arrive while an earlier lookup is still in flight. Do not
    // start another provider lookup once the campaign is no longer running.
    const {data:currentCampaign,error:campaignError}=await db.from("channel_campaigns")
      .select("status").eq("id",input.campaignId).eq("workspace_id",input.workspaceId).maybeSingle();
    if(campaignError)throw new Error("ZALO_CAMPAIGN_STATUS_UNAVAILABLE");
    if(currentCampaign?.status!=="RUNNING")break;
    const recipient=pending[index],phoneEvidence=phoneByContact.get(recipient.contact_id);
    if(!phoneEvidence)continue;
    const senderId=senders[index%senders.length].channel_account_id;
    if(blockedSenders.has(senderId)){throttled+=1;continue;}
    try{
      const {data:cached,error:cacheReadError}=await db.from("zalo_phone_lookup_cache")
        .select("result,zalo_user_id,display_name,avatar_url,is_friend")
        .eq("workspace_id",input.workspaceId).eq("channel_account_id",senderId)
        .eq("phone",phoneEvidence.phone).gt("expires_at",new Date().toISOString()).maybeSingle();
      if(cacheReadError)throw new Error("ZALO_LOOKUP_CACHE_UNAVAILABLE");
      if(cached?.result==="FOUND"&&(typeof cached.zalo_user_id!=="string"||typeof cached.display_name!=="string"||typeof cached.is_friend!=="boolean"))
        throw new Error("ZALO_LOOKUP_CACHE_INVALID");
      let identity=cached?.result==="FOUND"&&typeof cached.zalo_user_id==="string"&&typeof cached.display_name==="string"&&typeof cached.is_friend==="boolean"
        ? {userId:cached.zalo_user_id,displayName:cached.display_name,avatarUrl:cached.avatar_url as string|null,isFriend:cached.is_friend}
        : null;
      if(!cached){
        const {data:slotRows,error:slotError}=await db.rpc("reserve_zalo_phone_lookup",{p_workspace_id:input.workspaceId,p_channel_account_id:senderId});
        if(slotError||!Array.isArray(slotRows)||slotRows.length!==1)throw new Error("ZALO_LOOKUP_PACING_UNAVAILABLE");
        if(slotRows[0].granted!==true){blockedSenders.add(senderId);throttled+=1;continue;}
        const loaded=await loadChannelAdapterByAccountId(senderId);
        if(!("findUserByPhone" in loaded.adapter)||typeof loaded.adapter.findUserByPhone!=="function")throw new ChannelError("DELIVERY_REJECTED",false);
        try{
          identity=await loaded.adapter.findUserByPhone(`+84${phoneEvidence.phone.slice(1)}`,randomUUID());
        }catch(error){
          if(error instanceof ChannelError&&["ACCOUNT_BUSY","RATE_LIMITED","ACCOUNT_UNAVAILABLE"].includes(error.code)){
            blockedSenders.add(senderId);
            const cooldown=await db.rpc("record_zalo_phone_lookup_outcome",{p_workspace_id:input.workspaceId,p_channel_account_id:senderId,p_error_code:error.code});
            if(cooldown.error)console.error("ZALO_LOOKUP_BACKOFF_UNAVAILABLE",{code:cooldown.error.code});
          }
          throw error;
        }
        const cacheWrite=await db.from("zalo_phone_lookup_cache").upsert({
          workspace_id:input.workspaceId,channel_account_id:senderId,phone:phoneEvidence.phone,
          result:identity?"FOUND":"NOT_FOUND",zalo_user_id:identity?.userId??null,
          display_name:identity?.displayName??null,avatar_url:identity?.avatarUrl??null,
          is_friend:identity?.isFriend??null,checked_at:new Date().toISOString(),
          expires_at:new Date(Date.now()+(identity?30:1)*24*60*60*1000).toISOString(),
        },{onConflict:"workspace_id,channel_account_id,phone"});
        if(cacheWrite.error)console.error("ZALO_LOOKUP_CACHE_WRITE_UNAVAILABLE",{code:cacheWrite.error.code});
        const recorded=await db.rpc("record_zalo_phone_lookup_outcome",{p_workspace_id:input.workspaceId,p_channel_account_id:senderId,p_error_code:null});
        if(recorded.error)console.error("ZALO_LOOKUP_OUTCOME_UNAVAILABLE",{code:recorded.error.code});
      }
      if(!identity){
        const completedAt=new Date().toISOString();
        const [recipientUpdate,stepUpdate]=await Promise.all([
          db.from("channel_campaign_recipients").update({status:"FAILED",stop_reason:"ZALO_NOT_FOUND",next_step_at:null}).eq("id",recipient.id).eq("workspace_id",input.workspaceId).eq("campaign_id",input.campaignId).eq("status","ACTIVE"),
          db.from("channel_campaign_recipient_steps").update({status:"FAILED",safe_error_code:"ZALO_NOT_FOUND",completed_at:completedAt}).eq("recipient_id",recipient.id).eq("workspace_id",input.workspaceId).eq("campaign_id",input.campaignId).eq("status","PENDING"),
        ]);
        if(recipientUpdate.error||stepUpdate.error)throw new Error("ZALO_NOT_FOUND_PERSISTENCE_FAILED");
        notFound+=1;continue;
      }
      const existing=await db.from("contact_channels").select("id").eq("workspace_id",input.workspaceId).eq("contact_id",recipient.contact_id).eq("channel_type","ZALO").eq("channel_value",identity.userId).maybeSingle();
      const channelPayload={marketing_consent_status:"OPTED_IN",marketing_consent_source:phoneEvidence.source,marketing_consent_recorded_at:phoneEvidence.recordedAt,metadata:{phone:phoneEvidence.phone,displayName:identity.displayName,avatarUrl:identity.avatarUrl,resolvedByAccountId:senderId,resolvedAt:new Date().toISOString()}};
      const channelResult=existing.data
        ? await db.from("contact_channels").update(channelPayload).eq("id",existing.data.id).eq("workspace_id",input.workspaceId)
        : await db.from("contact_channels").insert({workspace_id:input.workspaceId,contact_id:recipient.contact_id,channel_type:"ZALO",channel_value:identity.userId,...channelPayload});
      if(channelResult.error)throw new Error("ZALO_IDENTITY_PERSISTENCE_FAILED");
      const conversations=await Promise.all(senders.map(sender=>db.from("omnichannel_conversations").upsert({workspace_id:input.workspaceId,channel_account_id:sender.channel_account_id,channel_type:"ZALO",provider_conversation_id:identity.userId,contact_id:recipient.contact_id,status:"OPEN",metadata:{participantExternalId:identity.userId,participantDisplayName:identity.displayName,resolvedFromPhone:phoneEvidence.phone}},{onConflict:"workspace_id,channel_account_id,provider_conversation_id"})));
      if(conversations.some(result=>result.error))throw new Error("ZALO_CONVERSATION_PERSISTENCE_FAILED");
      if(typeof identity.displayName==="string"&&identity.displayName.trim())await db.from("contacts").update({full_name:identity.displayName.trim().slice(0,255)}).eq("id",recipient.contact_id).eq("workspace_id",input.workspaceId).like("source","ZALO_CAMPAIGN_PHONE_IMPORT");
      resolved+=1;
    }catch(error){
      if(!(error instanceof ChannelError)||error.retryable){
        // Keep recipient and step pending. Deferring avoids a hot retry loop while
        // ensuring transient provider/network failures do not permanently lose it.
        const retryAt=new Date(Date.now()+15*60*1000).toISOString();
        const {error:updateError}=await db.from("channel_campaign_recipients").update({next_step_at:retryAt})
          .eq("id",recipient.id).eq("workspace_id",input.workspaceId).eq("campaign_id",input.campaignId).eq("status","ACTIVE");
        if(updateError)throw new Error("ZALO_LOOKUP_RETRY_PERSISTENCE_FAILED");
        console.warn("ZALO_PHONE_LOOKUP_DEFERRED",{code:error instanceof ChannelError?error.code:"ZALO_LOOKUP_RETRYABLE",retryable:true});
        deferred+=1;
        continue;
      }
      const completedAt=new Date().toISOString();
      await Promise.all([
        db.from("channel_campaign_recipients").update({status:"FAILED",stop_reason:"ZALO_LOOKUP_FAILED",next_step_at:null}).eq("id",recipient.id).eq("workspace_id",input.workspaceId).eq("campaign_id",input.campaignId).eq("status","ACTIVE"),
        db.from("channel_campaign_recipient_steps").update({status:"FAILED",safe_error_code:"ZALO_LOOKUP_FAILED",completed_at:completedAt}).eq("recipient_id",recipient.id).eq("workspace_id",input.workspaceId).eq("campaign_id",input.campaignId).eq("status","PENDING"),
      ]);
      console.warn("ZALO_PHONE_LOOKUP_FAILED",{code:error instanceof ChannelError?error.code:"ZALO_LOOKUP_FAILED",retryable:false});
      failed+=1;
    }
  }
  return{resolved,notFound,failed,deferred,throttled};
}

export async function processChannelCampaignBatch(input:{workspaceId:string;campaignId:string;maximumActions?:number;dryRun?:boolean},injectedAdapters?:ChannelAdapterRegistry){
  if(!uuid(input.workspaceId)||!uuid(input.campaignId))throw new Error("CHANNEL_CAMPAIGN_INPUT_INVALID");
  const campaignChannel=await campaignChannelType(input.workspaceId,input.campaignId);
  const requestedMaximum=Math.min(Math.max(input.maximumActions??10,1),25);
  // Personal-profile automation is deliberately serialized. This keeps every
  // scheduler pass conservative and avoids burst-sending through the desktop bridge.
  const maximum=campaignChannel==="FACEBOOK_PROFILE"?1:requestedMaximum;
  // Both modes evaluate the same read-only candidate snapshot first. The claim RPC
  // remains authoritative and rechecks eligibility under its transaction lock.
  if(!input.dryRun&&!injectedAdapters)await refreshCampaignSenderHealth({workspaceId:input.workspaceId,campaignId:input.campaignId});
  const projection = await projectChannelCampaign({workspaceId:input.workspaceId,campaignId:input.campaignId,maximumActions:maximum});
  if(input.dryRun)return {...projection,claimed:0,sent:0,failed:0,deliveryUnknown:0,remaining:projection.eligibleRecipientCount>projection.projectedActions};
  const client=createPrivilegedClient(); let claimed=0,sent=0,failed=0,deliveryUnknown=0; let pacing:PacingRow|null=null;
  const refundPacing=async()=>{
    if(!pacing||pacing.reserved!==true||typeof pacing.next_dispatch_at!=="string"||typeof pacing.batch_progress!=="number")
      throw new Error("CHANNEL_CAMPAIGN_PACING_REFUND_INVALID");
    const refund=await client.rpc("refund_channel_campaign_dispatch_slot",{
      p_workspace_id:input.workspaceId,p_campaign_id:input.campaignId,
      p_expected_next_at:pacing.next_dispatch_at,p_expected_batch_progress:pacing.batch_progress,
    });
    if(refund.error||refund.data!==true)throw new Error("CHANNEL_CAMPAIGN_PACING_REFUND_FAILED");
    pacing=null;
  };
  // Send an already-resolved recipient first. Looking up another phone before
  // sending would consume the same account lease and self-block every send.
  for(let index=0;index<projection.projectedActions;index+=1){
    const pacingResult=await client.rpc("reserve_channel_campaign_dispatch_slot",{p_workspace_id:input.workspaceId,p_campaign_id:input.campaignId});
    pacing=(Array.isArray(pacingResult.data)?pacingResult.data[0]:null) as PacingRow|null;
    if(pacingResult.error||!pacing)throw new Error("CHANNEL_CAMPAIGN_PACING_UNAVAILABLE");
    if(pacing.reserved!==true)break;
    const lockId=randomUUID(); const claimResult=await client.rpc("claim_channel_campaign_recipient_step",{p_workspace_id:input.workspaceId,p_campaign_id:input.campaignId,p_claim_lock_id:lockId});
    const row=(Array.isArray(claimResult.data)?claimResult.data[0]:null) as ClaimRow|undefined;
    if(claimResult.error||!row){await refundPacing();if(claimResult.error)throw new Error("CHANNEL_CAMPAIGN_CLAIM_FAILED");break}
    if(!uuid(row.recipient_step_id)||!uuid(row.channel_account_id)||row.claim_lock_id!==lockId)throw new Error("CHANNEL_CAMPAIGN_CLAIM_INVALID"); claimed+=1;
    const materialized=await client.rpc("materialize_channel_campaign_action",{p_workspace_id:input.workspaceId,p_campaign_id:input.campaignId,p_recipient_step_id:row.recipient_step_id,p_claim_lock_id:lockId});
    if(materialized.error||!uuid(materialized.data)){await refundPacing();failed+=1;break}
    if(typeof row.recipient_external_id!=="string"||!row.recipient_external_id.trim())throw new Error("CHANNEL_CAMPAIGN_RECIPIENT_INVALID");
    // A confirmed pre-provider ACCOUNT_BUSY reuses the original action and
    // idempotency key. Renew its policy evidence rather than creating a second
    // send action for the same recipient step.
    const {data:queuedAction,error:queuedError}=await client.from("channel_outbound_actions")
      .select("id,policy_decision_id,conversation_id,channel_account_id,recipient_external_id,status,attempt_count")
      .eq("id",materialized.data).eq("workspace_id",input.workspaceId).maybeSingle();
    if(queuedError||!queuedAction||queuedAction.status!=="QUEUED"||queuedAction.attempt_count!==0||
      queuedAction.channel_account_id!==row.channel_account_id||queuedAction.recipient_external_id!==row.recipient_external_id)
      throw new Error("CHANNEL_CAMPAIGN_REUSED_ACTION_INVALID");
    const {data:renewedPolicy,error:policyError}=await client.from("channel_policy_decisions")
      .update({expires_at:new Date(Date.now()+10*60*1000).toISOString()})
      .eq("id",queuedAction.policy_decision_id).eq("workspace_id",input.workspaceId).eq("allowed",true)
      .eq("channel_account_id",row.channel_account_id).eq("channel_type",row.channel_type)
      .eq("normalized_recipient",row.recipient_external_id.trim().toLowerCase())
      .select("id").maybeSingle();
    if(policyError||renewedPolicy?.id!==queuedAction.policy_decision_id)throw new Error("CHANNEL_CAMPAIGN_POLICY_RENEWAL_FAILED");
    if(row.channel_type==="FACEBOOK"||row.channel_type==="FACEBOOK_PROFILE"||row.channel_type==="ZALO"){
      if(typeof row.recipient_external_id!=="string"||!row.recipient_external_id.trim())throw new Error("CHANNEL_CAMPAIGN_CONVERSATION_UNAVAILABLE");
      let conversationQuery=client.from("omnichannel_conversations").select("id")
        .eq("workspace_id",input.workspaceId).eq("channel_account_id",row.channel_account_id)
        .in("status",["OPEN","PENDING"]);
      if(row.channel_type==="FACEBOOK")conversationQuery=conversationQuery.eq("provider_conversation_id",row.recipient_external_id).gte("last_message_at",new Date(Date.now()-23*60*60*1000).toISOString());
      else if(row.channel_type==="FACEBOOK_PROFILE")conversationQuery=conversationQuery.eq("provider_conversation_id",row.recipient_external_id);
      else conversationQuery=conversationQuery.contains("metadata",{participantExternalId:row.recipient_external_id});
      const {data:conversations,error:conversationError}=await conversationQuery.limit(2);
      if(conversationError||conversations?.length!==1||!uuid(conversations[0].id))throw new Error("CHANNEL_CAMPAIGN_CONVERSATION_UNAVAILABLE");
      if(queuedAction.conversation_id!==conversations[0].id){
        if(queuedAction.conversation_id!==null)throw new Error("CHANNEL_CAMPAIGN_CONVERSATION_MISMATCH");
        const {data:bound,error:bindError}=await client.from("channel_outbound_actions").update({conversation_id:conversations[0].id})
          .eq("id",materialized.data).eq("workspace_id",input.workspaceId).eq("channel_account_id",row.channel_account_id)
          .eq("recipient_external_id",row.recipient_external_id).eq("status","QUEUED").is("conversation_id",null).select("id").maybeSingle();
        if(bindError||bound?.id!==materialized.data)throw new Error("CHANNEL_CAMPAIGN_CONVERSATION_UNAVAILABLE");
      }
    }
    const registry=injectedAdapters??new ChannelAdapterRegistry();
    if(!injectedAdapters){const loaded=await loadChannelAdapterByAccountId(row.channel_account_id);registry.register(loaded.adapter)}
    const result=await executeChannelOutboundAction(materialized.data,registry);
    if(result.status==="DEFERRED"){await refundPacing();break;}
    const finalized=await client.rpc("finalize_channel_campaign_recipient_step",{p_workspace_id:input.workspaceId,p_campaign_id:input.campaignId,p_recipient_step_id:row.recipient_step_id,p_outbound_action_id:materialized.data});
    if(finalized.error||finalized.data!==true)throw new Error("CHANNEL_CAMPAIGN_FINALIZATION_FAILED");
    if(result.status==="SENT")sent+=1; else if(result.status==="FAILED")failed+=1; else if(result.status==="DELIVERY_UNKNOWN")deliveryUnknown+=1; else failed+=1;
    if(result.status==="DELIVERY_UNKNOWN")break;
  }
  const resolution=campaignChannel!=="ZALO"?{resolved:0,notFound:0,failed:0,deferred:0,throttled:0}
    :await resolvePendingZaloPhones({workspaceId:input.workspaceId,campaignId:input.campaignId,maximum});
  return {claimed,sent,failed:failed+resolution.failed,notFound:resolution.notFound,resolved:resolution.resolved,deferred:resolution.deferred,throttled:resolution.throttled,deliveryUnknown,remaining:claimed===maximum,pacing:pacing?{reason:typeof pacing.reason==="string"?pacing.reason:"UNKNOWN",nextDispatchAt:typeof pacing.next_dispatch_at==="string"?pacing.next_dispatch_at:null,sentToday:typeof pacing.sent_today==="number"?pacing.sent_today:null,batchProgress:typeof pacing.batch_progress==="number"?pacing.batch_progress:null}:null};
}

async function campaignChannelType(workspaceId:string,campaignId:string){
  const db=createPrivilegedClient();const{data,error}=await db.from("channel_campaign_steps").select("allowed_channels").eq("workspace_id",workspaceId).eq("campaign_id",campaignId).order("position").limit(1).maybeSingle();
  if(error)throw new Error("CHANNEL_CAMPAIGN_CHANNEL_UNAVAILABLE");const channels=Array.isArray(data?.allowed_channels)?data.allowed_channels:[];return channels.length===1?channels[0]:"MULTICHANNEL";
}

export async function processRunningChannelCampaigns(maximumCampaigns=25){
  const db=createPrivilegedClient();
  const {data,error}=await db.from("channel_campaigns").select("id,workspace_id").eq("status","RUNNING").order("started_at").limit(Math.min(Math.max(maximumCampaigns,1),25));
  if(error||!data)throw new Error("CHANNEL_CAMPAIGN_LIST_UNAVAILABLE");
  const results=[];
  // Rotate first position each minute so campaigns sharing one account do not
  // let the oldest campaign monopolize its single lookup slot.
  const offset=data.length?Math.floor(Date.now()/60_000)%data.length:0;
  const ordered=[...data.slice(offset),...data.slice(0,offset)];
  for(const campaign of ordered){
    try{
      results.push({campaignId:campaign.id,ok:true,result:await processChannelCampaignBatch({workspaceId:campaign.workspace_id,campaignId:campaign.id,maximumActions:25})});
    }catch{
      results.push({campaignId:campaign.id,ok:false,result:null});
    }
  }
  return {success:results.every(result=>result.ok),campaignsProcessed:results.length,results};
}
