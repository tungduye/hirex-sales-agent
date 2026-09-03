import "server-only";

import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

export interface CampaignSummary {
  id: string; name: string; status: string; scheduledAt: string | null; startedAt: string | null;
  recipients: number; sent: number; pending: number; failed: number; suppressed: number; deliveryUnknown: number; senders: number;
}

export async function listCampaigns(): Promise<{ campaigns: CampaignSummary[]; error: string | null }> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return { campaigns: [], error: "Campaigns could not be loaded." };
  const db = createPrivilegedSupabaseClient();
  const { data, error } = await db.from("email_campaigns")
    .select("id,name,status,scheduled_at,started_at,email_campaign_recipients(status),email_campaign_senders(id)")
    .eq("workspace_id", account.workspaceId).order("created_at", { ascending: false });
  if (error) return { campaigns: [], error: "Campaigns could not be loaded." };
  return { campaigns: (data ?? []).map((raw) => {
    const row = raw as unknown as { id:string;name:string;status:string;scheduled_at:string|null;started_at:string|null;email_campaign_recipients:{status:string}[];email_campaign_senders:{id:string}[] };
    const count = (status: string) => row.email_campaign_recipients.filter((item) => item.status === status).length;
    return { id:row.id,name:row.name,status:row.status,scheduledAt:row.scheduled_at,startedAt:row.started_at,recipients:row.email_campaign_recipients.length,sent:count("SENT"),pending:count("PENDING"),failed:count("FAILED"),suppressed:count("SUPPRESSED"),deliveryUnknown:count("DELIVERY_UNKNOWN"),senders:row.email_campaign_senders.length };
  }), error: null };
}

export async function getCampaign(id: string) {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return null;
  const db = createPrivilegedSupabaseClient();
  const { data } = await db.from("email_campaigns")
    .select("id,name,status,subject_template,body_text_template,scheduled_at,started_at,paused_at,completed_at,cancelled_at,email_campaign_recipients(id,email,display_name,company,position,personalization_json,status,sender_email_account_id,sent_at,failed_at,safe_error_code),email_campaign_senders(id,email_account_id,daily_cap,per_minute_cap,enabled)")
    .eq("id",id).eq("workspace_id",account.workspaceId).maybeSingle();
  return data;
}
