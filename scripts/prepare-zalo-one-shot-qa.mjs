#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(projectRoot);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const conversationId = process.argv[2];
const options = process.argv.slice(3);
const dryRun = options.includes("--dry-run");
const priorOption = options.find((option) => option.startsWith("--prior-failed-action="));
const priorFailedActionId = priorOption?.slice("--prior-failed-action=".length) ?? null;
const text = "DEPLAO_MANUAL_20260918_02";

async function main() {
  if (process.env.HIREX_ALLOW_ONE_SHOT_ZALO_QA !== "1" || !uuid.test(conversationId ?? "") ||
      options.some((option) => option !== "--dry-run" && option !== priorOption) ||
      options.filter((option) => option === "--dry-run").length > 1 ||
      options.filter((option) => option.startsWith("--prior-failed-action=")).length > 1 ||
      (priorFailedActionId !== null && !uuid.test(priorFailedActionId))) throw Error("QA_SCOPE_INVALID");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const qaAccountZaloId = process.env.HIREX_ZALO_QA_ACCOUNT_ID;
  const databasePath = process.env.ADAPTER_DATABASE_PATH;
  if (!url || !secret || !qaAccountZaloId || !databasePath || !existsSync(databasePath) ||
      databasePath.toLowerCase().startsWith(projectRoot.toLowerCase())) throw Error("QA_CONFIG_UNAVAILABLE");
  const supabase = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: conversation, error: conversationError } = await supabase.from("omnichannel_conversations")
    .select("id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status")
    .eq("id", conversationId).eq("channel_type", "ZALO").maybeSingle();
  if (conversationError) throw Error("QA_CONVERSATION_QUERY_ERROR");
  if (!conversation) throw Error("QA_CONVERSATION_MISSING");
  if (!uuid.test(conversation.workspace_id) ||
      !uuid.test(conversation.channel_account_id) || !["OPEN", "PENDING"].includes(conversation.status) ||
      typeof conversation.provider_conversation_id !== "string" || !/^[1-9][0-9]{0,127}$/u.test(conversation.provider_conversation_id))
    throw Error("QA_CONVERSATION_UNAVAILABLE");
  const { data: account, error: accountError } = await supabase.from("channel_accounts")
    .select("id,workspace_id,external_account_id,status,operator_enabled,capabilities")
    .eq("id", conversation.channel_account_id).eq("workspace_id", conversation.workspace_id)
    .eq("channel_type", "ZALO").eq("provider", "ZALO_BRIDGE").maybeSingle();
  if (accountError || !account || account.external_account_id !== qaAccountZaloId ||
      account.status !== "CONNECTED" || account.operator_enabled !== true ||
      !Array.isArray(account.capabilities) || !account.capabilities.includes("SEND_TEXT"))
    throw Error("QA_ACCOUNT_UNAVAILABLE");
  const { count: suppressionCount, error: suppressionError } = await supabase.from("channel_suppressions")
    .select("id", { count: "exact", head: true }).eq("workspace_id", conversation.workspace_id)
    .eq("channel_type", "ZALO").eq("normalized_recipient", conversation.provider_conversation_id.toLowerCase());
  if (suppressionError || (suppressionCount ?? 0) !== 0) throw Error("QA_RECIPIENT_SUPPRESSED");
  const { data: existingActions, error: existingActionError } = await supabase.from("channel_outbound_actions")
    .select("id,status,attempt_count,safe_error_code,provider_message_id").eq("workspace_id", conversation.workspace_id)
    .eq("conversation_id", conversation.id).eq("channel_account_id", account.id).eq("text_content", text);
  if (existingActionError || !Array.isArray(existingActions) ||
      (priorFailedActionId === null && existingActions.length !== 0) ||
      (priorFailedActionId !== null && (existingActions.length !== 1 ||
        existingActions[0]?.id !== priorFailedActionId || existingActions[0]?.status !== "FAILED" ||
        existingActions[0]?.attempt_count !== 1 || existingActions[0]?.safe_error_code !== "PERMISSION_DENIED" ||
        existingActions[0]?.provider_message_id !== null))) throw Error("QA_ACTION_ALREADY_EXISTS");
  if (dryRun) {
    process.stdout.write("ONE_SHOT_QA_PREFLIGHT_PASS account=EXACT conversation=EXACT recipient=EXACT suppressed=NO\n");
    return;
  }
  const adapterRoot = resolve(projectRoot, "..", "hirex-deplao-adapter", "dist", "src");
  const { openDatabase } = await import(pathToFileURL(resolve(adapterRoot, "storage", "database.js")).href);
  const { ManualCapabilityStore } = await import(pathToFileURL(resolve(adapterRoot, "storage", "manual-capability.js")).href);
  const db = openDatabase(databasePath);
  try {
    const capabilityId = new ManualCapabilityStore(db).createExact({
      workspaceId: conversation.workspace_id, connectedAccountId: account.id,
      accountZaloId: account.external_account_id, conversationId: conversation.id,
      recipientZaloId: conversation.provider_conversation_id, text,
    });
    process.stdout.write(`ONE_SHOT_QA_READY capabilityId=${capabilityId} scope=EXACT ttlMinutes=15\n`);
  } finally { db.close(); }
}
main().catch(error => { process.stderr.write(`ONE_SHOT_QA_BLOCKED code=${/^QA_[A-Z_]+$/.test(error?.message ?? "") ? error.message : "UNAVAILABLE"}\n`); process.exitCode = 1; });
