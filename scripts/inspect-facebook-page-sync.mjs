import { createDecipheriv } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env = (name) => { const value=process.env[name]?.trim(); if(!value)throw new Error(`${name}_MISSING`); return value; };
function decrypt(value){const [version,iv,tag,ciphertext]=value.split(":");if(version!=="v1")throw new Error("INVALID_CREDENTIAL");const decipher=createDecipheriv("aes-256-gcm",Buffer.from(env("CHANNEL_TOKEN_ENCRYPTION_KEY"),"base64"),Buffer.from(iv,"base64"));decipher.setAuthTag(Buffer.from(tag,"base64"));return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64")),decipher.final()]).toString("utf8")}

const client=createClient(env("NEXT_PUBLIC_SUPABASE_URL"),env("SUPABASE_SECRET_KEY"),{auth:{persistSession:false}});
const target=process.argv.slice(2).join(" ").trim();
const {data,error}=await client.from("channel_account_credentials").select("access_token_encrypted,configuration,channel_accounts!inner(id,external_account_id,display_name,status)").eq("channel_accounts.channel_type","FACEBOOK").eq("channel_accounts.status","CONNECTED").ilike("channel_accounts.display_name",`%${target}%`).limit(1).maybeSingle();
if(error||!data)throw error??new Error("ACCOUNT_NOT_FOUND");
const account=Array.isArray(data.channel_accounts)?data.channel_accounts[0]:data.channel_accounts,token=decrypt(data.access_token_encrypted),version=data.configuration.graphApiVersion;
async function graph(path){const url=new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${path}`);url.searchParams.set("access_token",token);const response=await fetch(url,{signal:AbortSignal.timeout(15000)}),body=await response.json().catch(()=>null);return{status:response.status,body}}
const subscriptions=await graph(`${encodeURIComponent(account.external_account_id)}/subscribed_apps?fields=id,name,subscribed_fields`);
const conversations=await graph(`${encodeURIComponent(account.external_account_id)}/conversations?platform=messenger&fields=id,updated_time,participants,messages.limit(5){id,created_time,from,to,message,attachments}`);
const safeConversations=Array.isArray(conversations.body?.data)?conversations.body.data.slice(0,3).map(item=>({id:item.id,updated_time:item.updated_time,participants:item.participants?.data?.map(p=>({id:p.id,name:p.name})),messages:item.messages?.data?.map(m=>({id:m.id,created_time:m.created_time,from:m.from,to:m.to?.data,message:m.message,attachmentCount:m.attachments?.data?.length??0}))})):conversations.body;
console.log(JSON.stringify({account:{id:account.external_account_id,name:account.display_name},subscriptions,conversations:{status:conversations.status,data:safeConversations}},null,2));
