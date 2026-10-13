import {createClient} from "@supabase/supabase-js";
import {createCipheriv,randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

for(const line of (await readFile(resolve(".env.local"),"utf8")).split(/\r?\n/u)){
  const match=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/u);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].trim().replace(/^['"]|['"]$/gu,"");
}
const slot=process.env.HIREX_FB_PROFILE_SLOT?.trim()||"default";if(!/^[a-z0-9-]{1,64}$/u.test(slot))throw new Error("INVALID_FACEBOOK_PROFILE_SLOT");
const suffix=slot==="default"?"":`-${slot}`;
const configuration=JSON.parse(await readFile(resolve(`runtime/facebook-profile-bridge${suffix}/config.json`),"utf8"));
const key=Buffer.from(process.env.CHANNEL_TOKEN_ENCRYPTION_KEY??"","base64");if(key.length!==32)throw new Error("CHANNEL_KEY_INVALID");
const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv),ciphertext=Buffer.concat([cipher.update(configuration.secret,"utf8"),cipher.final()]);
const encrypted=["v1",iv.toString("base64"),cipher.getAuthTag().toString("base64"),ciphertext.toString("base64")].join(":");
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const{data:profiles,error:profileError}=await client.from("profiles").select("id,workspace_id,full_name").limit(50);const profile=profiles?.find(item=>item.full_name==="HireX Admin")??profiles?.[0];if(profileError||!profile)throw new Error(`ADMIN_PROFILE_UNAVAILABLE:${profileError?.code??"EMPTY"}`);
const displayName=process.env.HIREX_FB_PROFILE_DISPLAY_NAME?.trim()||`${profile.full_name} Facebook`;
const{data,error}=await client.rpc("upsert_channel_account_credential",{p_workspace_id:profile.workspace_id,p_connected_by:profile.id,p_channel_type:"FACEBOOK_PROFILE",p_provider:"FACEBOOK_PROFILE_BRIDGE",p_external_account_id:configuration.accountId,p_display_name:displayName,p_capabilities:["SEND_TEXT","REPLY"],p_access_token_encrypted:null,p_webhook_secret_encrypted:encrypted,p_configuration:{bridgeBaseUrl:`http://127.0.0.1:${configuration.port}`}});
if(error||typeof data!=="string")throw error??new Error("CONNECT_FAILED");console.log(JSON.stringify({connected:true,channelAccountId:data,accountIdPresent:true}));
