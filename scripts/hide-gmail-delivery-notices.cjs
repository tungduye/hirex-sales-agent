// Reversible hiding only. No campaign status changes, Gmail deletion, or sending.
require('@next/env').loadEnvConfig(process.cwd());
const {createClient}=require('@supabase/supabase-js');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const {isHiddenSystemEmail:notice}=require('../src/modules/campaigns/domain/gmail-quota.ts');
async function read(q){const r=await q;if(r.error)throw Error(r.error.code);return r.data??[]}
(async()=>{let after=null,hidden=0;
for(;;){let q=db.from('email_messages').select('id,email_thread_id,from_email,auto_submitted,snippet,body_text').eq('direction','INBOUND').or('is_mailer_daemon.eq.true,auto_submitted.not.is.null,from_email.ilike.advertise-noreply@*').order('id').limit(100);if(after)q=q.gt('id',after);const page=await read(q);if(!page.length)break;after=page.at(-1).id;
const ids=[...new Set(page.filter(notice).map(r=>r.email_thread_id))];if(!ids.length)continue;
const members=await read(db.from('email_messages').select('email_thread_id,from_email,direction,auto_submitted,body_text,snippet').in('email_thread_id',ids).limit(1000));if(members.length>=1000)continue;
const safe=ids.filter(id=>{const inbound=members.filter(m=>m.email_thread_id===id&&m.direction==='INBOUND');return inbound.length&&inbound.every(notice)});if(!safe.length)continue;
const conversations=await read(db.from('omnichannel_conversations').select('id,workspace_id,metadata').in('id',safe));
const groups=new Map();for(const c of conversations){if(c.metadata?.hidden===true)continue;const key=JSON.stringify([c.workspace_id,{...c.metadata,hidden:true,gmailDeliveryNotice:true}]);groups.set(key,[...(groups.get(key)??[]),c.id])}
for(const[key,list]of groups){const[workspace,metadata]=JSON.parse(key);await read(db.from('omnichannel_conversations').update({metadata}).eq('workspace_id',workspace).in('id',list));hidden+=list.length}
}console.log(JSON.stringify({newlyHidden:hidden,complete:true}));})().catch(e=>{console.error(e.message);process.exitCode=1});
