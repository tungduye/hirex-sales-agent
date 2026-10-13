import env from '@next/env';
import {createClient} from '@supabase/supabase-js';
import {mkdir,writeFile} from 'node:fs/promises';
env.loadEnvConfig(process.cwd());
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY);
const workspace='da7cef02-036a-4ee9-b3d7-5c7df54c73a0';
// Nguyen Ha Vy already entered AUTO and attempted delivery; never retry it here.
const ids=['5c819b9d-4954-4b2b-b962-07bb7ca954ba','039b528c-8092-4647-9d22-a19742612506'];
async function checked(q){const r=await q;if(r.error)throw Error(r.error.code||r.error.message);return r.data;}
const plans=[];
for(const id of ids){
 const conversation=await checked(db.from('omnichannel_conversations').select('id,channel_account_id,metadata,status,takeover_mode').eq('workspace_id',workspace).eq('id',id).single());
 if(!['1cf50730-966d-4d7c-a5d4-27c578a8a19d','7c295907-7f62-4168-b14d-abcf440bb52f'].includes(conversation.channel_account_id)||conversation.takeover_mode!=='BOT_ALLOWED')throw Error('TARGET_CHANGED');
 const state=await checked(db.from('ai_recruiter_conversation_states').select('last_inbound_message_id,bot_paused').eq('workspace_id',workspace).eq('conversation_id',id).single());
 if(state.bot_paused)throw Error('PAUSED');
 const runs=await checked(db.from('ai_recruiter_runs').select('id,status,mode,inbound_message_id,proposed_text_parts,created_at').eq('workspace_id',workspace).eq('conversation_id',id).order('created_at',{ascending:false}));
 const latest=runs[0];
 if(latest?.mode==='AUTO'&&['PENDING','RUNNING','QUEUED','SENT'].includes(latest.status)&&conversation.metadata?.aiRecruiterModeOverride==='AUTO'){console.log(JSON.stringify({alreadyAuto:id,status:latest.status}));continue;}
 if(!latest||latest.status!=='DRAFT_READY'||latest.inbound_message_id!==state.last_inbound_message_id||!latest.proposed_text_parts?.length)throw Error('LATEST_NOT_UNSENT_DRAFT');
 const actions=await checked(db.from('channel_outbound_actions').select('id,status,attempt_count').eq('workspace_id',workspace).eq('conversation_id',id).gte('created_at',latest.created_at));
 if(actions.some(a=>a.attempt_count>0||['SENT','SENDING','DELIVERY_UNKNOWN','APPROVED'].includes(a.status)))throw Error('DELIVERY_REQUIRES_REVIEW');
 plans.push({conversation,state,latest,older:runs.filter(r=>r.id!==latest.id&&r.status==='DRAFT_READY'),actions});
}
await mkdir('outputs/chat-auto-authorization',{recursive:true});
await writeFile(`outputs/chat-auto-authorization/${Date.now()}.json`,JSON.stringify(plans,null,2));
for(const p of plans){
 await checked(db.from('omnichannel_conversations').update({metadata:{...p.conversation.metadata,aiRecruiterModeOverride:'AUTO'}}).eq('workspace_id',workspace).eq('id',p.conversation.id));
 for(const old of p.older)await checked(db.from('ai_recruiter_runs').update({status:'SKIPPED',safe_error_code:'SUPERSEDED_OPERATOR_APPROVAL'}).eq('id',old.id).eq('status','DRAFT_READY'));
 await checked(db.from('ai_recruiter_runs').update({mode:'AUTO',status:'QUEUED',safe_error_code:null,completed_at:null}).eq('workspace_id',workspace).eq('id',p.latest.id).eq('status','DRAFT_READY'));
}
console.log(JSON.stringify({authorized:plans.length,queuedRunIds:plans.map(p=>p.latest.id),olderRunsSkipped:plans.reduce((n,p)=>n+p.older.length,0)}));
