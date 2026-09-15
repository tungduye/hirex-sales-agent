#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateChannelCampaignEligibility } from "../src/modules/channels/core/evaluate-channel-campaign-eligibility.ts";

let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions += 1; };
const now = new Date("2026-09-14T08:00:00.000Z");
const fresh = "2026-09-14T07:00:00.000Z";
function fixture() {
  return {
    campaign: { id: "campaign-qa", status: "DRAFT" },
    steps: [{ id: "step-1", position: 1, allowed_channels: ["FACEBOOK"], text_template: "QA", attachment_ids: [] }],
    senders: [{ channel_account_id: "page-1", priority: 1, enabled: true }],
    accounts: [{ id: "page-1", channel_type: "FACEBOOK", status: "CONNECTED", capabilities: ["SEND_TEXT"] }],
    recipients: [{ id: "recipient-1", contact_id: "contact-1", status: "ACTIVE", current_step_position: 1, next_step_at: null }],
    recipientSteps: [],
    identities: [{ contact_id: "contact-1", channel_type: "FACEBOOK", channel_value: "psid-1", marketing_consent_status: "OPTED_IN" }],
    conversations: [{ channel_account_id: "page-1", provider_conversation_id: "psid-1", status: "OPEN", last_message_at: fresh }],
    suppressions: [],
  };
}
const project = (snapshot) => evaluateChannelCampaignEligibility(snapshot, now, 1);
let f = fixture(); const before = structuredClone(f); let p = project(f); equal(p.audienceCount, 1); equal(p.eligibleRecipientCount, 1); equal(p.projectedActions, 1); assert.deepEqual(f, before); assertions += 1;
for (const status of ["UNKNOWN", "OPTED_OUT"]) { f = fixture(); f.identities[0].marketing_consent_status = status; p = project(f); equal(p.eligibleRecipientCount, 0); equal(p.reasons.NOT_OPTED_IN, 1); }
f = fixture(); f.suppressions.push({ channel_type: "FACEBOOK", normalized_recipient: "psid-1" }); p = project(f); equal(p.eligibleRecipientCount, 0); equal(p.reasons.SUPPRESSED, 1);
f = fixture(); f.conversations[0].status = "RESOLVED"; p = project(f); equal(p.eligibleRecipientCount, 0); equal(p.reasons.NO_OPEN_CONVERSATION, 1);
f = fixture(); f.conversations = []; p = project(f); equal(p.eligibleRecipientCount, 0); equal(p.reasons.NO_OPEN_CONVERSATION, 1);
f = fixture(); f.conversations[0].last_message_at = "2026-09-13T07:00:00.000Z"; p = project(f); equal(p.eligibleRecipientCount, 0); equal(p.reasons.RESPONSE_WINDOW_EXPIRED, 1);
f = fixture(); f.accounts[0].id = "other-page"; p = project(f); equal(p.eligibleRecipientCount, 0); equal(p.reasons.NO_ENABLED_SENDER, 1);
f = fixture(); f.conversations[0].channel_account_id = "other-page"; p = project(f); equal(p.eligibleRecipientCount, 0); equal(p.reasons.NO_OPEN_CONVERSATION, 1);
f = fixture(); f.identities[0].channel_value = ""; p = project(f); equal(p.eligibleRecipientCount, 0); equal(p.reasons.MISSING_PROVIDER_IDENTITY, 1);
f = fixture(); f.campaign = null; assert.throws(() => project(f), /CHANNEL_CAMPAIGN_NOT_FOUND/); assertions += 1;
f = fixture(); f.recipients.push({ id: "recipient-2", contact_id: "contact-2", status: "ACTIVE", current_step_position: 1, next_step_at: null }); p = project(f); equal(p.audienceCount, 2); equal(p.eligibleRecipientCount, 1); equal(p.projectedActions, 1);
f = fixture(); f.campaign.status = "RUNNING"; f.recipients[0].next_step_at = fresh; f.recipientSteps = [{ recipient_id: "recipient-1", step_id: "step-1", status: "PENDING" }]; p = project(f); equal(p.eligibleRecipientCount, 1);
f.recipientSteps[0].status = "CLAIMED"; p = project(f); equal(p.eligibleRecipientCount, 0); equal(p.reasons.STEP_NOT_PENDING, 1);

const processor = readFileSync(new URL("../src/modules/channels/server/process-channel-campaign-batch.ts", import.meta.url), "utf8");
const projector = readFileSync(new URL("../src/modules/channels/server/project-channel-campaign.ts", import.meta.url), "utf8");
equal(processor.indexOf("projectChannelCampaign(") < processor.indexOf("if(input.dryRun)"), true);
equal(processor.indexOf("if(input.dryRun)") < processor.indexOf('client.rpc("claim_channel_campaign_recipient_step"'), true);
equal(processor.includes("executeChannelOutboundAction(materialized.data,registry)"), true);
equal(processor.indexOf('client.rpc("claim_channel_campaign_recipient_step"') < processor.indexOf("executeChannelOutboundAction(materialized.data,registry)"), true);
equal(processor.includes("Math.min(Math.max(input.maximumActions??10,1),25)"), true);
equal(processor.includes('if(result.status==="DELIVERY_UNKNOWN")break'), true);
equal(processor.includes('row.channel_type==="FACEBOOK"||row.channel_type==="ZALO"'), true);
equal(processor.includes('contains("metadata",{participantExternalId:row.recipient_external_id})'), true);
equal(processor.includes("injectedAdapters??new ChannelAdapterRegistry()"), true);
for (const forbidden of [".insert(", ".update(", ".delete(", ".rpc(", "sendMessage(", "fetch("]) equal(projector.includes(forbidden), false);
console.log(`PHASE6_CHANNEL_CAMPAIGN_DRY_RUN_PASS assertions=${assertions} providerCalls=0 dbMutations=0`);
