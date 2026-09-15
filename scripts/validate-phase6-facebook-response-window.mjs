#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ChannelAdapterRegistry } from "../src/modules/channels/core/channel-adapter-registry.ts";
import { executeOutboundAction } from "../src/modules/channels/core/execute-outbound-action.ts";
import { FACEBOOK_RESPONSE_WINDOW_MS, isFacebookResponseWindowOpen } from "../src/modules/channels/core/facebook-response-window.ts";

let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions += 1; };
const source = file => readFileSync(new URL(file, import.meta.url), "utf8");
const now = new Date("2026-09-15T12:00:00.000Z");
const ids = { workspace: "90000000-0000-4000-8000-000000000001", account: "90000000-0000-4000-8000-000000000002", conversation: "90000000-0000-4000-8000-000000000003", action: "90000000-0000-4000-8000-000000000004", policy: "90000000-0000-4000-8000-000000000005", approver: "90000000-0000-4000-8000-000000000006" };
const psid = "qa-page-scoped-id";
const action = { id: ids.action, workspaceId: ids.workspace, conversationId: ids.conversation, providerConversationId: psid, channelAccountId: ids.account, channelType: "FACEBOOK", recipientExternalId: psid, status: "APPROVED", textContent: "Synthetic response-window test", attachmentIds: [], idempotencyKey: "window-once", policyDecisionId: ids.policy, approvedBy: ids.approver, approvedAt: new Date(now.getTime() - 22 * 60 * 60 * 1000).toISOString() };

function windowAllowed(evidence) {
  return evidence.workspaceId === ids.workspace && evidence.accountId === ids.account && evidence.conversationId === ids.conversation && evidence.providerId === psid &&
    isFacebookResponseWindowOpen({ status: evidence.status, latestInboundAt: evidence.latestInboundAt }, now);
}

async function runCase(name, evidence, expectedAllowed) {
  let providerCalls = 0, failedFinalizers = 0;
  const adapters = new ChannelAdapterRegistry();
  adapters.register({ channelType: "FACEBOOK", capabilities: new Set(["SEND_TEXT"]), verifyWebhook: async () => false, normalizeInbound: async () => [], healthCheck: async () => "CONNECTED", sendMessage: async () => { providerCalls += 1; return { providerMessageId: `provider-${name}`, providerConversationId: psid, acceptedAt: now.toISOString() }; } });
  const result = await executeOutboundAction(ids.action, {
    adapters, createLockId: () => "lock", now: () => now.toISOString(), loadAction: async () => action,
    loadPolicy: async () => ({ id: ids.policy, workspaceId: ids.workspace, allowed: true, expiresAt: new Date(now.getTime() + 60_000).toISOString() }),
    isSuppressed: async () => false, claim: async () => ({ ...action, status: "EXECUTING", executionLockId: "lock" }), loadClaimedAttachments: async () => [],
    validatePreSend: async () => ({ allowed: windowAllowed(evidence), safeErrorCode: "FACEBOOK_RESPONSE_WINDOW_EXPIRED" }),
    finalizeSent: async () => true, finalizeFailed: async ({ safeErrorCode }) => { failedFinalizers += 1; equal(safeErrorCode, "FACEBOOK_RESPONSE_WINDOW_EXPIRED"); return true; }, finalizeUnknown: async () => true,
  });
  equal(result.status, expectedAllowed ? "SENT" : "FAILED");
  equal(providerCalls, expectedAllowed ? 1 : 0);
  equal(failedFinalizers, expectedAllowed ? 0 : 1);
}

const base = { workspaceId: ids.workspace, accountId: ids.account, conversationId: ids.conversation, providerId: psid, status: "OPEN" };
await runCase("one-minute", { ...base, latestInboundAt: new Date(now.getTime() - 60_000).toISOString() }, true);
await runCase("just-under", { ...base, latestInboundAt: new Date(now.getTime() - FACEBOOK_RESPONSE_WINDOW_MS + 1).toISOString() }, true);
await runCase("boundary", { ...base, latestInboundAt: new Date(now.getTime() - FACEBOOK_RESPONSE_WINDOW_MS).toISOString() }, false);
await runCase("older", { ...base, latestInboundAt: new Date(now.getTime() - FACEBOOK_RESPONSE_WINDOW_MS - 1).toISOString() }, false);
await runCase("approved-after-expiry", { ...base, latestInboundAt: new Date(now.getTime() - FACEBOOK_RESPONSE_WINDOW_MS - 60_000).toISOString() }, false);
await runCase("inbound-refreshed", { ...base, latestInboundAt: new Date(now.getTime() - 1_000).toISOString() }, true);
await runCase("wrong-account", { ...base, accountId: "90000000-0000-4000-8000-000000000099", latestInboundAt: now.toISOString() }, false);
await runCase("missing-conversation", { ...base, conversationId: null, latestInboundAt: now.toISOString() }, false);
await runCase("wrong-provider-identity", { ...base, providerId: "different-page-scoped-id", latestInboundAt: now.toISOString() }, false);
await runCase("missing-inbound", { ...base, latestInboundAt: null }, false);
await runCase("closed", { ...base, status: "CLOSED", latestInboundAt: now.toISOString() }, false);

const persistenceSource = source("../src/modules/channels/server/execute-channel-outbound-action.ts");
const executionSource = source("../src/modules/channels/core/execute-outbound-action.ts");
const uiSource = source("../src/modules/channels/components/conversation-composer.tsx");
const actionSource = source("../src/modules/channels/server/channel-actions.ts");
equal(persistenceSource.includes('.eq("direction", "INBOUND")'), true);
equal(persistenceSource.includes('.eq("channel_account_id", action.channelAccountId)'), true);
equal(persistenceSource.includes('.eq("provider_conversation_id", action.recipientExternalId)'), true);
equal(executionSource.indexOf("validatePreSend") < executionSource.indexOf("adapter.sendMessage(command)"), true);
equal(uiSource.includes("The Facebook reply window has expired"), true);
equal(uiSource.includes("disabled={pending||approvalDisabled}"), true);
equal(actionSource.includes("The Facebook reply window has expired. No message was sent."), true);

console.log(`PHASE6_FACEBOOK_RESPONSE_WINDOW_PASS assertions=${assertions}`);
