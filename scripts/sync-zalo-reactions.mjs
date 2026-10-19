// Copies reactions (❤️ 👍 ...) and reply-quotes of Zalo messages from Deplao into HireX (tables zalo_message_reactions,
// zalo_message_quotes), per nick, so the inbox shows them. Read-only on Deplao; only changes are written
// (reaction hashes and a quote cursor per nick kept in runtime/).
// Run by the Deplao supervisor; by hand: node scripts/sync-zalo-reactions.mjs --once [--dry-run]
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { acquireRecentLock, saveRecentState } from "./lib/zalo-recent-reconciliation.mjs";
import { mapQuote, planReactionChanges, selectQuotedMessages, selectReactedMessages } from "./lib/zalo-reactions.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
createRequire(import.meta.url)("@next/env").loadEnvConfig(projectRoot);
const profileRoot = process.env.HIREX_DEPLAO_QA_PROFILE || process.env.HIREX_DEPLAO_QA_USER_DATA_DIR ||
  "C:\\Users\\Admin\\AppData\\Local\\HireX\\ZaloRuntime\\deplao-qa-profile";
const databasePath = path.join(profileRoot, "deplao-tool.db");
const statePath = path.join(projectRoot, "runtime", "zalo-reaction-hashes.json");
const args = process.argv.slice(2);
if (args.some((arg) => !["--once", "--dry-run"].includes(arg))) throw new Error("REACTION_ARGUMENT_INVALID");
const dryRun = args.includes("--dry-run");
const BATCH = 500, MAX_QUOTES_PER_RUN = 20000;

function loadState() {
  if (!existsSync(statePath)) return { version: 1, accounts: {}, quoteCursors: {} };
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (state?.version !== 1 || !state.accounts || typeof state.accounts !== "object") throw new Error("REACTION_STATE_INVALID");
  state.quoteCursors ??= {};
  return state;
}

async function main() {
  const release = dryRun ? () => {} : acquireRecentLock(`${statePath}.lock`);
  if (!release) { console.log(JSON.stringify({ status: "already-running" })); return; }
  let database;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
    if (typeof url !== "string" || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/u.test(url) || typeof secret !== "string" || secret.length < 32)
      throw new Error("REACTION_REMOTE_CONFIGURATION_INVALID");
    const client = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) } });
    const accounts = await client.from("channel_accounts").select("id,workspace_id,external_account_id")
      .eq("channel_type", "ZALO").eq("provider", "ZALO_BRIDGE").is("deleted_at", null);
    if (accounts.error) throw new Error("REACTION_ACCOUNT_QUERY_FAILED");
    database = new DatabaseSync(databasePath, { readOnly: true });
    database.exec("pragma busy_timeout=5000");
    const state = loadState();
    let written = 0, cleared = 0, quotes = 0;
    for (const account of accounts.data ?? []) {
      const owner = account.external_account_id;
      if (!/^[0-9]{1,40}$/u.test(owner ?? "")) continue;
      const key = `${account.id}`;
      const plan = planReactionChanges(selectReactedMessages(database, owner, 0), owner, state.accounts[key] ?? {});
      if (!dryRun) {
        const rows = plan.upserts.map((item) => ({ workspace_id: account.workspace_id, channel_account_id: account.id,
          provider_message_id: item.msgId, summary: item.summary, mine: item.mine, updated_at: new Date().toISOString() }));
        for (let index = 0; index < rows.length; index += BATCH) {
          const { error } = await client.from("zalo_message_reactions").upsert(rows.slice(index, index + BATCH), { onConflict: "channel_account_id,provider_message_id" });
          if (error) throw new Error("REACTION_UPSERT_FAILED");
        }
        for (let index = 0; index < plan.removed.length; index += BATCH) {
          const { error } = await client.from("zalo_message_reactions").delete().eq("channel_account_id", account.id).in("provider_message_id", plan.removed.slice(index, index + BATCH));
          if (error) throw new Error("REACTION_DELETE_FAILED");
        }
        state.accounts[key] = plan.next;
        saveRecentState(statePath, state);
      }
      written += plan.upserts.length; cleared += plan.removed.length;
      // Reply-quotes never change once written: read on from the last Deplao row id.
      let after = Number(state.quoteCursors[key] ?? 0);
      for (;;) {
        if (quotes >= MAX_QUOTES_PER_RUN) break;
        const rows = selectQuotedMessages(database, owner, after);
        if (rows.length === 0) break;
        // Deplao can hold the same message twice for a nick; one row per message id in a batch.
        const unique = [...new Map(rows.map(mapQuote).filter(Boolean).map((item) => [item.msgId, item])).values()];
        const mapped = unique.map((item) => ({ workspace_id: account.workspace_id, channel_account_id: account.id,
          provider_message_id: item.msgId, quoted_message_id: item.quotedMessageId, quoted_text: item.quotedText, quoted_sender: item.quotedSender,
          updated_at: new Date().toISOString() }));
        if (!dryRun) for (let index = 0; index < mapped.length; index += BATCH) {
          const { error } = await client.from("zalo_message_quotes").upsert(mapped.slice(index, index + BATCH), { onConflict: "channel_account_id,provider_message_id" });
          if (error) { console.error(JSON.stringify({ status: "error", code: "QUOTE_UPSERT_FAILED", dbCode: typeof error.code === "string" ? error.code.slice(0, 10) : null })); throw new Error("QUOTE_UPSERT_FAILED"); }
        }
        quotes += mapped.length;
        after = Number(rows.at(-1).id);
        if (!dryRun) { state.quoteCursors[key] = after; saveRecentState(statePath, state); }
        if (rows.length < 2000) break;
      }
    }
    console.log(JSON.stringify({ status: dryRun ? "dry-run" : "complete", written, cleared, quotes }));
  } finally {
    database?.close();
    release();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", code: /^[A-Z][A-Z0-9_]{0,100}$/u.test(error.message) ? error.message : "REACTION_SYNC_FAILED" }));
  process.exitCode = 1;
});
