"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceAdmin } from "@/modules/access/server/access-control";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { enqueueAiRecruiterInbound } from "./enqueue-ai-recruiter";
import { candidateExplicitlyHasNoCv } from "./ai-recruiter-job-policy";

const uuid=z.string().uuid();
const text=(value:unknown)=>String(value??"").trim();
const bool=(value:unknown)=>value===true||String(value??"").trim().toUpperCase()==="TRUE";
const nullable=(value:unknown)=>text(value)||null;

export async function createAiRecruiterBot(formData:FormData){
  const account=await requireWorkspaceAdmin();
  const parsed=z.object({name:z.string().trim().min(1).max(120),model:z.string().trim().min(1).max(120),botType:z.enum(["SALE","RECRUITER","COLLABORATOR","INTERNAL_HR"])}).safeParse({name:formData.get("name"),model:formData.get("model"),botType:formData.get("botType")});
  if(!parsed.success)return;
  await createPrivilegedClient().from("ai_recruiter_bots").insert({workspace_id:account.workspaceId,created_by:account.userId,name:parsed.data.name,bot_type:parsed.data.botType,model:parsed.data.model,mode:"DRAFT",enabled:false});
  revalidatePath("/settings/ai-recruiter");
}

export async function initializeDedicatedChatbots(){
  const account=await requireWorkspaceAdmin(),db=createPrivilegedClient();
  const bots=[
    {bot_type:"SALE",name:"Chatbot Sale",job_scope:"Khách hàng doanh nghiệp có nhu cầu tuyển dụng",extra_rules:"Tư vấn dịch vụ, khai thác vị trí, số lượng, thời hạn, ngân sách và hẹn Sale phụ trách. Không tư vấn việc làm cho ứng viên."},
    {bot_type:"RECRUITER",name:"Chatbot Recruiter",job_scope:"Ứng viên tìm việc",extra_rules:"Khai thác từng thông tin một, ghép job phù hợp, xin CV và chuyển recruiter. Khi ứng viên từ chối phải dẫn dắt sang job phù hợp tiếp theo."},
    {bot_type:"COLLABORATOR",name:"Chatbot Cộng tác viên",job_scope:"Cộng tác viên giới thiệu ứng viên",extra_rules:"Hướng dẫn gửi hồ sơ, kiểm tra dữ liệu thiếu hoặc trùng, cập nhật tiến độ trong phạm vi được phép. Không lộ dữ liệu nội bộ."},
    {bot_type:"INTERNAL_HR",name:"Chatbot HR nội bộ",job_scope:"Nhân viên nội bộ",extra_rules:"Chỉ trả lời theo chính sách nội bộ được cung cấp; bảo mật thông tin nhân sự và chuyển HR thật khi nội dung nhạy cảm hoặc thiếu căn cứ."},
  ];
  for(const bot of bots)await db.from("ai_recruiter_bots").upsert({workspace_id:account.workspaceId,created_by:account.userId,model:"gpt-5.6-terra",mode:"DRAFT",enabled:false,...bot},{onConflict:"workspace_id,bot_type",ignoreDuplicates:true});
  const {data:created}=await db.from("ai_recruiter_bots").select("id,bot_type").eq("workspace_id",account.workspaceId);
  const flows:Record<string,Array<[string,string,string,string|null,string|null,boolean]>>={
    SALE:[["sale_need","Xác định nhu cầu","Chào anh/chị, mình đang cần HireX hỗ trợ tuyển vị trí nào ạ.","sale_volume","hiring_position",false],["sale_volume","Quy mô tuyển","Anh/chị dự kiến tuyển bao nhiêu người cho vị trí này ạ.","sale_timeline","hiring_volume",false],["sale_timeline","Thời hạn","Mình mong muốn hoàn thành tuyển dụng trong khoảng thời gian nào ạ.","sale_budget","hiring_timeline",false],["sale_budget","Ngân sách","Anh/chị chia sẻ giúp em ngân sách hoặc hình thức hợp tác dự kiến nhé.","sale_handoff","hiring_budget",false],["sale_handoff","Bàn giao Sale","Em sẽ chuyển đầy đủ nhu cầu này cho Sale phụ trách liên hệ tư vấn chi tiết.",null,null,true]],
    RECRUITER:[["rec_role","Vị trí quan tâm","Anh đang quan tâm vị trí nào để em lọc job phù hợp nhé.","rec_experience","candidate_type",false],["rec_experience","Kinh nghiệm","Anh chia sẻ giúp em kinh nghiệm liên quan gần nhất nhé.","rec_location","years_experience",false],["rec_location","Địa điểm","Anh ưu tiên làm việc tại khu vực nào nhé.","rec_salary","preferred_locations",false],["rec_salary","Thu nhập","Anh chia sẻ giúp em mức thu nhập mong muốn nhé.","rec_cv","expected_salary",false],["rec_cv","CV và bàn giao","Khi tiện anh gửi em CV để recruiter trao đổi bước tiếp theo nhé.",null,"cv_received",false]],
    COLLABORATOR:[["ctv_identity","Xác định CTV","Anh/chị chia sẻ giúp em mã hoặc thông tin CTV phụ trách nhé.","ctv_job","collaborator_identity",false],["ctv_job","Chọn job","Ứng viên được giới thiệu cho job nào ạ.","ctv_candidate","job_reference",false],["ctv_candidate","Nhận hồ sơ","Anh/chị gửi giúp em tên, liên hệ và CV của ứng viên nhé.","ctv_check","candidate_submission",false],["ctv_check","Kiểm tra hồ sơ","Em sẽ kiểm tra thông tin thiếu hoặc trùng và phản hồi trạng thái tiếp nhận.","ctv_status",null,false],["ctv_status","Cập nhật tiến độ","Hồ sơ đã được tiếp nhận; em sẽ cập nhật các mốc được phép chia sẻ tại đây.",null,null,false]],
    INTERNAL_HR:[["hr_verify","Xác minh nhân viên","Anh/chị cho em biết mã nhân viên hoặc email công ty để xác minh nhé.","hr_topic","employee_identity",false],["hr_topic","Phân loại yêu cầu","Anh/chị cần hỗ trợ về nghỉ phép, chấm công, phúc lợi hay thủ tục nào ạ.","hr_policy","hr_topic",false],["hr_policy","Tra cứu chính sách","Em sẽ đối chiếu yêu cầu với chính sách nội bộ đã được phê duyệt.","hr_resolution",null,false],["hr_resolution","Hướng dẫn xử lý","Em gửi anh/chị hướng dẫn hoặc biểu mẫu tương ứng; nội dung nhạy cảm sẽ được chuyển HR phụ trách.",null,null,false]],
  };
  for(const bot of created??[]){
    const stages=flows[bot.bot_type]??[];
    const {count}=await db.from("ai_recruiter_stages").select("id",{count:"exact",head:true}).eq("workspace_id",account.workspaceId).eq("bot_id",bot.id);
    if((count??0)===0&&stages.length)await db.from("ai_recruiter_stages").upsert(stages.map(([stage_key,stage_name,message_template,next_stage,next_question_field,stop_bot],sort_order)=>({workspace_id:account.workspaceId,bot_id:bot.id,stage_key,stage_name,message_template,next_stage,next_question_field,stop_bot,wait_for_candidate:!stop_bot,sort_order})),{onConflict:"workspace_id,bot_id,stage_key"});
  }
  revalidatePath("/settings/ai-recruiter");
}

