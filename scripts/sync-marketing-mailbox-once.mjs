import env from '@next/env';
import {registerHooks} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
env.loadEnvConfig(process.cwd());
registerHooks({resolve(s,c,next){
 if(s==='server-only')return {shortCircuit:true,url:'data:text/javascript,export{}'};
 if(s.startsWith('@/'))return next(pathToFileURL(resolve('src',s.slice(2)+'.ts')).href,c);
 return next(s,c);
}});
const {runInitialSyncBatch}=await import('../src/modules/integrations/gmail/server/run-initial-sync-batch.ts');
console.log(JSON.stringify(await runInitialSyncBatch({workspaceId:'da7cef02-036a-4ee9-b3d7-5c7df54c73a0',emailAccountId:'ab60b68a-ac63-455c-8002-e3add3b7f842'})));
