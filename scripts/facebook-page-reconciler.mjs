import { createDecipheriv, createHmac } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root=resolve("runtime/facebook-page-reconciler"),statePath=resolve(root,"state.json"),statusPath=resolve(root,"status.json");
for(const rawLine of readFileSync(resolve(".env.local"),"utf8").replace(/^\uFEFF/u,"").split(/\r?\n/u)){const match=rawLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);if(!match||process.env[match[1]])continue;let value=match[2].trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);process.env[match[1]]=value}
const sleep=(ms)=>new Promise(done=>setTimeout(done,ms));
const env=(name)=>{const value=process.env[name]?.trim();if(!value)throw new Error(`${name}_MISSING`);return value};
function decrypt(value){const [version,iv,tag,ciphertext,extra]=value.split(":");if(version!=="v1"||extra)throw new Error("INVALID_CREDENTIAL");const decipher=createDecipheriv("aes-256-gcm",Buffer.from(env("CHANNEL_TOKEN_ENCRYPTION_KEY"),"base64"),Buffer.from(iv,"base64"));decipher.setAuthTag(Buffer.from(tag,"base64"));return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64")),decipher.final()]).toString("utf8")}
async function loadState(){try{return JSON.parse(await readFile(statePath,"utf8"))}catch{return{seen:[]}}}
async function saveJson(path,value){await mkdir(root,{recursive:true});await writeFile(path,JSON.stringify(value,null,2))}
async function batches(items,size,work){for(let i=0;i<items.length;i+=size)await Promise.all(items.slice(i,i+size).map(work))}

const client=createClient(env("NEXT_PUBLIC_SUPABASE_URL"),env("SUPABASE_SECRET_KEY"),{auth:{persistSession:false}}),state=await loadState(),seen=new Set(Array.isArray(state.seen)?state.seen:[]);
async function accounts(){const{data,error}=await client.from("channel_account_credentials").select("access_token_encrypted,webhook_secret_encrypted,configuration,channel_accounts!inner(id,external_account_id,display_name,status)").eq("channel_accounts.channel_type","FACEBOOK").eq("channel_accounts.status","CONNECTED");if(error)throw error;return(data??[]).map(row=>({...row,account:Array.isArray(row.channel_accounts)?row.channel_accounts[0]:row.channel_accounts})).filter(row=>row.account)}
async function reconcile(row){
  const token=decrypt(row.access_token_encrypted),secret=decrypt(row.webhook_secret_encrypted),version=row.configuration?.graphApiVersion,pageId=row.account.external_account_id;
  const url=new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(pageId)}/conversations`);
  url.searchParams.set("platform","messenger");url.searchParams.set("limit","25");url.searchParams.set("fields","id,updated_time,messages.limit(25){id,created_time,from,to,message,attachments}");
  url.searchParams.set("access_token",token);
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok){
    // Keep Meta's error code/subcode (e.g. 190 = expired token) so the operator can act; never log the URL (it carries the token).
    const detail=await response.json().catch(()=>null),code=detail?.error?.code,subcode=detail?.error?.error_subcode;
    throw new Error(`GRAPH_${response.status}${code?`:${code}`:""}${subcode?`/${subcode}`:""}`);
  }
  const body=await response.json(),cutoff=Date.now()-48*60*60*1000,events=[];
  for(const conversation of body.data??[])for(const message of conversation.messages?.data??[]){
    if(!message.id||seen.has(message.id)||Date.parse(message.created_time)<cutoff)continue;
    const senderId=message.from?.id,recipientId=message.to?.data?.[0]?.id;if(!senderId||!recipientId)continue;
    const attachments=(message.attachments?.data??[]).flatMap(item=>{const url=item.image_data?.url??item.video_data?.url??item.file_url??item.url;return url?[{type:item.mime_type??item.type??"file",payload:{url}}]:[]});
    if(!message.message&&attachments.length===0)continue;
    events.push({sender:{id:senderId,name:message.from?.name},recipient:{id:recipientId,name:message.to?.data?.[0]?.name},timestamp:Date.parse(message.created_time),message:{mid:message.id,is_echo:senderId===pageId,text:message.message||undefined,attachments}});
  }
  if(events.length===0)return 0;events.sort((a,b)=>a.timestamp-b.timestamp);
  const payload=JSON.stringify({object:"page",entry:[{id:pageId,time:Date.now(),messaging:events}]}),signature=`sha256=${createHmac("sha256",secret).update(payload).digest("hex")}`;
  const ingest=await fetch("http://127.0.0.1:3000/api/webhooks/facebook",{method:"POST",headers:{"content-type":"application/json","x-hub-signature-256":signature},body:payload,signal:AbortSignal.timeout(30000)});
  if(!ingest.ok)throw new Error(`INGEST_${ingest.status}`);for(const event of events)seen.add(event.message.mid);return events.length;
}

// Per-page backoff: a page that keeps failing (expired token, revoked permission, network outage)
// is retried after 30s, 1m, 2m ... up to 1h instead of every cycle. It is logged only when its
// error changes, on failures 1/2/4/8/..., and once when it recovers. State survives restarts.
const BASE_DELAY_MS=30_000,MAX_BACKOFF_MS=60*60*1000;
const failures=state.failures&&typeof state.failures==="object"?state.failures:{};
const isPowerOfTwo=(count)=>(count&(count-1))===0;
function recordFailure(row,message){
  const id=row.account.id,previous=failures[id],count=(previous?.count??0)+1;
  const delay=Math.min(BASE_DELAY_MS*2**Math.min(count-1,20),MAX_BACKOFF_MS);
  failures[id]={name:row.account.display_name,count,lastError:message,nextAttemptAt:Date.now()+delay,since:previous?.since??new Date().toISOString()};
  if(previous?.lastError!==message||isPowerOfTwo(count))console.error(`${row.account.display_name}: ${message} (failure #${count}, next attempt in ${Math.round(delay/1000)}s)`);
}
function recordSuccess(row){
  const previous=failures[row.account.id];if(!previous)return;
  delete failures[row.account.id];console.error(`${row.account.display_name}: recovered after ${previous.count} failures`);
}

for(;;){
  const startedAt=new Date().toISOString();let accepted=0,failed=0,total=0,skipped=0;
  try{
    const rows=await accounts();total=rows.length;
    const live=new Set(rows.map(row=>row.account.id));for(const id of Object.keys(failures))if(!live.has(id))delete failures[id];
    const due=rows.filter(row=>{const entry=failures[row.account.id];if(entry&&entry.nextAttemptAt>Date.now()){skipped+=1;return false}return true});
    await batches(due,4,async row=>{try{accepted+=await reconcile(row);recordSuccess(row)}catch(error){failed+=1;recordFailure(row,error instanceof Error?error.message:"UNKNOWN")}});
    const retained=[...seen].slice(-20000);state.seen=retained;state.failures=failures;await saveJson(statePath,state);
    await saveJson(statusPath,{checkedAt:new Date().toISOString(),startedAt,accounts:total,accepted,failed,skipped,seen:retained.length,failingPages:Object.entries(failures).map(([id,entry])=>({id,...entry}))});
  }
  catch(error){console.error(error);await saveJson(statusPath,{checkedAt:new Date().toISOString(),startedAt,accounts:total,accepted,failed,error:error instanceof Error?error.message:"UNKNOWN"})}
  await sleep(BASE_DELAY_MS);
}
