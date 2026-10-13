import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('src/modules/integrations/gmail/server/gmail-send-api.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function load(fetch){let timeout;const c={exports:{},require:()=>({}),fetch,Error,AbortSignal:{timeout:ms=>{timeout=ms;return {};}}};vm.runInNewContext(code,c);return {api:c.exports,timeout:()=>timeout};}
test('attachment sends have bounded 120 second timeout',async()=>{const m=load(async()=>({ok:true,json:async()=>({id:'abc',threadId:'def'})}));assert.equal((await m.api.sendRawGmailMessage('test','mime')).providerMessageId,'abc');assert.equal(m.timeout(),120000);});
test('timeout remains unknown with exactly one POST, never retry',async()=>{let calls=0;const m=load(async()=>{calls++;const e=new Error();e.name='TimeoutError';throw e;});await assert.rejects(m.api.sendRawGmailMessage('test','mime'),e=>e.reason==='TIMEOUT');assert.equal(calls,1);});
test('network failure is distinguishable without exposing data',async()=>{const m=load(async()=>{throw new Error('private error');});await assert.rejects(m.api.sendRawGmailMessage('test','mime'),e=>e.reason==='NETWORK'&&!e.message.includes('private'));});
