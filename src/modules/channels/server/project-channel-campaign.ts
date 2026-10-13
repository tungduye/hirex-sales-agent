import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { evaluateChannelCampaignEligibility, type CampaignEligibilitySnapshot } from "../core/evaluate-channel-campaign-eligibility";

// Bounded reads fail closed instead of silently projecting only the first page.
const MAX_ROWS = 5000;
const PAGE_SIZE = 500;
const MAX_FILTER_IDS = 100;
const MAX_AGGREGATED_ROWS = 10_000;
function checked<T>(rows: T[] | null, count: number | null, error: { code?: string } | null): T[] {
  if (error || !rows || count === null || rows.length !== count || count > MAX_ROWS) throw new Error("CHANNEL_CAMPAIGN_PROJECTION_UNAVAILABLE");
  return rows;
}

async function readPaged<T>(read:(from:number,to:number)=>PromiseLike<{data:T[]|null;count:number|null;error:{code?:string}|null}>):Promise<T[]>{
  const first=await read(0,PAGE_SIZE-1);
  if(first.error||!first.data||first.count===null||first.count>MAX_ROWS||first.data.length!==Math.min(first.count,PAGE_SIZE))throw new Error("CHANNEL_CAMPAIGN_PROJECTION_UNAVAILABLE");
  const result=[...first.data];
  for(let from=PAGE_SIZE;from<first.count;from+=PAGE_SIZE){
    const page=await read(from,Math.min(from+PAGE_SIZE,first.count)-1);
    if(page.error||!page.data||page.count!==first.count||page.data.length!==Math.min(PAGE_SIZE,first.count-from))throw new Error("CHANNEL_CAMPAIGN_PROJECTION_UNAVAILABLE");
    result.push(...page.data);
  }
  if(result.length!==first.count)throw new Error("CHANNEL_CAMPAIGN_PROJECTION_UNAVAILABLE");
  return result;
}

async function readInBatches<T>(values:string[],read:(batch:string[],from:number,to:number)=>PromiseLike<{data:T[]|null;count:number|null;error:{code?:string}|null}>):Promise<T[]>{
  const result:T[]=[];
  for(let index=0;index<values.length;index+=MAX_FILTER_IDS){
    result.push(...await readPaged((from,to)=>read(values.slice(index,index+MAX_FILTER_IDS),from,to)));
    if(result.length>MAX_AGGREGATED_ROWS)throw new Error("CHANNEL_CAMPAIGN_PROJECTION_UNAVAILABLE");
  }
  return result;
}

