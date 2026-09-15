#!/usr/bin/env node
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const base = fileURLToPath(new URL(`../src/${specifier.slice(2)}`, import.meta.url));
    const file = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    const file = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

nextEnv.loadEnvConfig(process.cwd());
if (process.env.HIREX_ALLOW_REMOTE_SYNTHETIC_TESTS !== "1") throw new Error("REMOTE_SYNTHETIC_TEST_GUARD_REQUIRED");

const { ChannelAdapterRegistry } = await import("../src/modules/channels/core/channel-adapter-registry.ts");
const { ZaloBridgeAdapter } = await import("../src/modules/channels/adapters/zalo/zalo-bridge-adapter.ts");
const { FetchChannelTransport } = await import("../src/modules/channels/core/channel-transport.ts");
const { executeChannelOutboundAction } = await import("../src/modules/channels/server/execute-channel-outbound-action.ts");
const { processChannelCampaignBatch } = await import("../src/modules/channels/server/process-channel-campaign-batch.ts");
const { projectChannelCampaign } = await import("../src/modules/channels/server/project-channel-campaign.ts");

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const accountId = "98100000-0000-4000-8000-000000000001";
const contactId = "98100000-0000-4000-8000-000000000002";
const conversationId = "98100000-0000-4000-8000-000000000003";
const campaignId = "98100000-0000-4000-8000-000000000004";
const campaignStepId = "98100000-0000-4000-8000-000000000005";
const campaignRecipientId = "98100000-0000-4000-8000-000000000006";
const externalAccountId = "mock-zalo-account-remote-outbound";
const recipient = "mock-zalo-user-remote-outbound";
const providerThread = "mock-zalo-thread-remote-outbound";
const port = 18787;
const secret = randomBytes(32).toString("base64url");
const output = { realProviderCalls: 0, realMessages: 0 };
let workspaceId;
let actorId;
let child;