export async function updateAiRecruiterBot(formData:FormData){
  const account=await requireWorkspaceAdmin();
  const parsed=z.object({botId:uuid,enabled:z.enum(["true","false"]),mode:z.enum(["DRAFT","AUTO"])}).safeParse({botId:formData.get("botId"),enabled:formData.get("enabled"),mode:formData.get("mode")});
  if(!parsed.success)return;
  await createPrivilegedClient().from("ai_recruiter_bots").update({enabled:parsed.data.enabled==="true",mode:parsed.data.mode,mode_change_actor:account.userId}).eq("id",parsed.data.botId).eq("workspace_id",account.workspaceId);
  revalidatePath("/settings/ai-recruiter");
}

export async function setAiRecruiterConversationMode(formData:FormData){
  const account=await requireWorkspaceAdmin();
  const parsed=z.object({conversationId:uuid,mode:z.enum(["DRAFT","AUTO"])}).safeParse({conversationId:formData.get("conversationId"),mode:formData.get("mode")});
  if(!parsed.success)return;
  const db=createPrivilegedClient();
  const {data:conversation}=await db.from("omnichannel_conversations").select("id,metadata").eq("workspace_id",account.workspaceId).eq("id",parsed.data.conversationId).maybeSingle();
  if(!conversation)return;
  const metadata=conversation.metadata&&typeof conversation.metadata==="object"&&!Array.isArray(conversation.metadata)?conversation.metadata:{};
  await db.from("omnichannel_conversations").update({metadata:{...metadata,aiRecruiterModeOverride:parsed.data.mode,aiRecruiterModeChangedBy:account.userId},takeover_mode:"BOT_ALLOWED"}).eq("workspace_id",account.workspaceId).eq("id",parsed.data.conversationId);
  if(parsed.data.mode==="DRAFT")await db.from("ai_recruiter_conversation_states").update({next_followup_at:null}).eq("workspace_id",account.workspaceId).eq("conversation_id",parsed.data.conversationId);
  revalidatePath("/settings/ai-recruiter");revalidatePath(`/inbox/all/${parsed.data.conversationId}`);
}

