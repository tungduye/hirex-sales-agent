#!/usr/bin/env node
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPhase4cQaEnv } from "./load-phase4c-qa-env.mjs";
import { parseQaRecipientAllowlist } from "./phase4c-qa-recipient-allowlist.mjs";
import { loadRemoteReadAuthorization } from "./phase4c-remote-read-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!loadRemoteReadAuthorization(root)) { console.error("REMOTE_READ_TEST_SKIPPED authorization=required"); process.exit(0); }
const { missing } = loadPhase4cQaEnv(root);
const campaignId = process.argv[2];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (missing.length || !uuid.test(campaignId ?? "")) process.exit(2);

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
  const [{ data: campaign }, { data: deliveries }] = await Promise.all([
    db.from("email_campaigns").select("id,name,status,completed_at,email_campaign_recipients(email),email_campaign_senders(email_accounts(email_address))").eq("id", campaignId).maybeSingle(),
    db.from("email_campaign_recipient_steps").select("status,send_request_id,safe_error_code").eq("campaign_id", campaignId).order("step_order"),
  ]);
  if (!campaign || !campaign.name.startsWith(process.env.HIREX_QA_CAMPAIGN_PREFIX)) throw new Error("GUARD_REJECTED");
  const allowlist = new Set(parseQaRecipientAllowlist(process.env.HIREX_QA_RECIPIENT_ALLOWLIST));
  const audienceSafe = (campaign.email_campaign_recipients ?? []).every((row) => allowlist.has(row.email.trim().toLowerCase()));
  const senderSafe = campaign.email_campaign_senders?.length === 1 && campaign.email_campaign_senders[0].email_accounts?.email_address.trim().toLowerCase() === process.env.HIREX_QA_SENDER_EMAIL.trim().toLowerCase();
  const requestIds = (deliveries ?? []).map((row) => row.send_request_id).filter(Boolean);
  const { data: requests } = requestIds.length ? await db.from("email_send_requests").select("id,status,provider_message_id,provider_thread_id").in("id", requestIds) : { data: [] };
  const sent = (requests ?? []).filter((row) => row.status === "SENT");
  const sameThread = sent.length === 2 && sent.every((row) => typeof row.provider_thread_id === "string" && row.provider_thread_id === sent[0].provider_thread_id);
  const providerMessagesUnique = new Set(sent.map((row) => row.provider_message_id)).size === sent.length && sent.every((row) => typeof row.provider_message_id === "string");
  const duplicateSends = Math.max(0, requestIds.length - new Set(requestIds).size);
  const deliveryUnknown = (deliveries ?? []).filter((row) => row.status === "DELIVERY_UNKNOWN").length;
  const failed = (deliveries ?? []).filter((row) => row.status === "FAILED").length;
  const completion = campaign.status === "COMPLETED" && typeof campaign.completed_at === "string";
  const pass = audienceSafe && senderSafe && sent.length === 2 && sameThread && providerMessagesUnique && duplicateSends === 0 && deliveryUnknown === 0 && failed === 0 && completion;
  console.log(`QA_CAMPAIGN_VERIFY pass=${pass} sent=${sent.length} sameThread=${sameThread} duplicateSends=${duplicateSends} deliveryUnknown=${deliveryUnknown} failed=${failed} completed=${completion}`);
  if (!pass) process.exitCode = 1;
} catch {
  console.error("QA_CAMPAIGN_VERIFY_UNAVAILABLE");
  process.exitCode = 1;
}
