#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==="server-only")return{url:"data:text/javascript,export {};",shortCircuit:true};
  if(specifier.startsWith("@/")){const base=fileURLToPath(new URL(`../src/${specifier.slice(2)}`,import.meta.url));const file=[base,`${base}.ts`].find(existsSync);if(file)return{url:pathToFileURL(file).href,shortCircuit:true}}
  if(specifier.startsWith(".")&&context.parentURL?.startsWith("file:")){const base=fileURLToPath(new URL(specifier,context.parentURL));const file=[base,`${base}.ts`].find(existsSync);if(file)return{url:pathToFileURL(file).href,shortCircuit:true}}
  return nextResolve(specifier,context);
}});

const {handleZaloWebhook}=await import("../src/app/api/webhooks/zalo/route.ts");
const {ZaloWebhookDiagnosticError}=await import("../src/modules/channels/adapters/zalo/zalo-bridge-adapter.ts");
const {ChannelAccountLoadError}=await import("../src/modules/channels/server/load-channel-adapter.ts");
let assertions=0,ingestCalls=0;
const eq=(a,b)=>{assert.deepEqual(a,b);assertions++};
const body=JSON.stringify({accountId:"fixture-account",eventId:"fixture-event"});
const request=()=>new Request("http://127.0.0.1/api/webhooks/zalo",{method:"POST",headers:{"x-hirex-timestamp":"1800000000","x-hirex-signature":"fixture"},body});
const adapter={};
let response=await handleZaloWebhook(request(),{load:async()=>({channelAccountId:"fixture-channel",adapter}),ingest:async input=>{ingestCalls++;eq(input.channelAccountId,"fixture-channel");eq(input.channelType,"ZALO");return{accepted:1}}});
eq(response.status,200);eq(await response.json(),{accepted:1});eq(ingestCalls,1);
const persisted={contacts:new Set(),channels:new Set(),conversations:new Set(),messages:new Set(),events:new Set()};
const idempotentIngest=async()=>{const duplicate=persisted.events.has("fixture-event");persisted.contacts.add("contact");persisted.channels.add("channel");persisted.conversations.add("thread");persisted.messages.add("message");persisted.events.add("fixture-event");return{accepted:duplicate?0:1}};
response=await handleZaloWebhook(request(),{load:async()=>({channelAccountId:"fixture-channel",adapter}),ingest:idempotentIngest});eq(response.status,200);eq(await response.json(),{accepted:1});
response=await handleZaloWebhook(request(),{load:async()=>({channelAccountId:"fixture-channel",adapter}),ingest:idempotentIngest});eq(response.status,200);eq(await response.json(),{accepted:0});
for(const values of Object.values(persisted))eq(values.size,1);
response=await handleZaloWebhook(new Request("http://127.0.0.1/api/webhooks/zalo",{method:"POST",body:"{"}),{load:async()=>{throw Error("unexpected")},ingest:async()=>({accepted:0})});eq(response.status,400);eq(await response.json(),{ok:false,code:"JSON_INVALID"});
response=await handleZaloWebhook(new Request("http://127.0.0.1/api/webhooks/zalo",{method:"POST",body:"null"}),{load:async()=>{throw Error("unexpected")},ingest:async()=>({accepted:0})});eq(response.status,400);eq(await response.json(),{ok:false,code:"SCHEMA_INVALID"});
for(const [code,status] of [["TIMESTAMP_INVALID",401],["SIGNATURE_INVALID",401],["SCHEMA_INVALID",400],["PROVIDER_ACCOUNT_MISMATCH",400]]){response=await handleZaloWebhook(request(),{load:async()=>({channelAccountId:"fixture-channel",adapter}),ingest:async()=>{throw new ZaloWebhookDiagnosticError(code)}});eq(response.status,status);eq(await response.json(),{ok:false,code})}
for(const [code,status] of [["CHANNEL_ACCOUNT_NOT_FOUND",404],["CHANNEL_ACCOUNT_QUERY_FAILED",500],["CHANNEL_ACCOUNT_ROW_INVALID",400],["CHANNEL_CREDENTIAL_DECRYPT_FAILED",500],["CHANNEL_CONFIGURATION_INVALID",400]]){response=await handleZaloWebhook(request(),{load:async()=>{throw new ChannelAccountLoadError(code)},ingest:async()=>({accepted:0})});eq(response.status,status);eq(await response.json(),{ok:false,code})}
for(const [error,code] of [["CONTACT_PERSISTENCE_FAILED","CONTACT_PROVISION_FAILED"],["CONTACT_CHANNEL_PERSISTENCE_FAILED","CONTACT_CHANNEL_PROVISION_FAILED"],["CONVERSATION_PERSISTENCE_FAILED","CONVERSATION_PROVISION_FAILED"],["MESSAGE_PERSISTENCE_FAILED","MESSAGE_PERSIST_FAILED"]]){response=await handleZaloWebhook(request(),{load:async()=>({channelAccountId:"fixture-channel",adapter}),ingest:async()=>{throw Error(error)}});eq(response.status,500);eq(await response.json(),{ok:false,code})}
console.log(`ZALO_WEBHOOK_HANDLER_PASS assertions=${assertions} remoteCalls=0 providerCalls=0`);
