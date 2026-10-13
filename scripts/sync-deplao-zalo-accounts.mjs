import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const environment=Object.fromEntries(readFileSync(new URL("../.env.local",import.meta.url),"utf8").replace(/^\uFEFF/,"").split(/\r?\n/).filter(line=>/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map(line=>{const at=line.indexOf("=");return[line.slice(0,at),line.slice(at+1).replace(/^['\"]|['\"]$/g,"")]}));
const url=process.env.NEXT_PUBLIC_SUPABASE_URL||environment.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SECRET_KEY||environment.SUPABASE_SECRET_KEY;
if(!url||!key)throw new Error("SUPABASE_CONFIG_MISSING");
const discovered=JSON.parse(readFileSync(new URL("../runtime/deplao-zalo-accounts.json",import.meta.url),"utf8"));
if(!Array.isArray(discovered))throw new Error("DEPLAO_ACCOUNT_DISCOVERY_INVALID");
const accounts=discovered.filter(item=>item&&item.channel==="zalo"&&item.is_active===1&&/^[A-Za-z0-9_-]{1,128}$/u.test(item.zalo_id)&&typeof item.full_name==="string");
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:templates,error:templateError}=await db.from("channel_accounts").select("id,workspace_id,connected_by,capabilities,channel_account_credentials(webhook_secret_encrypted,configuration)").eq("channel_type","ZALO").eq("provider","ZALO_BRIDGE").eq("status","CONNECTED").is("deleted_at",null).limit(1);
if(templateError||!templates?.length)throw new Error("ZALO_TEMPLATE_ACCOUNT_MISSING");
const template=templates[0],credential=Array.isArray(template.channel_account_credentials)?template.channel_account_credentials[0]:template.channel_account_credentials;
if(!credential?.webhook_secret_encrypted||!credential.configuration)throw new Error("ZALO_TEMPLATE_CREDENTIAL_MISSING");
let created=0,updated=0,skipped=0;
for(const account of accounts){
  const {data:existing,error:existingError}=await db.from("channel_accounts").select("id,display_name,deleted_at,operator_enabled").eq("workspace_id",template.workspace_id).eq("channel_type","ZALO").eq("provider","ZALO_BRIDGE").eq("external_account_id",account.zalo_id).maybeSingle();
  if(existingError)throw existingError;
  if(existing?.deleted_at || existing?.operator_enabled === false){skipped++;continue;}
  const {data:id,error}=await db.rpc("upsert_channel_account_credential",{p_workspace_id:template.workspace_id,p_connected_by:template.connected_by,p_channel_type:"ZALO",p_provider:"ZALO_BRIDGE",p_external_account_id:account.zalo_id,p_display_name:account.full_name.trim().slice(0,160)||null,p_capabilities:template.capabilities,p_access_token_encrypted:null,p_webhook_secret_encrypted:credential.webhook_secret_encrypted,p_configuration:credential.configuration});
  if(error||typeof id!=="string")throw new Error("ZALO_ACCOUNT_SYNC_FAILED");
  if(existing) updated++;
  else created++;
}
console.log(JSON.stringify({discovered:accounts.length,created,updated,skipped}));
