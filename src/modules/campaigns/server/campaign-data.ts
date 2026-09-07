import "server-only";

import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

export interface CampaignSummary {
  id: string; name: string; status: string; scheduledAt: string | null; startedAt: string | null;
  updatedAt:string;recipients: number; sent: number;followUps:number;replies:number;hardBounces:number; pending: number; failed: number; suppressed: number; deliveryUnknown: number; senders: number;
}

export async function listCampaigns(): Promise<{ campaigns: CampaignSummary[]; error: string | null }> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return { campaigns: [], error: "Campaigns could not be loaded." };
  const db = createPrivilegedSupabaseClient();
  const { data, error } = await db.from("email_campaigns")
    .select("id,name,status,scheduled_at,started_at,updated_at,email_campaign_recipients(status,engagement_status),email_campaign_recipient_steps(status,step_order),email_campaign_senders(id)")
    .eq("workspace_id", account.workspaceId).order("created_at", { ascending: false });
  if (error) return { campaigns: [], error: "Campaigns could not be loaded." };
  return { campaigns: (data ?? []).map((raw) => {
    const row = raw as unknown as { id:string;name:string;status:string;scheduled_at:string|null;started_at:string|null;updated_at:string;email_campaign_recipients:{status:string;engagement_status:string}[];email_campaign_recipient_steps:{status:string;step_order:number}[];email_campaign_senders:{id:string}[] };
    const count = (status: string) => row.email_campaign_recipients.filter((item) => item.status === status).length;
    const sequenceSent=row.email_campaign_recipient_steps.filter(item=>item.status==="SENT");return { id:row.id,name:row.name,status:row.status,scheduledAt:row.scheduled_at,startedAt:row.started_at,updatedAt:row.updated_at,recipients:row.email_campaign_recipients.length,sent:sequenceSent.length||count("SENT"),followUps:sequenceSent.filter(item=>item.step_order>0).length,replies:row.email_campaign_recipients.filter(item=>item.engagement_status==="REPLIED").length,hardBounces:row.email_campaign_recipients.filter(item=>item.engagement_status==="HARD_BOUNCED").length,pending:count("PENDING"),failed:count("FAILED"),suppressed:count("SUPPRESSED"),deliveryUnknown:count("DELIVERY_UNKNOWN"),senders:row.email_campaign_senders.length };
  }), error: null };
}

export async function getCampaign(id: string) {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return null;
  const db = createPrivilegedSupabaseClient();
  const { data } = await db.from("email_campaigns")
    .select("id,name,status,sequence_enabled,subject_template,body_text_template,scheduled_at,started_at,paused_at,completed_at,cancelled_at,email_campaign_recipients(id,email,display_name,company,position,personalization_json,status,engagement_status,last_sent_step_order,last_engagement_at,sender_email_account_id,sent_at,failed_at,safe_error_code),email_campaign_senders(id,email_account_id,daily_cap,per_minute_cap,enabled),email_campaign_steps(id,step_order,step_type,delay_minutes,subject_template,body_text_template,enabled),email_campaign_events(id,event_type,recipient_id,created_at)")
    .eq("id",id).eq("workspace_id",account.workspaceId).maybeSingle();
  return data;
}

export async function getCampaignDetail(id:string){const account=await getAccountContext();if(!account?.workspaceId||!account.configurationComplete)return null;const {data}=await createPrivilegedSupabaseClient().from("email_campaigns").select("id,name,status,sequence_enabled,subject_template,body_text_template,scheduled_at,started_at,paused_at,completed_at,cancelled_at,email_campaign_senders(id,email_account_id,daily_cap,per_minute_cap,enabled),email_campaign_steps(id,step_order,step_type,delay_minutes,subject_template,body_text_template,enabled),email_campaign_events(id,event_type,recipient_id,created_at)").eq("id",id).eq("workspace_id",account.workspaceId).order("created_at",{referencedTable:"email_campaign_events",ascending:false}).limit(100,{referencedTable:"email_campaign_events"}).maybeSingle();return data}

export async function getCampaignAudience(id:string,input:{q?:string;status?:string;page?:number;pageSize?:number}){const account=await getAccountContext();if(!account?.workspaceId||!account.configurationComplete)return {rows:[],total:0,page:1,pageSize:25,totalPages:1};const page=Math.max(1,Math.trunc(input.page??1)),pageSize=[25,50,100].includes(input.pageSize??25)?input.pageSize??25:25,from=(page-1)*pageSize;const db=createPrivilegedSupabaseClient();let query=db.from("email_campaign_recipients").select("id,email,display_name,company,position,status,engagement_status,last_sent_step_order,last_engagement_at,sender_email_account_id,email_campaign_recipient_steps(status)",{count:"exact"}).eq("workspace_id",account.workspaceId).eq("campaign_id",id);const status=input.status?.toUpperCase();if(status&&status!=="ALL")query=["ACTIVE","REPLIED","HARD_BOUNCED","UNSUBSCRIBED","COMPLETED"].includes(status)?query.eq("engagement_status",status):query.eq("status",status);const q=(input.q??"").trim().replace(/[,%()]/g," ").slice(0,100);if(q)query=query.or(`email.ilike.%${q}%,display_name.ilike.%${q}%,company.ilike.%${q}%,position.ilike.%${q}%`);const {data,count}=await query.order("created_at",{ascending:false}).range(from,from+pageSize-1);const total=count??0;return {rows:(data??[]).map(r=>({...r,messagesSent:(r.email_campaign_recipient_steps as unknown as {status:string}[]).filter(s=>s.status==="SENT").length})),total,page,pageSize,totalPages:Math.max(1,Math.ceil(total/pageSize))}}
