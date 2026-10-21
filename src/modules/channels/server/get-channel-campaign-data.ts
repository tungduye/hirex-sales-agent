import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds, hasPermission } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

type CampaignListRow = { id: string; [key: string]: unknown };

async function countCampaignListRows<T extends CampaignListRow>(
  client: Awaited<ReturnType<typeof createClient>>,
  _workspaceId: string,
  rows: T[],
) {
  // One database call for every campaign (it used to be three count requests per campaign).
  const counts = new Map<string, { quantity: number; sent: number; replies: number }>();
  if (!rows.length) return counts;
  const { data, error } = await client.rpc("channel_campaign_list_counts", { p_campaign_ids: rows.map((row) => row.id) });
  if (error) throw new Error("CHANNEL_CAMPAIGN_SUMMARY_UNAVAILABLE");
  for (const row of (data ?? []) as Array<{ campaign_id: string; quantity: number; sent: number; replies: number }>)
    counts.set(row.campaign_id, { quantity: Number(row.quantity), sent: Number(row.sent), replies: Number(row.replies) });
  return counts;
}

export async function listChannelCampaigns() {
  const account = await getAccountContext();
  if (!account?.workspaceId) return [];
  const client = await createClient();
  const { data: steps } = await client.from("channel_campaign_steps").select("campaign_id").eq("workspace_id", account.workspaceId).contains("allowed_channels", ["ZALO"]);
  const campaignIds = [...new Set((steps ?? []).map((step) => step.campaign_id))];
  if (campaignIds.length === 0) return [];
  const { data } = await client.from("channel_campaigns")
    .select("id,name,status,created_at,updated_at,started_at,created_by,campaign_type,campaign_type_color,combo_uv,placement,channel_rank,owner_name,channel_campaign_senders(channel_accounts(display_name,external_account_id))")
    .eq("workspace_id", account.workspaceId).is("archived_at",null).in("id", campaignIds).order("created_at", { ascending: false });
  const campaignRows = data ?? [];
  const [summaries, creatorIds] = await Promise.all([
    countCampaignListRows(client, account.workspaceId, campaignRows),
    Promise.resolve([...new Set(campaignRows.map((row) => row.created_by))]),
  ]);
  const { data: profiles } = creatorIds.length
    ? await client.from("profiles").select("id,full_name").eq("workspace_id", account.workspaceId).in("id", creatorIds)
    : { data: [] as Array<{ id: string; full_name: string }> };
  const ownerById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
  return campaignRows.map((raw) => {
    const summary = summaries.get(raw.id);
    const row = raw as unknown as {
      id: string; name: string; status: string; created_at: string; updated_at: string; started_at: string | null; created_by: string; campaign_type:string;campaign_type_color:string;combo_uv:string|null;placement:string|null;channel_rank:string|null;owner_name:string|null;
      channel_campaign_senders: Array<{ channel_accounts: { display_name: string | null; external_account_id: string } | null }>;
    };
    return {
      id: row.id, name: row.name, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, startedAt: row.started_at,
      campaignType: row.campaign_type, campaignTypeColor:row.campaign_type_color, quantity: summary?.quantity ?? 0,
      comboUv: row.combo_uv, placement: row.placement, channelRank: row.channel_rank,
      ownerName: row.owner_name || ownerById.get(row.created_by) || null,
      senderNames: row.channel_campaign_senders.map((sender) => sender.channel_accounts?.display_name ?? sender.channel_accounts?.external_account_id).filter((value): value is string => Boolean(value)),
      sent: summary?.sent ?? 0,
      replies: summary?.replies ?? 0,
    };
  });
}

