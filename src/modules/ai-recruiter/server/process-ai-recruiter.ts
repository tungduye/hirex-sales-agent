import "server-only";
import { approvedIntroReply, withoutQuestionMarks } from "../core/approved-intro-flow";
import { initialRecruiterOpening } from "../core/recruiter-opening";
import { recoverIntroMemory } from "../core/intro-memory";
import { missingIntroField, introductionQuestion } from "../core/profile-disclosure-gate";
import { candidateBurst, shapeReply } from "../core/reply-shaping";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { ChannelAdapterRegistry } from "@/modules/channels/core/channel-adapter-registry";
import { executeChannelOutboundAction } from "@/modules/channels/server/execute-channel-outbound-action";
import { loadChannelAdapterByAccountId } from "@/modules/channels/server/load-channel-adapter";
import { availabilityFollowup, candidateExplicitlyHasNoCv, eligibleRecruiterJobIds, hasRecruiterCvAttachment, isManagementRecruiterJob, normalizeRecruiterMatchText } from "./ai-recruiter-job-policy";
import { aiRecruiterPersonaPolicy, aiRecruiterSharedPolicy } from "@/modules/ai-recruiter/core/persona-policy";
import { recruiterRejectionKind, recruiterRejectionOverride } from "@/modules/ai-recruiter/core/recruiter-conversation-policy";

const factKeys=["candidate_type","current_role","seniority","primary_skills","years_experience","current_company","location","preferred_locations","work_preference","japanese_level","english_level","japan_years","current_salary","expected_salary","availability","motivation","job_priorities","applied_companies","rejected_companies","management_experience","brse_experience","japanese_client_experience","email","phone","cv_received"] as const;
const jobMatchSchema=z.object({jobId:z.string().max(160),score:z.number().int().min(0).max(100),matchedReasons:z.array(z.string().max(300)).max(5),missingFields:z.array(z.string().max(120)).max(8),riskFlags:z.array(z.string().max(300)).max(5)});
const resultSchema=z.object({
  intent:z.enum(["greeting","answer","job_interest","job_rejection","salary_question","process_question","cv_shared","complaint","other"]),
  profileUpdates:z.object({candidate_type:z.string().max(120).nullable(),location:z.string().max(200).nullable(),japanese_level:z.string().max(50).nullable(),japan_years:z.number().min(0).max(80).nullable(),expected_salary:z.string().max(120).nullable(),cv_received:z.boolean().nullable()}),
  replyParts:z.array(z.string().trim().min(1).max(2000)).min(1).max(3),nextStage:z.string().max(160).nullable(),
  conversationStatus:z.enum(["COLLECTING_PROFILE","PROFILE_COMPLETE","OFFERING_JOB","DISCUSSING_PROCESS","WAITING_RECRUITER","COMPLETED","PAUSED"]),
  askedQuestion:z.boolean(),handoffRequested:z.boolean(),handoffReason:z.string().max(500),stopBot:z.boolean(),selectedJobId:z.string().max(160).nullable(),
  jobMatches:z.array(jobMatchSchema).max(3),
  facts:z.array(z.object({fieldKey:z.enum(factKeys),value:z.union([z.string().max(1000),z.number(),z.boolean(),z.array(z.string().max(300)).max(30)]),confidence:z.enum(["EXPLICIT","STRONG_INFERENCE"]),evidenceQuote:z.string().trim().min(1).max(1000)})).max(20),
});

function object(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}
function responseText(value:unknown){if(!object(value)||!Array.isArray(value.output))return null;const values:string[]=[];for(const item of value.output)if(object(item)&&Array.isArray(item.content))for(const part of item.content)if(object(part)&&part.type==="output_text"&&typeof part.text==="string")values.push(part.text);return values.join("").trim()||null}
function messageContext(message:{text_content:string|null;attachment_count:number;metadata:unknown}){
  if(typeof message.text_content==="string"&&message.text_content.trim())return message.text_content.slice(0,6000);
  const attachments=object(message.metadata)&&Array.isArray(message.metadata.attachments)?message.metadata.attachments:[];
  const descriptions=attachments.flatMap((value)=>{
    if(!object(value))return[];
    const filename=typeof value.filename==="string"?value.filename.trim():"";
    const contentType=typeof value.contentType==="string"?value.contentType.toLowerCase():"";
    if(contentType.startsWith("image/")||/\bimage\b|\bảnh\b/iu.test(filename))return["ảnh"];
    if(contentType==="application/pdf"||/\.pdf$/iu.test(filename))return[`tài liệu PDF${filename?` (${filename})`:""}`];
    return[`tệp đính kèm${filename?` (${filename})`:""}`];
  });
  return descriptions.length>0?`[${descriptions.join(", ")}]`:`[${message.attachment_count} tệp đính kèm]`;
}
function hasCvEvidence(message:{text_content:string|null;metadata:unknown}){
  return hasRecruiterCvAttachment(message.metadata);
}
function normalizedEvidence(value:string){return value.normalize("NFKC").replace(/\s+/gu," ").trim().toLocaleLowerCase("vi-VN")}
const normalizedMatchText=normalizeRecruiterMatchText;
function mentionsJob(reply:string,job:Record<string,unknown>){const haystack=normalizedMatchText(reply),company=normalizedMatchText(job.company_name);return company.length>=3&&haystack.includes(company)}
function humanizeRecruiterReply(value:string){
  const natural=value
    .replace(/^Em ghi nhận anh (?:không muốn|không còn muốn) ứng tuyển lại ([^.]+)\.\s*/iu,"Mình bỏ qua $1 nhé. ")
    .replace(/^(?:Dạ\s+)?(?:em\s+)?(?:đã\s+)?(?:ghi nhận|hiểu)(?:\s+rồi)?(?:\s+rằng)?[,:]?\s*/iu,"");
  const cleaned=natural
    .replace(/\s*[？]+\s*/gu,"? ")
    .replace(/\s+([.,!])/gu,"$1")
    .replace(/([.!])(?:\s*\1)+/gu,"$1")
    .replace(/\s{2,}/gu," ")
    .trim();
  return cleaned?cleaned[0].toLocaleUpperCase("vi-VN")+cleaned.slice(1):cleaned;
}
function isBareRecruiterGreeting(value:string){return /^(?:hi|hello|chào)(?:\s+(?:em|e|anh|chị))?[!.,\s]*$/iu.test(value.trim())||/^(?:em|e)\s*ơi[!.,\s]*$/iu.test(value.trim())}
function recruiterProfileQuestion(latestText:string,profile:Record<string,unknown>){
  if(!profile.candidate_type)return isBareRecruiterGreeting(latestText)
    ?"Em chào anh ạ, em đang có một vài job IT tiếng Nhật khá tốt cho các hướng BrSE, PM, SE và Developer.\n\nAnh đang quan tâm hướng BrSE, PM hay nghiêng về Dev hơn để em lọc job sát cho anh ạ?"
    :"Dạ được anh ạ, anh đang quan tâm hướng BrSE, PM hay nghiêng về Dev hơn để em lọc job sát cho anh ạ?";
  if(!profile.location)return`Với hướng ${String(profile.candidate_type)}, anh muốn ưu tiên làm ở khu vực nào ạ?`;
  if(!profile.japanese_level)return`Em sẽ lọc theo khu vực ${String(profile.location)}. Anh cho em biết mức tiếng Nhật hiện tại và khả năng trao đổi công việc với khách Nhật nhé?`;
  if(profile.japan_years===undefined||profile.japan_years===null)return"Anh đã từng sống hoặc làm việc tại Nhật chưa ạ? Nếu chưa từng thì em vẫn lọc job ở Việt Nam cho anh được.";
  return null;
}
function clarificationReply(profile:Record<string,unknown>){
  const known=[typeof profile.japanese_level==="string"?profile.japanese_level:null,typeof profile.years_experience==="number"?`${profile.years_experience} năm kinh nghiệm`:null,Array.isArray(profile.primary_skills)?profile.primary_skills.join("/"):null].filter(Boolean).join(", ");
  return`${known?`Với ${known}, `:""}anh chia sẻ giúp em vị trí muốn ưu tiên nhất để em lọc job sát hơn nhé.`;
}

