import "server-only";
import { requirePermission } from "@/modules/access/server/access-control";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

export async function getRoleManagementData(){
  const account=await requirePermission("roles.view");
  const db=createPrivilegedSupabaseClient();
  const [{data:roles},{data:permissions},{data:profiles},{data:accounts},{data:grants},{data:hardened,error:hardenError}]=await Promise.all([
    db.from("workspace_roles").select("id,name,description,is_system").eq("workspace_id",account.workspaceId).order("is_system",{ascending:false}).order("name"),
    db.from("workspace_role_permissions").select("role_id,permission_key").eq("workspace_id",account.workspaceId),
    db.from("profiles").select("id,full_name,role_id,all_channel_accounts,manager_id").eq("workspace_id",account.workspaceId).order("full_name"),
    db.from("channel_accounts").select("id,channel_type,display_name,external_account_id,status,primary_profile_id").eq("workspace_id",account.workspaceId).order("channel_type"),
    db.from("profile_channel_account_access").select("profile_id,channel_account_id").eq("workspace_id",account.workspaceId),
    db.rpc("rbac_account_scope_hardened"),
  ]);
  const {data:userPage}=await db.auth.admin.listUsers({page:1,perPage:1000});
  const emails=new Map(userPage?.users.map(user=>[user.id,user.email??""])??[]);
  return {roles:roles??[],permissions:permissions??[],profiles:(profiles??[]).map(profile=>({...profile,email:emails.get(profile.id)??""})),accounts:accounts??[],grants:grants??[],accountCreationReady:!hardenError&&hardened===true};
}
