#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPhase4cQaEnv } from "./load-phase4c-qa-env.mjs";
import { parseQaRecipientAllowlist } from "./phase4c-qa-recipient-allowlist.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
delete process.env.HIREX_QA_RECIPIENT_ALLOWLIST;
loadPhase4cQaEnv(root);
const mode = process.argv[2];
const requestedRecipient = process.argv.find((value) => value.startsWith("--recipient="))?.slice(12).trim().toLowerCase();
const statePath = path.join(root, "runtime", "phase5-live-attachment-state.json");
const filename = "phase5-live-attachment-test.txt";
const bytes = Buffer.from("HireX Phase 5 live attachment QA", "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (process.env.HIREX_ALLOW_LIVE_EMAIL_TESTS !== "1") fail("LIVE_GUARD_REQUIRED");
const allowlist = parseQaRecipientAllowlist(process.env.HIREX_QA_RECIPIENT_ALLOWLIST);
const sender = process.env.HIREX_QA_SENDER_EMAIL?.trim().toLowerCase();
const prefix = process.env.HIREX_QA_CAMPAIGN_PREFIX?.trim();
const maxSends = Number(process.env.HIREX_QA_MAX_LIVE_SENDS);
if (!sender || !prefix || !Number.isInteger(maxSends) || maxSends < 1 || maxSends > 100) fail("LIVE_CONFIG_INVALID");
if (!requestedRecipient || !allowlist.includes(requestedRecipient)) fail("RECIPIENT_NOT_ALLOWLISTED");

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

const { createPrivilegedSupabaseClient } = await import("../src/modules/integrations/gmail/server/privileged-supabase.ts");
const db = createPrivilegedSupabaseClient();
const bucket = "email-attachments";

if (mode === "setup") await setup();
else if (mode === "verify") await verify();
else if (mode === "cleanup") await cleanup();
else fail("MODE_REQUIRED");

async function setup() {
  const { data: account, error: accountError } = await db.from("email_accounts")
    .select("id,workspace_id,connected_by,email_address,status,scopes")
    .eq("provider", "GMAIL").eq("status", "CONNECTED").ilike("email_address", sender).maybeSingle();
  if (accountError || !account || account.email_address.trim().toLowerCase() !== sender || !account.scopes?.includes("https://www.googleapis.com/auth/gmail.send")) fail("SENDER_NOT_APPROVED");
  const { count: suppressionCount, error: suppressionError } = await db.from("email_suppressions").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspace_id).eq("normalized_email", requestedRecipient);
  if (suppressionError || suppressionCount !== 0) fail("RECIPIENT_SUPPRESSED");
  const { data: priorRecipients, error: recipientHistoryError } = await db.from("email_campaign_recipients").select("id,engagement_status,stopped_reason,hard_bounced_at").eq("workspace_id", account.workspace_id).eq("normalized_email", requestedRecipient);
  if (recipientHistoryError) fail("RECIPIENT_HISTORY_UNAVAILABLE");
  const priorIds = (priorRecipients ?? []).map((row) => row.id);
  const { count: terminalSignalCount, error: terminalSignalError } = priorIds.length
    ? await db.from("email_campaign_signal_events").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspace_id).in("recipient_id", priorIds).in("signal_type", ["UNSUBSCRIBE", "HARD_BOUNCE"])
    : { count: 0, error: null };
  const terminalRecipient = (priorRecipients ?? []).some((row) => ["UNSUBSCRIBED", "HARD_BOUNCED", "CANCELLED"].includes(row.engagement_status) || row.hard_bounced_at || ["UNSUBSCRIBE", "HARD_BOUNCE"].includes(row.stopped_reason));
  if (terminalSignalError || terminalSignalCount !== 0 || terminalRecipient) fail("RECIPIENT_TERMINAL_HISTORY");
  const ids = { campaign: randomUUID(), step: randomUUID(), recipient: randomUUID(), delivery: randomUUID(), sender: randomUUID(), attachment: randomUUID() };
  const baseName = `PHASE-5-ATTACHMENT-E2E-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const name = baseName.startsWith(prefix) ? baseName : `${prefix}-${baseName}`;
  const storagePath = `${account.workspace_id}/${ids.campaign}/${ids.attachment}/${filename}`;
  const rows = [
    ["email_campaigns", { id: ids.campaign, workspace_id: account.workspace_id, created_by: account.connected_by, name, status: "DRAFT", subject_template: "HireX Phase 5 Attachment QA", body_text_template: "Controlled HireX Phase 5 attachment QA message.", sequence_enabled: true }],
    ["email_campaign_steps", { id: ids.step, workspace_id: account.workspace_id, campaign_id: ids.campaign, step_order: 0, step_type: "INITIAL", delay_minutes: 0, subject_template: "HireX Phase 5 Attachment QA", body_text_template: "Controlled HireX Phase 5 attachment QA message.", enabled: true }],
    ["email_campaign_recipients", { id: ids.recipient, workspace_id: account.workspace_id, campaign_id: ids.campaign, email: requestedRecipient, normalized_email: requestedRecipient, idempotency_key: randomUUID() }],
    ["email_campaign_senders", { id: ids.sender, workspace_id: account.workspace_id, campaign_id: ids.campaign, email_account_id: account.id, enabled: true, daily_cap: 10, per_minute_cap: 2, priority: 0 }],
    ["email_campaign_recipient_steps", { id: ids.delivery, workspace_id: account.workspace_id, campaign_id: ids.campaign, recipient_id: ids.recipient, campaign_step_id: ids.step, step_order: 0, status: "PENDING", eligible_at: new Date().toISOString(), idempotency_key: randomUUID() }],
  ];
  for (const [table, row] of rows) { const { error } = await db.from(table).insert(row); if (error) fail(`SETUP_${table.toUpperCase()}_FAILED`); }
  const upload = await db.storage.from(bucket).upload(storagePath, bytes, { contentType: "text/plain", upsert: false });
  if (upload.error) fail("PRIVATE_UPLOAD_FAILED");
  let result = await db.from("email_attachments").insert({ id: ids.attachment, workspace_id: account.workspace_id, storage_bucket: bucket, storage_path: storagePath, original_filename: filename, safe_filename: filename, mime_type: "text/plain", size_bytes: bytes.length, sha256, uploaded_by: account.connected_by, lifecycle_status: "ACTIVE" });
  if (result.error) fail("ATTACHMENT_METADATA_FAILED");
  result = await db.from("email_campaign_step_attachments").insert({ workspace_id: account.workspace_id, campaign_id: ids.campaign, step_id: ids.step, attachment_id: ids.attachment, sort_order: 0 });
  if (result.error) fail("ATTACHMENT_ASSOCIATION_FAILED");
  const download = await db.storage.from(bucket).download(storagePath);
  if (download.error || !download.data || createHash("sha256").update(Buffer.from(await download.data.arrayBuffer())).digest("hex") !== sha256) fail("ATTACHMENT_PREFLIGHT_FAILED");
  result = await db.from("email_campaigns").update({ status: "RUNNING", started_at: new Date().toISOString() }).eq("id", ids.campaign).eq("workspace_id", account.workspace_id).eq("status", "DRAFT");
  if (result.error) fail("CAMPAIGN_START_FAILED");
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ ...ids, workspaceId: account.workspace_id, accountId: account.id, name, recipient: requestedRecipient, storagePath, sha256, size: bytes.length }), { mode: 0o600 });
  console.log(`PHASE5_LIVE_SETUP_PASS campaignId=${ids.campaign} recipient=${requestedRecipient} attachmentSize=${bytes.length}`);
}

async function verify() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  if (!uuidPattern.test(state.campaign) || state.recipient !== requestedRecipient) fail("STATE_INVALID");
  const [{ data: campaign }, { data: deliveries }, { data: links }] = await Promise.all([
    db.from("email_campaigns").select("id,name,status,email_campaign_recipients(id,email,status,engagement_status),email_campaign_senders(email_account_id)").eq("id", state.campaign).eq("workspace_id", state.workspaceId).maybeSingle(),
    db.from("email_campaign_recipient_steps").select("id,status,send_request_id,provider_message_id,provider_thread_id,idempotency_key").eq("campaign_id", state.campaign),
    db.from("email_campaign_step_attachments").select("attachment_id,sort_order,email_attachments!inner(original_filename,size_bytes,sha256,lifecycle_status)").eq("campaign_id", state.campaign),
  ]);
  const delivery = deliveries?.[0];
  const request = delivery?.send_request_id ? await db.from("email_send_requests").select("id,status,provider_message_id,provider_thread_id,attempt_count").eq("id", delivery.send_request_id).maybeSingle() : { data: null };
  const duplicate = await db.from("email_send_requests").select("id", { count: "exact", head: true }).eq("workspace_id", state.workspaceId).eq("idempotency_key", delivery?.idempotency_key ?? "00000000-0000-4000-8000-000000000000");
  const ok = campaign?.name?.startsWith(prefix) && campaign.email_campaign_recipients?.length === 1 && campaign.email_campaign_recipients[0].email.toLowerCase() === requestedRecipient && deliveries?.length === 1 && delivery?.status === "SENT" && request.data?.status === "SENT" && request.data.attempt_count === 1 && Boolean(request.data.provider_message_id) && Boolean(request.data.provider_thread_id) && duplicate.count === 1 && links?.length === 1 && links[0].email_attachments?.original_filename === filename && links[0].email_attachments?.sha256 === state.sha256;
  console.log(`PHASE5_LIVE_VERIFY pass=${Boolean(ok)} sent=${request.data?.status === "SENT" ? 1 : 0} deliveryUnknown=${delivery?.status === "DELIVERY_UNKNOWN" ? 1 : 0} duplicates=${Math.max(0, (duplicate.count ?? 0) - 1)} attachment=${links?.length === 1}`);
  if (!ok) process.exitCode = 1;
}

async function cleanup() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  if (!uuidPattern.test(state.campaign) || !allowlist.includes(state.recipient)) fail("STATE_INVALID");
  await db.from("email_campaigns").update({ status: "DRAFT", scheduled_at: null, started_at: null, paused_at: null, completed_at: null, cancelled_at: null }).eq("id", state.campaign).eq("workspace_id", state.workspaceId);
  await db.from("email_campaign_events").delete().eq("campaign_id", state.campaign).eq("workspace_id", state.workspaceId);
  await db.from("email_campaign_recipient_steps").delete().eq("campaign_id", state.campaign).eq("workspace_id", state.workspaceId);
  await db.from("email_campaign_step_attachments").delete().eq("campaign_id", state.campaign).eq("workspace_id", state.workspaceId);
  await db.from("email_attachments").delete().eq("id", state.attachment).eq("workspace_id", state.workspaceId);
  await db.storage.from(bucket).remove([state.storagePath]);
  await db.from("email_campaign_recipients").delete().eq("campaign_id", state.campaign).eq("workspace_id", state.workspaceId);
  await db.from("email_campaign_senders").delete().eq("campaign_id", state.campaign).eq("workspace_id", state.workspaceId);
  await db.from("email_campaign_steps").delete().eq("campaign_id", state.campaign).eq("workspace_id", state.workspaceId);
  await db.from("email_campaigns").delete().eq("id", state.campaign).eq("workspace_id", state.workspaceId);
  const [{ count: campaigns }, { count: attachments }, object] = await Promise.all([
    db.from("email_campaigns").select("id", { count: "exact", head: true }).eq("id", state.campaign),
    db.from("email_attachments").select("id", { count: "exact", head: true }).eq("id", state.attachment),
    db.storage.from(bucket).download(state.storagePath),
  ]);
  const remaining = (campaigns ?? 0) + (attachments ?? 0) + (object.error ? 0 : 1);
  console.log(`PHASE5_LIVE_CLEANUP remaining=${remaining}`);
  if (remaining !== 0) process.exitCode = 1;
}

function fail(code) { console.error(code); process.exit(1); }
