import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
globalThis.gmailBootstrapCalls=[];
globalThis.gmailBootstrapRows=[
 {id:'older',workspace_id:'w',email_sync_states:[{sync_type:'INITIAL',status:'RUNNING',last_batch_at:'2026-10-01'}]},
 {id:'new1',workspace_id:'w',email_sync_states:[]},
 {id:'new2',workspace_id:'w',email_sync_states:[]},
 {id:'done',workspace_id:'w',email_sync_states:[{sync_type:'INITIAL',status:'COMPLETED'}]},
];
registerHooks({resolve(s,c,next){
 let code;
 if(s==='server-only')code='export {};';
 if(s.endsWith('/privileged-supabase'))code=`export function createPrivilegedSupabaseClient(){return {from(){const q={};for(const m of ['select','eq','not','order'])q[m]=()=>q;q.limit=async()=>({data:[],error:null});q.is=async()=>({data:globalThis.gmailBootstrapRows,error:null});return q;}}}`;
 if(s.endsWith('/run-initial-sync-batch'))code=`export async function runInitialSyncBatch(s){globalThis.gmailBootstrapCalls.push(s.emailAccountId);return {success:true,completed:false};}`;
 if(s.endsWith('/run-incremental-sync-batch'))code='export async function runIncrementalSyncBatch(){throw Error("unexpected")};';
 if(s.endsWith('/process-campaign-signals'))code='export async function processPersistedCampaignReplies(){};export async function processPersistedCampaignBounces(){}';
 return code?{shortCircuit:true,url:'data:text/javascript,'+encodeURIComponent(code)}:next(s,c);
}});
const {runAutomaticIncrementalSync}=await import('../src/modules/integrations/gmail/server/run-automatic-incremental-sync.ts');
test('automatic sync bootstraps at most two unstarted accounts without an initial checkpoint',async()=>{
 const r=await runAutomaticIncrementalSync();
 assert.deepEqual(globalThis.gmailBootstrapCalls,['new1','new2']);
 assert.equal(r.accountsRemaining,2);assert.equal(r.accountsFailed,0);
});
