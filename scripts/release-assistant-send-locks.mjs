// Frees a Zalo nick locked by a Zalo Trợ lý answer whose delivery is "unknown" right away, instead of after
// the usual 30 minutes. Only Trợ lý answers (key "assistant-bot:…") that Deplao never recorded as sent are
// released, and they are never sent again. Same signed adapter call and HireX function as
// reconcile-zalo-send-locks.mjs. By hand: node scripts/release-assistant-send-locks.mjs
import { DatabaseSync } from "node:sqlite";
import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { findSentMessage, selectHeldLocks } from "./lib/zalo-send-locks.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
createRequire(import.meta.url)("@next/env").loadEnvConfig(projectRoot);
const runtimeRoot = "C:\\Users\\Admin\\AppData\\Local\\HireX\\ZaloRuntime";
const profileRoot = process.env.HIREX_DEPLAO_QA_PROFILE || process.env.HIREX_DEPLAO_QA_USER_DATA_DIR || path.join(runtimeRoot, "deplao-qa-profile");
const adapterBase = `http://127.0.0.1:${process.env.ADAPTER_PORT || "18788"}`;
const RECONCILE_PATH = "/v1/deliveries/reconcile";

async function adapterReconcile(payload) {
  const secret = process.env.HIREX_BRIDGE_SIGNING_SECRET;
  if (typeof secret !== "string" || secret.length < 16) throw new Error("SIGNING_SECRET_MISSING");
  const body = JSON.stringify(payload), timestamp = String(Math.floor(Date.now() / 1000));
  const canonical = ["POST", RECONCILE_PATH, timestamp, createHash("sha256").update(body).digest("hex"), payload.idempotencyKey].join("\n");
  const response = await fetch(`${adapterBase}${RECONCILE_PATH}`, { method: "POST", body, signal: AbortSignal.timeout(10_000), headers: {
    "content-type": "application/json", "x-hirex-timestamp": timestamp, "x-hirex-idempotency-key": payload.idempotencyKey,
    "x-hirex-signature": createHmac("sha256", secret).update(canonical).digest("hex") } });
  const result = await response.json().catch(() => ({}));
  return response.status === 200 ? result.status : `HTTP_${response.status}`;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const adapterDb = new DatabaseSync(process.env.ADAPTER_DATABASE_PATH || path.join(runtimeRoot, "adapter.db"), { readOnly: true });
const deplaoDb = new DatabaseSync(path.join(profileRoot, "deplao-tool.db"), { readOnly: true });
const outcomes = [];
for (const lock of selectHeldLocks(adapterDb)) {
  if (lock.state !== "UNKNOWN" || !/^assistant-bot:[0-9a-f-]{36}:part:\d+$/iu.test(lock.idempotencyKey)) continue;
  const { data } = await client.from("channel_outbound_actions").select("id,workspace_id,status,text_content").eq("channel_type", "ZALO").eq("idempotency_key", lock.idempotencyKey).limit(1);
  const action = data?.[0] ?? null;
  if (findSentMessage(deplaoDb, lock, action?.text_content ?? null)) { outcomes.push({ account: lock.accountId, decision: "SENT_KEEP_FOR_NORMAL_RECONCILE" }); continue; }
  const adapter = await adapterReconcile({ idempotencyKey: lock.idempotencyKey, decision: "ACKNOWLEDGE_NO_RETRY" });
  let hirex = null;
  if (action?.status === "DELIVERY_UNKNOWN") {
    const { data: done, error } = await client.rpc("auto_acknowledge_zalo_delivery_unknown", { p_workspace_id: action.workspace_id, p_action_id: action.id });
    hirex = !error && done === true;
  }
  outcomes.push({ account: lock.accountId, decision: "RELEASED", adapter, hirex });
}
adapterDb.close(); deplaoDb.close();
console.log(JSON.stringify({ released: outcomes.filter((item) => item.decision === "RELEASED").length, outcomes }));
