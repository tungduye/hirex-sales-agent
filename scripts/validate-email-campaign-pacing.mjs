import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SECRET_KEY;
if(!url||!key)throw new Error("Missing Supabase environment");
const db=createClient(url,key,{auth:{persistSession:false}});
const {data:profile,error:profileError}=await db.from("profiles").select("id,workspace_id").limit(1).single();
if(profileError)throw profileError;
const id=crypto.randomUUID();
const now=new Date().toISOString();
const checks=[];
try{
  const {error:insertError}=await db.from("email_campaigns").insert({id,workspace_id:profile.workspace_id,created_by:profile.id,name:"PACING VALIDATION - DELETE",status:"RUNNING",subject_template:"test",body_text_template:"test",started_at:now,daily_message_limit:10,min_delay_seconds:7,max_delay_seconds:7,batch_size:2,batch_pause_minutes:3});
  if(insertError)throw insertError;
  const reserve=async()=>{const {data,error}=await db.rpc("reserve_email_campaign_dispatch_slot",{p_workspace_id:profile.workspace_id,p_campaign_id:id});if(error)throw error;return data[0];};
  const first=await reserve();
  checks.push(["first slot reserved",first.reserved===true]);
  const firstDelay=(new Date(first.next_dispatch_at)-Date.now())/1000;
  checks.push(["fixed random delay applied",firstDelay>5&&firstDelay<=8]);
  const waiting=await reserve();
  checks.push(["concurrent/early worker blocked",waiting.reserved===false&&waiting.reason==="WAITING"]);
  await db.from("email_campaigns").update({pacing_next_at:null}).eq("id",id);
  const second=await reserve();
  const batchDelay=(new Date(second.next_dispatch_at)-Date.now())/60000;
  checks.push(["batch pause applied",second.reserved===true&&second.batch_progress===0&&batchDelay>2.9&&batchDelay<=3.1]);
  const failed=checks.filter(([,ok])=>!ok);
  for(const [name,ok] of checks)console.log(`${ok?"PASS":"FAIL"} ${name}`);
  if(failed.length)process.exitCode=1;
}finally{
  await db.from("email_campaigns").delete().eq("id",id);
}
