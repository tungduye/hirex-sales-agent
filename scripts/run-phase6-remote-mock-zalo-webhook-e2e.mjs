#!/usr/bin/env node
import nextEnv from "@next/env";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.HIREX_ALLOW_REMOTE_SYNTHETIC_TESTS !== "1") throw new Error("REMOTE_SYNTHETIC_TEST_GUARD_REQUIRED");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ACCOUNT = "98200000-0000-4000-8000-000000000001";
const CONTACT = "98200000-0000-4000-8000-000000000002";
const EXTERNAL_ACCOUNT = "mock-zalo-account-remote-webhook";
const SENDER = "mock-zalo-user-remote-webhook";
const THREAD = "mock-zalo-thread-remote-webhook";

async function cleanup() {
  await db.from("channel_accounts").delete().eq("id", ACCOUNT);
  await db.from("contacts").delete().eq("id", CONTACT);
  const account = await db.from("channel_accounts").select("id", { count: "exact", head: true }).eq("id", ACCOUNT);
  const contact = await db.from("contacts").select("id", { count: "exact", head: true }).eq("id", CONTACT);
  return (account.count ?? 0) + (contact.count ?? 0);
}

if (process.argv.includes("--cleanup")) {
  console.log(JSON.stringify({ syntheticRemaining: await cleanup() }));
  process.exit(0);
}

const output = {};
try {
await cleanup();
const base = await db.from("channel_accounts").select("workspace_id,connected_by").eq("channel_type", "FACEBOOK").eq("status", "CONNECTED").limit(1).single();
if (base.error) throw new Error("WORKSPACE_CONTEXT_UNAVAILABLE");
const workspace = base.data.workspace_id;
const secret = randomBytes(32).toString("base64url");
const key = Buffer.from(process.env.CHANNEL_TOKEN_ENCRYPTION_KEY.trim(), "base64");
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
const encrypted = ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
const inserts = [
  () => db.from("contacts").insert({ id: CONTACT, workspace_id: workspace, full_name: "HireX Mock Zalo Remote Webhook", lead_status: "NEW", lead_score: 0 }),
  () => db.from("contact_channels").insert({ workspace_id: workspace, contact_id: CONTACT, channel_type: "ZALO", channel_value: SENDER, is_primary: true, metadata: { synthetic: true }, marketing_consent_status: "OPTED_IN", marketing_consent_source: "MOCK_E2E", marketing_consent_recorded_at: new Date().toISOString() }),
  () => db.from("channel_accounts").insert({ id: ACCOUNT, workspace_id: workspace, connected_by: base.data.connected_by, channel_type: "ZALO", provider: "ZALO_BRIDGE", external_account_id: EXTERNAL_ACCOUNT, display_name: "HireX Mock Zalo Remote Webhook", status: "CONNECTED", capabilities: ["SEND_TEXT", "REPLY"], metadata: { synthetic: true } }),
  () => db.from("channel_account_credentials").insert({ channel_account_id: ACCOUNT, workspace_id: workspace, webhook_secret_encrypted: encrypted, configuration: { bridgeBaseUrl: "https://127.0.0.1:18787" } }),
];
for (const insert of inserts) { const result = await insert(); if (result.error) throw new Error("WEBHOOK_FIXTURE_SETUP_FAILED"); }

async function send(eventId, messageId, text) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ eventId, accountId: EXTERNAL_ACCOUNT, threadId: THREAD, messageId, senderId: SENDER, recipientIds: [EXTERNAL_ACCOUNT], text, attachments: [], occurredAt: new Date().toISOString() });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return fetch("https://app.hirexmkt.online/api/webhooks/zalo", { method: "POST", headers: { "content-type": "application/json", "x-hirex-timestamp": timestamp, "x-hirex-signature": signature }, body });
}
const first = await send("mock-webhook-event-001", "mock-webhook-message-001", "Test HireX mock Zalo inbound 01");
const replay = await send("mock-webhook-event-001", "mock-webhook-message-001", "Test HireX mock Zalo inbound 01");
const second = await send("mock-webhook-event-002", "mock-webhook-message-002", "Test HireX mock Zalo inbound 02");
const messages = await db.from("omnichannel_messages").select("conversation_id", { count: "exact" }).eq("workspace_id", workspace).eq("channel_account_id", ACCOUNT).eq("direction", "INBOUND");
const conversations = await db.from("omnichannel_conversations").select("id,contact_id,status", { count: "exact" }).eq("workspace_id", workspace).eq("channel_account_id", ACCOUNT);
Object.assign(output, { httpAccepted: first.ok && replay.ok && second.ok, inboundCount: messages.count, conversationCount: conversations.count, sameContact: conversations.data?.[0]?.contact_id === CONTACT, sameConversation: new Set((messages.data ?? []).map(row => row.conversation_id)).size === 1 });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ storageState: "playwright/.auth/hirex.json" });
  const page = await context.newPage();
  let runtimeErrors = 0;
  page.on("pageerror", () => { runtimeErrors += 1; });
  await page.goto("http://localhost:3000/inbox/all", { waitUntil: "networkidle" });
  const bodyText = await page.locator("body").innerText();
  output.uiPath = new URL(page.url()).pathname;
  output.uiSignals = { hasInbound02: bodyText.includes("Test HireX mock Zalo inbound 02"), hasZalo: bodyText.includes("ZALO"), hasAiDraft: bodyText.includes("AI draft"), runtimeErrors };
  output.unifiedInbox = !page.url().includes("/login") && bodyText.includes("Test HireX mock Zalo inbound 02") && bodyText.includes("ZALO") && runtimeErrors === 0;
  output.aiAssistDraftOnly = bodyText.includes("AI draft") && bodyText.includes("Propose") && !bodyText.includes("Autonomous send");
} finally { await browser.close(); }
} catch (error) {
  output.failure = error instanceof Error ? error.message : "REMOTE_WEBHOOK_E2E_FAILED";
} finally {
  output.syntheticRemaining = await cleanup();
}
console.log(JSON.stringify(output));
