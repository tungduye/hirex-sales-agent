#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  CHANNEL_TYPES,
  hasSafeIdentifier,
  isChannelType,
  isSendMessageCommand,
} from "../src/modules/channels/core/channel-contracts.ts";
import { ChannelAdapterRegistry } from "../src/modules/channels/core/channel-adapter-registry.ts";
import { reduceConversationPolicy, canAutomateConversation } from "../src/modules/channels/core/conversation-policy.ts";
import { decideInboundSignal } from "../src/modules/channels/core/inbound-signal-policy.ts";
import { selectCampaignChannel } from "../src/modules/channels/core/campaign-channel-policy.ts";
import { summarizeDeliveryEvents } from "../src/modules/channels/core/delivery-reporting.ts";
import { canQueueReviewedDraft } from "../src/modules/channels/core/ai-assist-boundary.ts";
import { evaluateAutomation } from "../src/modules/channels/core/evaluate-automation.ts";
import { planMultichannelCampaignStep } from "../src/modules/channels/core/multichannel-campaign.ts";
import { executeOutboundAction } from "../src/modules/channels/core/execute-outbound-action.ts";

let assertions = 0;
const equal = (actual, expected) => {
  assert.equal(actual, expected);
  assertions += 1;
};

equal(CHANNEL_TYPES.includes("FACEBOOK"), true);
equal(CHANNEL_TYPES.includes("ZALO"), true);
equal(isChannelType("EMAIL"), true);
equal(isChannelType("MESSENGER"), false);
equal(hasSafeIdentifier("provider-thread-1"), true);
equal(hasSafeIdentifier("bad\nidentifier"), false);

const command = {
  actionId: "action-1",
  workspaceId: "workspace-1",
  channelAccountId: "account-1",
  channelType: "FACEBOOK",
  providerConversationId: "conversation-1",
  recipientExternalId: "recipient-1",
  text: "Hello",
  attachments: [],
  idempotencyKey: "send-once-1",
  policyDecisionId: "policy-1",
};

equal(isSendMessageCommand(command), true);
equal(isSendMessageCommand({ ...command, idempotencyKey: "" }), false);
equal(isSendMessageCommand({ ...command, text: "x".repeat(100_001) }), false);
equal(isSendMessageCommand({ ...command, attachments: Array(11).fill({}) }), false);
equal(isSendMessageCommand({ ...command, text: null, attachments: [] }), false);
equal(isSendMessageCommand({ ...command, text: "contains\u0000nul" }), false);
equal(
  isSendMessageCommand({
    ...command,
    text: null,
    attachments: [{ id: "attachment-1", filename: "quote.pdf", contentType: "application/pdf", sizeBytes: 3, sha256: "a".repeat(64), contentBase64: "YWJj" }],
  }),
  true,
);
equal(
  isSendMessageCommand({
    ...command,
    attachments: [{ id: "attachment-1", filename: "bad\nname.txt", contentType: "text/plain", sizeBytes: 3, sha256: "a".repeat(64), contentBase64: "YWJj" }],
  }),
  false,
);

const registry = new ChannelAdapterRegistry();
const adapter = {
  channelType: "FACEBOOK",
  capabilities: new Set(["SEND_TEXT"]),
  async verifyWebhook() {
    return { channelAccountId: "account-1", providerEventId: null, receivedAt: "2026-01-01", payload: {} };
  },
  async normalizeInbound() {
    return [];
  },
  async sendMessage() {
    return { providerMessageId: "message-1", providerConversationId: "conversation-1", acceptedAt: "2026-01-01" };
  },
  async healthCheck() {
    return "CONNECTED";
  },
};

registry.register(adapter);
equal(registry.has("FACEBOOK"), true);
equal(registry.get("FACEBOOK"), adapter);
assert.throws(() => registry.register(adapter), /CHANNEL_ADAPTER_ALREADY_REGISTERED/);
assertions += 1;
assert.throws(() => registry.get("ZALO"), /CHANNEL_ADAPTER_UNAVAILABLE/);
assertions += 1;

const openPolicy = { status: "OPEN", takeoverMode: "BOT_ALLOWED", assignedTo: null, globallySuppressed: false, channelOptedOut: false };
equal(canAutomateConversation(openPolicy), true);
equal(canAutomateConversation({ ...openPolicy, takeoverMode: "HUMAN_TAKEOVER" }), false);
equal(reduceConversationPolicy(openPolicy, { type: "TAKE_OVER", profileId: "u" }).takeoverMode, "HUMAN_TAKEOVER");
equal(reduceConversationPolicy(openPolicy, { type: "MARK_SPAM" }).status, "SPAM");

equal(decideInboundSignal("FACEBOOK", "REPLY").createChannelSuppression, false);
equal(decideInboundSignal("ZALO", "UNSUBSCRIBE").suppressionReason, "UNSUBSCRIBED");
equal(decideInboundSignal("EMAIL", "HARD_BOUNCE").stopCampaigns, true);