export async function emergencyStopAiRecruiter(formData:FormData){
  const account=await requireWorkspaceAdmin(),botId=uuid.safeParse(formData.get("botId"));if(!botId.success)return;
  const db=createPrivilegedClient(),now=new Date().toISOString();
  const {data:bot}=await db.from("ai_recruiter_bots").update({enabled:false,mode:"DRAFT",mode_change_actor:account.userId}).eq("workspace_id",account.workspaceId).eq("id",botId.data).select("id").maybeSingle();if(!bot)return;
  await Promise.all([
    db.from("ai_recruiter_conversation_states").update({bot_paused:true,pause_reason:"EMERGENCY_STOP",next_followup_at:null}).eq("workspace_id",account.workspaceId).eq("bot_id",botId.data),
    db.from("ai_recruiter_scheduled_actions").update({status:"CANCELLED",completed_at:now}).eq("workspace_id",account.workspaceId).eq("bot_id",botId.data).in("status",["PENDING","CLAIMED"]),
  ]);
  revalidatePath("/settings/ai-recruiter");
}

export async function bindAiRecruiterChannel(formData:FormData){
  const account=await requireWorkspaceAdmin();
  const parsed=z.object({botId:uuid,channelAccountId:uuid}).safeParse({botId:formData.get("botId"),channelAccountId:formData.get("channelAccountId")});
  if(!parsed.success)return;
  const db=createPrivilegedClient();
  const [{data:bot},{data:channel}]=await Promise.all([db.from("ai_recruiter_bots").select("id").eq("id",parsed.data.botId).eq("workspace_id",account.workspaceId).maybeSingle(),db.from("channel_accounts").select("id").eq("id",parsed.data.channelAccountId).eq("workspace_id",account.workspaceId).eq("status","CONNECTED").maybeSingle()]);
  if(!bot||!channel)return;
  await db.from("ai_recruiter_channel_bindings").upsert({workspace_id:account.workspaceId,bot_id:parsed.data.botId,channel_account_id:parsed.data.channelAccountId,enabled:true},{onConflict:"workspace_id,channel_account_id"});
  revalidatePath("/settings/ai-recruiter");
}

export async function updateAiRecruiterBinding(formData:FormData){
  const account=await requireWorkspaceAdmin();
  const parsed=z.object({bindingId:uuid,enabled:z.enum(["true","false"])}).safeParse({bindingId:formData.get("bindingId"),enabled:formData.get("enabled")});
  if(!parsed.success)return;
  await createPrivilegedClient().from("ai_recruiter_channel_bindings").update({enabled:parsed.data.enabled==="true"}).eq("id",parsed.data.bindingId).eq("workspace_id",account.workspaceId);
  revalidatePath("/settings/ai-recruiter");
}

