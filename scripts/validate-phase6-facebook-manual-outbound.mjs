#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ChannelAdapterRegistry } from "../src/modules/channels/core/channel-adapter-registry.ts";
import { executeOutboundAction } from "../src/modules/channels/core/execute-outbound-action.ts";

let assertions = 0;
function equal(actual, expected) { assert.equal(actual, expected); assertions += 1; }
function source(file) { return readFileSync(new URL(file, import.meta.url), "utf8"); }

const actionCode = source("../src/modules/channels/server/channel-actions.ts");
const dispatcherCode = source("../src/modules/channels/server/dispatch-manual-facebook-action.ts");
const persistenceCode = source("../src/modules/channels/server/execute-channel-outbound-action.ts");
equal(actionCode.includes("dispatchManualFacebookAction(parsed.data)"), true);
equal(actionCode.includes('action.status !== "PROPOSED"'), true);
equal(dispatcherCode.includes('action.status !== "APPROVED"'), true);
equal(dispatcherCode.includes("action.attempt_count !== 0"), true);
equal(dispatcherCode.includes("loadChannelAdapterByAccountId(action.channel_account_id)"), true);
equal(persistenceCode.includes('direction: "OUTBOUND"'), true);
equal(persistenceCode.includes('onConflict: "workspace_id,channel_account_id,provider_message_id", ignoreDuplicates: true'), true);

const accountId = "90000000-0000-4000-8000-000000000001";
const workspaceId = "90000000-0000-4000-8000-000000000002";
const conversationId = "90000000-0000-4000-8000-000000000003";
const actionId = "90000000-0000-4000-8000-000000000004";
const psid = "page-scoped-qa-psid";
const action = { id: actionId, workspaceId, conversationId, providerConversationId: psid, channelAccountId: accountId, channelType: "FACEBOOK", recipientExternalId: psid, status: "APPROVED", textContent: "Test HireX outbound 02", attachmentIds: [], idempotencyKey: "qa-once", policyDecisionId: "90000000-0000-4000-8000-000000000005", approvedBy: "90000000-0000-4000-8000-000000000006", approvedAt: "2026-09-14T00:00:00.000Z" };
let status = "APPROVED", providerCalls = 0, claimCalls = 0, sentFinalizations = 0;
const adapters = new ChannelAdapterRegistry();
adapters.register({channelType:"FACEBOOK",capabilities:new Set(["SEND_TEXT"]),verifyWebhook:async()=>{throw Error("UNUSED")},normalizeInbound:async()=>[],healthCheck:async()=>"CONNECTED",sendMessage:async command=>{providerCalls += 1; equal(command.recipientExternalId, psid); equal(command.providerConversationId, psid); equal(command.channelAccountId, accountId); return {providerMessageId:"provider-msg-1",providerConversationId:psid,acceptedAt:"2026-09-14T00:00:01.000Z"}}});
const dependencies = {adapters,createLockId:()=>"lock-1",now:()=>"2026-09-14T00:00:00.000Z",loadAction:async()=>status==="APPROVED"?action:null,loadPolicy:async()=>({id:action.policyDecisionId,workspaceId,allowed:true,expiresAt:"2026-09-14T00:01:00.000Z"}),isSuppressed:async()=>false,claim:async()=>{claimCalls += 1; if(status!=="APPROVED")return null;status="EXECUTING";return {...action,status:"EXECUTING",executionLockId:"lock-1"}},loadClaimedAttachments:async()=>[],validatePreSend:async()=>({allowed:true,safeErrorCode:""}),finalizeSent:async()=>{sentFinalizations += 1;status="SENT";return true},finalizeFailed:async()=>false,finalizeUnknown:async()=>false};
const first=await executeOutboundAction(actionId,dependencies);equal(first.status,"SENT");equal(providerCalls,1);equal(claimCalls,1);equal(sentFinalizations,1);
const second=await executeOutboundAction(actionId,dependencies);equal(second.status,"NOT_ELIGIBLE");equal(providerCalls,1);equal(claimCalls,1);

let unknownCalls=0;
const unknownAdapters=new ChannelAdapterRegistry();
unknownAdapters.register({...adapters.get("FACEBOOK"),sendMessage:async()=>{unknownCalls+=1;throw Error("AMBIGUOUS_NETWORK_FAILURE")}});
const unknown=await executeOutboundAction(actionId,{...dependencies,adapters:unknownAdapters,loadAction:async()=>action,claim:async()=>({...action,status:"EXECUTING",executionLockId:"lock-1"}),finalizeUnknown:async()=>true});
equal(unknown.status,"DELIVERY_UNKNOWN");equal(unknownCalls,1);
console.log(`PHASE6_FACEBOOK_MANUAL_OUTBOUND_PASS assertions=${assertions} providerNetworkCalls=0`);
