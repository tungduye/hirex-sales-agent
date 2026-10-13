import env from '@next/env';
import {createClient} from '@supabase/supabase-js';
import {mkdir,writeFile} from 'node:fs/promises';
env.loadEnvConfig(process.cwd());
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY);
const workspace='da7cef02-036a-4ee9-b3d7-5c7df54c73a0';
const ids=['660ea7ef-94dd-4186-8753-a95268eb4134','57b5496f-f598-48d5-833d-8c84aeb4137e','c094b391-c6f6-4adc-a25f-ea1ccbc354c9'];
async function checked(query){const result=await query;if(result.error)throw new Error(result.error.code);return result.data;}
const snapshot={};
const sending=await checked(db.from('channel_outbound_actions').select('id').eq('workspace_id',workspace).in('conversation_id',ids).eq('status','SENDING'));
if(sending.length)throw new Error('WAIT_FOR_ACTIVE_CHAT_SEND');
for(const table of ['omnichannel_conversations','ai_recruiter_conversation_states','ai_recruiter_candidate_facts'])snapshot[table]=await checked(db.from(table).select('*').eq('workspace_id',workspace).in(table==='omnichannel_conversations'?'id':'conversation_id',ids));
if(snapshot.omnichannel_conversations.length!==3||snapshot.ai_recruiter_conversation_states.length!==3)throw new Error('TARGET_MISMATCH');
await mkdir('outputs/recruiter-test-reset',{recursive:true});
const now=new Date().toISOString();
await writeFile(`outputs/recruiter-test-reset/${Date.now()}.json`,JSON.stringify(snapshot,null,2));
// Pause first so a running generation fails its pre-dispatch eligibility check.
await checked(db.from('ai_recruiter_conversation_states').update({bot_paused:true,last_inbound_message_id:null}).eq('workspace_id',workspace).in('conversation_id',ids));
await checked(db.from('ai_recruiter_runs').update({status:'SKIPPED',safe_error_code:'TEST_RESET',completed_at:now}).eq('workspace_id',workspace).in('conversation_id',ids).in('status',['PENDING','QUEUED','RUNNING']));
await checked(db.from('ai_recruiter_scheduled_actions').update({status:'CANCELLED',completed_at:now}).eq('workspace_id',workspace).in('conversation_id',ids).in('status',['PENDING','CLAIMED']));
await checked(db.from('ai_recruiter_candidate_facts').delete().eq('workspace_id',workspace).in('conversation_id',ids));
for(const conversation of snapshot.omnichannel_conversations)await checked(db.from('omnichannel_conversations').update({metadata:{...conversation.metadata,aiRecruiterResetAt:now}}).eq('workspace_id',workspace).eq('id',conversation.id));
await checked(db.from('ai_recruiter_conversation_states').update({status:'COLLECTING_PROFILE',current_stage:null,profile:{},offered_job_ids:[],last_inbound_message_id:null,last_ai_run_id:null,bot_paused:false,pause_reason:null,next_followup_at:null}).eq('workspace_id',workspace).in('conversation_id',ids));
const states=await checked(db.from('ai_recruiter_conversation_states').select('conversation_id,profile,last_inbound_message_id,bot_paused').eq('workspace_id',workspace).in('conversation_id',ids));
console.log(JSON.stringify({reset:states.length,verified:states.every(s=>Object.keys(s.profile).length===0&&s.last_inbound_message_id===null&&!s.bot_paused),historyPreserved:true}));
