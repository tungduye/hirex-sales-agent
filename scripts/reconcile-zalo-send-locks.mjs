// Frees Zalo nicks locked by a "delivery unknown" send and publishes the nicks that are still locked, so the
// channel page can warn (table zalo_account_send_locks). Rules in lib/zalo-send-locks.mjs. Never sends anything.
// Reads the adapter and Deplao databases read-only; changes go through the adapter's signed reconcile endpoint
// and two service-role functions (migration 090).
// Run by the Deplao supervisor; by hand: node scripts/reconcile-zalo-send-locks.mjs --once [--dry-run]
import { DatabaseSync } from "node:sqlite";
import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { acquireRecentLock } from "./lib/zalo-recent-reconciliation.mjs";
import { autoReleaseAt, decide, findSentMessage, recordedLaterActivity, selectHeldLocks } from "./lib/zalo-send-locks.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
createRequire(import.meta.url)("@next/env").loadEnvConfig(projectRoot);
const runtimeRoot = "C:\\Users\\Admin\\AppData\\Local\\HireX\\ZaloRuntime";
const profileRoot = process.env.HIREX_DEPLAO_QA_PROFILE || process.env.HIREX_DEPLAO_QA_USER_DATA_DIR || path.join(runtimeRoot, "deplao-qa-profile");
const deplaoPath = path.join(profileRoot, "deplao-tool.db");
const adapterPath = process.env.ADAPTER_DATABASE_PATH || path.join(runtimeRoot, "adapter.db");
const adapterBase = `http://127.0.0.1:${process.env.ADAPTER_PORT || "18788"}`;
const RECONCILE_PATH = "/v1/deliveries/reconcile";
const args = process.argv.slice(2);
if (args.some((arg) => !["--once", "--dry-run"].includes(arg))) throw new Error("SEND_LOCK_ARGUMENT_INVALID");
const dryRun = args.includes("--dry-run");

async function adapterReconcile(payload) {
  const secret = process.env.HIREX_BRIDGE_SIGNING_SECRET;
  if (typeof secret !== "string" || secret.length < 16) throw new Error("SEND_LOCK_SIGNING_SECRET_MISSING");
  const body = JSON.stringify(payload), timestamp = String(Math.floor(Date.now() / 1000));
  const canonical = ["POST", RECONCILE_PATH, timestamp, createHash("sha256").update(body).digest("hex"), payload.idempotencyKey].join("\n");
  const response = await fetch(`${adapterBase}${RECONCILE_PATH}`, { method: "POST", body, signal: AbortSignal.timeout(10_000), headers: {
    "content-type": "application/json", "x-hirex-timestamp": timestamp, "x-hirex-idempotency-key": payload.idempotencyKey,
    "x-hirex-signature": createHmac("sha256", secret).update(canonical).digest("hex") } });
  const result = await response.json().catch(() => ({}));
  return response.status === 200 ? result.status : null;
}

