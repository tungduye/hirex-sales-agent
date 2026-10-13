// Batched historical repair; no sends, no deletes, no credential output.
require('@next/env').loadEnvConfig(process.cwd());
const {createClient}=require('@supabase/supabase-js');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const code='GMAIL_RATE_LIMITED_APPROVAL_REQUIRED';
const isNotice=r=>/^(mailer-daemon|postmaster)@(googlemail|gmail)\.com$/i.test(r.from_email??'')&&/reached a limit for sending mail|đạt đến giới hạn gửi thư/i.test(r.body_text??r.snippet??'');
async function checked(q){const r=await q;if(r.error)throw Error(r.error.code);return r.data??[]}
async function run(){let after=null,hidden=0,matched=0;
 for(;;){let q=db.from('email_messages').select('id,workspace_id,email_account_id,email_thread_id,from_email,body_text,snippet,received_at,email_threads(provider_thread_id)').eq('is_mailer_daemon',true).eq('direction','INBOUND').order('id').limit(100);if(after)q=q.gt('id',after);const page=await checked(q);if(!page.length)break;after=page.at(-1).id;
 const notices=page.filter(isNotice);if(!notices.length)continue;
 const threadIds=[...new Set(notices.map(r=>r.email_thread_id))];
 const members=await checked(db.from('email_messages').select('email_thread_id,from_email,body_text,snippet,direction').in('email_thread_id',threadIds).limit(1000));
 if(members.length<1000){const hideIds=threadIds.filter(id=>{const rows=members.filter(r=>r.email_thread_id===id&&r.direction==='INBOUND');return rows.length&&rows.every(isNotice)});
 const conversations=hideIds.length?await checked(db.from('omnichannel_conversations').select('id,workspace_id,metadata').in('id',hideIds)):[];
 const groups=new Map();for(const c of conversations){const metadata={...c.metadata,hidden:true,gmailQuotaNotice:true};const key=JSON.stringify([c.workspace_id,metadata]);groups.set(key,[...(groups.get(key)??[]),c.id])}
 for(const [key,ids]of groups){const [workspace,metadata]=JSON.parse(key);await checked(db.from('omnichannel_conversations').update({metadata}).eq('workspace_id',workspace).in('id',ids));hidden+=ids.length}}
 const scopeGroups=new Map();for(const n of notices){const key=JSON.stringify([n.workspace_id,n.email_account_id]);scopeGroups.set(key,[...(scopeGroups.get(key)??[]),n])}
 for(const[key,rows]of scopeGroups){const[workspace,account]=JSON.parse(key);const tids=[...new Set(rows.map(r=>r.email_threads?.provider_thread_id).filter(Boolean))];if(!tids.length)continue;
 const steps=await checked(db.from('email_campaign_recipient_steps').select('id,recipient_id,status,sent_at,provider_thread_id').eq('workspace_id',workspace).eq('sender_email_account_id',account).in('provider_thread_id',tids).limit(1000));if(steps.length>=1000)continue;
 const eligible=steps.filter(s=>['SENT','FAILED'].includes(s.status)&&steps.filter(x=>x.provider_thread_id===s.provider_thread_id).length===1&&rows.some(n=>n.email_threads?.provider_thread_id===s.provider_thread_id&&s.sent_at&&Date.parse(n.received_at)>=Date.parse(s.sent_at)));
 if(!eligible.length)continue;const recipientIds=[...new Set(eligible.map(s=>s.recipient_id))];
 await checked(db.from('email_campaign_recipient_steps').update({status:'FAILED',safe_error_code:code}).eq('workspace_id',workspace).in('id',eligible.map(s=>s.id)).in('status',['SENT','FAILED']));
 await checked(db.from('email_campaign_recipients').update({status:'FAILED',sent_at:null,failed_at:new Date().toISOString(),safe_error_code:code,engagement_status:'CANCELLED',stopped_reason:code}).eq('workspace_id',workspace).in('id',recipientIds).in('status',['PENDING','SENT','FAILED']).in('engagement_status',['ACTIVE','COMPLETED','CANCELLED']));
 await checked(db.from('email_campaign_recipient_steps').update({status:'CANCELLED',safe_error_code:code}).eq('workspace_id',workspace).in('recipient_id',recipientIds).eq('status','PENDING'));matched+=eligible.length;
 }console.log(JSON.stringify({hidden,matched}));
 }console.log('REPAIR_COMPLETE');}
run().catch(e=>{console.error(e.message);process.exitCode=1});
