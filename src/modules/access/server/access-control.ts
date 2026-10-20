import "server-only";
import { cache } from "react";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import type { PermissionKey } from "@/modules/access/core/permission-catalog";

export async function hasPermission(permission:PermissionKey){
  const account=await getAccountContext();
  if(!account?.workspaceId)return false;
  return account.permissions.includes(permission);
}

export async function requirePermission(permission:PermissionKey){
  const account=await getAccountContext();
  if(!account?.workspaceId||!await hasPermission(permission))throw new Error("FORBIDDEN");
  return {...account,workspaceId:account.workspaceId};
}

export const isWorkspaceAdmin = cache(async () => {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.permissions.includes("roles.manage") || !account.permissions.includes("settings.view")) return false;
  const db = createPrivilegedSupabaseClient();
  // One round trip: the profile with its role.
  const { data: joined, error: joinError } = await db.from("profiles")
    .select("role_id, workspace_roles!profiles_role_workspace_fk(name,is_system)").eq("id", account.userId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (!joinError) {
    const role = joined?.workspace_roles as unknown as { name: string; is_system: boolean } | Array<{ name: string; is_system: boolean }> | null | undefined;
    const value = Array.isArray(role) ? role[0] : role;
    return Boolean(joined?.role_id) && value?.is_system === true && value.name === "Quản trị viên";
  }
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("role_id").eq("id", account.userId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (profileError || !profile?.role_id) return false;
  const { data: role, error: roleError } = await db.from("workspace_roles")
    .select("name,is_system").eq("id", profile.role_id).eq("workspace_id", account.workspaceId).maybeSingle();
  return !roleError && role?.is_system === true && role.name === "Quản trị viên";
});

/** Thư viện tài liệu: members granted "Tài liệu · Xem" (administrators always). Managing it stays admin-only. */
export async function requireDocumentReader() {
  const account = await getAccountContext();
  if (!account?.workspaceId || (!account.permissions.includes("documents.view") && !await isWorkspaceAdmin())) throw new Error("FORBIDDEN");
  return { ...account, workspaceId: account.workspaceId };
}

export async function requireWorkspaceAdmin() {
  const account = await getAccountContext();
  if (!account?.workspaceId || !await isWorkspaceAdmin()) throw new Error("FORBIDDEN");
  return { ...account, workspaceId: account.workspaceId };
}

/** Channel accounts the member may use (null = all). Cached for the current request. */
export const getAccessibleChannelAccountIds = cache(async function loadAccessibleChannelAccountIds(){
  const account=await getAccountContext();
  if(!account?.workspaceId)return [];
  const db=createPrivilegedSupabaseClient();
  // Both lookups at once; the access list is ignored when the member has every account.
  const [{data:profile,error},{data,error:accessError}]=await Promise.all([
    db.from("profiles").select("all_channel_accounts").eq("id",account.userId).eq("workspace_id",account.workspaceId).maybeSingle(),
    db.from("profile_channel_account_access").select("channel_account_id").eq("workspace_id",account.workspaceId).eq("profile_id",account.userId),
  ]);
  if(error)return [];
  if(profile?.all_channel_accounts)return null;
  if(accessError)return [];
  return (data??[]).map(item=>item.channel_account_id as string);
});

export async function canAccessChannelAccount(channelAccountId:string){
  const ids=await getAccessibleChannelAccountIds();
  return ids===null||ids.includes(channelAccountId);
}

export async function getAccessibleEmailAccountIds(){
  const channelIds=await getAccessibleChannelAccountIds();
  if(channelIds===null)return null;
  if(channelIds.length===0)return [];
  const account=await getAccountContext();
  if(!account?.workspaceId)return [];
  const {data}=await createPrivilegedSupabaseClient().from("channel_accounts").select("legacy_email_account_id").eq("workspace_id",account.workspaceId).in("id",channelIds).not("legacy_email_account_id","is",null);
  return (data??[]).flatMap(item=>typeof item.legacy_email_account_id==="string"?[item.legacy_email_account_id]:[]);
}

export async function canAccessEmailAccount(emailAccountId:string){
  const ids=await getAccessibleEmailAccountIds();
  return ids===null||ids.includes(emailAccountId);
}