export async function projectChannelCampaign(input: { workspaceId: string; campaignId: string; maximumActions: number }) {
  const db = createPrivilegedClient();
  const campaignResult = await db.from("channel_campaigns").select("id,status").eq("workspace_id", input.workspaceId).eq("id", input.campaignId).maybeSingle();
  if (campaignResult.error) throw new Error("CHANNEL_CAMPAIGN_PROJECTION_UNAVAILABLE");
  if (!campaignResult.data) throw new Error("CHANNEL_CAMPAIGN_NOT_FOUND");
  const [steps, senders, recipients] = await Promise.all([
    readPaged((from,to)=>db.from("channel_campaign_steps").select("id,position,allowed_channels,text_template,attachment_ids", {count:"exact"}).eq("workspace_id", input.workspaceId).eq("campaign_id", input.campaignId).range(from,to)),
    readPaged((from,to)=>db.from("channel_campaign_senders").select("channel_account_id,priority,enabled", {count:"exact"}).eq("workspace_id", input.workspaceId).eq("campaign_id", input.campaignId).range(from,to)),
    readPaged((from,to)=>db.from("channel_campaign_recipients").select("id,contact_id,status,current_step_position,next_step_at", {count:"exact"}).eq("workspace_id", input.workspaceId).eq("campaign_id", input.campaignId).range(from,to)),
  ]);
  const accountIds = [...new Set(senders.map((sender) => sender.channel_account_id))];
  const contactIds = [...new Set(recipients.map((recipient) => recipient.contact_id))];
  const channelTypes=[...new Set(steps.flatMap(step=>step.allowed_channels))];
  const facebookAccountIds=accountIds.filter(id=>senders.some(sender=>sender.channel_account_id===id&&sender.enabled)&&channelTypes.some(type=>type==="FACEBOOK"||type==="FACEBOOK_PROFILE"));
  const [accounts, recipientSteps, conversations] = await Promise.all([
    accountIds.length ? readPaged(fromTo=>db.from("channel_accounts").select("id,channel_type,status,capabilities,operator_enabled,provider_health_status,provider_health_checked_at", {count:"exact"}).eq("workspace_id", input.workspaceId).in("id", accountIds).range(fromTo,fromTo+PAGE_SIZE-1)) : Promise.resolve([]),
    readPaged((from,to)=>db.from("channel_campaign_recipient_steps").select("recipient_id,step_id,status", {count:"exact"}).eq("workspace_id", input.workspaceId).eq("campaign_id", input.campaignId).range(from,to)),
    facebookAccountIds.length ? readPaged((from,to)=>db.from("omnichannel_conversations").select("id,channel_account_id,provider_conversation_id,status,last_message_at", {count:"exact"}).eq("workspace_id", input.workspaceId).in("channel_account_id", facebookAccountIds).range(from,to)) : Promise.resolve([]),
  ]);
  const conversationIds=conversations.map(conversation=>conversation.id).filter((id):id is string=>typeof id==="string");
  const inboundRows=conversationIds.length?await readInBatches(conversationIds,(batch,from,to)=>db.from("omnichannel_messages").select("conversation_id",{count:"exact"}).eq("workspace_id",input.workspaceId).eq("channel_type","FACEBOOK_PROFILE").eq("direction","INBOUND").in("conversation_id",batch).range(from,to)):[];
  const inboundConversationIds=new Set(inboundRows.map(row=>row.conversation_id));
  const projectedConversations=conversations.map(conversation=>({...conversation,hasInbound:inboundConversationIds.has(conversation.id)}));
  const identities=contactIds.length&&channelTypes.length?await readInBatches(contactIds,(batch,from,to)=>db.from("contact_channels").select("contact_id,channel_type,channel_value,marketing_consent_status",{count:"exact"}).eq("workspace_id",input.workspaceId).in("contact_id",batch).in("channel_type",channelTypes).range(from,to)):[];
  const suppressionValues=new Map<string,Set<string>>();
  for(const identity of identities){const values=suppressionValues.get(identity.channel_type)??new Set<string>();values.add(identity.channel_value.trim().toLowerCase());suppressionValues.set(identity.channel_type,values)}
  const suppressions=await Promise.all([...suppressionValues].flatMap(([channelType,values])=>{
    const normalized=[...values];
    return Array.from({length:Math.ceil(normalized.length/MAX_FILTER_IDS)},(_,index)=>normalized.slice(index*MAX_FILTER_IDS,(index+1)*MAX_FILTER_IDS))
      .map(batch=>db.from("channel_suppressions").select("channel_type,normalized_recipient",{count:"exact"}).eq("workspace_id",input.workspaceId).eq("channel_type",channelType).in("normalized_recipient",batch).limit(MAX_ROWS));
  }));
  const suppressionRows=suppressions.flatMap(result=>checked(result.data,result.count,result.error));
  if(suppressionRows.length>MAX_AGGREGATED_ROWS)throw new Error("CHANNEL_CAMPAIGN_PROJECTION_UNAVAILABLE");
  const snapshot: CampaignEligibilitySnapshot = {
    campaign: campaignResult.data,
    steps: steps as CampaignEligibilitySnapshot["steps"],
    senders: senders as CampaignEligibilitySnapshot["senders"],
    accounts: accounts as CampaignEligibilitySnapshot["accounts"],
    recipients: recipients as CampaignEligibilitySnapshot["recipients"],
    recipientSteps: recipientSteps as CampaignEligibilitySnapshot["recipientSteps"],
    identities: identities as CampaignEligibilitySnapshot["identities"],
    conversations: projectedConversations as CampaignEligibilitySnapshot["conversations"],
    suppressions: suppressionRows as CampaignEligibilitySnapshot["suppressions"],
  };
  return evaluateChannelCampaignEligibility(snapshot, new Date(), input.maximumActions);
}