async function generate(input:{model:string;bot:Record<string,unknown>;state:Record<string,unknown>|null;messages:unknown[];jobs:unknown[];stages:unknown[];latestInbound:{text:string;cvEvidence:boolean}}){
  const apiKey=process.env.OPENAI_API_KEY;if(!apiKey)throw new Error("AI_NOT_CONFIGURED");
  const botType=String(input.bot.bot_type??"RECRUITER");
  const roleContext=aiRecruiterPersonaPolicy(botType);
  const schema={type:"object",additionalProperties:false,required:["intent","profileUpdates","replyParts","nextStage","conversationStatus","askedQuestion","handoffRequested","handoffReason","stopBot","selectedJobId","jobMatches","facts"],properties:{intent:{type:"string",enum:["greeting","answer","job_interest","job_rejection","salary_question","process_question","cv_shared","complaint","other"]},profileUpdates:{type:"object",additionalProperties:false,required:["candidate_type","location","japanese_level","japan_years","expected_salary","cv_received"],properties:{candidate_type:{type:["string","null"]},location:{type:["string","null"]},japanese_level:{type:["string","null"]},japan_years:{type:["number","null"]},expected_salary:{type:["string","null"]},cv_received:{type:["boolean","null"]}}},replyParts:{type:"array",minItems:1,maxItems:3,items:{type:"string"}},nextStage:{type:["string","null"]},conversationStatus:{type:"string",enum:["COLLECTING_PROFILE","PROFILE_COMPLETE","OFFERING_JOB","DISCUSSING_PROCESS","WAITING_RECRUITER","COMPLETED","PAUSED"]},askedQuestion:{type:"boolean"},handoffRequested:{type:"boolean"},handoffReason:{type:"string"},stopBot:{type:"boolean"},selectedJobId:{type:["string","null"]},jobMatches:{type:"array",maxItems:3,items:{type:"object",additionalProperties:false,required:["jobId","score","matchedReasons","missingFields","riskFlags"],properties:{jobId:{type:"string"},score:{type:"integer",minimum:0,maximum:100},matchedReasons:{type:"array",maxItems:5,items:{type:"string"}},missingFields:{type:"array",maxItems:8,items:{type:"string"}},riskFlags:{type:"array",maxItems:5,items:{type:"string"}}}}},facts:{type:"array",maxItems:20,items:{type:"object",additionalProperties:false,required:["fieldKey","value","confidence","evidenceQuote"],properties:{fieldKey:{type:"string",enum:factKeys},value:{anyOf:[{type:"string"},{type:"number"},{type:"boolean"},{type:"array",items:{type:"string"},maxItems:30}]},confidence:{type:"string",enum:["EXPLICIT","STRONG_INFERENCE"]},evidenceQuote:{type:"string"}}}}}};
  const recruiterPolicy="Chỉ dùng job được cung cấp; không bịa lương, nhiệm vụ, yêu cầu, quy trình, công ty hoặc cam kết. Có thể giới thiệu sơ bộ một job theo hướng nghề và địa điểm khi ứng viên hỏi; phải ghi rõ missingFields nếu chưa biết điều kiện quan trọng, không khẳng định ứng viên đạt yêu cầu. Trả lời trước, hỏi tối đa một ý liên quan trực tiếp job nếu cần; askedQuestion=false là hợp lệ. Không khai thác tuần tự theo checklist. Chỉ xác nhận phù hợp BrSE khi có bằng chứng BrSE/làm cầu nối, phù hợp quản lý khi có bằng chứng quản lý. Địa điểm đã chọn là ưu tiên cứng. Nếu không có job đúng nhu cầu thì nói rõ chưa có trong danh sách, không thay bằng job trái địa điểm. facts chỉ chứa dữ kiện mới được latestInbound nói rõ, evidenceQuote phải là trích dẫn nguyên văn. jobMatches chỉ chấm job dựa trên bằng chứng; mọi job được nhắc phải có trong jobMatches, selectedJobId là job đang giới thiệu. latestInbound.cvEvidence=false thì cv_received không được true. Khi có CV thật, khiếu nại hoặc tình huống nhạy cảm thì bàn giao người thật.";
  const instructions=`${aiRecruiterSharedPolicy} ${botType==="RECRUITER"?recruiterPolicy:"Bám đúng thứ tự stages được cung cấp. Không tạo jobMatches, không chọn job và không diễn giải người đang chat là ứng viên trừ khi vai trò yêu cầu."} latestInbound có thể gồm nhiều tin liên tiếp: đọc toàn bộ như một câu trả lời. Không hỏi lại dữ kiện đã có trong state.profile hoặc lịch sử; chỉ hỏi làm rõ nếu mâu thuẫn. Trả lời yêu cầu trực tiếp trước, sau đó tối đa một câu hỏi về thông tin còn thiếu. Văn phong recruiter chuyên nghiệp, ngắn gọn, cụ thể, không khen sáo rỗng hoặc khẳng định có job khi chưa có dữ liệu. Trả JSON đúng schema, xưng em và gọi anh/chị theo ngữ cảnh.`;
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:input.model,store:false,max_output_tokens:1900,instructions:`${roleContext} Mỗi lượt chỉ xử lý một mục tiêu và không tự chuyển sang vai trò chatbot khác. ${String(input.bot.extra_rules??"")} ${instructions}`,input:JSON.stringify({bot:input.bot,state:input.state,latestInbound:input.latestInbound,messages:input.messages,jobs:input.jobs,stages:input.stages}).slice(0,90000),text:{format:{type:"json_schema",name:"ai_recruiter_result",strict:true,schema}}}),signal:AbortSignal.timeout(45_000)});
  if(!response.ok)throw new Error("AI_UNAVAILABLE");const raw=responseText(await response.json());if(!raw)throw new Error("AI_INVALID_OUTPUT");return resultSchema.parse(JSON.parse(raw));
}

