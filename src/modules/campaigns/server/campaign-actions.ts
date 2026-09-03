"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { validateRenderedCampaignMessage } from "@/modules/campaigns/domain/campaign-rules";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import { normalizeCampaignEmail, parseCampaignCsv } from "@/modules/campaigns/domain/campaign-rules";

const schema = z.object({ name:z.string().trim().min(1).max(200), subject:z.string().max(998), body:z.string().max(100000) });

export async function createCampaign(formData: FormData): Promise<void> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) redirect("/login");
  const parsed = schema.safeParse({ name:formData.get("name"),subject:formData.get("subject"),body:formData.get("body") });
  if (!parsed.success || validateRenderedCampaignMessage(parsed.data.subject, parsed.data.body)) redirect("/campaigns/new?error=invalid");
  const db = createPrivilegedSupabaseClient();
  const { data, error } = await db.from("email_campaigns").insert({ workspace_id:account.workspaceId,created_by:account.userId,name:parsed.data.name,subject_template:parsed.data.subject,body_text_template:parsed.data.body,status:"DRAFT" }).select("id").single();
  if (error || !data) redirect("/campaigns/new?error=save");
  await db.from("email_campaign_events").insert({workspace_id:account.workspaceId,campaign_id:data.id,event_type:"CAMPAIGN_CREATED"});
  revalidatePath("/campaigns"); redirect(`/campaigns/${data.id}`);
}

export async function updateCampaign(formData:FormData):Promise<void>{
  const context=await requireContext(); const id=z.string().uuid().parse(formData.get("campaignId")); const parsed=schema.safeParse({name:formData.get("name"),subject:formData.get("subject"),body:formData.get("body")});
  if(!parsed.success||validateRenderedCampaignMessage(parsed.data.subject,parsed.data.body)) return;
  await createPrivilegedSupabaseClient().from("email_campaigns").update({name:parsed.data.name,subject_template:parsed.data.subject,body_text_template:parsed.data.body}).eq("id",id).eq("workspace_id",context.workspaceId).eq("status","DRAFT"); revalidatePath(`/campaigns/${id}`);
}

export async function setCampaignSenders(formData:FormData):Promise<void>{
  const context=await requireContext();const campaignId=z.string().uuid().parse(formData.get("campaignId"));const accountId=z.string().uuid().parse(formData.get("emailAccountId"));
  const daily=z.coerce.number().int().min(1).max(2000).parse(formData.get("dailyCap"));const minute=z.coerce.number().int().min(1).max(100).parse(formData.get("perMinuteCap"));const db=createPrivilegedSupabaseClient();
  if(!await isDraftCampaign(db,campaignId,context.workspaceId))return;
  const {data:account}=await db.from("email_accounts").select("id,scopes").eq("id",accountId).eq("workspace_id",context.workspaceId).eq("provider","GMAIL").eq("status","CONNECTED").maybeSingle();
  if(!account||(account.scopes as string[]).includes("https://www.googleapis.com/auth/gmail.send")===false)return;
  await db.from("email_campaign_senders").upsert({workspace_id:context.workspaceId,campaign_id:campaignId,email_account_id:accountId,daily_cap:daily,per_minute_cap:minute,enabled:true},{onConflict:"campaign_id,email_account_id"});revalidatePath(`/campaigns/${campaignId}`);
}

export async function transitionCampaign(formData:FormData):Promise<void>{
  const context=await requireContext();const id=z.string().uuid().parse(formData.get("campaignId"));const target=z.enum(["SCHEDULED","RUNNING","PAUSED","CANCELLED"]).parse(formData.get("target"));const db=createPrivilegedSupabaseClient();
  const {data:campaign}=await db.from("email_campaigns").select("id,status,subject_template,body_text_template").eq("id",id).eq("workspace_id",context.workspaceId).maybeSingle();if(!campaign)return;
  const allowed:Record<string,string[]>={DRAFT:["SCHEDULED","RUNNING"],SCHEDULED:["RUNNING","CANCELLED"],RUNNING:["PAUSED","CANCELLED"],PAUSED:["RUNNING","CANCELLED"]};if(!allowed[campaign.status]?.includes(target))return;
  if(target==="RUNNING"||target==="SCHEDULED"){
    if(validateRenderedCampaignMessage(campaign.subject_template,campaign.body_text_template))return;
    const [{count:recipients},{data:senders}]=await Promise.all([db.from("email_campaign_recipients").select("id",{count:"exact",head:true}).eq("campaign_id",id).eq("workspace_id",context.workspaceId),db.from("email_campaign_senders").select("id,email_accounts!inner(status,provider,scopes)").eq("campaign_id",id).eq("workspace_id",context.workspaceId).eq("enabled",true)]);if(!recipients||!senders?.some((sender)=>{const a=sender.email_accounts as unknown as {status:string;provider:string;scopes:string[]};return a.status==="CONNECTED"&&a.provider==="GMAIL"&&a.scopes.includes("https://www.googleapis.com/auth/gmail.send");}))return;
  }
  const now=new Date().toISOString();const scheduledRaw=String(formData.get("scheduledAt")??"");const patch:Record<string,unknown>={status:target};let event="";
  if(target==="SCHEDULED"){const date=new Date(scheduledRaw);if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now())return;patch.scheduled_at=date.toISOString();event="CAMPAIGN_SCHEDULED";}
  if(target==="RUNNING"){patch.started_at=now;patch.paused_at=null;event=campaign.status==="PAUSED"?"CAMPAIGN_RESUMED":"CAMPAIGN_STARTED";}
  if(target==="PAUSED"){patch.paused_at=now;event="CAMPAIGN_PAUSED";}if(target==="CANCELLED"){patch.cancelled_at=now;event="CAMPAIGN_CANCELLED";}
  const {data:changed}=await db.from("email_campaigns").update(patch).eq("id",id).eq("workspace_id",context.workspaceId).eq("status",campaign.status).select("id").maybeSingle();if(changed){if(target==="CANCELLED")await db.from("email_campaign_recipients").update({status:"CANCELLED"}).eq("campaign_id",id).eq("workspace_id",context.workspaceId).eq("status","PENDING");await db.from("email_campaign_events").insert({workspace_id:context.workspaceId,campaign_id:id,event_type:event});}revalidatePath(`/campaigns/${id}`);revalidatePath("/campaigns");
}

