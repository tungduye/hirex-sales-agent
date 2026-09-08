"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { encryptChannelCredential } from "./channel-credential-encryption";
import type { ChannelActionState } from "../types/channel-action-state";

const safeText=z.string().trim().min(1).max(256).refine(value=>!/[\u0000-\u001f\u007f-\u009f]/u.test(value));
const facebookSchema=z.object({pageId:safeText,displayName:z.string().trim().max(160),pageAccessToken:z.string().trim().min(20).max(8192),appSecret:z.string().trim().min(16).max(1024),graphApiVersion:z.string().trim().regex(/^v[0-9]{1,3}\.[0-9]{1,3}$/)});
const zaloSchema=z.object({accountId:safeText,displayName:z.string().trim().max(160),bridgeBaseUrl:z.string().url().refine(value=>new URL(value).protocol==="https:"),bridgeSecret:z.string().trim().min(32).max(1024)});

async function context(){const account=await getAccountContext();if(!account?.configurationComplete||!account.workspaceId||!account.userId)return null;return account}

export async function connectFacebookPage(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const parsed=facebookSchema.safeParse(Object.fromEntries(formData)),account=await context();if(!parsed.success||!account)return{status:"error",message:"Facebook Page configuration is invalid."};
  try{const client=createPrivilegedClient();const {data,error}=await client.rpc("upsert_channel_account_credential",{p_workspace_id:account.workspaceId,p_connected_by:account.userId,p_channel_type:"FACEBOOK",p_provider:"META_GRAPH",p_external_account_id:parsed.data.pageId,p_display_name:parsed.data.displayName||null,p_capabilities:["SEND_TEXT","SEND_IMAGE","SEND_FILE","REPLY","DELIVERY_RECEIPTS","READ_RECEIPTS"],p_access_token_encrypted:encryptChannelCredential(parsed.data.pageAccessToken),p_webhook_secret_encrypted:encryptChannelCredential(parsed.data.appSecret),p_configuration:{graphApiVersion:parsed.data.graphApiVersion}});if(error||typeof data!=="string")return{status:"error",message:"Facebook Page could not be connected."};revalidatePath("/settings/channels");return{status:"success",message:"Facebook Page credential saved securely."}}catch{return{status:"error",message:"Facebook Page connection is unavailable."}}
}

export async function connectZaloBridge(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const parsed=zaloSchema.safeParse(Object.fromEntries(formData)),account=await context();if(!parsed.success||!account)return{status:"error",message:"Zalo bridge configuration is invalid."};
  try{const client=createPrivilegedClient();const {data,error}=await client.rpc("upsert_channel_account_credential",{p_workspace_id:account.workspaceId,p_connected_by:account.userId,p_channel_type:"ZALO",p_provider:"ZALO_BRIDGE",p_external_account_id:parsed.data.accountId,p_display_name:parsed.data.displayName||null,p_capabilities:["SEND_TEXT","SEND_IMAGE","SEND_FILE","REPLY","READ_RECEIPTS"],p_access_token_encrypted:null,p_webhook_secret_encrypted:encryptChannelCredential(parsed.data.bridgeSecret),p_configuration:{bridgeBaseUrl:parsed.data.bridgeBaseUrl}});if(error||typeof data!=="string")return{status:"error",message:"Zalo bridge could not be connected."};revalidatePath("/settings/channels");return{status:"success",message:"Zalo bridge credential saved securely."}}catch{return{status:"error",message:"Zalo bridge connection is unavailable."}}
}

export async function disconnectChannelAccount(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const id=z.string().uuid().safeParse(formData.get("id")),account=await context();if(!id.success||!account)return{status:"error",message:"Channel account could not be disconnected."};
  try{const{data,error}=await createPrivilegedClient().rpc("disconnect_channel_account",{p_workspace_id:account.workspaceId,p_actor_id:account.userId,p_channel_account_id:id.data});if(error||data!==true)return{status:"error",message:"Channel account could not be disconnected."};revalidatePath("/settings/channels");return{status:"success",message:"Channel account disconnected and credential removed."}}catch{return{status:"error",message:"Channel account disconnect is unavailable."}}
}