async function sendGenerationFallback(run:{id:string;workspace_id:string;bot_id:string;conversation_id:string;inbound_message_id:string;mode:string},code:string){
  const db=createPrivilegedClient();
  const [{data:bot},{data:conversation},{data:state},{data:inbound}]=await Promise.all([
    db.from("ai_recruiter_bots").select("id,bot_type,enabled,mode").eq("id",run.bot_id).eq("workspace_id",run.workspace_id).maybeSingle(),
    db.from("omnichannel_conversations").select("id,status,takeover_mode,channel_account_id,metadata").eq("id",run.conversation_id).eq("workspace_id",run.workspace_id).maybeSingle(),
    db.from("ai_recruiter_conversation_states").select("profile,bot_paused,last_inbound_message_id").eq("workspace_id",run.workspace_id).eq("conversation_id",run.conversation_id).maybeSingle(),
    db.from("omnichannel_messages").select("text_content,attachment_count,metadata").eq("workspace_id",run.workspace_id).eq("conversation_id",run.conversation_id).eq("id",run.inbound_message_id).eq("direction","INBOUND").maybeSingle(),
  ]);
  const metadata=conversation?.metadata&&typeof conversation.metadata==="object"&&!Array.isArray(conversation.metadata)?conversation.metadata:{};
  if(!bot?.enabled||bot.mode!=="AUTO"||run.mode!=="AUTO"||!conversation||conversation.takeover_mode!=="BOT_ALLOWED"||!['OPEN','PENDING'].includes(conversation.status)||state?.bot_paused||state?.last_inbound_message_id!==run.inbound_message_id||String(metadata.aiRecruiterModeOverride??"").toUpperCase()!=="AUTO")return false;
  const profile=object(state?.profile)?state.profile:{};
  const matches=Array.isArray(profile.job_matches)?profile.job_matches.filter(object):[];
  const matchedJobId=typeof matches[0]?.jobId==="string"?matches[0].jobId:null;
  const {data:job}=matchedJobId?await db.from("ai_recruiter_jobs").select("external_job_id,company_name,job_title,location,salary_range").eq("workspace_id",run.workspace_id).eq("bot_id",run.bot_id).eq("external_job_id",matchedJobId).eq("active",true).maybeSingle():{data:null};
  let text:string;
  const recruiterFallback=String(bot.bot_type)==="RECRUITER"&&inbound?recruiterProfileQuestion(messageContext(inbound),profile):null;
  if(recruiterFallback){
    text=recruiterFallback;
  }else if(job){
    const salary=job.salary_range?`, mức ${job.salary_range}`:"";
    text=`Em giới thiệu kỹ hơn nhé. Vị trí ${job.job_title} ở ${job.location}${salary}. Anh chia sẻ giúp em thời điểm có thể bắt đầu để em trao đổi bước tiếp theo nhé.`;
  }else if(profile.expected_salary===undefined){
    text="Anh chia sẻ giúp em mức thu nhập mong muốn để em lọc job sát hơn nhé.";
  }else if(profile.availability===undefined){
    text="Anh chia sẻ giúp em thời điểm có thể bắt đầu công việc mới nhé.";
  }else{
    text="Em đang rà lại job phù hợp nhất theo hồ sơ của anh và sẽ trao đổi ngay ở bước tiếp theo nhé.";
  }
  text=withoutQuestionMarks(text);
  await db.from("ai_recruiter_runs").update({status:"DRAFT_READY",proposed_text_parts:[text],safe_error_code:`${code}_FALLBACK`,completed_at:new Date().toISOString()}).eq("id",run.id);
  const proposed=await db.rpc("propose_ai_recruiter_message_service",{p_workspace_id:run.workspace_id,p_run_id:run.id,p_text_content:text,p_part:1});
  if(proposed.error||typeof proposed.data!=="string")return false;
  const loaded=await loadChannelAdapterByAccountId(conversation.channel_account_id),registry=new ChannelAdapterRegistry();registry.register(loaded.adapter);
  const dispatched=await executeChannelOutboundAction(proposed.data,registry);
  await db.from("ai_recruiter_runs").update({status:dispatched.status==="SENT"?"SENT":"QUEUED",safe_error_code:dispatched.status==="SENT"?`${code}_FALLBACK`:dispatched.status==="FAILED"?dispatched.safeErrorCode:"DISPATCH_UNAVAILABLE"}).eq("id",run.id);
  if(dispatched.status==="SENT")await db.from("ai_recruiter_conversation_states").update({last_ai_run_id:run.id}).eq("workspace_id",run.workspace_id).eq("conversation_id",run.conversation_id);
  return dispatched.status==="SENT";
}

