require('@next/env').loadEnvConfig(process.cwd());
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const load=Module._load,resolve=Module._resolveFilename;
Module._load=function(name,...args){return name==='server-only'?{}:load.call(this,name,...args)};
Module._resolveFilename=function(name,...args){return resolve.call(this,name.startsWith('@/')?path.join(process.cwd(),'src',name.slice(2)):name,...args)};
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {createPrivilegedSupabaseClient}=require('../src/modules/integrations/gmail/server/privileged-supabase.ts');
const {gmailQuotaReached}=require('../src/modules/campaigns/server/gmail-quota.ts');
(async()=>{const db=createPrivilegedSupabaseClient();const r=await db.from('email_accounts').select('id,workspace_id,email_address').in('email_address',['quanghuy.sale3@gmail.com','tuantus.sale@gmail.com','thuydung.salemanager@gmail.com']);if(r.error)throw Error('ACCOUNT_READ_FAILED');for(const a of r.data)console.log(a.email_address,await gmailQuotaReached(a.workspace_id,a.id));})().catch(e=>{console.error(e.message);process.exitCode=1});
