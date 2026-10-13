import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { mapZaloHistoryRow } from "./lib/zalo-history-backfill.mjs";
import { persistHistoryMessage, resolveHistoryAccounts } from "./lib/zalo-history-remote-writer.mjs";

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
createRequire(import.meta.url)("@next/env").loadEnvConfig(projectRoot);
const authorizationPath=path.join(projectRoot,"runtime","zalo-media-sync-authorized");
if(process.env.HIREX_ALLOW_REMOTE_ZALO_MEDIA_SYNC!=="1"&&!existsSync(authorizationPath))throw new Error("REMOTE_ZALO_MEDIA_SYNC_NOT_AUTHORIZED");
const profileRoot=process.env.HIREX_DEPLAO_QA_PROFILE||"C:\\Users\\Admin\\AppData\\Local\\HireX\\ZaloRuntime\\deplao-qa-profile";
const databasePath=path.join(profileRoot,"deplao-tool.db");
const statePath=path.join(projectRoot,"runtime","zalo-live-attachment-sync-state.json");
const completed=new Set(existsSync(statePath)?JSON.parse(readFileSync(statePath,"utf8")):[]);
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SECRET_KEY;
if(typeof url!=="string"||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/u.test(url)||typeof secret!=="string"||secret.length<32)throw new Error("REMOTE_CONFIGURATION_INVALID");

const database=new DatabaseSync(databasePath,{readOnly:true});
try{
  const rows=database.prepare(`select cast(m.owner_zalo_id as text) account_id, cast(m.msg_id as text) provider_message_id,
    cast(m.thread_id as text) thread_id, m.thread_type, cast(m.sender_id as text) sender_id, m.content, m.msg_type,
    c.display_name conversation_name, c.avatar_url, cast(m.timestamp as text) timestamp_text, m.is_sent, m.attachments, m.local_paths
    from messages m left join contacts c on c.owner_zalo_id=m.owner_zalo_id and c.contact_id=m.thread_id
    where m.channel='zalo' and m.local_paths is not null and m.local_paths not in ('','{}','[]')
    order by m.timestamp desc limit 200`).all();
  const candidates=[];
  let invalid=0,missingLocalMedia=0;
  for(const row of rows){
    const key=`${row.account_id}:${row.provider_message_id}`;
    if(completed.has(key))continue;
    const mapped=mapZaloHistoryRow(row,profileRoot);
    if(!mapped.ok){invalid+=1;continue}
    if(!mapped.value.media.some(item=>item.exists)){missingLocalMedia+=1;continue}
    candidates.push({key,message:mapped.value});
  }
  if(candidates.length===0)console.log(JSON.stringify({candidates:0,synced:0,invalid,missingLocalMedia}));
  else {
  const client=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
  const mapping=await resolveHistoryAccounts(client,[...new Set(candidates.map(item=>item.message.accountId))]);
  let synced=0;
  for(const candidate of candidates){
    const result=await persistHistoryMessage(client,mapping,candidate.message);
    if(result.uploaded>0){completed.add(candidate.key);synced+=1}
  }
  writeFileSync(statePath,JSON.stringify([...completed].slice(-5000)));
  console.log(JSON.stringify({candidates:candidates.length,synced,invalid,missingLocalMedia}));
  }
}finally{database.close()}
