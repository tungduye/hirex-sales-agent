import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const calls=[];
globalThis.__recruiterQueueCalls=calls;
registerHooks({resolve(specifier,context,next){
  if(specifier==='@/modules/ai-recruiter/server/process-ai-recruiter')return {shortCircuit:true,url:'data:text/javascript,'+encodeURIComponent(`
    export async function resumeQueuedAiRecruiterRuns(limit,id){globalThis.__recruiterQueueCalls.push(['resume',limit,id]);return {processed:1,sent:0};}
    export async function processPendingAiRecruiterRuns(limit){globalThis.__recruiterQueueCalls.push(['pending',limit]);return {processed:2,failed:0};}
  `)};
  return next(specifier,context);
}});
const {POST}=await import('../src/app/api/internal/ai-recruiter/process/route.ts');
process.env.AUTOMATION_CRON_SECRET='fixture-only';
test('unauthorized worker cannot generate or resume replies',async()=>{
  const response=await POST(new Request('http://localhost/api',{method:'POST'}));
  assert.equal(response.status,401);assert.deepEqual(calls,[]);
});
test('normal worker drains queued replies as well as new runs',async()=>{
  const response=await POST(new Request('http://localhost/api',{method:'POST',headers:{Authorization:'Bearer fixture-only','Content-Type':'application/json'},body:JSON.stringify({limit:2})}));
  assert.equal(response.status,200);
  assert.deepEqual(calls,[['resume',2,undefined],['pending',2]]);
});