function records(rows:unknown[][]){
  if(rows.length<2)return[];const headers=rows[0].map((value)=>text(value));
  return rows.slice(1).filter((row)=>row.some((value)=>value!==null&&value!=="")).map((row)=>Object.fromEntries(headers.map((header,index)=>[header,row[index]])));
}

export async function importAiRecruiterWorkbook(formData:FormData){
  const account=await requireWorkspaceAdmin();const botId=uuid.safeParse(formData.get("botId")),file=formData.get("file");
  if(!botId.success||!(file instanceof File)||file.size===0||file.size>2_000_000||!file.name.toLowerCase().endsWith(".xlsx"))return;
  const db=createPrivilegedClient(),{data:bot}=await db.from("ai_recruiter_bots").select("id").eq("id",botId.data).eq("workspace_id",account.workspaceId).maybeSingle();if(!bot)return;
  const {readSheet}=await import("read-excel-file/node"),buffer=Buffer.from(await file.arrayBuffer());
  const [jobRows,stageRows,settingsRows]=await Promise.all([readSheet(buffer,"job_data"),readSheet(buffer,"sale_flow_templates"),readSheet(buffer,"bot_settings")]);
  const jobs=records(jobRows).slice(0,500).flatMap((row,index)=>{const external=text(row.job_id),company=text(row.company_name),title=text(row.job_title),stage=text(row.sale_stage);if(!external||!company||!title||!stage)return[];return[{workspace_id:account.workspaceId,bot_id:botId.data,external_job_id:external,active:bool(row.active),priority:Number(row.priority)||index+1,sale_stage:stage,company_name:company,job_title:title,candidate_type:nullable(row.candidate_type),location:nullable(row.location),location_group:nullable(row.location_group),japanese_level_min:nullable(row.japanese_level_min),japan_years_min:Number.isFinite(Number(row.japan_years_min))?Number(row.japan_years_min):null,salary_range:nullable(row.salary_range),process_summary:nullable(row.process_summary),rank_salary_note:nullable(row.rank_salary_note),summary:nullable(row.summary),selling_points:nullable(row.selling_points),requirements:nullable(row.requirements),jd_link:nullable(row.jd_link),avoid_reason_tags:nullable(row.avoid_reason_tags),note:nullable(row.note)}]});
  const stages=records(stageRows).slice(0,100).flatMap((row,index)=>{const key=text(row.stage_key),name=text(row.stage_name),template=text(row.message_template);if(!key||!name||!template)return[];return[{workspace_id:account.workspaceId,bot_id:botId.data,stage_key:key,stage_name:name,message_template:template,next_stage:nullable(row.next_stage),wait_for_candidate:bool(row.wait_for_candidate),stop_bot:bool(row.stop_bot),next_question_field:nullable(row.next_question_field),notes:nullable(row.notes),sort_order:index}]});
  const settings=Object.fromEntries(records(settingsRows).map((row)=>[text(row.setting_key),text(row.setting_value)]));
  if(jobs.length)await db.from("ai_recruiter_jobs").upsert(jobs,{onConflict:"workspace_id,bot_id,external_job_id"});
  if(stages.length)await db.from("ai_recruiter_stages").upsert(stages,{onConflict:"workspace_id,bot_id,stage_key"});
  await db.from("ai_recruiter_bots").update({max_jobs_to_offer:Math.min(10,Math.max(1,Number(settings.max_jobs_to_offer)||2)),process_timeout_minutes:Math.min(10080,Math.max(1,Number(settings.process_timeout_minutes)||60))}).eq("id",botId.data).eq("workspace_id",account.workspaceId);
  revalidatePath("/settings/ai-recruiter");
}