async function main() {
  const release = dryRun ? () => {} : acquireRecentLock(path.join(projectRoot, "runtime", "zalo-send-locks.lock"));
  if (!release) { console.log(JSON.stringify({ status: "already-running" })); return; }
  let adapterDb, deplaoDb;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
    if (typeof url !== "string" || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/u.test(url) || typeof key !== "string" || key.length < 32)
      throw new Error("SEND_LOCK_REMOTE_CONFIGURATION_INVALID");
    const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) } });
    const accountsResult = await client.from("channel_accounts").select("id,workspace_id,external_account_id")
      .eq("channel_type", "ZALO").eq("provider", "ZALO_BRIDGE").is("deleted_at", null);
    if (accountsResult.error) throw new Error("SEND_LOCK_ACCOUNT_QUERY_FAILED");
    const accounts = accountsResult.data ?? [];
    adapterDb = new DatabaseSync(adapterPath, { readOnly: true }); adapterDb.exec("pragma busy_timeout=5000");
    deplaoDb = new DatabaseSync(deplaoPath, { readOnly: true }); deplaoDb.exec("pragma busy_timeout=5000");

    async function actionFor(lock) {
      const ids = accounts.filter((account) => account.external_account_id === lock.accountId).map((account) => account.id);
      if (ids.length === 0) return null;
      const { data, error } = await client.from("channel_outbound_actions").select("id,workspace_id,conversation_id,status,text_content")
        .eq("channel_type", "ZALO").eq("idempotency_key", lock.idempotencyKey).in("channel_account_id", ids).limit(1);
      if (error) throw new Error("SEND_LOCK_ACTION_QUERY_FAILED");
      return data?.[0] ?? null;
    }

    const now = Date.now(), outcomes = [];
    for (const lock of selectHeldLocks(adapterDb)) {
      if (lock.state !== "UNKNOWN") continue;
      const action = await actionFor(lock);
      const found = findSentMessage(deplaoDb, lock, action?.text_content ?? null);
      const decision = decide(lock, found, recordedLaterActivity(deplaoDb, lock), now);
      if (decision === "WAIT") { outcomes.push({ account: lock.accountId, decision }); continue; }
      if (dryRun) { outcomes.push({ account: lock.accountId, decision, found: Boolean(found) }); continue; }
      if (decision === "CONFIRM") {
        const adapter = await adapterReconcile({ idempotencyKey: lock.idempotencyKey, decision: "CONFIRM_SENT", providerMessageId: found.msgId, providerThreadId: found.threadId });
        let hirex = null;
        if (action?.status === "DELIVERY_UNKNOWN") {
          const { data, error } = await client.rpc("confirm_zalo_delivery_unknown_sent", { p_workspace_id: action.workspace_id, p_action_id: action.id,
            p_provider_message_id: found.msgId, p_provider_conversation_id: found.threadId, p_accepted_at: new Date(found.timestamp).toISOString() });
          hirex = !error && data === true;
        }
        outcomes.push({ account: lock.accountId, decision, adapter, hirex });
      } else {
        const adapter = await adapterReconcile({ idempotencyKey: lock.idempotencyKey, decision: "ACKNOWLEDGE_NO_RETRY" });
        let hirex = null;
        if (action?.status === "DELIVERY_UNKNOWN") {
          const { data, error } = await client.rpc("auto_acknowledge_zalo_delivery_unknown", { p_workspace_id: action.workspace_id, p_action_id: action.id });
          hirex = !error && data === true;
        }
        outcomes.push({ account: lock.accountId, decision, adapter, hirex });
      }
    }

    // Publish what is still locked (read again after the changes above).
    if (!dryRun) {
      adapterDb.close(); adapterDb = new DatabaseSync(adapterPath, { readOnly: true }); adapterDb.exec("pragma busy_timeout=5000");
      const rows = [];
      for (const lock of selectHeldLocks(adapterDb)) {
        if (lock.state !== "UNKNOWN" && lock.state !== "EXECUTING") continue;
        const action = await actionFor(lock);
        for (const account of accounts.filter((item) => item.external_account_id === lock.accountId)) {
          rows.push({ channel_account_id: account.id, workspace_id: account.workspace_id, reason: lock.state === "UNKNOWN" ? "DELIVERY_UNKNOWN" : "SENDING",
            locked_since: new Date(Date.parse(lock.invokedAt) || now).toISOString(),
            action_id: action?.workspace_id === account.workspace_id ? action.id : null,
            conversation_id: action?.workspace_id === account.workspace_id ? action.conversation_id : null,
            auto_release_at: autoReleaseAt(lock), updated_at: new Date(now).toISOString() });
        }
      }
      if (rows.length) {
        const { error } = await client.from("zalo_account_send_locks").upsert(rows, { onConflict: "channel_account_id" });
        if (error) throw new Error("SEND_LOCK_PUBLISH_FAILED");
      }
      const locked = new Set(rows.map((row) => row.channel_account_id));
      const stale = accounts.map((account) => account.id).filter((id) => !locked.has(id));
      if (stale.length) {
        const { error } = await client.from("zalo_account_send_locks").delete().in("channel_account_id", stale);
        if (error) throw new Error("SEND_LOCK_PUBLISH_FAILED");
      }
      outcomes.push({ stillLocked: rows.length });
    }
    console.log(JSON.stringify({ at: new Date(now).toISOString(), status: dryRun ? "dry-run" : "complete", outcomes }));
  } finally {
    adapterDb?.close(); deplaoDb?.close();
    release();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", code: /^[A-Z][A-Z0-9_]{0,100}$/u.test(error.message) ? error.message : "SEND_LOCK_RECONCILE_FAILED" }));
  process.exitCode = 1;
});
