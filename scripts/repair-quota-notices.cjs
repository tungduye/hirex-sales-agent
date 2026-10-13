// Run on the trusted application host. Never prints credentials or message bodies.
require('@next/env').loadEnvConfig(process.cwd());
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const originalLoad=Module._load,originalResolve=Module._resolveFilename;
Module._load=function(name,...args){if(name==='server-only')return {};return originalLoad.call(this,name,...args)};
Module._resolveFilename=function(name,...args){return originalResolve.call(this,name.startsWith('@/')?path.join(process.cwd(),'src',name.slice(2)):name,...args)};
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {createPrivilegedSupabaseClient}=require('../src/modules/integrations/gmail/server/privileged-supabase.ts');
const {isGmailQuotaNotice}=require('../src/modules/campaigns/domain/gmail-quota.ts');
const {reconcileQuotaNotice}=require('../src/modules/campaigns/server/reconcile-quota-notice.ts');
const {recomputeThreadAggregates}=require('../src/modules/integrations/gmail/server/mailbox-persistence.ts');
(async()=>{
 const db=createPrivilegedSupabaseClient();let after=null,notices=0,correlatable=0;
 for(;;){let q=db.from('email_messages').select('id,workspace_id,email_account_id,email_thread_id,from_email,body_text,snippet,in_reply_to,received_at').eq('is_mailer_daemon',true).eq('direction','INBOUND').order('id').limit(100);if(after)q=q.gt('id',after);const p=await q;if(p.error)throw Error('READ_FAILED');if(!p.data.length)break;
 for(const row of p.data){if(!isGmailQuotaNotice(row.from_email,row.body_text??row.snippet))continue;notices++;if(row.in_reply_to)correlatable++;
 const thread=await db.from('email_threads').select('provider_thread_id').eq('workspace_id',row.workspace_id).eq('id',row.email_thread_id).single();if(thread.error)throw Error('THREAD_READ_FAILED');
 await reconcileQuotaNotice(row.workspace_id,row.email_account_id,{providerThreadId:thread.data.provider_thread_id,fromEmail:row.from_email,bodyText:row.body_text,snippet:row.snippet,inReplyTo:row.in_reply_to,receivedAt:row.received_at});
 await recomputeThreadAggregates({workspaceId:row.workspace_id,emailAccountId:row.email_account_id},new Set([row.email_thread_id]));
 }after=p.data.at(-1).id;console.log(JSON.stringify({notices,withParent:correlatable}));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
