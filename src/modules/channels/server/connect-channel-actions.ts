"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { hasPermission } from "@/modules/access/server/access-control";
import { encryptChannelCredential } from "./channel-credential-encryption";
import { requireTrustedZaloBridgeOrigin } from "../adapters/zalo/trusted-bridge-origin";
import { requireTrustedFacebookProfileBridgeOrigin } from "../adapters/facebook-profile/trusted-bridge-origin";
import { loadChannelAdapterByAccountId } from "./load-channel-adapter";
import { PROVIDER_HEALTH_STATUSES, type ProviderHealthStatus } from "../core/provider-health";
import { zaloConnectCapabilities } from "../core/zalo-account-policy";
import type { ChannelActionState } from "../types/channel-action-state";
import { subscribeFacebookPage } from "./subscribe-facebook-page";

const safeText=z.string().trim().min(1).max(256).refine(value=>!/[\u0000-\u001f\u007f-\u009f]/u.test(value));
const facebookSchema=z.object({pageId:safeText,displayName:z.string().trim().max(160),pageAccessToken:z.string().trim().min(20).max(8192),appSecret:z.string().trim().min(16).max(1024),graphApiVersion:z.string().trim().regex(/^v[0-9]{1,3}\.[0-9]{1,3}$/)});
const zaloSchema=z.object({accountId:safeText,displayName:z.string().trim().max(160),bridgeBaseUrl:z.string().refine(value=>{try{return Boolean(requireTrustedZaloBridgeOrigin(value))}catch{return false}}),bridgeSecret:z.string().trim().min(32).max(1024)});
const facebookProfileSchema=z.object({accountId:safeText,displayName:z.string().trim().max(160),bridgeBaseUrl:z.string().refine(value=>{try{return Boolean(requireTrustedFacebookProfileBridgeOrigin(value))}catch{return false}}),bridgeSecret:z.string().trim().min(32).max(1024)});

async function context(){const account=await getAccountContext();if(!account?.configurationComplete||!account.workspaceId||!account.userId)return null;return account}

export async function connectFacebookPage(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const parsed=facebookSchema.safeParse(Object.fromEntries(formData)),account=await context();if(!parsed.success||!account)return{status:"error",message:"Facebook Page configuration is invalid."};
  try{
    const subscription=await subscribeFacebookPage(parsed.data);
    if(!subscription.ok)return{status:"error",message:subscription.reason==="TOKEN_REJECTED"?"Page Access Token không hợp lệ hoặc thiếu quyền pages_messaging.":subscription.reason==="META_UNAVAILABLE"?"Meta đang không phản hồi; chưa thể bật đồng bộ tin nhắn.":"Không thể đăng ký webhook cho Page. Hãy kiểm tra Page đã được thêm vào Meta App và quyền pages_messaging."};
    const client=createPrivilegedClient();const {data,error}=await client.rpc("upsert_channel_account_credential",{p_workspace_id:account.workspaceId,p_connected_by:account.userId,p_channel_type:"FACEBOOK",p_provider:"META_GRAPH",p_external_account_id:parsed.data.pageId,p_display_name:parsed.data.displayName||null,p_capabilities:["SEND_TEXT","REPLY","DELIVERY_RECEIPTS","READ_RECEIPTS"],p_access_token_encrypted:encryptChannelCredential(parsed.data.pageAccessToken),p_webhook_secret_encrypted:encryptChannelCredential(parsed.data.appSecret),p_configuration:{graphApiVersion:parsed.data.graphApiVersion}});if(error||typeof data!=="string")return{status:"error",message:"Facebook Page could not be connected."};revalidatePath("/settings/channels");return{status:"success",message:"Đã lưu Facebook Page và bật tự động đồng bộ tin nhắn."}
  }catch{return{status:"error",message:"Facebook Page connection is unavailable."}}
}

export async function connectZaloBridge(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const parsed=zaloSchema.safeParse(Object.fromEntries(formData)),account=await context();if(!parsed.success||!account)return{status:"error",message:"Zalo bridge configuration is invalid."};
  try{
    const client=createPrivilegedClient();
    const {data:existing,error:lookupError}=await client.from("channel_accounts").select("id,capabilities")
      .eq("workspace_id",account.workspaceId).eq("channel_type","ZALO").eq("provider","ZALO_BRIDGE")
      .eq("external_account_id",parsed.data.accountId).maybeSingle();
    if(lookupError)return{status:"error",message:"Zalo bridge could not be connected."};
    // Never grant outbound to a newly added account. Only preserve the already
    // reviewed single QA account's existing SEND_TEXT capability on reconnect.
    const capabilities=zaloConnectCapabilities({isExisting:Boolean(existing),existingCapabilities:existing?.capabilities,
      providerAccountId:parsed.data.accountId,qaProviderAccountId:process.env.HIREX_ZALO_QA_ACCOUNT_ID});
    const {data,error}=await client.rpc("upsert_channel_account_credential",{p_workspace_id:account.workspaceId,p_connected_by:account.userId,p_channel_type:"ZALO",p_provider:"ZALO_BRIDGE",p_external_account_id:parsed.data.accountId,p_display_name:parsed.data.displayName||null,p_capabilities:capabilities,p_access_token_encrypted:null,p_webhook_secret_encrypted:encryptChannelCredential(parsed.data.bridgeSecret),p_configuration:{bridgeBaseUrl:requireTrustedZaloBridgeOrigin(parsed.data.bridgeBaseUrl)}});if(error||typeof data!=="string")return{status:"error",message:"Zalo bridge could not be connected."};revalidatePath("/settings/channels");return{status:"success",message:"Zalo bridge credential saved securely."};
  }catch{return{status:"error",message:"Zalo bridge connection is unavailable."}}
}

