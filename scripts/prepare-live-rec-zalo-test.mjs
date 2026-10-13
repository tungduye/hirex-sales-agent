const url=process.env.NEXT_PUBLIC_SUPABASE_URL??process.env["\uFEFFNEXT_PUBLIC_SUPABASE_URL"],key=process.env.SUPABASE_SECRET_KEY;
if(!url||!key)throw new Error("Missing Supabase environment");
const headers={apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json",Prefer:"return=representation"};
const get=path=>fetch(`${url}/rest/v1/${path}`,{headers}).then(async r=>{if(!r.ok)throw new Error(`GET ${r.status}`);return r.json()});
const patch=(path,body)=>fetch(`${url}/rest/v1/${path}`,{method:"PATCH",headers,body:JSON.stringify(body)}).then(async r=>{if(!r.ok)throw new Error(`PATCH ${r.status}`);return r.json()});
const [bot]=await get("ai_recruiter_bots?bot_type=eq.RECRUITER&select=id,workspace_id&limit=1");
if(!bot)throw new Error("Recruiter bot not found");
const accounts=await get(`channel_accounts?workspace_id=eq.${bot.workspace_id}&channel_type=eq.ZALO&select=id,display_name,status`);
const linh=accounts.find(a=>/hoàng linh trang/iu.test(a.display_name??""));
if(!linh||linh.status!=="CONNECTED")throw new Error("Hoàng Linh Trang is not connected");
const conversations=await get(`omnichannel_conversations?workspace_id=eq.${bot.workspace_id}&channel_account_id=eq.${linh.id}&select=id,metadata`);
const conversation=conversations.find(c=>/hoang toan/iu.test(JSON.stringify(c.metadata??{})));
if(!conversation)throw new Error("Hoang Toan conversation not found on Hoàng Linh Trang");
// Keep the live AUTO test isolated to Hoàng Linh Trang. The Recruiter bot is a
// shared switch, so every other binding must be disabled before enabling it.
await patch(`ai_recruiter_channel_bindings?bot_id=eq.${bot.id}&channel_account_id=neq.${linh.id}`,{enabled:false});
await patch(`ai_recruiter_bots?id=eq.${bot.id}&workspace_id=eq.${bot.workspace_id}`,{enabled:true,mode:"AUTO"});
await patch(`ai_recruiter_channel_bindings?bot_id=eq.${bot.id}&channel_account_id=eq.${linh.id}`,{enabled:true,created_at:new Date().toISOString()});
await patch(`omnichannel_conversations?id=eq.${conversation.id}&workspace_id=eq.${bot.workspace_id}`,{takeover_mode:"BOT_ALLOWED",status:"OPEN",metadata:{...(conversation.metadata??{}),aiRecruiterModeOverride:"AUTO",aiRecruiterResetAt:new Date().toISOString()}});
await patch(`ai_recruiter_conversation_states?conversation_id=eq.${conversation.id}&workspace_id=eq.${bot.workspace_id}`,{status:"COLLECTING_PROFILE",current_stage:null,profile:{},offered_job_ids:[],last_inbound_message_id:null,last_ai_run_id:null,bot_paused:false,pause_reason:null,next_followup_at:null});
console.log(JSON.stringify({ready:true,bot:"Recruiter",sender:"Hoàng Linh Trang",candidate:"Hoang Toan"}));
