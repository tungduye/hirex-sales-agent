// Copies Zalo group member names/avatars from Deplao into HireX (table zalo_group_members), so the inbox can show
// who wrote each group message and highlight @mentions. Read-only on Deplao; incremental by updated_at per nick.
// Run by the Deplao supervisor; safe to run by hand: node scripts/sync-zalo-group-members.mjs --once [--dry-run]
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { acquireRecentLock, saveRecentState } from "./lib/zalo-recent-reconciliation.mjs";
import { mapGroupMemberRow, selectChangedMembers } from "./lib/zalo-group-members.mjs";
import { existsSync, readFileSync } from "node:fs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
createRequire(import.meta.url)("@next/env").loadEnvConfig(projectRoot);
const profileRoot = process.env.HIREX_DEPLAO_QA_PROFILE || process.env.HIREX_DEPLAO_QA_USER_DATA_DIR ||
  "C:\\Users\\Admin\\AppData\\Local\\HireX\\ZaloRuntime\\deplao-qa-profile";
const databasePath = path.join(profileRoot, "deplao-tool.db");
const statePath = path.join(projectRoot, "runtime", "zalo-group-member-cursors.json");
const args = process.argv.slice(2);
if (args.some((arg) => !["--once", "--dry-run"].includes(arg))) throw new Error("GROUP_MEMBER_ARGUMENT_INVALID");
const dryRun = args.includes("--dry-run");
const BATCH = 500, MAX_ROWS_PER_RUN = 20000;

function loadState() {
  if (!existsSync(statePath)) return { version: 1, accounts: {} };
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (state?.version !== 1 || !state.accounts || typeof state.accounts !== "object") throw new Error("GROUP_MEMBER_STATE_INVALID");
  return state;
}

async function main() {
  const release = dryRun ? () => {} : acquireRecentLock(`${statePath}.lock`);
  if (!release) { console.log(JSON.stringify({ status: "already-running" })); return; }
  let database;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
    if (typeof url !== "string" || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/u.test(url) || typeof secret !== "string" || secret.length < 32)
      throw new Error("GROUP_MEMBER_REMOTE_CONFIGURATION_INVALID");
    const client = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) } });
    const accounts = await client.from("channel_accounts").select("id,workspace_id,external_account_id")
      .eq("channel_type", "ZALO").eq("provider", "ZALO_BRIDGE").is("deleted_at", null);
    if (accounts.error) throw new Error("GROUP_MEMBER_ACCOUNT_QUERY_FAILED");
    database = new DatabaseSync(databasePath, { readOnly: true });
    database.exec("pragma busy_timeout=5000");
    const state = loadState();
    let written = 0, skipped = 0;
    for (const account of accounts.data ?? []) {
      if (!/^[0-9]{1,40}$/u.test(account.external_account_id ?? "")) continue;
      const saved = state.accounts[account.external_account_id];
      let cursor = { at: Number(saved?.at ?? 0), id: Number(saved?.id ?? 0) };
      for (;;) {
        if (written >= MAX_ROWS_PER_RUN) break;
        const rows = selectChangedMembers(database, account.external_account_id, cursor);
        if (rows.length === 0) break;
        const mapped = rows.map((row) => mapGroupMemberRow(row, account)).filter(Boolean);
        skipped += rows.length - mapped.length;
        if (!dryRun) for (let index = 0; index < mapped.length; index += BATCH) {
          const { error } = await client.from("zalo_group_members").upsert(mapped.slice(index, index + BATCH), { onConflict: "channel_account_id,group_id,member_id" });
          if (error) throw new Error("GROUP_MEMBER_UPSERT_FAILED");
        }
        written += mapped.length;
        cursor = { at: Number(rows.at(-1).updated_at), id: Number(rows.at(-1).id) };
        state.accounts[account.external_account_id] = cursor;
        if (!dryRun) saveRecentState(statePath, state);
        if (rows.length < 2000) break;
      }
    }
    console.log(JSON.stringify({ status: dryRun ? "dry-run" : "complete", written, skipped }));
  } finally {
    database?.close();
    release();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", code: /^[A-Z][A-Z0-9_]{0,100}$/u.test(error.message) ? error.message : "GROUP_MEMBER_SYNC_FAILED" }));
  process.exitCode = 1;
});
