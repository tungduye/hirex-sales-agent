import "server-only";
import { requireWorkspaceAdmin } from "@/modules/access/server/access-control";
import { createPrivilegedClient } from "@/lib/supabase/privileged";

export async function getAiRecruiterAdminData(){
  const account=await requireWorkspaceAdmin(),db=createPrivilegedClient();
  const recentRunCutoff=new Date(Date.now()-86_400_000).toISOString();
  const [bots,bindings,jobs,stages,runs,recentRunCount,accounts,states,facts]=await Promise.all([
    db.from("ai_recruiter_bots").select("id,name,bot_type,enabled,mode,model,recruiter_name,debounce_seconds,reminder_1_minutes,reminder_2_minutes,process_timeout_minutes,max_jobs_to_offer,updated_at").eq("workspace_id",account.workspaceId).order("bot_type"),
    db.from("ai_recruiter_channel_bindings").select("id,bot_id,channel_account_id,enabled").eq("workspace_id",account.workspaceId),
    db.from("ai_recruiter_jobs").select("id,bot_id,external_job_id,active,priority,sale_stage,company_name,job_title,candidate_type,location,japanese_level_min,japan_years_min,salary_range,requirements,selling_points").eq("workspace_id",account.workspaceId).order("priority"),
    db.from("ai_recruiter_stages").select("id,bot_id,stage_key,stage_name,next_stage,wait_for_candidate,stop_bot,sort_order").eq("workspace_id",account.workspaceId).order("sort_order"),
    db.from("ai_recruiter_runs").select("id,bot_id,conversation_id,status,mode,proposed_text_parts,output_json,safe_error_code,created_at").eq("workspace_id",account.workspaceId).order("created_at",{ascending:false}).limit(30),
    db.from("ai_recruiter_runs").select("id",{count:"exact",head:true}).eq("workspace_id",account.workspaceId).gte("created_at",recentRunCutoff),
    db.from("channel_accounts").select("id,channel_type,display_name,status").eq("workspace_id",account.workspaceId).is("deleted_at",null).order("channel_type").order("display_name"),
    db.from("ai_recruiter_conversation_states").select("id,bot_id,conversation_id,status,current_stage,profile,bot_paused,pause_reason,updated_at").eq("workspace_id",account.workspaceId).order("updated_at",{ascending:false}).limit(100),
    db.from("ai_recruiter_candidate_facts").select("id,bot_id,conversation_id,field_key,field_value,confidence,evidence_quote,source_message_id,updated_at").eq("workspace_id",account.workspaceId).order("updated_at",{ascending:false}).limit(1000),
  ]);
  const conversationIds=(states.data??[]).map((state)=>state.conversation_id);
  const conversations=conversationIds.length?await db.from("omnichannel_conversations").select("id,channel_type,provider_conversation_id,contact_id,metadata").eq("workspace_id",account.workspaceId).in("id",conversationIds):{data:[],error:null};
  const contactIds=(conversations.data??[]).map((conversation)=>conversation.contact_id).filter((id):id is string=>typeof id==="string");
  const contacts=contactIds.length?await db.from("contacts").select("id,full_name").eq("workspace_id",account.workspaceId).in("id",contactIds):{data:[],error:null};
  const error=[bots,bindings,jobs,stages,runs,recentRunCount,accounts,states,facts,conversations,contacts].find((result)=>result.error)?.error;
  return{bots:bots.data??[],bindings:bindings.data??[],jobs:jobs.data??[],stages:stages.data??[],runs:runs.data??[],recentRunCount:recentRunCount.count??0,accounts:accounts.data??[],states:states.data??[],facts:facts.data??[],conversations:conversations.data??[],contacts:contacts.data??[],error:error?"Không thể tải cấu hình AI Recruiter.":null};
}
