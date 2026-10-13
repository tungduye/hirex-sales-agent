import "server-only";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { FacebookPageAdapter } from "../adapters/facebook/facebook-adapter";
import { ZaloBridgeAdapter } from "../adapters/zalo/zalo-bridge-adapter";
import { FacebookProfileBridgeAdapter } from "../adapters/facebook-profile/facebook-profile-bridge-adapter";
import { requireTrustedFacebookProfileBridgeOrigin } from "../adapters/facebook-profile/trusted-bridge-origin";
import { requireTrustedZaloBridgeOrigin } from "../adapters/zalo/trusted-bridge-origin";
import { FetchChannelTransport } from "../core/channel-transport";
import { decryptChannelCredential } from "./channel-credential-encryption";

interface CredentialRow { channel_account_id: unknown; workspace_id: unknown; access_token_encrypted: unknown; webhook_secret_encrypted: unknown; configuration: unknown; channel_accounts: unknown }
interface AccountRow { id: unknown; channel_type: unknown; external_account_id: unknown }
function object(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}

export type ChannelAccountLoadCode = "CHANNEL_ACCOUNT_QUERY_FAILED" | "CHANNEL_ACCOUNT_NOT_FOUND" | "CHANNEL_ACCOUNT_ROW_INVALID" | "CHANNEL_CREDENTIAL_DECRYPT_FAILED" | "CHANNEL_CONFIGURATION_INVALID";
export class ChannelAccountLoadError extends Error {
  readonly safeCode: ChannelAccountLoadCode;
  constructor(safeCode: ChannelAccountLoadCode) { super(safeCode); this.safeCode=safeCode; this.name="ChannelAccountLoadError"; }
}

function build(row:CredentialRow, account:{channel_type:unknown;external_account_id:unknown}){
  if(typeof row.channel_account_id!=="string"||typeof row.workspace_id!=="string"||typeof row.webhook_secret_encrypted!=="string"||!object(row.configuration)||typeof account.external_account_id!=="string")throw new ChannelAccountLoadError("CHANNEL_ACCOUNT_ROW_INVALID");
  let trustedZaloOrigin: string | null = null;
  let trustedFacebookProfileOrigin: string | null = null;
  if(account.channel_type==="ZALO") {
    try { trustedZaloOrigin=requireTrustedZaloBridgeOrigin(row.configuration.bridgeBaseUrl); }
    catch { throw new ChannelAccountLoadError("CHANNEL_CONFIGURATION_INVALID"); }
  }
  if(account.channel_type==="FACEBOOK_PROFILE") {
    try { trustedFacebookProfileOrigin=requireTrustedFacebookProfileBridgeOrigin(row.configuration.bridgeBaseUrl); }
    catch { throw new ChannelAccountLoadError("CHANNEL_CONFIGURATION_INVALID"); }
  }
  let webhookSecret:string; try{webhookSecret=decryptChannelCredential(row.webhook_secret_encrypted)}catch{throw new ChannelAccountLoadError("CHANNEL_CREDENTIAL_DECRYPT_FAILED")}; const transport=new FetchChannelTransport();
  if(account.channel_type==="FACEBOOK"){
    const version=row.configuration.graphApiVersion; if(typeof row.access_token_encrypted!=="string"||typeof version!=="string"||!/^v[0-9]{1,3}\.[0-9]{1,3}$/u.test(version))throw new ChannelAccountLoadError("CHANNEL_CONFIGURATION_INVALID");
    let pageAccessToken:string;try{pageAccessToken=decryptChannelCredential(row.access_token_encrypted)}catch{throw new ChannelAccountLoadError("CHANNEL_CREDENTIAL_DECRYPT_FAILED")};
    return { channelAccountId: row.channel_account_id, adapter: new FacebookPageAdapter(row.channel_account_id,row.workspace_id,{pageId:account.external_account_id,pageAccessToken,appSecret:webhookSecret,graphApiVersion:version},transport) };
  }
  if(account.channel_type==="FACEBOOK_PROFILE"){
    if(!trustedFacebookProfileOrigin)throw new ChannelAccountLoadError("CHANNEL_CONFIGURATION_INVALID");
    return {channelAccountId:row.channel_account_id,adapter:new FacebookProfileBridgeAdapter(row.workspace_id,row.channel_account_id,{bridgeAccountId:account.external_account_id,bridgeBaseUrl:trustedFacebookProfileOrigin,signingSecret:webhookSecret},transport)};
  }
  if(account.channel_type!=="ZALO")throw new ChannelAccountLoadError("CHANNEL_ACCOUNT_ROW_INVALID");
  if(!trustedZaloOrigin)throw new ChannelAccountLoadError("CHANNEL_CONFIGURATION_INVALID");
  return { channelAccountId: row.channel_account_id, adapter: new ZaloBridgeAdapter(row.workspace_id,row.channel_account_id,{bridgeAccountId:account.external_account_id,bridgeBaseUrl:trustedZaloOrigin,signingSecret:webhookSecret},transport) };
}

function relation(value:unknown):{channel_type:unknown;external_account_id:unknown}|null{const account=Array.isArray(value)?value[0]:value;return object(account)&&"channel_type" in account&&"external_account_id" in account?{channel_type:account.channel_type,external_account_id:account.external_account_id}:null}

export async function loadChannelAdapterByExternalId(channelType:"FACEBOOK"|"FACEBOOK_PROFILE"|"ZALO",provider:string,externalAccountId:string){
  const client=createPrivilegedClient();
  const accountResult=await client.from("channel_accounts").select("id,channel_type,external_account_id")
    .eq("channel_type",channelType).eq("provider",provider).eq("external_account_id",externalAccountId).eq("status","CONNECTED").maybeSingle();
  if(accountResult.error)throw new ChannelAccountLoadError("CHANNEL_ACCOUNT_QUERY_FAILED");
  const accountRow=accountResult.data as AccountRow|null;
  if(!accountRow||typeof accountRow.id!=="string")throw new ChannelAccountLoadError("CHANNEL_ACCOUNT_NOT_FOUND");
  const credentialResult=await client.from("channel_account_credentials")
    .select("channel_account_id,workspace_id,access_token_encrypted,webhook_secret_encrypted,configuration")
    .eq("channel_account_id",accountRow.id).maybeSingle();
  if(credentialResult.error)throw new ChannelAccountLoadError("CHANNEL_ACCOUNT_QUERY_FAILED");
  const row=credentialResult.data as CredentialRow|null;
  if(!row)throw new ChannelAccountLoadError("CHANNEL_ACCOUNT_NOT_FOUND");
  return build(row,{channel_type:accountRow.channel_type,external_account_id:accountRow.external_account_id});
}

export async function loadChannelAdapterByAccountId(channelAccountId:string){
  const client=createPrivilegedClient(); const {data,error}=await client.from("channel_account_credentials").select("channel_account_id,workspace_id,access_token_encrypted,webhook_secret_encrypted,configuration,channel_accounts!inner(channel_type,provider,external_account_id,status)").eq("channel_account_id",channelAccountId).eq("channel_accounts.status","CONNECTED").maybeSingle();
  const row=data as CredentialRow|null; const account=relation(row?.channel_accounts); if(error||!row||!account)throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE"); return build(row,account);
}