export async function listFacebookProfileCampaigns(){
  const account=await getAccountContext();if(!account?.workspaceId)return[];const client=await createClient();const{data:steps}=await client.from("channel_campaign_steps").select("campaign_id").eq("workspace_id",account.workspaceId).contains("allowed_channels",["FACEBOOK_PROFILE"]);const campaignIds=[...new Set((steps??[]).map(step=>step.campaign_id))];if(!campaignIds.length)return[];
  const{data}=await client.from("channel_campaigns").select("id,name,status,created_at,updated_at,started_at,campaign_type,combo_uv,placement,channel_rank,owner_name,channel_campaign_senders(channel_accounts(display_name,external_account_id))").eq("workspace_id",account.workspaceId).is("archived_at",null).in("id",campaignIds).order("created_at",{ascending:false});
  const campaignRows=data??[],summaries=await countCampaignListRows(client,account.workspaceId,campaignRows);
  return campaignRows.map(raw=>{const row=raw as unknown as{id:string;name:string;status:string;created_at:string;updated_at:string;started_at:string|null;campaign_type:string;combo_uv:string|null;placement:string|null;channel_rank:string|null;owner_name:string|null;channel_campaign_senders:Array<{channel_accounts:{display_name:string|null;external_account_id:string}|null}>};const summary=summaries.get(row.id);return{id:row.id,name:row.name,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,startedAt:row.started_at,campaignType:row.campaign_type,quantity:summary?.quantity??0,comboUv:row.combo_uv,placement:row.placement,channelRank:row.channel_rank,ownerName:row.owner_name,senderNames:row.channel_campaign_senders.map(sender=>sender.channel_accounts?.display_name??sender.channel_accounts?.external_account_id).filter((value):value is string=>Boolean(value)),sent:summary?.sent??0,replies:summary?.replies??0}});
}

export async function getFacebookProfileCampaignOptions(){
  const account=await getAccountContext();if(!account?.workspaceId)return{senders:[]};const client=createPrivilegedClient();const accessible=await getAccessibleChannelAccountIds();let query=client.from("channel_accounts").select("id,channel_type,display_name,external_account_id,status,provider_health_status").eq("workspace_id",account.workspaceId).eq("channel_type","FACEBOOK_PROFILE").eq("status","CONNECTED").is("deleted_at",null);if(accessible!==null){if(accessible.length===0)return{senders:[]};query=query.in("id",accessible)}const{data}=await query.order("display_name");return{senders:data??[]};
}

export async function getChannelCampaignOptions() {
  const account = await getAccountContext();
  if (!account?.workspaceId) return { contacts: [], senders: [] };
  const client = await createClient();
  const accessibleAccountIds = await getAccessibleChannelAccountIds();
  let senderQuery = client.from("channel_accounts").select("id,channel_type,display_name,external_account_id").eq("workspace_id", account.workspaceId).eq("status", "CONNECTED").eq("channel_type", "ZALO");
  if (accessibleAccountIds) senderQuery = senderQuery.in("id", accessibleAccountIds);
  const [contacts, identities, phones, senders] = await Promise.all([
    client.from("contacts").select("id,full_name,phone").eq("workspace_id", account.workspaceId).order("full_name").limit(500),
    client.from("contact_channels").select("id,contact_id,channel_value,marketing_consent_status").eq("workspace_id", account.workspaceId).eq("channel_type", "ZALO"),
    client.from("contact_channels").select("contact_id,channel_value").eq("workspace_id", account.workspaceId).eq("channel_type", "PHONE"),
    senderQuery,
  ]);
  const identityByContact = new Map((identities.data ?? []).map((row) => [row.contact_id, row]));
  const phonesByContact = new Map<string, string[]>();
  for (const phone of phones.data ?? []) phonesByContact.set(phone.contact_id, [...(phonesByContact.get(phone.contact_id) ?? []), phone.channel_value]);
  return {
    contacts: (contacts.data ?? []).flatMap((contact) => {
      const identity = identityByContact.get(contact.id);
      const channelPhones = phonesByContact.get(contact.id) ?? [];
      const phoneNumbers = [...new Set([...channelPhones, ...(typeof contact.phone === "string" && contact.phone.trim() ? [contact.phone] : [])])];
      return identity ? [{ id: contact.id, full_name: contact.full_name, zalo_channel_id: identity.id, zalo_id: identity.channel_value, marketing_consent_status: identity.marketing_consent_status, phone_numbers: phoneNumbers }] : [];
    }),
    senders: senders.data ?? [],
  };
}