export async function importCampaignAudience(formData:FormData):Promise<void>{
  const context=await requireContext();const campaignId=z.string().uuid().parse(formData.get("campaignId"));const file=formData.get("file");if(!(file instanceof File)||file.size>5_000_000)return;
  const draftDb=createPrivilegedSupabaseClient();if(!await isDraftCampaign(draftDb,campaignId,context.workspaceId))return;
  let rows:unknown[][];if(file.name.toLowerCase().endsWith(".xlsx")){const {readSheet}=await import("read-excel-file/node");rows=await readSheet(Buffer.from(await file.arrayBuffer()),1);}else rows=parseCampaignCsv(await file.text());
  if(rows.length<2||rows.length>5001||rows[0].length>100)return;const headers=rows[0].map((v)=>String(v??"").trim().toLowerCase());const emailIndex=headers.indexOf("email");if(emailIndex<0)return;const db=createPrivilegedSupabaseClient();let added=0;
  for(const row of rows.slice(1)){const email=normalizeCampaignEmail(row[emailIndex]);if(!email)continue;const value=(...keys:string[])=>{const index=keys.map(k=>headers.indexOf(k)).find(i=>i>=0);return index===undefined?null:String(row[index]??"").trim()||null;};const known=new Set(["email","name","first_name","last_name","company","position","job_title"]);const custom=Object.fromEntries(headers.map((h,i)=>[h,String(row[i]??"")]).filter(([h])=>h&&!known.has(h)));
    const {error}=await db.from("email_campaign_recipients").insert({workspace_id:context.workspaceId,campaign_id:campaignId,email,normalized_email:email,display_name:value("name"),company:value("company"),position:value("position","job_title"),personalization_json:{first_name:value("first_name")??"",last_name:value("last_name")??"",...custom}});if(!error)added+=1;
  }if(added)await db.from("email_campaign_events").insert({workspace_id:context.workspaceId,campaign_id:campaignId,event_type:"AUDIENCE_IMPORTED",metadata:{added}});revalidatePath(`/campaigns/${campaignId}`);
}

export async function addCampaignContacts(formData:FormData):Promise<void>{const context=await requireContext();const campaignId=z.string().uuid().parse(formData.get("campaignId"));const ids=formData.getAll("contactId").map(String).filter((id)=>z.string().uuid().safeParse(id).success).slice(0,5000);if(!ids.length)return;const db=createPrivilegedSupabaseClient();if(!await isDraftCampaign(db,campaignId,context.workspaceId))return;const {data:contacts}=await db.from("contacts").select("id,full_name,email,job_title,company_id,companies(name)").eq("workspace_id",context.workspaceId).in("id",ids).not("email","is",null);let added=0;for(const contact of contacts??[]){const email=normalizeCampaignEmail(contact.email);if(!email)continue;const company=contact.companies as unknown as {name:string}|null;const {error}=await db.from("email_campaign_recipients").insert({workspace_id:context.workspaceId,campaign_id:campaignId,contact_id:contact.id,email,normalized_email:email,display_name:contact.full_name,company:company?.name??null,position:contact.job_title,personalization_json:{}});if(!error)added+=1;}if(added)await db.from("email_campaign_events").insert({workspace_id:context.workspaceId,campaign_id:campaignId,event_type:"AUDIENCE_IMPORTED",metadata:{source:"CRM",added}});revalidatePath(`/campaigns/${campaignId}`);}

export async function setEmailSuppression(formData:FormData):Promise<void>{const context=await requireContext();const email=normalizeCampaignEmail(formData.get("email"));if(!email)return;const db=createPrivilegedSupabaseClient();const {data:existing}=await db.from("email_suppressions").select("reason").eq("workspace_id",context.workspaceId).eq("normalized_email",email).maybeSingle();if(!existing)await db.from("email_suppressions").insert({workspace_id:context.workspaceId,normalized_email:email,reason:"MANUAL",source:"SETTINGS"});else if(existing.reason==="MANUAL")await db.from("email_suppressions").update({source:"SETTINGS"}).eq("workspace_id",context.workspaceId).eq("normalized_email",email).eq("reason","MANUAL");revalidatePath("/settings");}
export async function removeEmailSuppression(formData:FormData):Promise<void>{const context=await requireContext();const email=normalizeCampaignEmail(formData.get("email"));if(!email)return;await createPrivilegedSupabaseClient().from("email_suppressions").delete().eq("workspace_id",context.workspaceId).eq("normalized_email",email).eq("reason","MANUAL");revalidatePath("/settings");}

async function requireContext(){const context=await getAccountContext();if(!context?.workspaceId||!context.configurationComplete)redirect("/login");return {...context,workspaceId:context.workspaceId};}
async function isDraftCampaign(db:ReturnType<typeof createPrivilegedSupabaseClient>,campaignId:string,workspaceId:string){const {data,error}=await db.from("email_campaigns").select("id").eq("id",campaignId).eq("workspace_id",workspaceId).eq("status","DRAFT").maybeSingle();return !error&&Boolean(data);}
