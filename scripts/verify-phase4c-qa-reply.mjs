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
} });

try {
  const { createPrivilegedSupabaseClient } = await import("../src/modules/integrations/gmail/server/privileged-supabase.ts");
  const db = createPrivilegedSupabaseClient();
  const { data: campaign } = await db.from("email_campaigns")
    .select("id,name,workspace_id,email_campaign_recipients(id,email,normalized_email,engagement_status,replied_at,reply_email_message_id)")
    .eq("id", campaignId).maybeSingle();
  if (!campaign || !campaign.name.startsWith(process.env.HIREX_QA_CAMPAIGN_PREFIX)) throw new Error("GUARD");

  const allowlist = new Set(parseQaRecipientAllowlist(process.env.HIREX_QA_RECIPIENT_ALLOWLIST));
  const recipients = campaign.email_campaign_recipients ?? [];
  if (recipients.length !== 1 || !recipients.every((row) => allowlist.has(row.normalized_email))) throw new Error("GUARD");
  const recipient = recipients[0];
  const { data: steps, error: stepError } = await db.from("email_campaign_recipient_steps")
    .select("sender_email_account_id,provider_thread_id,status")
    .eq("workspace_id", campaign.workspace_id).eq("campaign_id", campaign.id).eq("recipient_id", recipient.id).eq("status", "SENT");
  if (stepError || !(steps ?? []).length) throw new Error("STEPS");
  const accountIds = [...new Set((steps ?? []).map((row) => row.sender_email_account_id).filter(Boolean))];
  const threadIds = new Set((steps ?? []).map((row) => row.provider_thread_id).filter(Boolean));
  const { data: inbound, error: inboundError } = await db.from("email_messages")
    .select("id,direction,from_email,email_account_id,email_threads(provider_thread_id)")
    .eq("workspace_id", campaign.workspace_id).eq("direction", "INBOUND").eq("from_email", recipient.normalized_email)
    .in("email_account_id", accountIds).order("received_at", { ascending: false }).limit(20);
  if (inboundError) throw new Error("MESSAGES");
  const matchingInbound = (inbound ?? []).find((message) => {
    const thread = message.email_threads;
    const providerThreadId = Array.isArray(thread) ? thread[0]?.provider_thread_id : thread?.provider_thread_id;
    return typeof providerThreadId === "string" && threadIds.has(providerThreadId);
  });
  const { data: suppressions, error: suppressionError } = await db.from("email_suppressions")
    .select("id,reason,source,created_at").eq("workspace_id", campaign.workspace_id).eq("normalized_email", recipient.normalized_email);
  if (suppressionError) throw new Error("SUPPRESSION");
  const sourceStored = recipient.engagement_status === "REPLIED" && typeof recipient.replied_at === "string"
    && uuid.test(recipient.reply_email_message_id ?? "") && recipient.reply_email_message_id === matchingInbound?.id;
  const persisted = !!matchingInbound;
  const replyCreatedSuppression = (suppressions ?? []).some((row) => !recipient.replied_at || new Date(row.created_at).getTime() > new Date(recipient.replied_at).getTime());
  const pass = persisted && sourceStored && !replyCreatedSuppression;
  console.log(`QA_REPLY_VERIFY pass=${pass} inboundPersisted=${persisted} engagement=${recipient.engagement_status} repliedAt=${typeof recipient.replied_at === "string"} replySourceStored=${sourceStored} suppressionCount=${suppressions?.length ?? 0} replyCreatedSuppression=${replyCreatedSuppression}`);
  if (!pass) process.exitCode = 1;
} catch {
  console.error("QA_REPLY_VERIFY_UNAVAILABLE");
  process.exitCode = 1;
}