export async function resumeAiRecruiterConversation(formData:FormData){
  const account=await requireWorkspaceAdmin(),conversationId=uuid.safeParse(formData.get("conversationId"));
  if(!conversationId.success)return;
  const db=createPrivilegedClient();
  const [{data:state},{data:conversation},{data:message}]=await Promise.all([
    db.from("ai_recruiter_conversation_states").select("id,profile").eq("workspace_id",account.workspaceId).eq("conversation_id",conversationId.data).maybeSingle(),
    db.from("omnichannel_conversations").select("channel_account_id").eq("workspace_id",account.workspaceId).eq("id",conversationId.data).maybeSingle(),
    db.from("omnichannel_messages").select("id,text_content").eq("workspace_id",account.workspaceId).eq("conversation_id",conversationId.data).eq("direction","INBOUND").order("created_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  if(!state||!conversation||!message)return;
  const noCv=candidateExplicitlyHasNoCv(message.text_content),profile=state.profile&&typeof state.profile==="object"&&!Array.isArray(state.profile)?state.profile:{};
  const resumed=await db.from("ai_recruiter_conversation_states").update({bot_paused:false,pause_reason:null,status:"COLLECTING_PROFILE",next_followup_at:null,...(noCv?{profile:{...profile,cv_received:false}}:{})}).eq("id",state.id).eq("workspace_id",account.workspaceId).select("id").maybeSingle();
  if(!resumed.data)return;
  if(noCv)await db.from("ai_recruiter_candidate_facts").delete().eq("workspace_id",account.workspaceId).eq("conversation_id",conversationId.data).eq("field_key","cv_received");
  await db.from("omnichannel_conversations").update({takeover_mode:"BOT_ALLOWED"}).eq("id",conversationId.data).eq("workspace_id",account.workspaceId);
  await enqueueAiRecruiterInbound({workspaceId:account.workspaceId,channelAccountId:conversation.channel_account_id,conversationId:conversationId.data,messageId:message.id,retryExisting:true});
  revalidatePath("/settings/ai-recruiter");
  revalidatePath(`/inbox/all/${conversationId.data}`);
}

export async function resetAiRecruiterConversation(formData:FormData){
  const account=await requireWorkspaceAdmin(),conversationId=uuid.safeParse(formData.get("conversationId"));
  if(!conversationId.success)return;
  const db=createPrivilegedClient();
  const {data:conversation}=await db.from("omnichannel_conversations").select("id,metadata").eq("workspace_id",account.workspaceId).eq("id",conversationId.data).maybeSingle();
  if(!conversation)return;
  const metadata=conversation.metadata&&typeof conversation.metadata==="object"&&!Array.isArray(conversation.metadata)?conversation.metadata:{};
  const resetAt=new Date().toISOString();
  await db.from("ai_recruiter_scheduled_actions").update({status:"CANCELLED",completed_at:new Date().toISOString()}).eq("workspace_id",account.workspaceId).eq("conversation_id",conversationId.data).in("status",["PENDING","CLAIMED"]);
  await db.from("channel_outbound_actions").delete().eq("workspace_id",account.workspaceId).eq("conversation_id",conversationId.data).eq("status","PROPOSED").eq("proposed_by","AI_ASSIST").eq("dispatch_source","AI_AUTOMATION");
  await db.from("ai_recruiter_candidate_facts").delete().eq("workspace_id",account.workspaceId).eq("conversation_id",conversationId.data);
  await db.from("ai_recruiter_conversation_states").update({status:"COLLECTING_PROFILE",current_stage:null,profile:{},offered_job_ids:[],last_inbound_message_id:null,last_ai_run_id:null,bot_paused:false,pause_reason:null,next_followup_at:null}).eq("workspace_id",account.workspaceId).eq("conversation_id",conversationId.data);
  await db.from("omnichannel_conversations").update({takeover_mode:"BOT_ALLOWED",metadata:{...metadata,aiRecruiterModeOverride:"DRAFT",aiRecruiterResetAt:resetAt,aiRecruiterModeChangedBy:account.userId}}).eq("workspace_id",account.workspaceId).eq("id",conversationId.data);
  revalidatePath("/settings/ai-recruiter");
  revalidatePath(`/inbox/all/${conversationId.data}`);
}