export async function connectFacebookProfileBridge(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const parsed=facebookProfileSchema.safeParse(Object.fromEntries(formData)),account=await context();
  if(!parsed.success||!account)return{status:"error",message:"Cấu hình bridge Facebook cá nhân không hợp lệ."};
  try{
    const {data,error}=await createPrivilegedClient().rpc("upsert_channel_account_credential",{
      p_workspace_id:account.workspaceId,p_connected_by:account.userId,p_channel_type:"FACEBOOK_PROFILE",p_provider:"FACEBOOK_PROFILE_BRIDGE",
      p_external_account_id:parsed.data.accountId,p_display_name:parsed.data.displayName||null,p_capabilities:["SEND_TEXT","REPLY"],
      p_access_token_encrypted:null,p_webhook_secret_encrypted:encryptChannelCredential(parsed.data.bridgeSecret),
      p_configuration:{bridgeBaseUrl:requireTrustedFacebookProfileBridgeOrigin(parsed.data.bridgeBaseUrl)},
    });
    if(error||typeof data!=="string")return{status:"error",message:"Không thể kết nối bridge Facebook cá nhân."};
    revalidatePath("/settings/channels");revalidatePath("/inbox/all");
    return{status:"success",message:"Đã lưu bridge Facebook cá nhân an toàn. Chỉ bật đọc và trả lời thủ công."};
  }catch{return{status:"error",message:"Bridge Facebook cá nhân hiện không khả dụng."}}
}

export async function disconnectChannelAccount(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const id=z.string().uuid().safeParse(formData.get("id")),account=await context();if(!id.success||!account)return{status:"error",message:"Channel account could not be disconnected."};
  try{const{data,error}=await createPrivilegedClient().rpc("disconnect_channel_account",{p_workspace_id:account.workspaceId,p_actor_id:account.userId,p_channel_account_id:id.data});if(error||data!==true)return{status:"error",message:"Channel account could not be disconnected."};revalidatePath("/settings/channels");return{status:"success",message:"Channel account disconnected and credential removed."}}catch{return{status:"error",message:"Channel account disconnect is unavailable."}}
}

export async function deleteChannelAccount(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const id=z.string().uuid().safeParse(formData.get("id")),account=await context();
  if(!id.success||!account||!await hasPermission("channels.manage"))return{status:"error",message:"Bạn không có quyền xóa tài khoản kênh."};
  try{const{data,error}=await createPrivilegedClient().rpc("soft_delete_channel_account",{p_workspace_id:account.workspaceId,p_actor_id:account.userId,p_channel_account_id:id.data});if(error||data!==true)return{status:"error",message:"Không thể xóa tài khoản kênh."};revalidatePath("/settings/channels");revalidatePath("/settings/roles");revalidatePath("/inbox/all");return{status:"success",message:"Đã xóa tài khoản kênh và credential; lịch sử vẫn được giữ."}}catch{return{status:"error",message:"Chức năng xóa tài khoản kênh hiện không khả dụng."}}
}

export async function setChannelAccountOperatorEnabled(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const id=z.string().uuid().safeParse(formData.get("id")),enabled=z.enum(["true","false"]).safeParse(formData.get("enabled")),account=await context();
  if(!id.success||!enabled.success||!account)return{status:"error",message:"Channel operator state could not be changed."};
  const{data,error}=await createPrivilegedClient().rpc("set_channel_account_operator_enabled",{p_channel_account_id:id.data,p_enabled:enabled.data==="true"});
  if(error||data!==true)return{status:"error",message:"Channel operator state could not be changed."};
  revalidatePath("/settings/channels");return{status:"success",message:"Channel operator state updated."};
}

/** Authenticated, workspace-scoped read-only provider probe with reviewed health persistence. */
export async function checkZaloBridgeHealth(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const id=z.string().uuid().safeParse(formData.get("id")),account=await context();
  if(!id.success||!account)return{status:"error",message:"Zalo health check is unavailable."};
  try{
    const client=createPrivilegedClient();
    const {data:target,error}=await client.from("channel_accounts").select("id").eq("id",id.data).eq("workspace_id",account.workspaceId).eq("channel_type","ZALO").eq("provider","ZALO_BRIDGE").eq("status","CONNECTED").maybeSingle();
    if(error||!target)return{status:"error",message:"Zalo health check is unavailable."};
    const loaded=await loadChannelAdapterByAccountId(id.data);
    const started=Date.now();
    const raw=await loaded.adapter.healthCheck();
    const health:ProviderHealthStatus=PROVIDER_HEALTH_STATUSES.includes(raw as ProviderHealthStatus)?raw as ProviderHealthStatus:"UNKNOWN";
    const {data:recorded,error:recordError}=await client.rpc("record_channel_account_provider_health",{
      p_workspace_id:account.workspaceId,p_channel_account_id:id.data,p_status:health,p_checked_at:new Date().toISOString(),
      p_safe_reason_code:health==="HEALTHY"?null:health,p_latency_ms:Math.min(Date.now()-started,60000),
    });
    if(recordError||recorded!==true)return{status:"error",message:"Zalo health check could not be saved."};
    revalidatePath("/settings/channels");revalidatePath("/inbox/all");
    return{status:health==="HEALTHY"?"success":"error",message:health==="HEALTHY"?"Zalo bridge is healthy.":"Zalo bridge health is not healthy."};
  }catch{return{status:"error",message:"Zalo health check is unavailable."}}
}
