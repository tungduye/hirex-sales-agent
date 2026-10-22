import "server-only";
import { createPrivilegedClient } from "@/lib/supabase/privileged";

export async function enqueueAiRecruiterInbound(input:{workspaceId:string;channelAccountId:string;conversationId:string;messageId:string;retryExisting?:boolean}){
  const db=createPrivilegedClient();
  // The nick's bot, unless the conversation picked its own Phiên bản AI in Suối Nguồn (metadata.aiRecruiterBotId).
  const [{data:binding,error},{data:conversation}]=await Promise.all([
    db.from("ai_recruiter_channel_bindings").select("bot_id,created_at").eq("workspace_id",input.workspaceId).eq("channel_account_id",input.channelAccountId).eq("enabled",true).maybeSingle(),
    db.from("omnichannel_conversations").select("status,takeover_mode,metadata").eq("id",input.conversationId).eq("workspace_id",input.workspaceId).maybeSingle(),
  ]);
  const conversationMetadata=conversation?.metadata&&typeof conversation.metadata==="object"&&!Array.isArray(conversation.metadata)?conversation.metadata as Record<string,unknown>:null;
  const chosenBotId=typeof conversationMetadata?.aiRecruiterBotId==="string"?conversationMetadata.aiRecruiterBotId:null;
  const chosenSince=typeof conversationMetadata?.aiRecruiterBotSince==="string"?conversationMetadata.aiRecruiterBotSince:null;
  const botId=chosenBotId??(error?null:binding?.bot_id??null);
  // Only messages that arrived after the bot was attached (to the nick, or chosen for this conversation).
  const since=chosenBotId?chosenSince:binding?.created_at??null;
  if(!botId||!since)return{queued:false};
  const [{data:bot},{data:state},{data:message}]=await Promise.all([
    db.from("ai_recruiter_bots").select("id,enabled,mode").eq("id",botId).eq("workspace_id",input.workspaceId).eq("enabled",true).maybeSingle(),
    db.from("ai_recruiter_conversation_states").select("bot_paused").eq("workspace_id",input.workspaceId).eq("conversation_id",input.conversationId).maybeSingle(),
    db.from("omnichannel_messages").select("id,created_at,direction").eq("workspace_id",input.workspaceId).eq("conversation_id",input.conversationId).eq("id",input.messageId).maybeSingle(),
  ]);
  const conversationKind=conversationMetadata&&"conversationKind" in conversationMetadata?String(conversationMetadata.conversationKind??"").toUpperCase():"";
  const modeOverride=conversationMetadata&&"aiRecruiterModeOverride" in conversationMetadata?String(conversationMetadata.aiRecruiterModeOverride??"").toUpperCase():"";
  // AUTO requires two explicit switches: the bot and the individual conversation.
  // Missing/unknown metadata always falls back to DRAFT.
  const runMode=bot?.mode==="AUTO"&&modeOverride==="AUTO"?"AUTO":"DRAFT";
  if(!bot||!conversation||!message||message.direction!=="INBOUND"||Date.parse(message.created_at)<Date.parse(since)||conversationKind==="GROUP"||state?.bot_paused||!['OPEN','PENDING'].includes(conversation.status)||conversation.takeover_mode!=="BOT_ALLOWED")return{queued:false};
  await db.from("ai_recruiter_scheduled_actions").update({status:"CANCELLED",completed_at:new Date().toISOString()}).eq("workspace_id",input.workspaceId).eq("conversation_id",input.conversationId).eq("status","PENDING");
  const inserted=await db.from("ai_recruiter_runs").upsert({workspace_id:input.workspaceId,bot_id:bot.id,conversation_id:input.conversationId,inbound_message_id:input.messageId,status:"PENDING",mode:runMode,input_snapshot:{}},{onConflict:"workspace_id,bot_id,inbound_message_id",ignoreDuplicates:true}).select("id").maybeSingle();
  if(inserted.error)return{queued:false};
  let runId=inserted.data?.id as string|undefined;
  if(!runId&&input.retryExisting){
    const retried=await db.from("ai_recruiter_runs").update({status:"PENDING",mode:runMode,input_snapshot:{},output_json:null,proposed_text_parts:[],safe_error_code:null,started_at:null,completed_at:null}).eq("workspace_id",input.workspaceId).eq("bot_id",bot.id).eq("inbound_message_id",input.messageId).in("status",["DRAFT_READY","FAILED","SKIPPED"]).select("id").maybeSingle();
    if(retried.error||!retried.data)return{queued:false};
    runId=retried.data.id as string;
  }
  if(!runId)return{queued:false};
  if(!state)await db.from("ai_recruiter_conversation_states").insert({workspace_id:input.workspaceId,bot_id:bot.id,conversation_id:input.conversationId,last_inbound_message_id:input.messageId});
  else await db.from("ai_recruiter_conversation_states").update({last_inbound_message_id:input.messageId}).eq("workspace_id",input.workspaceId).eq("conversation_id",input.conversationId);
  return{queued:true,runId};
}