async function processRun(run:{id:string;workspace_id:string;bot_id:string;conversation_id:string;inbound_message_id:string;mode:string;input_snapshot?:unknown}){
  const db=createPrivilegedClient(),claimed=await db.from("ai_recruiter_runs").update({status:"RUNNING",started_at:new Date().toISOString()}).eq("id",run.id).eq("status","PENDING").select("id").maybeSingle();if(!claimed.data)return"SKIPPED";
  const aiAttempt=object(run.input_snapshot)&&typeof run.input_snapshot.aiAttempt==="number"?Math.max(0,Math.floor(run.input_snapshot.aiAttempt)):0;
  try{
    const {data:inbound}=await db.from("omnichannel_messages").select("id,direction,text_content,attachment_count,metadata,created_at").eq("workspace_id",run.workspace_id).eq("conversation_id",run.conversation_id).eq("id",run.inbound_message_id).eq("direction","INBOUND").maybeSingle();
    if(!inbound)throw new Error("INBOUND_MESSAGE_UNAVAILABLE");
    if(Date.now()-Date.parse(inbound.created_at)<8000){
      await db.from("ai_recruiter_runs").update({status:"PENDING",started_at:null}).eq("id",run.id);
      return "DEBOUNCED";
    }
    const [{data:bot},{data:conversation},{data:state},{data:messages},{data:jobs},{data:stages}]=await Promise.all([
      db.from("ai_recruiter_bots").select("id,name,bot_type,enabled,mode,model,recruiter_name,company_intro,job_scope,max_jobs_to_offer,extra_rules,reminder_1_minutes").eq("id",run.bot_id).eq("workspace_id",run.workspace_id).maybeSingle(),
      db.from("omnichannel_conversations").select("id,status,takeover_mode,channel_account_id,metadata").eq("id",run.conversation_id).eq("workspace_id",run.workspace_id).maybeSingle(),
      db.from("ai_recruiter_conversation_states").select("status,current_stage,profile,offered_job_ids,bot_paused,last_inbound_message_id").eq("workspace_id",run.workspace_id).eq("conversation_id",run.conversation_id).maybeSingle(),
      db.from("omnichannel_messages").select("id,direction,text_content,attachment_count,metadata,created_at").eq("workspace_id",run.workspace_id).eq("conversation_id",run.conversation_id).lte("created_at",inbound.created_at).order("created_at",{ascending:false}).limit(20),
      db.from("ai_recruiter_jobs").select("external_job_id,priority,sale_stage,company_name,job_title,candidate_type,location,japanese_level_min,japan_years_min,salary_range,process_summary,summary,selling_points,requirements,jd_link,avoid_reason_tags").eq("workspace_id",run.workspace_id).eq("bot_id",run.bot_id).eq("active",true).order("priority").limit(50),
      db.from("ai_recruiter_stages").select("stage_key,stage_name,message_template,next_stage,wait_for_candidate,stop_bot,next_question_field,notes").eq("workspace_id",run.workspace_id).eq("bot_id",run.bot_id).order("sort_order"),
    ]);
    const conversationKind=conversation?.metadata&&typeof conversation.metadata==="object"&&!Array.isArray(conversation.metadata)&&"conversationKind" in conversation.metadata?String(conversation.metadata.conversationKind??"").toUpperCase():"";
    if(!bot?.enabled||!conversation||conversationKind==="GROUP"||state?.bot_paused||state?.last_inbound_message_id!==run.inbound_message_id||conversation.takeover_mode!=="BOT_ALLOWED")throw new Error("BOT_NOT_ELIGIBLE");
    const resetAt=conversation.metadata&&typeof conversation.metadata==="object"&&!Array.isArray(conversation.metadata)&&"aiRecruiterResetAt" in conversation.metadata&&typeof conversation.metadata.aiRecruiterResetAt==="string"?Date.parse(conversation.metadata.aiRecruiterResetAt):Number.NaN;
    const contextMessages=(messages??[]).filter(message=>!Number.isFinite(resetAt)||Date.parse(message.created_at)>=resetAt).reverse().map((message)=>({role:message.direction,text:messageContext(message)}));
    const priorProfile=recoverIntroMemory(contextMessages,object(state?.profile)?state.profile:{});
    const priorRejectedCompanies=new Set((Array.isArray(priorProfile.rejected_companies)?priorProfile.rejected_companies:[]).filter((value):value is string=>typeof value==="string").map(normalizedMatchText));
    const jobsForGeneration=(jobs??[]).filter(job=>eligibleRecruiterJobIds([job],priorRejectedCompanies,priorProfile.management_experience).has(job.external_job_id));
    const inputSnapshot={messageCount:contextMessages.length,jobCount:jobsForGeneration.length,excludedJobCount:(jobs?.length??0)-jobsForGeneration.length,stageCount:stages?.length??0,currentStage:state?.current_stage??null};
    await db.from("ai_recruiter_runs").update({input_snapshot:{...inputSnapshot,aiAttempt}}).eq("id",run.id);
    const anonymousOnly=String(bot.bot_type)==="RECRUITER"&&missingIntroField(priorProfile)!==null;
    const cvEvidence=hasCvEvidence(inbound),latestText=candidateBurst(contextMessages)||messageContext(inbound),noCvYet=candidateExplicitlyHasNoCv(latestText),generated=await generate({model:bot.model,bot,state:{...state,profile:priorProfile},messages:contextMessages,jobs:jobsForGeneration,stages:anonymousOnly?[]:stages??[],latestInbound:{text:latestText,cvEvidence}});
    // A newer candidate message arriving during generation supersedes this run.
    const fresh=await db.from("ai_recruiter_conversation_states").select("last_inbound_message_id,bot_paused").eq("workspace_id",run.workspace_id).eq("conversation_id",run.conversation_id).maybeSingle();
    if(fresh.error||!fresh.data||fresh.data.bot_paused||fresh.data.last_inbound_message_id!==run.inbound_message_id)throw new Error("BOT_NOT_ELIGIBLE");
    const result={...generated,replyParts:[generated.replyParts.join("\n\n")],...(noCvYet?{handoffRequested:false,handoffReason:"",stopBot:false,conversationStatus:"DISCUSSING_PROCESS" as const,nextStage:state?.current_stage??generated.nextStage}:{})};
    if(result.profileUpdates.cv_received===true&&!cvEvidence)throw new Error("AI_INVALID_OUTPUT");
    const normalizedLatest=normalizedEvidence(latestText);
    const supportedFacts=result.facts.filter(fact=>normalizedLatest.includes(normalizedEvidence(fact.evidenceQuote))&&(fact.fieldKey!=="cv_received"||fact.value!==true||cvEvidence));
    // Never trust free-standing profileUpdates from the model. A profile field is
    // persisted only when the model also supplies a verbatim evidence quote that
    // is present in the latest inbound message. This prevents a greeting such as
    // "hi em" from hallucinating a complete candidate profile and skipping the
    // guided recruiter questions.
    const profileBase:Record<string,unknown>={...priorProfile,...Object.fromEntries(supportedFacts.filter(fact=>fact.value!==''&&(!['candidate_type','location','japanese_level'].includes(fact.fieldKey)||typeof fact.value==='string')).map(fact=>[fact.fieldKey,fact.value])),...(noCvYet?{cv_received:false}:{})};
    const offeredJobIds=Array.isArray(state?.offered_job_ids)?state.offered_job_ids.filter((value):value is string=>typeof value==="string"):[];
    const lastOfferedJob=(jobs??[]).find(job=>job.external_job_id===offeredJobIds.at(-1));
    const rejectionKind=String(bot.bot_type)==="RECRUITER"?recruiterRejectionKind(latestText):"NONE";
    if(rejectionKind==="KNOWN_REASON"&&lastOfferedJob?.company_name){const rejected=Array.isArray(profileBase.rejected_companies)?profileBase.rejected_companies.filter((value):value is string=>typeof value==="string"):[];profileBase.rejected_companies=[...new Set([...rejected,lastOfferedJob.company_name])];}
    const rejectionOverride=String(bot.bot_type)==="RECRUITER"?recruiterRejectionOverride({text:latestText,lastSaleStage:lastOfferedJob?.sale_stage}):null;
    const rejectedCompanies=new Set((Array.isArray(profileBase.rejected_companies)?profileBase.rejected_companies:[]).filter((value):value is string=>typeof value==="string").map(normalizedEvidence));
    const validJobIds=new Set((jobs??[]).map(job=>job.external_job_id));
    const eligibleJobIds=eligibleRecruiterJobIds(jobs??[],rejectedCompanies,profileBase.management_experience);
    let jobMatches=result.jobMatches.filter(match=>validJobIds.has(match.jobId)&&eligibleJobIds.has(match.jobId)).sort((a,b)=>b.score-a.score).slice(0,Math.min(bot.max_jobs_to_offer,3));
    const hasCoreProfile=missingIntroField(profileBase)===null;
    // Let the grounded model answer the candidate's request, rather than replacing
    // every reply with the next checklist question. Keep only the greeting guide.
    const guidedCollection=String(bot.bot_type)==="RECRUITER"&&!rejectionOverride&&!result.handoffRequested&&!result.stopBot?initialRecruiterOpening(contextMessages,profileBase):null;
    const preferredPrimaryLocations=[...(Array.isArray(profileBase.preferred_locations)?profileBase.preferred_locations:[]),profileBase.location]
      .filter((value):value is string=>typeof value==="string").map(normalizedMatchText).filter(Boolean);
    const primaryJob=String(bot.bot_type)!=="RECRUITER"&&offeredJobIds.length===0&&hasCoreProfile?(jobs??[])
      .filter(job=>job.sale_stage==="first_job"&&eligibleJobIds.has(job.external_job_id)&&preferredPrimaryLocations.some(location=>{const jobLocation=normalizedMatchText(job.location);return jobLocation.includes(location)||location.includes(jobLocation)}))
      .sort((a,b)=>(a.priority??999)-(b.priority??999)||a.external_job_id.localeCompare(b.external_job_id))[0]:null;
    let guidedPrimary:string|null=null;
    if(primaryJob){jobMatches=[{jobId:primaryJob.external_job_id,score:90,matchedReasons:["Đủ hướng nghề nghiệp, địa điểm và năng lực tiếng Nhật"],missingFields:[],riskFlags:[]}];const salary=primaryJob.salary_range?`, range ${primaryJob.salary_range}`:"";guidedPrimary=`Em có vị trí ${primaryJob.job_title} của ${primaryJob.company_name}, làm việc ở ${primaryJob.location}${salary}. Anh xem hướng này có phù hợp với mình không nhé.`;}
    let guidedAlternative:string|null=null;
    if(String(bot.bot_type)!=="RECRUITER"&&hasCoreProfile&&!rejectionOverride&&["job_rejection","job_interest","answer"].includes(result.intent)&&jobMatches.length===0){
      const preferredLocations=(Array.isArray(profileBase.preferred_locations)?profileBase.preferred_locations:[]).filter((value):value is string=>typeof value==="string").map(normalizedMatchText).filter(Boolean);
      const locationCandidates=[...preferredLocations.reverse(),normalizedMatchText(profileBase.location)].filter(Boolean);
      const candidateType=normalizedMatchText(profileBase.candidate_type);
      const alternative=(jobs??[]).filter(job=>eligibleJobIds.has(job.external_job_id)&&locationCandidates.some(location=>normalizedMatchText(job.location).includes(location))&&(!candidateType||normalizedMatchText(`${job.job_title??""} ${job.requirements??""}`).includes(candidateType))).sort((a,b)=>(a.priority??999)-(b.priority??999))[0];
      if(alternative){
        const needsManagement=isManagementRecruiterJob(alternative)&&!profileBase.management_experience;
        jobMatches=[{jobId:alternative.external_job_id,score:needsManagement?72:82,matchedReasons:[`Đúng định hướng ${String(profileBase.candidate_type??"ứng viên")}`,`Đúng địa điểm ${String(alternative.location??profileBase.location??"")}`],missingFields:needsManagement?["management_experience"]:[],riskFlags:needsManagement?["Cần xác nhận kinh nghiệm quản lý dự án"]:[]}];
        const salary=typeof alternative.salary_range==="string"&&alternative.salary_range.trim()?`, range ${alternative.salary_range.trim()}`:"";
        guidedAlternative=needsManagement?`Em còn vị trí ${alternative.job_title} tại ${alternative.company_name} ở ${alternative.location}${salary}. Bên này cần kinh nghiệm quản lý dự án; anh chia sẻ giúp em phần này nhé.`:`Em còn vị trí ${alternative.job_title} tại ${alternative.company_name} ở ${alternative.location}${salary}. Anh xem hướng này có phù hợp với mình không nhé.`;
      }
    }
    const learnedSalary=supportedFacts.some(fact=>fact.fieldKey==="expected_salary")||result.profileUpdates.expected_salary!==null;
    const selectedMatchJob=(jobs??[]).find(job=>job.external_job_id===(jobMatches[0]?.jobId??result.selectedJobId));
    const guidedAvailability=String(bot.bot_type)!=="RECRUITER"&&learnedSalary?availabilityFollowup(profileBase.expected_salary,profileBase.availability,selectedMatchJob?.company_name):null;
    const selectedJobId=(guidedPrimary||guidedAlternative)?jobMatches[0]?.jobId??null:result.selectedJobId&&validJobIds.has(result.selectedJobId)&&jobMatches.some(match=>match.jobId===result.selectedJobId)?result.selectedJobId:null;
    const replyParts=rejectionOverride?[rejectionOverride.reply]:guidedPrimary?[guidedPrimary]:guidedCollection?[guidedCollection]:guidedAvailability?[guidedAvailability]:guidedAlternative?[guidedAlternative]:result.replyParts;
    const unsupportedOffer=(jobs??[]).some(job=>mentionsJob(replyParts.join(" "),job)&&!jobMatches.some(match=>match.jobId===job.external_job_id));
    const disclosureBlocked=String(bot.bot_type)==="RECRUITER"&&!hasCoreProfile;
    // Collect the four introductory facts before offering even anonymous jobs.
    // Keep the approved opening and ground each subsequent question in known facts.
    const introReply=disclosureBlocked&&!rejectionOverride&&!result.handoffRequested&&!result.stopBot?guidedCollection??approvedIntroReply(profileBase,jobsForGeneration):null;
    const gatedParts=introReply?[introReply]:unsupportedOffer?[clarificationReply(profileBase)]:replyParts;
    const safeReplyParts=(guidedCollection?[guidedCollection]:shapeReply(gatedParts.map(humanizeRecruiterReply),run.id)).map(withoutQuestionMarks);
    const verifiedResult={...result,...(rejectionOverride?{selectedJobId:null,jobMatches:[],replyParts:safeReplyParts,askedQuestion:!rejectionOverride.stopBot,stopBot:rejectionOverride.stopBot,handoffRequested:false,handoffReason:rejectionOverride.notification??"",conversationStatus:rejectionOverride.stopBot?"PAUSED" as const:"DISCUSSING_PROCESS" as const}: {selectedJobId:unsupportedOffer?null:selectedJobId,jobMatches:unsupportedOffer?[]:jobMatches,replyParts:safeReplyParts}),...(disclosureBlocked?{selectedJobId:null,jobMatches:[],...(introReply?{askedQuestion:true,conversationStatus:"COLLECTING_PROFILE" as const,nextStage:`intro_${missingIntroField(profileBase)}`}:{})}:{})};
    const profile={...profileBase,job_matches:verifiedResult.jobMatches};
    await db.from("ai_recruiter_runs").update({status:"DRAFT_READY",output_json:verifiedResult,proposed_text_parts:safeReplyParts,completed_at:new Date().toISOString()}).eq("id",run.id);
    const nextOfferedJobIds=verifiedResult.selectedJobId?[...new Set([...offeredJobIds,verifiedResult.selectedJobId])]:offeredJobIds;
    await db.from("ai_recruiter_conversation_states").update({status:verifiedResult.conversationStatus,current_stage:verifiedResult.nextStage,profile,offered_job_ids:nextOfferedJobIds,last_ai_run_id:run.id,bot_paused:verifiedResult.stopBot||verifiedResult.handoffRequested,pause_reason:verifiedResult.handoffReason||null,next_followup_at:verifiedResult.askedQuestion?new Date(Date.now()+bot.reminder_1_minutes*60000).toISOString():null}).eq("workspace_id",run.workspace_id).eq("conversation_id",run.conversation_id);
    if(supportedFacts.length>0)await db.from("ai_recruiter_candidate_facts").upsert(supportedFacts.map(fact=>({workspace_id:run.workspace_id,bot_id:run.bot_id,conversation_id:run.conversation_id,field_key:fact.fieldKey,field_value:fact.value,confidence:fact.confidence,evidence_quote:fact.evidenceQuote,source_message_id:(messages??[]).find(message=>message.direction==="INBOUND"&&normalizedEvidence(messageContext(message)).includes(normalizedEvidence(fact.evidenceQuote)))?.id??run.inbound_message_id,source_run_id:run.id})),{onConflict:"workspace_id,conversation_id,field_key"});
    if(result.handoffRequested)await db.from("omnichannel_conversations").update({takeover_mode:"HUMAN_TAKEOVER"}).eq("workspace_id",run.workspace_id).eq("id",run.conversation_id).eq("takeover_mode","BOT_ALLOWED");
    if(verifiedResult.askedQuestion&&!verifiedResult.stopBot&&!verifiedResult.handoffRequested)await db.from("ai_recruiter_scheduled_actions").insert({workspace_id:run.workspace_id,bot_id:run.bot_id,conversation_id:run.conversation_id,run_id:run.id,action_type:"REMINDER_1",due_at:new Date(Date.now()+bot.reminder_1_minutes*60000).toISOString(),idempotency_key:`run:${run.id}:reminder:1`,payload:{stage:verifiedResult.nextStage}});
    const metadata=conversation.metadata&&typeof conversation.metadata==="object"&&!Array.isArray(conversation.metadata)?conversation.metadata:{};
    const autoAuthorized=run.mode==="AUTO"&&bot.mode==="AUTO"&&String(metadata.aiRecruiterModeOverride??"").toUpperCase()==="AUTO";
    let autoCooldown=false;
    if(autoAuthorized){const {data:recent}=await db.from("channel_outbound_actions").select("id").eq("workspace_id",run.workspace_id).eq("conversation_id",run.conversation_id).eq("dispatch_source","AI_AUTOMATION").eq("status","SENT").gte("updated_at",new Date(Date.now()-20_000).toISOString()).limit(1).maybeSingle();autoCooldown=Boolean(recent);}
    const terminalReply=Boolean(rejectionOverride?.stopBot);
    if(autoAuthorized&&autoCooldown&&!verifiedResult.handoffRequested&&!verifiedResult.stopBot){
      await db.from("ai_recruiter_runs").update({status:"QUEUED",safe_error_code:"AUTO_COOLDOWN",completed_at:null}).eq("id",run.id);
      return "QUEUED";
    }
    if((run.mode==="DRAFT"||!autoAuthorized||autoCooldown)&&!verifiedResult.handoffRequested&&(!verifiedResult.stopBot||terminalReply)){for(const [index,part] of safeReplyParts.entries())await db.rpc("propose_ai_recruiter_draft_service",{p_workspace_id:run.workspace_id,p_run_id:run.id,p_text_content:part,p_part:index+1});if(autoCooldown)await db.from("ai_recruiter_runs").update({safe_error_code:"AUTO_COOLDOWN"}).eq("id",run.id);}
    if(autoAuthorized&&!autoCooldown&&!verifiedResult.handoffRequested&&(!verifiedResult.stopBot||terminalReply)){let sent=true;for(const [index,part] of safeReplyParts.entries()){const proposed=await db.rpc("propose_ai_recruiter_message_service",{p_workspace_id:run.workspace_id,p_run_id:run.id,p_text_content:part,p_part:index+1});if(proposed.error||typeof proposed.data!=="string"){sent=false;break}const loaded=await loadChannelAdapterByAccountId(conversation.channel_account_id),registry=new ChannelAdapterRegistry();registry.register(loaded.adapter);const dispatched=await executeChannelOutboundAction(proposed.data,registry);if(dispatched.status!=="SENT"){sent=false;break}}await db.from("ai_recruiter_runs").update({status:sent?"SENT":"QUEUED"}).eq("id",run.id);return sent?"SENT":"QUEUED";}
    return"DRAFT_READY";
  }catch(error){
    const code=error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:"AI_RECRUITER_FAILED";
    if(code!=="BOT_NOT_ELIGIBLE"&&aiAttempt<2){
      await db.from("ai_recruiter_runs").update({status:"PENDING",safe_error_code:code,input_snapshot:{aiAttempt:aiAttempt+1},started_at:null,completed_at:null}).eq("id",run.id);
      return"RETRY_QUEUED";
    }
    if(code!=="BOT_NOT_ELIGIBLE"&&await sendGenerationFallback(run,code).catch(()=>false))return"SENT";
    await db.from("ai_recruiter_runs").update({status:code==="BOT_NOT_ELIGIBLE"?"SKIPPED":"FAILED",safe_error_code:code,completed_at:new Date().toISOString()}).eq("id",run.id);return"FAILED";
  }
}

