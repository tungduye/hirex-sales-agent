import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY;
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if(!url||!secret||!anonKey)throw new Error("RBAC_VALIDATOR_ENV_MISSING");
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const anon=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const fixtureName=`__RBAC_VALIDATOR_${randomUUID()}__`;
let fixtureId=null;
let assertions=0;
const check=(condition,code)=>{assertions++;if(!condition)throw new Error(code)};

try{
  const {data:profiles,error:profileError}=await db.from("profiles").select("id,workspace_id,role_id,all_channel_accounts");
  check(!profileError&&profiles.length>0,"PROFILES_UNAVAILABLE");
  const baseline=profiles.map(row=>JSON.stringify(row)).sort();
  const workspaceId=profiles[0].workspace_id;

  const {data:roles,error:rolesError}=await db.from("workspace_roles").select("id,name,is_system").eq("workspace_id",workspaceId);
  check(!rolesError,"ROLES_UNAVAILABLE");
  check(roles.some(role=>role.name==="Quản trị viên"&&role.is_system),"ADMIN_ROLE_MISSING");
  check(roles.some(role=>role.name==="Nhân viên"&&role.is_system),"MEMBER_ROLE_MISSING");
  check(profiles.every(profile=>profile.role_id),"PROFILE_WITHOUT_ROLE");

  const {data:created,error:createError}=await db.from("workspace_roles").insert({workspace_id:workspaceId,name:fixtureName,description:"Synthetic RBAC validator"}).select("id").single();
  check(!createError&&created?.id,"ROLE_CREATE_FAILED");fixtureId=created.id;
  const duplicate=await db.from("workspace_roles").insert({workspace_id:workspaceId,name:fixtureName.toLowerCase()});
  check(Boolean(duplicate.error),"DUPLICATE_ROLE_ACCEPTED");

  const validKeys=["inbox.view","inbox.reply","contacts.view"];
  const permissionInsert=await db.from("workspace_role_permissions").insert(validKeys.map(permission_key=>({workspace_id:workspaceId,role_id:fixtureId,permission_key})));
  check(!permissionInsert.error,"VALID_PERMISSION_REJECTED");
  const invalidPermission=await db.from("workspace_role_permissions").insert({workspace_id:workspaceId,role_id:fixtureId,permission_key:"INVALID KEY"});
  check(Boolean(invalidPermission.error),"INVALID_PERMISSION_ACCEPTED");
  const {data:stored,error:storedError}=await db.from("workspace_role_permissions").select("permission_key").eq("role_id",fixtureId);
  check(!storedError&&stored.length===validKeys.length,"PERMISSION_COUNT_MISMATCH");

  const badGrant=await db.from("profile_channel_account_access").insert({workspace_id:workspaceId,profile_id:randomUUID(),channel_account_id:randomUUID()});
  check(Boolean(badGrant.error),"INVALID_ACCOUNT_GRANT_ACCEPTED");
  const {data:anonRoles,error:anonError}=await anon.from("workspace_roles").select("id");
  check(!anonError&&anonRoles.length===0,"ANON_ROLE_DISCLOSURE");

  const removed=await db.from("workspace_roles").delete().eq("id",fixtureId).eq("workspace_id",workspaceId).select("id").single();
  check(!removed.error&&removed.data?.id===fixtureId,"ROLE_DELETE_FAILED");fixtureId=null;
  const {count:remaining,error:remainingError}=await db.from("workspace_roles").select("id",{count:"exact",head:true}).eq("name",fixtureName);
  check(!remainingError&&remaining===0,"FIXTURE_REMAINING");
  const {count:orphanPermissions,error:orphanError}=await db.from("workspace_role_permissions").select("role_id",{count:"exact",head:true}).eq("role_id",removed.data.id);
  check(!orphanError&&orphanPermissions===0,"CASCADE_CLEANUP_FAILED");

  const {data:afterProfiles,error:afterError}=await db.from("profiles").select("id,workspace_id,role_id,all_channel_accounts");
  check(!afterError,"PROFILE_RECHECK_FAILED");
  check(JSON.stringify(afterProfiles.map(row=>JSON.stringify(row)).sort())===JSON.stringify(baseline),"REAL_PROFILE_CHANGED");
  console.log(`WORKSPACE_RBAC_VALIDATOR=PASS assertions=${assertions} fixture_remaining=0 real_profiles_changed=0`);
}finally{
  if(fixtureId)await db.from("workspace_roles").delete().eq("id",fixtureId);
}
