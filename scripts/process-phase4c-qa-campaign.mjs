#!/usr/bin/env node
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPhase4cQaEnv } from "./load-phase4c-qa-env.mjs";
import { parseQaRecipientAllowlist } from "./phase4c-qa-recipient-allowlist.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { missing } = loadPhase4cQaEnv(root);
const campaignId = process.argv[2];
const preflightOnly = process.argv.includes("--preflight");
const expectZero = process.argv.includes("--expect-zero");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (missing.length || process.env.HIREX_ALLOW_REMOTE_SYNTHETIC_TESTS !== "1" || !uuid.test(campaignId ?? "")) {
  console.error("QA_CAMPAIGN_GUARD_FAILED");
  process.exit(2);
}

let allowlist;
try {
  allowlist = new Set(parseQaRecipientAllowlist(process.env.HIREX_QA_RECIPIENT_ALLOWLIST));
} catch {
  console.error("QA_CAMPAIGN_GUARD_FAILED");
  process.exit(2);
}
const approvedSender = process.env.HIREX_QA_SENDER_EMAIL.trim().toLowerCase();
const prefix = process.env.HIREX_QA_CAMPAIGN_PREFIX.trim();
const maxSends = Number(process.env.HIREX_QA_MAX_LIVE_SENDS);
if (!allowlist.size || !approvedSender || !prefix || !Number.isInteger(maxSends) || maxSends < 1) {
  console.error("QA_CAMPAIGN_GUARD_FAILED");
  process.exit(2);
}

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const base = path.join(root, "src", specifier.slice(2));
    const found = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
    if (!found) throw new Error("MODULE_UNAVAILABLE");
    return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}});

try {
  const { createPrivilegedSupabaseClient } = await import("../src/modules/integrations/gmail/server/privileged-supabase.ts");
  const db = createPrivilegedSupabaseClient();
  const { data: campaign, error } = await db.from("email_campaigns")
    .select("id,name,status,email_campaign_recipients(email,engagement_status),email_campaign_senders(enabled,email_accounts(email_address,status,scopes)),email_campaign_steps(id,enabled)")
    .eq("id", campaignId).maybeSingle();
  if (error || !campaign) throw new Error("CAMPAIGN_UNAVAILABLE");
  const recipients = campaign.email_campaign_recipients ?? [];
  const senders = campaign.email_campaign_senders ?? [];
  const steps = (campaign.email_campaign_steps ?? []).filter((step) => step.enabled);
  const deliverable = recipients.filter((recipient) => recipient.engagement_status === "ACTIVE");
  const senderSafe = senders.length === 1 && senders[0].enabled === true && senders[0].email_accounts?.status === "CONNECTED" && senders[0].email_accounts.email_address.trim().toLowerCase() === approvedSender && senders[0].email_accounts.scopes?.includes("https://www.googleapis.com/auth/gmail.send");
  const recipientsSafe = recipients.length > 0 && recipients.every((recipient) => allowlist.has(recipient.email.trim().toLowerCase())) && (expectZero || deliverable.length > 0);
  const projected = deliverable.length * steps.length;
  const statusSafe = preflightOnly ? campaign.status === "DRAFT" || campaign.status === "RUNNING" : campaign.status === "RUNNING";
  if (!campaign.name.startsWith(prefix) || !senderSafe || !recipientsSafe || (!expectZero && projected < 1) || projected > maxSends || (!expectZero && !statusSafe)) throw new Error("GUARD_REJECTED");
  console.log(`QA_CAMPAIGN_PREFLIGHT_PASS recipients=${deliverable.length} steps=${steps.length} projected=${projected}`);
  if (!preflightOnly) {
    const { processEmailCampaignSequenceBatch } = await import("../src/modules/campaigns/server/process-email-campaign-sequence-batch.ts");
    const result = await processEmailCampaignSequenceBatch(1, campaignId);
    console.log(`QA_CAMPAIGN_BATCH success=${result.success} processed=${result.deliveriesProcessed} sent=${result.sent} failed=${result.failed} deliveryUnknown=${result.deliveryUnknown}`);
    if (!result.success || result.deliveryUnknown > 0 || (expectZero && (result.deliveriesProcessed !== 0 || result.sent !== 0))) process.exitCode = 1;
  }
} catch {
  console.error("QA_CAMPAIGN_GUARD_FAILED");
  process.exitCode = 1;
}
