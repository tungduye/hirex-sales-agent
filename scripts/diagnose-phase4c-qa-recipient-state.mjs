#!/usr/bin/env node
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadQaRecipientAllowlist } from "./phase4c-qa-recipient-allowlist.mjs";
import { loadRemoteReadAuthorization } from "./phase4c-remote-read-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!loadRemoteReadAuthorization(root)) { console.error("REMOTE_READ_TEST_SKIPPED authorization=required"); process.exit(0); }
const allowlist = loadQaRecipientAllowlist(root);
const prefix = process.env.HIREX_QA_CAMPAIGN_PREFIX?.trim();
if (!prefix) process.exit(2);

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const base = path.join(root, "src", specifier.slice(2));
    const found = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
    if (!found) throw new Error("MODULE_UNAVAILABLE");
    return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

let phase = "BOOTSTRAP";
try {
  phase = "CLIENT";
  const { createPrivilegedSupabaseClient } = await import("../src/modules/integrations/gmail/server/privileged-supabase.ts");
  const db = createPrivilegedSupabaseClient();
  phase = "CAMPAIGN";
  const { data: campaign, error: campaignError } = await db.from("email_campaigns")
    .select("id,name,workspace_id")
    .like("name", `${prefix}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (campaignError || !campaign) throw new Error("CAMPAIGN_UNAVAILABLE");

  phase = "RECIPIENTS";
  const [{ data: recipients, error: recipientError }, { data: suppressions, error: suppressionError }] = await Promise.all([
    db.from("email_campaign_recipients")
      .select("id,email,normalized_email,status,engagement_status")
      .eq("workspace_id", campaign.workspace_id)
      .eq("campaign_id", campaign.id)
      .in("normalized_email", allowlist),
    db.from("email_suppressions")
      .select("normalized_email,reason,source")
      .eq("workspace_id", campaign.workspace_id)
      .in("normalized_email", allowlist),
  ]);
  if (recipientError || suppressionError) throw new Error("RECIPIENTS_UNAVAILABLE");

  const recipientIds = (recipients ?? []).map((row) => row.id);
  phase = "DELIVERIES";
  const { data: deliveries, error: deliveryError } = recipientIds.length
    ? await db.from("email_campaign_recipient_steps")
      .select("recipient_id,step_order,status,send_request_id,provider_thread_id")
      .eq("workspace_id", campaign.workspace_id)
      .eq("campaign_id", campaign.id)
      .in("recipient_id", recipientIds)
      .order("step_order")
    : { data: [], error: null };
  if (deliveryError) throw new Error("DELIVERIES_UNAVAILABLE");

  const requestIds = [...new Set((deliveries ?? []).map((row) => row.send_request_id).filter(Boolean))];
  phase = "REQUESTS";
  const { data: requests, error: requestError } = requestIds.length
    ? await db.from("email_send_requests").select("id,status,provider_thread_id").in("id", requestIds)
    : { data: [], error: null };
  if (requestError) throw new Error("REQUESTS_UNAVAILABLE");

  const suppressionByEmail = new Map((suppressions ?? []).map((row) => [row.normalized_email, row]));
  const suppressed = new Set(suppressionByEmail.keys());
  const requestById = new Map((requests ?? []).map((row) => [row.id, row]));
  const results = allowlist.map((email) => {
    const recipient = (recipients ?? []).find((row) => row.normalized_email === email);
    const recipientDeliveries = recipient ? (deliveries ?? []).filter((row) => row.recipient_id === recipient.id) : [];
    const initial = recipientDeliveries.find((row) => row.step_order === 0);
    const followUp = recipientDeliveries.find((row) => row.step_order === 1);
    const sendRequests = recipientDeliveries.map((row) => row.send_request_id ? requestById.get(row.send_request_id) : null).filter(Boolean);
    const hasSent = sendRequests.some((row) => row.status === "SENT");
    const threadPresent = recipientDeliveries.some((row) => typeof row.provider_thread_id === "string" && row.provider_thread_id.length > 0)
      || sendRequests.some((row) => typeof row.provider_thread_id === "string" && row.provider_thread_id.length > 0);
    const hasSentCampaignMessage = !!recipient && hasSent;
    const preferred = hasSentCampaignMessage && !suppressed.has(email) && recipient.engagement_status !== "UNSUBSCRIBED";
    return { email, recipient, initial, followUp, sendRequests, threadPresent, hasSentCampaignMessage, preferred };
  });

  console.log(`QA_CAMPAIGN=${campaign.id}/${campaign.name}`);
  for (const result of results) {
    const requestStatus = result.sendRequests.map((row) => row.status).join(",") || "NONE";
    console.log(result.email);
    console.log(` recipient_status=${result.recipient?.status ?? "NOT_IN_CAMPAIGN"}`);
    console.log(` engagement_status=${result.recipient?.engagement_status ?? "NOT_IN_CAMPAIGN"}`);
    console.log(` initial=${result.initial?.status ?? "NONE"}`);
    console.log(` follow_up=${result.followUp?.status ?? "NONE"}`);
    console.log(` send_request_status=${requestStatus}`);
    console.log(` thread=${result.threadPresent}`);
    console.log(` suppression_reason=${suppressionByEmail.get(result.email)?.reason ?? "NONE"}`);
  }

  const candidates = results.filter((result) => result.hasSentCampaignMessage);
  const selected = candidates.find((result) => result.preferred) ?? candidates[0];
  console.log(`LOGIN_TO_RECIPIENT=${selected?.email ?? "NONE"}`);
  if (!selected) process.exitCode = 1;
} catch {
  console.error(`QA_RECIPIENT_STATE_UNAVAILABLE phase=${phase}`);
  process.exitCode = 1;
}