export async function getChannelCampaign(id: string) {
  const account = await getAccountContext();
  if (!account?.workspaceId) return null;
  const client = await createClient();
  const allRecipients = (async () => {
    const rows: Array<{ id: string; contact_id: string | null; status: string; stop_reason: string | null; current_step_position: number; next_step_at: string | null; contacts: Array<{ full_name: string; phone: string | null }> }> = [];
    for (let offset = 0; offset < 5000; offset += 1000) {
      const page = await client.from("channel_campaign_recipients").select("id,contact_id,status,stop_reason,current_step_position,next_step_at,contacts(full_name,phone)")
        .eq("workspace_id", account.workspaceId).eq("campaign_id", id).range(offset, offset + 999);
      if (page.error) return { data: null, error: page.error };
      rows.push(...(page.data ?? []) as typeof rows);
      if (!page.data || page.data.length < 1000) break;
    }
    const contactIds = [...new Set(rows.flatMap((row) => row.contact_id ? [row.contact_id] : []))];
    const phoneByContact = new Map<string, string>();
    if (contactIds.length && await hasPermission("contacts.view")) {
      const privileged = createPrivilegedClient();
      for (let offset = 0; offset < contactIds.length; offset += 100) {
        const batch = contactIds.slice(offset, offset + 100);
        const [contacts, phones] = await Promise.all([
          privileged.from("contacts").select("id,phone").eq("workspace_id", account.workspaceId).in("id", batch),
          privileged.from("contact_channels").select("contact_id,channel_value,is_primary")
            .eq("workspace_id", account.workspaceId).eq("channel_type", "PHONE").in("contact_id", batch),
        ]);
        for (const contact of contacts.data ?? []) {
          if (typeof contact.phone === "string" && contact.phone.trim()) phoneByContact.set(contact.id, contact.phone.trim());
        }
        for (const phone of phones.data ?? []) {
          const existing = phoneByContact.get(phone.contact_id);
          if (!existing || phone.is_primary) phoneByContact.set(phone.contact_id, phone.channel_value);
        }
      }
    }
    return { data: rows.map((row) => {
      const contact = row.contacts?.[0];
      const phone = contact?.phone?.trim() || (row.contact_id ? phoneByContact.get(row.contact_id) : null) || null;
      return { ...row, phone };
    }), error: null };
  })();
  const [campaign, steps, recipients, events, senders, ...counts] = await Promise.all([
    client.from("channel_campaigns").select("id,name,status,stop_on_reply,created_at,started_at,completed_at,daily_message_limit,min_delay_seconds,max_delay_seconds,batch_size,batch_pause_minutes,pacing_next_at,pacing_batch_sent").eq("workspace_id", account.workspaceId).eq("id", id).maybeSingle(),
    client.from("channel_campaign_steps").select("id,position,delay_minutes,text_template,content_variants,allowed_channels").eq("workspace_id", account.workspaceId).eq("campaign_id", id).order("position"),
    allRecipients,
    client.from("channel_campaign_events").select("id,event_type,created_at").eq("workspace_id", account.workspaceId).eq("campaign_id", id).order("created_at", { ascending: false }).limit(100),
    client.from("channel_campaign_senders").select("id,channel_account_id,priority,channel_accounts(display_name,channel_type)").eq("workspace_id", account.workspaceId).eq("campaign_id", id).order("priority"),
    ...(["SENT", "FAILED", "DELIVERY_UNKNOWN"] as const).map((status) => client.from("channel_campaign_recipient_steps").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("campaign_id", id).eq("status", status)),
  ]);
  if (campaign.error || !campaign.data) return null;
  const senderIds=(senders.data??[]).map(sender=>sender.channel_account_id);
  const lookupPacing=senderIds.length
    ? await createPrivilegedClient().from("zalo_lookup_account_pacing")
      .select("channel_account_id,next_allowed_at,backoff_level,last_error_code,last_lookup_at")
      .eq("workspace_id",account.workspaceId).in("channel_account_id",senderIds)
    : {data:[],error:null};
  return { campaign: campaign.data, steps: steps.data ?? [], recipients: recipients.data ?? [], events: events.data ?? [], senders: senders.data ?? [], lookupPacing:lookupPacing.data??[], deliveryCounts: counts.map((result) => result.error ? null : result.count) };
}
