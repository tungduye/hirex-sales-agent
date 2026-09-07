#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { loadPhase4cQaEnv } from "./load-phase4c-qa-env.mjs";
import { parseQaRecipientAllowlist } from "./phase4c-qa-recipient-allowlist.mjs";
import { loadRemoteReadAuthorization } from "./phase4c-remote-read-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const remoteAuthorized = loadRemoteReadAuthorization(root);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localCampaignId = "94000000-0000-4000-8000-000000000001";
const localWorkspaceId = "94000000-0000-4000-8000-000000000002";
const localRecipient = "fixture.recipient@example.com";
const campaignId = remoteAuthorized ? process.argv[2] : localCampaignId;

globalThis.__hirexQaAccountContext = { workspaceId: localWorkspaceId, configurationComplete: true };
globalThis.__hirexQaExportFixture = {
  campaign: { id: localCampaignId, name: "PHASE-4C-LOCAL-EXPORT-FIXTURE", status: "COMPLETED" },
  recipients: [{ id: "94000000-0000-4000-8000-000000000003", email: localRecipient, display_name: "Fixture Recipient", company: "Fixture Co", position: "Buyer", status: "SENT", engagement_status: "NONE", last_sent_step_order: 1, last_engagement_at: null }],
  events: [{ event_type: "CAMPAIGN_COMPLETED", recipient_id: null, created_at: "2026-01-01T00:00:00.000Z" }],
  report: {
    campaign: { total: 1, sent: 1, failed: 0 },
    steps: [{ stepOrder: 1, stepType: "INITIAL", delayMinutes: 0, eligible: 1, sent: 1, failed: 0, skipped: 0, deliveryUnknown: 0, repliesAfterStep: 0, replyRate: 0 }],
    senders: [{ email: "fixture.sender@example.com", campaignDailyCap: 10, campaignMinuteCap: 1, globalDailyCap: 10, globalMinuteCap: 1, dailyReserved: 1, minuteReserved: 1, sent: 1, failed: 0, deliveryUnknown: 0, replies: 0, hardBounces: 0 }],
  },
};

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  if (specifier === "@/modules/identity/server/get-account-context") return { url: "data:text/javascript,export async function getAccountContext(){return globalThis.__hirexQaAccountContext;}", shortCircuit: true };
  if (!remoteAuthorized && specifier === "@/modules/integrations/gmail/server/privileged-supabase") return { url: "data:text/javascript,export function createPrivilegedSupabaseClient(){return globalThis.__hirexQaLocalDb;}", shortCircuit: true };
  if (!remoteAuthorized && specifier === "@/modules/campaigns/server/campaign-reporting") return { url: "data:text/javascript,export async function getCanonicalCampaignReport(){return globalThis.__hirexQaExportFixture.report;}", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const base = path.join(root, "src", specifier.slice(2));
    const found = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
    if (!found) throw new Error("MODULE_UNAVAILABLE");
    return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    const found = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

function localQuery(table) {
  const fixture = globalThis.__hirexQaExportFixture;
  const data = table === "email_campaigns" ? fixture.campaign : table === "email_campaign_recipients" ? fixture.recipients : table === "email_campaign_events" ? fixture.events : null;
  const query = { select: () => query, eq: () => query, order: () => query, maybeSingle: async () => ({ data, error: null }), then: (resolve) => Promise.resolve({ data, error: null }).then(resolve) };
  return query;
}
globalThis.__hirexQaLocalDb = { from: localQuery };

let phase = "BOOTSTRAP";
try {
  let recipients = globalThis.__hirexQaExportFixture.recipients;
  if (remoteAuthorized) {
    phase = "REMOTE_CONFIG";
    const { missing } = loadPhase4cQaEnv(root);
    if (missing.length || !uuid.test(campaignId ?? "")) throw new Error("GUARD");
    const allowlist = new Set(parseQaRecipientAllowlist(process.env.HIREX_QA_RECIPIENT_ALLOWLIST));
    const { createPrivilegedSupabaseClient } = await import("../src/modules/integrations/gmail/server/privileged-supabase.ts");
    const db = createPrivilegedSupabaseClient();
    const { data: campaign, error } = await db.from("email_campaigns").select("id,name,workspace_id,email_campaign_recipients(normalized_email)").eq("id", campaignId).maybeSingle();
    if (error || !campaign || !campaign.name.startsWith(process.env.HIREX_QA_CAMPAIGN_PREFIX)) throw new Error("GUARD");
    recipients = campaign.email_campaign_recipients ?? [];
    if (!recipients.length || recipients.some((row) => !allowlist.has(row.normalized_email))) throw new Error("GUARD");
    globalThis.__hirexQaAccountContext = { workspaceId: campaign.workspace_id, configurationComplete: true };
  }

  phase = "EXPORT_IMPORT";
  const { buildCampaignExport } = await import("../src/modules/campaigns/server/campaign-report-export.ts");
  phase = "CSV";
  const csv = await buildCampaignExport(campaignId, "csv"); assert.ok(csv);
  const csvBytes = Buffer.from(csv.body); const csvText = csvBytes.toString("utf8");
  assert.match(csv.contentType, /^text\/csv/i); assert.equal(csv.extension, "csv");
  assert.ok(csvBytes.length > 0 && !/^\s*<!doctype html/i.test(csvText));
  assert.ok(csvText.includes('"Metric","Value"') && csvText.includes('"Email","Name","Company","Position"'));
  assert.ok(recipients.some((row) => csvText.toLowerCase().includes((row.normalized_email ?? row.email).toLowerCase())));

  phase = "XLSX";
  const xlsx = await buildCampaignExport(campaignId, "xlsx"); assert.ok(xlsx);
  const xlsxBytes = Buffer.from(xlsx.body); assert.match(xlsx.contentType, /spreadsheetml\.sheet/i); assert.equal(xlsx.extension, "xlsx");
  assert.ok(xlsxBytes.length > 0 && xlsxBytes.subarray(0, 2).toString("ascii") === "PK");
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(xlsxBytes);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Summary", "Recipients", "Sequence Steps", "Senders", "Events"]);
  const recipientSheet = workbook.getWorksheet("Recipients"); assert.ok(recipientSheet);
  assert.deepEqual(recipientSheet.getRow(1).values.slice(1, 5), ["Email", "Name", "Company", "Position"]);
  const worksheetEmails = new Set(); recipientSheet.eachRow((row, index) => { if (index > 1) worksheetEmails.add(String(row.getCell(1).value).toLowerCase()); });
  assert.ok(recipients.every((row) => worksheetEmails.has((row.normalized_email ?? row.email).toLowerCase())));
  console.log(`PHASE4C_EXPORTS_PASS mode=${remoteAuthorized ? "REMOTE_AUTHORIZED" : "LOCAL_FIXTURE"} csvBytes=${csvBytes.length} xlsxBytes=${xlsxBytes.length}`);
} catch (error) {
  console.error(`PHASE4C_EXPORTS_UNAVAILABLE phase=${phase} category=${error instanceof Error ? error.name : "UNKNOWN"}`); process.exitCode = 1;
} finally {
  delete globalThis.__hirexQaAccountContext; delete globalThis.__hirexQaExportFixture; delete globalThis.__hirexQaLocalDb;
}
