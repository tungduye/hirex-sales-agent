"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/modules/access/server/access-control";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

export type CreateAccountState={status:"idle"|"success"|"error";message:string};
const schema=z.object({
  fullName:z.string().trim().min(2).max(120),
  email:z.email().max(254).transform(value=>value.trim().toLowerCase()),
  password:z.string().min(6).max(128),
  roleId:z.uuid(),
});

export async function createWorkspaceAccount(_state:CreateAccountState,formData:FormData):Promise<CreateAccountState>{
  const actor=await requirePermission("roles.manage");
  const parsed=schema.safeParse({fullName:formData.get("fullName"),email:formData.get("email"),password:formData.get("password"),roleId:formData.get("roleId")});
  if(!parsed.success)return {status:"error",message:"Kiểm tra lại tên, email và mật khẩu (ít nhất 6 ký tự)."};
  const accountIds=[...new Set(formData.getAll("channelAccountId").map(String))];
  if(accountIds.some(id=>!z.uuid().safeParse(id).success))return {status:"error",message:"Danh sách tài khoản kết nối không hợp lệ."};
  const db=createPrivilegedSupabaseClient();
  // Migration 030 closes pre-existing workspace-wide read policies before any restricted login is created.
  const {data:hardened,error:hardenError}=await db.rpc("rbac_account_scope_hardened");
  if(hardenError||hardened!==true)return {status:"error",message:"Chưa thể tạo tài khoản: cần hoàn tất RLS migration 030 trước."};
  const {data:role,error:roleError}=await db.from("workspace_roles").select("id").eq("id",parsed.data.roleId).eq("workspace_id",actor.workspaceId).maybeSingle();
  if(roleError||!role)return {status:"error",message:"Vai trò không thuộc không gian làm việc này."};
  let validAccountIds:string[]=[];
  if(accountIds.length){
    const {data:valid,error:accountError}=await db.from("channel_accounts").select("id").eq("workspace_id",actor.workspaceId).in("id",accountIds);
    if(accountError||valid?.length!==accountIds.length)return {status:"error",message:"Có tài khoản kết nối không thuộc không gian làm việc này."};
    validAccountIds=valid.map(item=>item.id);
  }
  const {data:created,error:createError}=await db.auth.admin.createUser({email:parsed.data.email,password:parsed.data.password,email_confirm:true,user_metadata:{full_name:parsed.data.fullName}});
  if(createError||!created.user)return {status:"error",message:"Không thể tạo tài khoản; email có thể đã tồn tại."};
  const userId=created.user.id;
  try{
    const {error:profileError}=await db.from("profiles").insert({id:userId,workspace_id:actor.workspaceId,full_name:parsed.data.fullName,role_id:role.id,all_channel_accounts:false});
    if(profileError)throw new Error("PROFILE_INSERT_FAILED");
    if(validAccountIds.length){
      const {error:grantError}=await db.from("profile_channel_account_access").insert(validAccountIds.map(channel_account_id=>({workspace_id:actor.workspaceId,profile_id:userId,channel_account_id})));
      if(grantError)throw new Error("ACCOUNT_GRANT_FAILED");
    }
  }catch{
    // This ID was created in this action only. Deleting Auth cascades its profile and grants.
    const {error:cleanupError}=await db.auth.admin.deleteUser(userId);
    return cleanupError
      ? {status:"error",message:"Tạo hồ sơ thất bại và cleanup chưa xác nhận. Dừng tạo thêm tài khoản; cần quản trị viên kiểm tra."}
      : {status:"error",message:"Tạo hồ sơ hoặc cấp kênh thất bại; tài khoản vừa tạo đã được thu hồi."};
  }
  revalidatePath("/settings/roles");
  return {status:"success",message:"Đã tạo tài khoản và chỉ cấp các kênh đã chọn. Hãy chuyển mật khẩu qua kênh riêng an toàn."};
}
