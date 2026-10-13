import {createDecipheriv} from "node:crypto";
import {readFileSync} from "node:fs";
import {createClient} from "@supabase/supabase-js";

const environment=Object.fromEntries(readFileSync(new URL("../.env.local",import.meta.url),"utf8").replace(/^\uFEFF/u,"").split(/\r?\n/u).filter(line=>/^[A-Za-z_][A-Za-z0-9_]*=/u.test(line)).map(line=>{const at=line.indexOf("=");return[line.slice(0,at),line.slice(at+1).replace(/^[']|[']$/gu,"").replace(/^["]|["]$/gu,"")]}));
const url=process.env.NEXT_PUBLIC_SUPABASE_URL||environment.NEXT_PUBLIC_SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY||environment.SUPABASE_SECRET_KEY;
const rawKey=process.env.CHANNEL_TOKEN_ENCRYPTION_KEY||environment.CHANNEL_TOKEN_ENCRYPTION_KEY;
if(!url||!secret||!rawKey)throw new Error("CONFIGURATION_MISSING");
const key=Buffer.from(rawKey,"base64");
if(key.length!==32)throw new Error("CREDENTIAL_KEY_INVALID");
function decrypt(value){const[version,encodedIv,encodedAuthTag,encodedCiphertext,extra]=value.split(":");if(version!=="v1"||!encodedIv||!encodedAuthTag||!encodedCiphertext||extra)throw new Error("CREDENTIAL_INVALID");const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(encodedIv,"base64"));decipher.setAuthTag(Buffer.from(encodedAuthTag,"base64"));return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext,"base64")),decipher.final()]).toString("utf8")}
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const accounts=await db.from("channel_account_credentials").select("channel_account_id,workspace_id,access_token_encrypted,configuration,channel_accounts!inner(channel_type,status,external_account_id)").eq("channel_accounts.channel_type","FACEBOOK").eq("channel_accounts.status","CONNECTED");
if(accounts.error)throw new Error("ACCOUNT_QUERY_FAILED");
let updated=0,failed=0;
for(const account of accounts.data??[]){
  if(typeof account.channel_account_id!=="string"||typeof account.workspace_id!=="string"||typeof account.access_token_encrypted!=="string"||!account.configuration||typeof account.configuration!=="object"||Array.isArray(account.configuration))continue;
  const version=account.configuration.graphApiVersion;
  if(typeof version!=="string"||!/^v[0-9]{1,3}\.[0-9]{1,3}$/u.test(version))continue;
  const channelAccount=Array.isArray(account.channel_accounts)?account.channel_accounts[0]:account.channel_accounts;
  const pageId=channelAccount?.external_account_id;if(typeof pageId!=="string")continue;
  const conversations=await db.from("omnichannel_conversations").select("id,provider_conversation_id,metadata").eq("workspace_id",account.workspace_id).eq("channel_account_id",account.channel_account_id).eq("channel_type","FACEBOOK").limit(500);
  if(conversations.error)throw new Error("CONVERSATION_QUERY_FAILED");
  const token=decrypt(account.access_token_encrypted);
  const names=new Map();
  try{
    const endpoint=new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(pageId)}/conversations`);
    endpoint.searchParams.set("platform","messenger");endpoint.searchParams.set("limit","100");endpoint.searchParams.set("fields","participants");endpoint.searchParams.set("access_token",token);
    const response=await fetch(endpoint,{redirect:"error",signal:AbortSignal.timeout(20_000)}),payload=await response.json();
    if(response.ok)for(const thread of payload.data??[])for(const participant of thread.participants?.data??[])if(participant.id!==pageId&&typeof participant.name==="string"&&participant.name.trim())names.set(participant.id,participant.name.trim());
  }catch{}
  for(const conversation of conversations.data??[]){
    const metadata=conversation.metadata&&typeof conversation.metadata==="object"&&!Array.isArray(conversation.metadata)?conversation.metadata:{};
    if(typeof metadata.participantDisplayName==="string"&&metadata.participantDisplayName.trim())continue;
    try{
      const name=names.get(conversation.provider_conversation_id);
      if(typeof name!=="string"||!name||name.length>255){failed+=1;continue}
      const result=await db.from("omnichannel_conversations").update({metadata:{...metadata,participantExternalId:conversation.provider_conversation_id,participantDisplayName:name}}).eq("id",conversation.id).eq("workspace_id",account.workspace_id);
      if(result.error){failed+=1;continue}updated+=1;
    }catch{failed+=1}
  }
}
console.log(JSON.stringify({updated,failed}));
