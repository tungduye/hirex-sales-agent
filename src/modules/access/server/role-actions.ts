"use server";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { allPermissionKeys } from "@/modules/access/core/permission-catalog";
import { requirePermission } from "@/modules/access/server/access-control";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

const uuid=z.string().uuid();
const allowed=new Set<string>(allPermissionKeys);

export async function createRole(formData:FormData){
  const account=await requirePermission("roles.manage");
  const parsed=z.object({name:z.string().trim().min(2).max(80),description:z.string().trim().max(300)}).safeParse({name:formData.get("name"),description:formData.get("description")??""});
  if(!parsed.success)return;
  const db=createPrivilegedSupabaseClient();
  const {data}=await db.from("workspace_roles").insert({workspace_id:account.workspaceId,name:parsed.data.name,description:parsed.data.description||null}).select("id").single();
  if(data)await replacePermissions(db,account.workspaceId,data.id,formData.getAll("permission").map(String));
  revalidatePath("/settings/roles");
}

export async function updateRole(formData:FormData){
  const account=await requirePermission("roles.manage");
  const parsed=z.object({roleId:uuid,name:z.string().trim().min(2).max(80),description:z.string().trim().max(300)}).safeParse({roleId:formData.get("roleId"),name:formData.get("name"),description:formData.get("description")??""});
  if(!parsed.success)return;
  const db=createPrivilegedSupabaseClient();
  const requested=formData.getAll("permission").map(String);
  const {data:self}=await db.from("profiles").select("role_id").eq("id",account.userId).eq("workspace_id",account.workspaceId).maybeSingle();
  if(self?.role_id===parsed.data.roleId&&!requested.includes("roles.manage"))return;
  await db.from("workspace_roles").update({name:parsed.data.name,description:parsed.data.description||null}).eq("id",parsed.data.roleId).eq("workspace_id",account.workspaceId);
  await replacePermissions(db,account.workspaceId,parsed.data.roleId,requested);
  revalidatePath("/settings/roles");
}

export async function assignProfileAccess(formData:FormData){
  const account=await requirePermission("roles.manage");
  const parsed=z.object({profileId:uuid,roleId:uuid}).safeParse({profileId:formData.get("profileId"),roleId:formData.get("roleId")});
  if(!parsed.success)return;
  const db=createPrivilegedSupabaseClient();
  const allAccounts=formData.get("allAccounts")==="on";
  const accountIds=formData.getAll("channelAccountId").map(String).filter(value=>uuid.safeParse(value).success);
  const {data:role}=await db.from("workspace_roles").select("id").eq("id",parsed.data.roleId).eq("workspace_id",account.workspaceId).maybeSingle();
  const {data:profile}=await db.from("profiles").select("id").eq("id",parsed.data.profileId).eq("workspace_id",account.workspaceId).maybeSingle();
  if(!role||!profile)return;
  if(profile.id===account.userId){const {data:manage}=await db.from("workspace_role_permissions").select("permission_key").eq("workspace_id",account.workspaceId).eq("role_id",role.id).eq("permission_key","roles.manage").maybeSingle();if(!manage)return;}
  // Quản lý trực tiếp: anyone in the workspace except the member and the people below them (no loops).
  const managerRaw=String(formData.get("managerId")??"");
  const managerId=uuid.safeParse(managerRaw).success?managerRaw:null;
  const {data:people}=await db.from("profiles").select("id,manager_id").eq("workspace_id",account.workspaceId);
  const bossOf=new Map((people??[]).map(item=>[item.id as string,item.manager_id as string|null]));
  let safeManager:string|null=managerId&&managerId!==profile.id&&bossOf.has(managerId)?managerId:null;
  for(let step=safeManager,hops=0;step&&hops<200;step=bossOf.get(step)??null,hops++){if(step===profile.id){safeManager=null;break;}}
  // Bộ phận (Sale, Rec…): Soda counts Suối Nguồn by it.
  const department=String(formData.get("department")??"").replace(/\s+/gu," ").trim().slice(0,60)||null;
  // Ảnh đại diện (HireX HQ map): an https image link, empty = initials.
  const avatarRaw=String(formData.get("avatarUrl")??"").trim();
  const avatar_url=/^https:\/\/\S+$/u.test(avatarRaw)&&avatarRaw.length<=1000?avatarRaw:null;
  await db.from("profiles").update({role_id:role.id,all_channel_accounts:allAccounts,manager_id:safeManager,department,avatar_url}).eq("id",profile.id).eq("workspace_id",account.workspaceId);
  // Tài khoản chính: each account has one main user; ticking one here takes it over from whoever had it.
  const primaryIds=formData.getAll("primaryAccountId").map(String).filter(value=>uuid.safeParse(value).success);
  const {data:validPrimary}=primaryIds.length?await db.from("channel_accounts").select("id").eq("workspace_id",account.workspaceId).in("id",primaryIds):{data:[] as Array<{id:string}>};
  const keepPrimary=(validPrimary??[]).map(item=>item.id as string);
  const release=db.from("channel_accounts").update({primary_profile_id:null}).eq("workspace_id",account.workspaceId).eq("primary_profile_id",profile.id);
  await (keepPrimary.length?release.not("id","in",`(${keepPrimary.join(",")})`):release);
  if(keepPrimary.length)await db.from("channel_accounts").update({primary_profile_id:profile.id}).eq("workspace_id",account.workspaceId).in("id",keepPrimary);
  await db.from("profile_channel_account_access").delete().eq("workspace_id",account.workspaceId).eq("profile_id",profile.id);
  // A member can always use the accounts they are the main user of.
  const grantIds=[...new Set([...accountIds,...keepPrimary])];
  if(!allAccounts&&grantIds.length){
    const {data:valid}=await db.from("channel_accounts").select("id").eq("workspace_id",account.workspaceId).in("id",grantIds);
    if(valid?.length)await db.from("profile_channel_account_access").insert(valid.map(item=>({workspace_id:account.workspaceId,profile_id:profile.id,channel_account_id:item.id})));
  }
  try{updateTag("inbox-metadata");}catch{/* the inbox cache expires within a minute */}
  revalidatePath("/settings/roles");
}

async function replacePermissions(db:ReturnType<typeof createPrivilegedSupabaseClient>,workspaceId:string,roleId:string,keys:string[]){
  const selected=[...new Set(keys.filter(key=>allowed.has(key)))];
  await db.from("workspace_role_permissions").delete().eq("workspace_id",workspaceId).eq("role_id",roleId);
  if(selected.length)await db.from("workspace_role_permissions").insert(selected.map(permission_key=>({workspace_id:workspaceId,role_id:roleId,permission_key})));
}
