import "server-only";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { FacebookPageAdapter } from "../adapters/facebook/facebook-adapter";
import { ZaloBridgeAdapter } from "../adapters/zalo/zalo-bridge-adapter";
import { FetchChannelTransport } from "../core/channel-transport";
import { decryptChannelCredential } from "./channel-credential-encryption";

interface CredentialRow { channel_account_id: unknown; workspace_id: unknown; access_token_encrypted: unknown; webhook_secret_encrypted: unknown; configuration: unknown; channel_accounts: unknown }
function object(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}

function build(row:CredentialRow, account:{channel_type:unknown;external_account_id:unknown}){
  if(typeof row.channel_account_id!=="string"||typeof row.workspace_id!=="string"||typeof row.webhook_secret_encrypted!=="string"||!object(row.configuration)||typeof account.external_account_id!=="string")throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE");
  const webhookSecret=decryptChannelCredential(row.webhook_secret_encrypted); const transport=new FetchChannelTransport();
  if(account.channel_type==="FACEBOOK"){
    const version=row.configuration.graphApiVersion; if(typeof row.access_token_encrypted!=="string"||typeof version!=="string"||!/^v[0-9]{1,3}\.[0-9]{1,3}$/u.test(version))throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE");
    return { channelAccountId: row.channel_account_id, adapter: new FacebookPageAdapter(row.channel_account_id,row.workspace_id,{pageId:account.external_account_id,pageAccessToken:decryptChannelCredential(row.access_token_encrypted),appSecret:webhookSecret,graphApiVersion:version},transport) };
  }
  if(account.channel_type!=="ZALO")throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE");
  const baseUrl=row.configuration.bridgeBaseUrl; if(typeof baseUrl!=="string"||new URL(baseUrl).protocol!=="https:")throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE");
  return { channelAccountId: row.channel_account_id, adapter: new ZaloBridgeAdapter(row.workspace_id,row.channel_account_id,{bridgeAccountId:account.external_account_id,bridgeBaseUrl:baseUrl,signingSecret:webhookSecret},transport) };
}

function relation(value:unknown):{channel_type:unknown;external_account_id:unknown}|null{const account=Array.isArray(value)?value[0]:value;return object(account)&&"channel_type" in account&&"external_account_id" in account?{channel_type:account.channel_type,external_account_id:account.external_account_id}:null}

export async function loadChannelAdapterByExternalId(channelType:"FACEBOOK"|"ZALO",provider:string,externalAccountId:string){
  const client=createPrivilegedClient();
  const {data,error}=await client.from("channel_account_credentials").select("channel_account_id,workspace_id,access_token_encrypted,webhook_secret_encrypted,configuration,channel_accounts!inner(channel_type,provider,external_account_id,status)").eq("channel_accounts.channel_type",channelType).eq("channel_accounts.provider",provider).eq("channel_accounts.external_account_id",externalAccountId).eq("channel_accounts.status","CONNECTED").maybeSingle();
  const row=data as CredentialRow|null; const account=relation(row?.channel_accounts);
  if(error||!row||!account)throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE"); return build(row,account);
}

export async function loadChannelAdapterByAccountId(channelAccountId:string){
  const client=createPrivilegedClient(); const {data,error}=await client.from("channel_account_credentials").select("channel_account_id,workspace_id,access_token_encrypted,webhook_secret_encrypted,configuration,channel_accounts!inner(channel_type,provider,external_account_id,status)").eq("channel_account_id",channelAccountId).eq("channel_accounts.status","CONNECTED").maybeSingle();
  const row=data as CredentialRow|null; const account=relation(row?.channel_accounts); if(error||!row||!account)throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE"); return build(row,account);
}
