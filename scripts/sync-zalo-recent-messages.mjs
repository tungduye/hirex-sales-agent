import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { persistHistoryMessage } from "./lib/zalo-history-remote-writer.mjs";
import { acquireRecentLock, countRecentPending, loadRecentState, reconcileRecentMessages, saveRecentState, selectRecentAccounts } from "./lib/zalo-recent-reconciliation.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
createRequire(import.meta.url)("@next/env").loadEnvConfig(projectRoot);
const profileRoot = process.env.HIREX_DEPLAO_QA_PROFILE || process.env.HIREX_DEPLAO_QA_USER_DATA_DIR ||
  "C:\\Users\\Admin\\AppData\\Local\\HireX\\ZaloRuntime\\deplao-qa-profile";
const databasePath = path.join(profileRoot, "deplao-tool.db");
const statePath = path.join(projectRoot, "runtime", "zalo-recent-message-cursors.json");
const args = process.argv.slice(2);
if (args.some((arg) => !["--once", "--dry-run"].includes(arg) && !arg.startsWith("--since="))) throw new Error("RECENT_ARGUMENT_INVALID");
const dryRun = args.includes("--dry-run");
const since = args.find((arg) => arg.startsWith("--since="))?.slice("--since=".length);

async function enqueueAiRecruiter(account, message, persisted) {
  if (message.direction !== "INBOUND" || message.conversationKind === "GROUP") return;
  const secret = process.env.AUTOMATION_CRON_SECRET?.trim();
  const endpoint = process.env.HIREX_INTERNAL_BASE_URL?.trim() || "http://127.0.0.1:3000";
  if (!secret) throw new Error("RECENT_AI_ENQUEUE_CONFIGURATION_INVALID");
  const response = await fetch(`${endpoint}/api/internal/ai-recruiter/enqueue`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: account.workspace_id, channelAccountId: account.id,
      conversationId: persisted.conversationId, messageId: persisted.messageId }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("RECENT_AI_ENQUEUE_FAILED");
}

async function main() {
  // Dry-run neither creates a state/lock file nor mutates remote data.
  const release = dryRun ? () => {} : acquireRecentLock(`${statePath}.lock`);
  if (!release) { console.log(JSON.stringify({ status: "already-running" })); return; }
  let database;
  try {
    const state = loadRecentState(statePath, databasePath, since);
    if (!dryRun) saveRecentState(statePath, state);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (typeof url !== "string" || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/u.test(url) || typeof secret !== "string" || secret.length < 32)
      throw new Error("RECENT_REMOTE_CONFIGURATION_INVALID");
    const client = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) } });
    const result = await client.from("channel_accounts").select("id,workspace_id,external_account_id,channel_type,provider,status,operator_enabled,deleted_at")
      .eq("channel_type", "ZALO").eq("provider", "ZALO_BRIDGE").eq("status", "CONNECTED").eq("operator_enabled", true).is("deleted_at", null);
    if (result.error) throw new Error("RECENT_ACCOUNT_QUERY_FAILED");
    database = new DatabaseSync(databasePath, { readOnly: true });
    database.exec("pragma busy_timeout=5000");
    const accounts = selectRecentAccounts(database, result.data);
    if (dryRun) {
      const pending = accounts.reduce((total, account) => total + countRecentPending(database, account.external_account_id,
        state.accounts[account.external_account_id]?.lastRowId ?? "0", state.since), 0);
      console.log(JSON.stringify({ status: "dry-run", accounts: accounts.length, pending, since: state.since }));
      return;
    }
    const summary = await reconcileRecentMessages({ database, accounts, state, profileRoot,
      checkpoint: (nextState) => saveRecentState(statePath, nextState),
      persist: async (account, message) => {
        const persisted = await persistHistoryMessage(client,
          { workspaceId: account.workspace_id, accounts: new Map([[account.external_account_id, account.id]]) }, message,
          { reconcile: true, skipMedia: true });
        await enqueueAiRecruiter(account, message, persisted);
        return persisted;
      },
    });
    console.log(JSON.stringify({ status: summary.failedAccounts ? "retry-required" : "complete", ...summary }));
    if (summary.failedAccounts) process.exitCode = 1;
  } finally {
    database?.close();
    release();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", code: /^[A-Z][A-Z0-9_]{0,100}$/u.test(error.message) ? error.message : "RECENT_SYNC_FAILED" }));
  process.exitCode = 1;
});