export async function processPendingAiRecruiterRuns(limit=10){const db=createPrivilegedClient(),{data,error}=await db.from("ai_recruiter_runs").select("id,workspace_id,bot_id,conversation_id,inbound_message_id,mode,input_snapshot").eq("status","PENDING").order("created_at").limit(Math.min(Math.max(limit,1),25));if(error)return{processed:0,failed:0};let processed=0,failed=0;for(const run of data??[]){const result=await processRun(run);processed+=1;if(result==="FAILED")failed+=1}return{processed,failed};}

export async function resumeQueuedAiRecruiterRuns(limit=10,runId?:string){
  const db=createPrivilegedClient();
  let query=db.from("ai_recruiter_runs")
    .select("id,workspace_id,bot_id,conversation_id,inbound_message_id,mode,proposed_text_parts")
    .eq("status","QUEUED").eq("mode","AUTO").order("created_at").limit(Math.min(Math.max(limit,1),25));
  if(runId)query=query.eq("id",runId);
  const {data,error}=await query;
  if(error)return{processed:0,sent:0};let processed=0,sent=0;
  for(const run of data??[]){
    const claimed=await db.from("ai_recruiter_runs").update({status:"RUNNING"}).eq("id",run.id).eq("status","QUEUED").select("id").maybeSingle();
    if(!claimed.data)continue;processed+=1;
    const [stateResult,conversationResult,actionsResult,botResult]=await Promise.all([
      db.from("ai_recruiter_conversation_states").select("last_inbound_message_id,bot_paused").eq("workspace_id",run.workspace_id).eq("conversation_id",run.conversation_id).maybeSingle(),
      db.from("omnichannel_conversations").select("channel_account_id,status,takeover_mode,metadata").eq("workspace_id",run.workspace_id).eq("id",run.conversation_id).maybeSingle(),
      db.from("channel_outbound_actions").select("id,status,idempotency_key,updated_at,safe_error_code").eq("workspace_id",run.workspace_id).eq("conversation_id",run.conversation_id).like("idempotency_key",`ai-recruiter:${run.id}:part:%`).order("updated_at",{ascending:false}),
      db.from("ai_recruiter_bots").select("enabled,mode").eq("workspace_id",run.workspace_id).eq("id",run.bot_id).maybeSingle(),
    ]);
    if([stateResult,conversationResult,actionsResult,botResult].some(result=>result.error)){
      await db.from("ai_recruiter_runs").update({status:"QUEUED",safe_error_code:"RESUME_READ_FAILED"}).eq("id",run.id).eq("status","RUNNING");continue;
    }
    const state=stateResult.data,conversation=conversationResult.data,actions=actionsResult.data,bot=botResult.data;
    const metadata=object(conversation?.metadata)?conversation.metadata:{};
    if(!bot?.enabled||bot.mode!=="AUTO"||metadata.aiRecruiterModeOverride!=="AUTO"){
      await db.from("ai_recruiter_runs").update({status:"DRAFT_READY",safe_error_code:"AUTO_NOT_AUTHORIZED"}).eq("id",run.id).eq("status","RUNNING");continue;
    }
    if(!state||state.bot_paused||state.last_inbound_message_id!==run.inbound_message_id||!conversation||conversation.takeover_mode!=="BOT_ALLOWED"||!["OPEN","PENDING"].includes(conversation.status)){
      await db.from("ai_recruiter_runs").update({status:"SKIPPED",safe_error_code:"SUPERSEDED_OR_PAUSED",completed_at:new Date().toISOString()}).eq("id",run.id).eq("status","RUNNING");continue;
    }
    const latestSent=(actions??[]).find(action=>action.status==="SENT");
    if(latestSent&&Date.now()-Date.parse(latestSent.updated_at)<65_000){await db.from("ai_recruiter_runs").update({status:"QUEUED"}).eq("id",run.id).eq("status","RUNNING");continue;}
    const {data:recentSend,error:recentError}=await db.from("channel_outbound_actions").select("id").eq("workspace_id",run.workspace_id).eq("conversation_id",run.conversation_id).eq("dispatch_source","AI_AUTOMATION").eq("status","SENT").gte("updated_at",new Date(Date.now()-20_000).toISOString()).limit(1).maybeSingle();
    if(recentError||recentSend){await db.from("ai_recruiter_runs").update({status:"QUEUED"}).eq("id",run.id).eq("status","RUNNING");continue;}
    const parts=Array.isArray(run.proposed_text_parts)?run.proposed_text_parts.filter((part):part is string=>typeof part==="string"&&part.trim().length>0):[];
    let nextIndex=-1;
    for(let index=0;index<parts.length;index++){
      const base=`ai-recruiter:${run.id}:part:${index+1}`;
      const related=(actions??[]).filter(action=>typeof action.idempotency_key==="string"&&(action.idempotency_key===base||action.idempotency_key.startsWith(`${base}:retry:`)));
      if(related.some(action=>action.status==="SENT"))continue;
      if(related.some(action=>action.status==="DELIVERY_UNKNOWN")){nextIndex=-2;break;}
      if(related.length===0){nextIndex=index;break;}
      nextIndex=-2;break;
    }
    if(nextIndex===-1){await db.from("ai_recruiter_runs").update({status:"SENT",safe_error_code:null,completed_at:new Date().toISOString()}).eq("id",run.id).eq("status","RUNNING");sent+=1;continue;}
    if(nextIndex<0){await db.from("ai_recruiter_runs").update({status:"QUEUED"}).eq("id",run.id).eq("status","RUNNING");continue;}
    const proposed=await db.rpc("propose_ai_recruiter_message_service",{p_workspace_id:run.workspace_id,p_run_id:run.id,p_text_content:parts[nextIndex],p_part:nextIndex+1});
    if(proposed.error||typeof proposed.data!=="string"){await db.from("ai_recruiter_runs").update({status:"QUEUED"}).eq("id",run.id).eq("status","RUNNING");continue;}
    try{
      const loaded=await loadChannelAdapterByAccountId(conversation.channel_account_id),registry=new ChannelAdapterRegistry();registry.register(loaded.adapter);
      const dispatched=await executeChannelOutboundAction(proposed.data,registry);
      await db.from("ai_recruiter_runs").update({status:dispatched.status==="SENT"&&nextIndex===parts.length-1?"SENT":"QUEUED",safe_error_code:dispatched.status==="FAILED"?dispatched.safeErrorCode:null,completed_at:dispatched.status==="SENT"&&nextIndex===parts.length-1?new Date().toISOString():null}).eq("id",run.id).eq("status","RUNNING");
      if(dispatched.status==="SENT")sent+=1;
    }catch{await db.from("ai_recruiter_runs").update({status:"QUEUED",safe_error_code:"DISPATCH_UNAVAILABLE"}).eq("id",run.id).eq("status","RUNNING");}
  }
  return{processed,sent};
}
