#!/usr/bin/env node
import assert from "node:assert/strict";
import { ChannelAdapterRegistry } from "../src/modules/channels/core/channel-adapter-registry.ts";
import { ChannelError } from "../src/modules/channels/core/channel-errors.ts";
import { executeOutboundAction } from "../src/modules/channels/core/execute-outbound-action.ts";

const action = {
  id: "action", workspaceId: "workspace", conversationId: "conversation",
  providerConversationId: "recipient", channelAccountId: "account", channelType: "ZALO",
  recipientExternalId: "recipient", status: "QUEUED", textContent: "offline test",
  attachmentIds: [], idempotencyKey: "same-key", policyDecisionId: "policy",
  approvedBy: "operator", approvedAt: "2026-10-06T00:00:00Z", dispatchSource: "CAMPAIGN",
};

async function scenario({preSendAllowed=true,sendError=null,deferSucceeds=true}) {
  const events=[];
  const registry=new ChannelAdapterRegistry();
  registry.register({channelType:"ZALO",sendMessage:async()=>{
    events.push("send");
    if(sendError)throw sendError;
    return {providerMessageId:"sent-id",providerConversationId:"recipient",acceptedAt:"2026-10-06T00:00:00Z"};
  }});
  const result=await executeOutboundAction(action.id,{
    adapters:registry,createLockId:()=>"lock",now:()=>"2026-10-06T00:00:01Z",
    loadAction:async()=>action,
    loadPolicy:async()=>({id:"policy",workspaceId:"workspace",allowed:true,expiresAt:"2026-10-06T01:00:00Z"}),
    isSuppressed:async()=>false,
    claim:async()=>({...action,status:"EXECUTING",executionLockId:"lock"}),
    loadClaimedAttachments:async()=>[],
    validatePreSend:async()=>({allowed:preSendAllowed,safeErrorCode:preSendAllowed?"":"ACCOUNT_BUSY"}),
    finalizeSent:async()=>{events.push("sent-finalized");return true;},
    finalizeFailed:async()=>{events.push("failed-finalized");return true;},
    finalizeUnknown:async()=>{events.push("unknown-finalized");return true;},
    deferConfirmedBusy:async({providerRejected})=>{events.push(providerRejected?"busy-deferred":"slot-deferred");return deferSucceeds;},
  });
  return {result,events};
}

const slot=await scenario({preSendAllowed:false});
assert.equal(slot.result.status,"DEFERRED");
assert.deepEqual(slot.events,["slot-deferred"]);

const rejected=await scenario({sendError:new ChannelError("ACCOUNT_BUSY",false)});
assert.equal(rejected.result.status,"DEFERRED");
assert.deepEqual(rejected.events,["send","busy-deferred"]);

const uncertain=await scenario({sendError:new ChannelError("DELIVERY_UNKNOWN",true)});
assert.equal(uncertain.result.status,"DELIVERY_UNKNOWN");
assert.deepEqual(uncertain.events,["send","unknown-finalized"]);

const failedDefer=await scenario({sendError:new ChannelError("ACCOUNT_BUSY",false),deferSucceeds:false});
assert.equal(failedDefer.result.status,"DELIVERY_UNKNOWN");
assert.deepEqual(failedDefer.events,["send","busy-deferred","unknown-finalized"]);

console.log("Zalo ACCOUNT_BUSY defer tests passed (offline, no provider calls)");
