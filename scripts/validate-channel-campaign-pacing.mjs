import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SECRET_KEY;
if(!url||!secret)throw new Error("PACING_VALIDATOR_ENV_MISSING");
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
let campaignId=null,contactId=null,assertions=0;
const check=(value,code)=>{assertions+=1;if(!value)throw new Error(code)};

try{
  const {data:profile,error:profileError}=await db.from("profiles").select("id,workspace_id").limit(1).single();
  check(!profileError&&profile,"PROFILE_UNAVAILABLE");
  const campaign=await db.from("channel_campaigns").insert({workspace_id:profile.workspace_id,name:`__PACING_VALIDATOR_${randomUUID()}__`,status:"RUNNING",started_at:new Date().toISOString(),created_by:profile.id,daily_message_limit:100,min_delay_seconds:5,max_delay_seconds:5,batch_size:2,batch_pause_minutes:10}).select("id").single();
  check(!campaign.error&&campaign.data?.id,"CAMPAIGN_CREATE_FAILED");campaignId=campaign.data.id;
  const first=await db.rpc("reserve_channel_campaign_dispatch_slot",{p_workspace_id:profile.workspace_id,p_campaign_id:campaignId});
  const firstRow=first.data?.[0];check(!first.error&&firstRow?.reserved===true&&firstRow.batch_progress===1,"FIRST_SLOT_NOT_RESERVED");
  const firstDelay=Date.parse(firstRow.next_dispatch_at)-Date.now();check(firstDelay>=3000&&firstDelay<=8000,"RANDOM_DELAY_OUT_OF_RANGE");
  const waiting=await db.rpc("reserve_channel_campaign_dispatch_slot",{p_workspace_id:profile.workspace_id,p_campaign_id:campaignId});
  check(!waiting.error&&waiting.data?.[0]?.reserved===false&&waiting.data[0].reason==="WAITING","WAITING_NOT_ENFORCED");
  await db.from("channel_campaigns").update({pacing_next_at:new Date(Date.now()-1000).toISOString()}).eq("id",campaignId);
  const batch=await db.rpc("reserve_channel_campaign_dispatch_slot",{p_workspace_id:profile.workspace_id,p_campaign_id:campaignId});
  const batchRow=batch.data?.[0];check(!batch.error&&batchRow?.reserved===true&&batchRow.batch_progress===0,"BATCH_RESET_FAILED");
  const batchDelay=Date.parse(batchRow.next_dispatch_at)-Date.now();check(batchDelay>=598000&&batchDelay<=602000,"BATCH_PAUSE_OUT_OF_RANGE");

  const contact=await db.from("contacts").insert({workspace_id:profile.workspace_id,full_name:"__PACING_VALIDATOR__",source:"SYSTEM_TEST"}).select("id").single();
  check(!contact.error&&contact.data?.id,"CONTACT_CREATE_FAILED");contactId=contact.data.id;
  const step=await db.from("channel_campaign_steps").insert({workspace_id:profile.workspace_id,campaign_id:campaignId,position:1,delay_minutes:0,text_template:"test",allowed_channels:["ZALO"]}).select("id").single();
  check(!step.error&&step.data?.id,"STEP_CREATE_FAILED");
  const recipient=await db.from("channel_campaign_recipients").insert({workspace_id:profile.workspace_id,campaign_id:campaignId,contact_id:contactId,status:"COMPLETED",stop_reason:"SEQUENCE_COMPLETED"}).select("id").single();
  check(!recipient.error&&recipient.data?.id,"RECIPIENT_CREATE_FAILED");
  const sent=await db.from("channel_campaign_recipient_steps").insert({workspace_id:profile.workspace_id,campaign_id:campaignId,recipient_id:recipient.data.id,step_id:step.data.id,status:"SENT",idempotency_key:`pacing-test:${randomUUID()}`,completed_at:new Date().toISOString()});
  check(!sent.error,"SENT_FIXTURE_CREATE_FAILED");
  await db.from("channel_campaigns").update({daily_message_limit:1,pacing_next_at:new Date(Date.now()-1000).toISOString()}).eq("id",campaignId);
  const capped=await db.rpc("reserve_channel_campaign_dispatch_slot",{p_workspace_id:profile.workspace_id,p_campaign_id:campaignId});
  check(!capped.error&&capped.data?.[0]?.reserved===false&&capped.data[0].reason==="DAILY_LIMIT"&&capped.data[0].sent_today===1,"DAILY_LIMIT_NOT_ENFORCED");
  console.log(`CHANNEL_CAMPAIGN_PACING=PASS assertions=${assertions} random_delay_seconds=5 batch_pause_minutes=10 daily_limit=1`);
}finally{
  if(campaignId)await db.from("channel_campaigns").delete().eq("id",campaignId);
  if(contactId)await db.from("contacts").delete().eq("id",contactId).eq("source","SYSTEM_TEST");
}
