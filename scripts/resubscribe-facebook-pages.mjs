import { createDecipheriv } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const readEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
};

function decrypt(value) {
  const [version, ivValue, tagValue, ciphertextValue, extra] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue || extra) throw new Error("INVALID_CREDENTIAL");
  const key = Buffer.from(readEnv("CHANNEL_TOKEN_ENCRYPTION_KEY"), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64")), decipher.final()]).toString("utf8");
}

const client = createClient(readEnv("NEXT_PUBLIC_SUPABASE_URL"), readEnv("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
const { data, error } = await client.from("channel_account_credentials")
  .select("access_token_encrypted,configuration,channel_accounts!inner(id,channel_type,external_account_id,display_name,status)")
  .eq("channel_accounts.channel_type", "FACEBOOK").eq("channel_accounts.status", "CONNECTED");
if (error) throw error;

let subscribed = 0;
let failed = 0;
for (const row of data ?? []) {
  const account = Array.isArray(row.channel_accounts) ? row.channel_accounts[0] : row.channel_accounts;
  try {
    const token = decrypt(row.access_token_encrypted);
    const version = row.configuration?.graphApiVersion;
    const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(account.external_account_id)}/subscribed_apps`);
    endpoint.searchParams.set("subscribed_fields", "messages,messaging_postbacks,message_deliveries,message_reads");
    const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true) throw new Error(`HTTP_${response.status}`);
    subscribed += 1;
    console.log(`SUBSCRIBED ${account.display_name}`);
  } catch (cause) {
    failed += 1;
    console.error(`FAILED ${account?.display_name ?? "unknown"}: ${cause instanceof Error ? cause.message : "UNKNOWN"}`);
  }
}
console.log(JSON.stringify({ subscribed, failed, total: subscribed + failed }));
if (failed > 0) process.exitCode = 1;
