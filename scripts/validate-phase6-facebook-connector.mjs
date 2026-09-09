#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync,readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";

registerHooks({resolve(specifier,context,nextResolve){if(specifier==="server-only")return{url:"data:text/javascript,export {};",shortCircuit:true};if(specifier.startsWith(".")&&context.parentURL?.startsWith("file:")){const base=fileURLToPath(new URL(specifier,context.parentURL)),found=[base,`${base}.ts`,`${base}.tsx`].find(existsSync);if(found)return{url:pathToFileURL(found).href,shortCircuit:true}}return nextResolve(specifier,context)}});

const root=path.resolve(import.meta.dirname,"..");
const[{FacebookPageAdapter},{verifyFacebookWebhookChallenge},{encryptChannelCredential,decryptChannelCredential}]=await Promise.all([
  import("../src/modules/channels/adapters/facebook/facebook-adapter.ts"),
  import("../src/modules/channels/adapters/facebook/facebook-webhook-verification.ts"),
  import("../src/modules/channels/server/channel-credential-encryption.ts"),
]);
let assertions=0;const equal=(actual,expected)=>{assert.deepEqual(actual,expected);assertions+=1};const ok=(value)=>{assert.ok(value);assertions+=1};

equal(verifyFacebookWebhookChallenge({mode:"subscribe",suppliedToken:"verify-token",expectedToken:"verify-token",challenge:"12345"}),{status:200,body:"12345"});
equal(verifyFacebookWebhookChallenge({mode:"subscribe",suppliedToken:"wrong-token",expectedToken:"verify-token",challenge:"12345"}).status,403);
equal(verifyFacebookWebhookChallenge({mode:"wrong",suppliedToken:"verify-token",expectedToken:"verify-token",challenge:"12345"}).status,403);
equal(verifyFacebookWebhookChallenge({mode:"subscribe",suppliedToken:"verify-token",expectedToken:"verify-token",challenge:"bad\nchallenge"}).status,400);

const workspaceId="90000000-0000-4000-8000-000000000001",accountId="90000000-0000-4000-8000-000000000002",pageId="page-123",senderId="sender-456",body=JSON.stringify({object:"page",entry:[{id:pageId,messaging:[{sender:{id:senderId},recipient:{id:pageId},timestamp:1788900000000,message:{mid:"message-789",text:"Need pricing"}}]}]});
const secret="fixture-app-secret",signature=`sha256=${createHmac("sha256",secret).update(body).digest("hex")}`;
const adapter=new FacebookPageAdapter(accountId,workspaceId,{pageId,pageAccessToken:"fixture-token",appSecret:secret,graphApiVersion:"v24.0"},{request:async()=>{throw new Error("TRANSPORT_MUST_NOT_RUN")}});
const verified=await adapter.verifyWebhook({headers:{"x-hub-signature-256":signature},body});equal(verified.channelAccountId,accountId);
const normalized=await adapter.normalizeInbound(verified);equal(normalized.length,1);equal(normalized[0].workspaceId,workspaceId);equal(normalized[0].channelType,"FACEBOOK");equal(normalized[0].providerConversationId,senderId);equal(normalized[0].providerMessageId,"message-789");equal(normalized[0].sender.externalId,senderId);equal(normalized[0].text,"Need pricing");ok(Number.isFinite(Date.parse(normalized[0].occurredAt)));
await assert.rejects(()=>adapter.verifyWebhook({headers:{"x-hub-signature-256":"sha256="+"0".repeat(64)},body}));assertions+=1;
await assert.rejects(()=>adapter.verifyWebhook({headers:{"x-hub-signature-256":signature},body:"{"}));assertions+=1;
await assert.rejects(()=>adapter.verifyWebhook({headers:{"x-hub-signature-256":signature},body:JSON.stringify({object:"user",entry:[]})}));assertions+=1;

const previousKey=process.env.CHANNEL_TOKEN_ENCRYPTION_KEY;process.env.CHANNEL_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString("base64");
const plaintext="fixture-page-access-token-never-persist-plain",ciphertext=encryptChannelCredential(plaintext);ok(ciphertext.startsWith("v1:"));equal(ciphertext.includes(plaintext),false);equal(decryptChannelCredential(ciphertext),plaintext);if(previousKey===undefined)delete process.env.CHANNEL_TOKEN_ENCRYPTION_KEY;else process.env.CHANNEL_TOKEN_ENCRYPTION_KEY=previousKey;

const route=readFileSync(path.join(root,"src/app/api/webhooks/facebook/route.ts"),"utf8"),connect=readFileSync(path.join(root,"src/modules/channels/server/connect-channel-actions.ts"),"utf8"),connectForm=readFileSync(path.join(root,"src/modules/channels/components/channel-connect-forms.tsx"),"utf8"),ingest=readFileSync(path.join(root,"src/modules/channels/server/ingest-channel-webhook.ts"),"utf8"),migration21=readFileSync(path.join(root,"supabase/migrations/021_omnichannel_foundation.sql"),"utf8"),migration22=readFileSync(path.join(root,"supabase/migrations/022_multichannel_campaigns.sql"),"utf8"),inbox=readFileSync(path.join(root,"src/modules/inbox/server/get-omnichannel-inbox-data.ts"),"utf8"),composer=readFileSync(path.join(root,"src/modules/channels/components/conversation-composer.tsx"),"utf8"),controls=readFileSync(path.join(root,"src/modules/channels/components/conversation-controls.tsx"),"utf8"),quickReplies=readFileSync(path.join(root,"src/modules/channels/components/quick-replies-manager.tsx"),"utf8");
ok(route.includes("FACEBOOK_WEBHOOK_VERIFY_TOKEN"));ok(route.includes("verifyFacebookWebhookChallenge"));ok(connect.includes("encryptChannelCredential(parsed.data.pageAccessToken)"));ok(connect.includes("encryptChannelCredential(parsed.data.appSecret)"));equal(connect.includes("NEXT_PUBLIC"),false);ok(migration21.includes("channel_account_credentials"));ok(migration21.includes("ignoreDuplicates: true")||ingest.includes("ignoreDuplicates: true"));ok(ingest.includes('.eq("workspace_id",account.workspace_id)'));ok(ingest.includes('.eq("channel_type",input.channelType)'));ok(ingest.includes("contact_id:contactId"));ok(inbox.includes('channel_type'));ok(inbox.includes('omnichannel_messages'));ok(composer.includes('AI_ASSIST'));ok(migration22.includes("cc.marketing_consent_status='OPTED_IN'"));ok(migration22.includes("conversation.status in ('OPEN','PENDING')"));ok(migration22.includes("interval '23 hours'"));ok(migration22.includes("channel_suppressions"));
for(const field of ['name="pageId"','name="displayName"','name="graphApiVersion"','name="pageAccessToken"','name="appSecret"'])ok(connectForm.includes(field));
ok(connectForm.includes('type="password"'));ok(controls.includes("HUMAN_TAKEOVER"));ok(controls.includes("assignedTo"));ok(quickReplies.includes("Quick"));ok(composer.includes("quickReplies.filter"));ok(composer.includes("setText(reply.textContent)"));equal(composer.includes("sendMessage("),false);

console.log(`PHASE6_FACEBOOK_CONNECTOR_PASS assertions=${assertions}`);