const candidates = [
  { channelAccountId: "a", channelType: "FACEBOOK", recipientExternalId: "r", connected: true, suppressed: false, optedOut: false, priority: 20, capabilities: new Set(["SEND_TEXT"]) },
  { channelAccountId: "b", channelType: "ZALO", recipientExternalId: "z", connected: true, suppressed: false, optedOut: false, priority: 10, capabilities: new Set(["SEND_TEXT", "SEND_FILE"]) },
];
equal(selectCampaignChannel(candidates, { needsText: true, needsFiles: false, needsTemplates: false })?.channelAccountId, "b");
equal(selectCampaignChannel(candidates, { needsText: true, needsFiles: true, needsTemplates: false })?.channelAccountId, "b");
equal(selectCampaignChannel(candidates, { needsText: true, needsFiles: false, needsTemplates: true }), null);

const report = summarizeDeliveryEvents([{ outboundActionId: "a", eventType: "ACCEPTED" }, { outboundActionId: "a", eventType: "DELIVERED" }, { outboundActionId: "a", eventType: "DELIVERED" }, { outboundActionId: "b", eventType: "FAILED" }]);
equal(report.actions, 2); equal(report.delivered, 1); equal(report.failed, 1);

equal(canQueueReviewedDraft({ proposal: { kind: "DRAFT_MESSAGE", workspaceId: "w", conversationId: "c", channelType: "ZALO", text: "Draft", modelReference: "m", promptVersion: "1", evidenceMessageIds: [] }, policyDecisionId: "p", approvedBy: "u", approvedAt: "2026-01-01T00:00:00Z" }), true);

const automation = { id: "auto", workspaceId: "w", name: "Lead", enabled: true, trigger: { type: "KEYWORD_MATCHED", channelTypes: ["FACEBOOK"], keywords: ["pricing"] }, actions: [{ type: "PROPOSE_MESSAGE", configuration: { template: "price" } }], version: 1 };
equal(evaluateAutomation({ definition: automation, event: { id: "e", workspaceId: "w", channelType: "FACEBOOK", conversationId: "c", type: "MESSAGE_RECEIVED", text: "Need PRICING", tagId: null }, conversationPolicy: openPolicy }).matched, true);
equal(evaluateAutomation({ definition: automation, event: { id: "e", workspaceId: "w", channelType: "FACEBOOK", conversationId: "c", type: "MESSAGE_RECEIVED", text: "pricing", tagId: null }, conversationPolicy: { ...openPolicy, takeoverMode: "HUMAN_TAKEOVER" } }).matched, false);

const plan = planMultichannelCampaignStep({ recipient: { id: "r", workspaceId: "w", campaignId: "c", contactId: "x", status: "ACTIVE", currentStepPosition: 1, nextStepAt: "2026-01-01T00:00:00Z" }, step: { id: "s", position: 1, delayMinutes: 0, textTemplate: "Hi", attachmentIds: [], allowedChannels: ["FACEBOOK", "ZALO"], requiresTemplate: false }, candidates, now: "2026-01-01T00:00:00Z" });
equal(plan.status, "READY");
equal(plan.status === "READY" ? plan.channelType : null, "ZALO");

const actionRecord = { id: "act", workspaceId: "w", conversationId: "c", providerConversationId: "pc", channelAccountId: "a", channelType: "FACEBOOK", recipientExternalId: "r", status: "APPROVED", textContent: "Hi", attachmentIds: [], idempotencyKey: "k", policyDecisionId: "p", approvedBy: "u", approvedAt: "2026-01-01T00:00:00Z" };
let sends = 0, claims = 0, sentFinalizers = 0;
const executionRegistry = new ChannelAdapterRegistry();
executionRegistry.register({ ...adapter, async sendMessage() { sends += 1; return { providerMessageId: "pm", providerConversationId: "pc", acceptedAt: "2026-01-01T00:00:00Z" }; } });
const execution = await executeOutboundAction("act", { adapters: executionRegistry, createLockId: () => "lock", now: () => "2026-01-01T00:00:00Z", loadAction: async () => actionRecord, loadPolicy: async () => ({ id: "p", workspaceId: "w", allowed: true, expiresAt: "2026-01-01T00:01:00Z" }), isSuppressed: async () => false, claim: async () => { claims += 1; return { ...actionRecord, status: "EXECUTING", executionLockId: "lock" }; }, loadClaimedAttachments: async () => [], finalizeSent: async () => { sentFinalizers += 1; return true; }, finalizeFailed: async () => true, finalizeUnknown: async () => true });
equal(execution.status, "SENT"); equal(sends, 1); equal(claims, 1); equal(sentFinalizers, 1);

let blockedClaims = 0;
const blocked = await executeOutboundAction("act", { adapters: executionRegistry, createLockId: () => "lock", now: () => "2026-01-01T00:00:00Z", loadAction: async () => actionRecord, loadPolicy: async () => ({ id: "p", workspaceId: "w", allowed: true, expiresAt: "2026-01-01T00:01:00Z" }), isSuppressed: async () => true, claim: async () => { blockedClaims += 1; return null; }, loadClaimedAttachments: async () => [], finalizeSent: async () => true, finalizeFailed: async () => true, finalizeUnknown: async () => true });
equal(blocked.status, "NOT_ELIGIBLE"); equal(blockedClaims, 0);

console.log(`PHASE6_CHANNEL_CONTRACTS_PASS assertions=${assertions}`);
