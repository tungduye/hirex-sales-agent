const url=process.env.NEXT_PUBLIC_SUPABASE_URL??process.env["\uFEFFNEXT_PUBLIC_SUPABASE_URL"],key=process.env.SUPABASE_SECRET_KEY;
if(!url||!key)throw new Error("Missing Supabase environment");
const phase=process.argv[2];
if(!["phuong","tung","off"].includes(phase))throw new Error("Usage: phuong|tung|off [conversationId]");
const ids={phuong:"f0051a1f-ac43-4d10-8cd7-86cffcb35fd6",tung:"f092425a-23e9-40fe-9653-860f8eff2891"};
const botId="deba8749-586a-460e-a49c-6129f1a02115",workspaceId="da7cef02-036a-4ee9-b3d7-5c7df54c73a0";
const headers={apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"};
const request=async(path,options={})=>{const response=await fetch(`${url}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers}});if(!response.ok)throw new Error(`${options.method??"GET"} ${response.status}: ${await response.text()}`);return response.text()};
await request(`ai_recruiter_channel_bindings?channel_account_id=in.(${ids.phuong},${ids.tung})`,{method:"PATCH",body:JSON.stringify({enabled:false})});
if(phase==="off"){
  for(const conversationId of ["60c1d5c0-cdaf-4aaa-b3c1-cbf5bc59cbc0","7edacbe5-5a1a-40f2-a620-0bcb723f8495"]){
    const rows=JSON.parse(await request(`omnichannel_conversations?id=eq.${conversationId}&select=id,metadata`));
    const conversation=rows[0];
    if(conversation)await request(`omnichannel_conversations?id=eq.${conversationId}`,{method:"PATCH",body:JSON.stringify({metadata:{...(conversation.metadata??{}),aiRecruiterModeOverride:"DRAFT"}})});
    await request(`ai_recruiter_scheduled_actions?conversation_id=eq.${conversationId}&status=in.(PENDING,CLAIMED)`,{method:"PATCH",body:JSON.stringify({status:"CANCELLED",completed_at:new Date().toISOString()})});
    await request(`ai_recruiter_conversation_states?conversation_id=eq.${conversationId}`,{method:"PATCH",body:JSON.stringify({status:"PAUSED",bot_paused:true,pause_reason:"MANUAL_TEST_STOP",next_followup_at:null})});
  }
}
if(phase!=="off"){
  const accountId=ids[phase];
  await request("ai_recruiter_channel_bindings?on_conflict=workspace_id,channel_account_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates"},body:JSON.stringify({workspace_id:workspaceId,bot_id:botId,channel_account_id:accountId,enabled:true,created_at:new Date().toISOString()})});
}
const conversationId=process.argv[3];
if(conversationId){
  const rows=JSON.parse(await request(`omnichannel_conversations?id=eq.${conversationId}&select=id,metadata,channel_account_id`));
  const conversation=rows[0];
  if(!conversation||conversation.channel_account_id!==ids[phase])throw new Error("Conversation/account mismatch");
  await request(`omnichannel_conversations?id=eq.${conversationId}`,{method:"PATCH",body:JSON.stringify({takeover_mode:"BOT_ALLOWED",metadata:{...(conversation.metadata??{}),aiRecruiterModeOverride:"AUTO",aiRecruiterResetAt:new Date().toISOString()}})});
  await request(`ai_recruiter_conversation_states?conversation_id=eq.${conversationId}`,{method:"PATCH",body:JSON.stringify({status:"COLLECTING_PROFILE",current_stage:null,profile:{},offered_job_ids:[],last_inbound_message_id:null,last_ai_run_id:null,bot_paused:false,pause_reason:null,next_followup_at:null})});
}
console.log(JSON.stringify({phase,conversationId:conversationId??null}));