async function control(value) {
  const response = await fetch(`http://127.0.0.1:${port}/__mock/state`, { method: "POST", headers: { "content-type": "application/json", "x-mock-control-secret": secret }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error("MOCK_CONTROL_FAILED");
}
async function metrics() {
  const response = await fetch(`http://127.0.0.1:${port}/__mock/metrics`, { headers: { "x-mock-control-secret": secret } });
  if (!response.ok) throw new Error("MOCK_METRICS_FAILED");
  return response.json();
}
async function cleanup() {
  const actions = await service.from("channel_outbound_actions").select("id").eq("channel_account_id", accountId);
  const actionIds = (actions.data ?? []).flatMap(row => typeof row.id === "string" ? [row.id] : []);
  if (actionIds.length > 0 && workspaceId) await service.from("audit_logs").delete().eq("workspace_id", workspaceId).in("entity_id", actionIds);
  await service.from("channel_campaigns").delete().eq("id", campaignId);
  await service.from("channel_accounts").delete().eq("id", accountId);
  await service.from("contacts").delete().eq("id", contactId);
}
async function createAction(label) {
  const policyId = randomUUID();
  const actionId = randomUUID();
  let result = await service.from("channel_policy_decisions").insert({ id: policyId, workspace_id: workspaceId, conversation_id: conversationId, channel_account_id: accountId, channel_type: "ZALO", normalized_recipient: recipient, allowed: true, reason_codes: [], expires_at: new Date(Date.now() + 600_000).toISOString() });
  if (result.error) throw new Error("POLICY_FIXTURE_FAILED");
  result = await service.from("channel_outbound_actions").insert({ id: actionId, workspace_id: workspaceId, conversation_id: conversationId, channel_account_id: accountId, channel_type: "ZALO", recipient_external_id: recipient, status: "APPROVED", text_content: `HireX remote mock ${label}`, idempotency_key: `remote-mock:${label}:${actionId}`, policy_decision_id: policyId, proposed_by: "HUMAN", approved_by: actorId, approved_at: new Date().toISOString() });
  if (result.error) throw new Error("ACTION_FIXTURE_FAILED");
  return actionId;
}

try {
  const base = await service.from("channel_accounts").select("workspace_id,connected_by").eq("channel_type", "FACEBOOK").eq("status", "CONNECTED").limit(1).single();
  if (base.error) throw new Error("WORKSPACE_CONTEXT_UNAVAILABLE");
  workspaceId = base.data.workspace_id; actorId = base.data.connected_by;
  await cleanup();
  let result = await service.from("contacts").insert({ id: contactId, workspace_id: workspaceId, full_name: "HireX Remote Mock Zalo Outbound", lead_status: "NEW", lead_score: 0 });
  if (result.error) throw new Error("CONTACT_FIXTURE_FAILED");
  result = await service.from("contact_channels").insert({ workspace_id: workspaceId, contact_id: contactId, channel_type: "ZALO", channel_value: recipient, is_primary: true, metadata: { synthetic: true }, marketing_consent_status: "OPTED_IN", marketing_consent_source: "MOCK_E2E", marketing_consent_recorded_at: new Date().toISOString() });
  if (result.error) throw new Error("IDENTITY_FIXTURE_FAILED");
  result = await service.from("channel_accounts").insert({ id: accountId, workspace_id: workspaceId, connected_by: actorId, channel_type: "ZALO", provider: "ZALO_BRIDGE", external_account_id: externalAccountId, display_name: "HireX Mock Zalo Remote Outbound", status: "CONNECTED", capabilities: ["SEND_TEXT", "REPLY"], metadata: { synthetic: true } });
  if (result.error) throw new Error("ACCOUNT_FIXTURE_FAILED");
  result = await service.from("omnichannel_conversations").insert({ id: conversationId, workspace_id: workspaceId, channel_account_id: accountId, channel_type: "ZALO", provider_conversation_id: providerThread, contact_id: contactId, status: "OPEN", last_message_at: new Date().toISOString(), metadata: { synthetic: true, participantExternalId: recipient } });
  if (result.error) throw new Error("CONVERSATION_FIXTURE_FAILED");
  result = await service.from("omnichannel_messages").insert({ workspace_id: workspaceId, conversation_id: conversationId, channel_account_id: accountId, channel_type: "ZALO", provider_message_id: "mock-seed-inbound", direction: "INBOUND", sender_external_id: recipient, recipient_external_ids: [externalAccountId], text_content: "Synthetic seed", received_at: new Date().toISOString(), metadata: { synthetic: true } });
  if (result.error) throw new Error("MESSAGE_FIXTURE_FAILED");

  child = spawn(process.execPath, ["tools/mock-zalo-bridge/server.mjs"], { cwd: process.cwd(), env: { ...process.env, MOCK_ZALO_BRIDGE_PORT: String(port), MOCK_ZALO_ACCOUNT_ID: externalAccountId, MOCK_ZALO_SIGNING_SECRET: secret }, stdio: ["ignore", "pipe", "pipe"] });
  let ready = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", chunk => { ready += chunk; });
  for (let index = 0; index < 100 && !ready.includes("MOCK_ZALO_BRIDGE_READY"); index += 1) await new Promise(resolve => setTimeout(resolve, 25));
  if (!ready.includes("MOCK_ZALO_BRIDGE_READY")) throw new Error("MOCK_START_FAILED");
  const adapter = new ZaloBridgeAdapter(workspaceId, accountId, { bridgeAccountId: externalAccountId, bridgeBaseUrl: `http://127.0.0.1:${port}`, signingSecret: secret }, new FetchChannelTransport());
  const registry = new ChannelAdapterRegistry(); registry.register(adapter);

  await control({ reset: true, health: "HEALTHY", healthMode: "NORMAL", sendMode: "SENT" });
  const sentAction = await createAction("sent");
  output.sentResult = (await executeChannelOutboundAction(sentAction, registry)).status;
  output.sentReplayResult = (await executeChannelOutboundAction(sentAction, registry)).status;
  let row = await service.from("channel_outbound_actions").select("status,attempt_count,provider_message_id,idempotency_key").eq("id", sentAction).single();
  let messages = await service.from("omnichannel_messages").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("conversation_id", conversationId).eq("direction", "OUTBOUND");
  output.sentPersistence = !row.error && row.data.status === "SENT" && row.data.attempt_count === 1 && typeof row.data.provider_message_id === "string" && messages.count === 1;
  output.sentMetrics = await metrics();
  let healthRow = await service.from("channel_accounts").select("provider_health_status,provider_health_checked_at,provider_health_latency_ms").eq("id", accountId).single();
  output.healthCacheHealthy = !healthRow.error && healthRow.data.provider_health_status === "HEALTHY" && typeof healthRow.data.provider_health_checked_at === "string" && Number.isInteger(healthRow.data.provider_health_latency_ms);

  for (const [mode, expected] of [["FAILED", "FAILED"], ["UNKNOWN", "DELIVERY_UNKNOWN"], ["MALFORMED", "DELIVERY_UNKNOWN"]]) {
    await control({ reset: true, health: "HEALTHY", healthMode: "NORMAL", sendMode: mode });
    const action = await createAction(mode.toLowerCase());
    output[`${mode.toLowerCase()}Result`] = (await executeChannelOutboundAction(action, registry)).status;
    row = await service.from("channel_outbound_actions").select("status,attempt_count").eq("id", action).single();
    output[`${mode.toLowerCase()}Persisted`] = !row.error && row.data.status === expected && row.data.attempt_count === 1;
  }

  const guards = {};
  for (const health of ["DEGRADED", "DISCONNECTED", "AUTH_REQUIRED", "UNKNOWN"]) {
    await control({ reset: true, health, healthMode: "NORMAL", sendMode: "SENT" });
    const action = await createAction(`guard-${health.toLowerCase()}`);
    const before = await metrics();
    const execution = await executeChannelOutboundAction(action, registry);
    const after = await metrics();
    healthRow = await service.from("channel_accounts").select("provider_health_status,provider_health_checked_at").eq("id", accountId).single();
    guards[health] = execution.status === "FAILED" && after.sendCalls === before.sendCalls && !healthRow.error && healthRow.data.provider_health_status === health && typeof healthRow.data.provider_health_checked_at === "string";
  }
  await service.from("channel_accounts").update({ operator_enabled: false }).eq("id", accountId);
  const disabledAction = await createAction("guard-disabled");
  const beforeDisabled = await metrics();
  const disabledResult = await executeChannelOutboundAction(disabledAction, registry);
  const afterDisabled = await metrics();
  guards.DISABLED = disabledResult.status === "FAILED" && afterDisabled.sendCalls === beforeDisabled.sendCalls;
  output.healthGuards = guards;

  await service.from("channel_accounts").update({ operator_enabled: true }).eq("id", accountId);
  await control({ reset: true, health: "HEALTHY", healthMode: "NORMAL", sendMode: "TIMEOUT_AFTER_ACCEPT" });
  const timeoutAction = await createAction("timeout");
  output.timeoutResult = (await executeChannelOutboundAction(timeoutAction, registry)).status;
  row = await service.from("channel_outbound_actions").select("status,attempt_count,idempotency_key").eq("id", timeoutAction).single();
  const timeoutMetrics = await metrics();
  output.timeoutPersisted = !row.error && row.data.status === "DELIVERY_UNKNOWN" && row.data.attempt_count === 1 && typeof row.data.idempotency_key === "string";
  output.timeoutCalls = timeoutMetrics.sendCalls;
  output.timeoutDeliveries = timeoutMetrics.deliveries;

  await control({ reset: true, health: "HEALTHY", healthMode: "NORMAL", sendMode: "SENT" });
  const campaignRows = [
    () => service.from("channel_campaigns").insert({ id: campaignId, workspace_id: workspaceId, name: "HireX Mock Zalo Remote Campaign", status: "RUNNING", stop_on_reply: true, created_by: actorId, started_at: new Date().toISOString() }),
    () => service.from("channel_campaign_steps").insert({ id: campaignStepId, workspace_id: workspaceId, campaign_id: campaignId, position: 1, delay_minutes: 0, text_template: "HireX mock Zalo campaign", allowed_channels: ["ZALO"] }),
    () => service.from("channel_campaign_senders").insert({ workspace_id: workspaceId, campaign_id: campaignId, channel_account_id: accountId, priority: 1, enabled: true }),
    () => service.from("channel_campaign_recipients").insert({ id: campaignRecipientId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, status: "ACTIVE", current_step_position: 1, next_step_at: new Date().toISOString() }),
  ];
  for (const insert of campaignRows) { const inserted = await insert(); if (inserted.error) throw new Error("CAMPAIGN_FIXTURE_FAILED"); }
  const recipientStep = await service.from("channel_campaign_recipient_steps").insert({ workspace_id: workspaceId, campaign_id: campaignId, recipient_id: campaignRecipientId, step_id: campaignStepId, status: "PENDING", idempotency_key: `channel-campaign:${campaignId}:${campaignRecipientId}:${campaignStepId}` });
  if (recipientStep.error) throw new Error("CAMPAIGN_STEP_FIXTURE_FAILED");
  const campaignGuards = {};
  for (const health of ["DEGRADED", "DISCONNECTED", "AUTH_REQUIRED", "UNKNOWN"]) {
    await service.from("channel_accounts").update({ operator_enabled: true, provider_health_status: health, provider_health_checked_at: new Date().toISOString(), provider_health_reason_code: health }).eq("id", accountId);
    const projection = await projectChannelCampaign({ workspaceId, campaignId, maximumActions: 1 });
    campaignGuards[health] = projection.projectedActions === 0;
  }
  await service.from("channel_accounts").update({ operator_enabled: true, provider_health_status: "HEALTHY", provider_health_checked_at: new Date(Date.now() - 10 * 60_000).toISOString(), provider_health_reason_code: null }).eq("id", accountId);
  campaignGuards.STALE = (await projectChannelCampaign({ workspaceId, campaignId, maximumActions: 1 })).projectedActions === 0;
  await service.from("channel_accounts").update({ operator_enabled: false, provider_health_status: "HEALTHY", provider_health_checked_at: new Date().toISOString(), provider_health_reason_code: null }).eq("id", accountId);
  campaignGuards.DISABLED = (await projectChannelCampaign({ workspaceId, campaignId, maximumActions: 1 })).projectedActions === 0;
  await service.from("channel_accounts").update({ operator_enabled: true, provider_health_status: "HEALTHY", provider_health_checked_at: new Date().toISOString(), provider_health_reason_code: null }).eq("id", accountId);
  output.campaignHealthGuards = campaignGuards;
  const dryRun = await processChannelCampaignBatch({ workspaceId, campaignId, maximumActions: 1, dryRun: true }, registry);
  output.campaignDryRun = dryRun.eligibleRecipientCount === 1 && dryRun.projectedActions === 1 && dryRun.claimed === 0;
  const campaignRun = await processChannelCampaignBatch({ workspaceId, campaignId, maximumActions: 1 }, registry);
  output.campaignRun = campaignRun;
  const campaignAction = await service.from("channel_outbound_actions").select("id,status,attempt_count,provider_message_id,conversation_id").eq("workspace_id", workspaceId).eq("idempotency_key", `channel-campaign:${campaignId}:${campaignRecipientId}:${campaignStepId}`).single();
  const campaignMessages = await service.from("omnichannel_messages").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("conversation_id", conversationId).eq("direction", "OUTBOUND").eq("text_content", "HireX mock Zalo campaign");
  output.campaignPersistence = !campaignAction.error && campaignAction.data.status === "SENT" && campaignAction.data.attempt_count === 1 && campaignAction.data.conversation_id === conversationId && typeof campaignAction.data.provider_message_id === "string" && campaignMessages.count === 1;
  output.campaignMetrics = await metrics();
  const secondCampaignRun = await processChannelCampaignBatch({ workspaceId, campaignId, maximumActions: 1 }, registry);
  const afterSecond = await metrics();
  output.campaignIdempotency = secondCampaignRun.claimed === 0 && afterSecond.deliveries === 1;
} catch (error) {
  output.failure = error instanceof Error ? error.message : "REMOTE_MOCK_E2E_FAILED";
} finally {
  if (child) { child.kill("SIGTERM"); if (child.exitCode === null) await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 2_000))]); }
  await cleanup();
  const accounts = await service.from("channel_accounts").select("id", { count: "exact", head: true }).eq("id", accountId);
  const contacts = await service.from("contacts").select("id", { count: "exact", head: true }).eq("id", contactId);
  output.syntheticRemaining = (accounts.count ?? 0) + (contacts.count ?? 0);
}

console.log(JSON.stringify(output));
