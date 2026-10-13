import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { mapZaloHistoryRow, summarizeZaloHistory } from "./lib/zalo-history-backfill.mjs";
import { ensurePrivateHistoryBucket, inspectHistoryRemote, persistHistoryMessage, resolveHistoryAccounts } from "./lib/zalo-history-remote-writer.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
createRequire(import.meta.url)("@next/env").loadEnvConfig(projectRoot);
const profileRoot = process.env.HIREX_DEPLAO_QA_PROFILE || "C:\\Users\\Admin\\AppData\\Local\\HireX\\ZaloRuntime\\deplao-qa-profile";
const databasePath = path.join(profileRoot, "deplao-tool.db");
const execute = process.argv.includes("--execute");
const enrichIdentities = process.argv.includes("--enrich-identities");
const remotePreflight = process.argv.includes("--remote-preflight");
const verify = process.argv.includes("--verify");
function integerArgument(name, fallback, maximum) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) throw new Error(`INVALID_${name.toUpperCase()}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > maximum) throw new Error(`INVALID_${name.toUpperCase()}`);
  return value;
}
const offset = integerArgument("offset", 0, 10_000_000);
const limit = integerArgument("limit", 100, 500);
const tail = integerArgument("tail", 0, 500);
if (execute && process.env.HIREX_ALLOW_REMOTE_ZALO_HISTORY_BACKFILL !== "1") throw new Error("REMOTE_ZALO_HISTORY_BACKFILL_NOT_AUTHORIZED");
if (enrichIdentities && process.env.HIREX_ALLOW_REMOTE_ZALO_IDENTITY_ENRICHMENT !== "1") throw new Error("REMOTE_ZALO_IDENTITY_ENRICHMENT_NOT_AUTHORIZED");

function remoteClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (typeof url !== "string" || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/u.test(url) || typeof secret !== "string" || secret.length < 32)
    throw new Error("REMOTE_CONFIGURATION_INVALID");
  return createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}

const database = new DatabaseSync(databasePath, { readOnly: true });
try {
  const select = `select cast(m.owner_zalo_id as text) account_id, cast(m.msg_id as text) provider_message_id,
    cast(m.thread_id as text) thread_id, m.thread_type, cast(m.sender_id as text) sender_id, m.content, m.msg_type,
    c.display_name conversation_name, c.avatar_url,
    cast(m.timestamp as text) timestamp_text, m.is_sent, m.attachments, m.local_paths
    from messages m left join contacts c on c.owner_zalo_id=m.owner_zalo_id and c.contact_id=m.thread_id
    where m.channel='zalo' order by m.owner_zalo_id, m.timestamp, m.id`;
  const rows = database.prepare(select).all();
  const summary = summarizeZaloHistory(rows, profileRoot);
  if (summary.total === 0 || summary.invalid !== 0 || summary.valid !== summary.total) throw new Error("LOCAL_HISTORY_VALIDATION_FAILED");
  if (!execute && !enrichIdentities && !remotePreflight && !verify) {
    console.log("ZALO_HISTORY_BACKFILL_DRY_RUN");
    for (const key of ["total", "valid", "invalid", "inbound", "outbound", "user", "group", "attachments", "mediaAvailable", "named", "avatars"])
      console.log(`${key.toUpperCase()}=${summary[key]}`);
    console.log(`ACCOUNT_COUNTS=${JSON.stringify(summary.byAccount)}`);
    console.log(`TYPE_COUNTS=${JSON.stringify(summary.byType)}`);
  } else {
    const client = remoteClient();
    const externalIds = Object.keys(summary.byAccount).sort();
    const inspection = await inspectHistoryRemote(client, externalIds);
    if (inspection.bucketExists && inspection.bucketPrivate !== true) throw new Error("STORAGE_BUCKET_NOT_PRIVATE");
    if (remotePreflight) {
      console.log("ZALO_HISTORY_REMOTE_PREFLIGHT_PASS");
      console.log(`ACCOUNT_COUNT=${inspection.accountCount}`);
      console.log(`PRIVATE_BUCKET=${inspection.bucketExists ? "PRESENT" : "MISSING_WILL_CREATE_ON_EXECUTE"}`);
    } else if (verify) {
      const mapping = await resolveHistoryAccounts(client, externalIds);
      let missing = 0, verified = 0;
      for (const externalId of externalIds) {
        const accountId = mapping.accounts.get(externalId);
        const ids = rows.filter((row) => String(row.account_id) === externalId).map((row) => String(row.provider_message_id));
        for (let index = 0; index < ids.length; index += 100) {
          const part = ids.slice(index, index + 100);
          const result = await client.from("omnichannel_messages").select("provider_message_id")
            .eq("workspace_id", mapping.workspaceId).eq("channel_account_id", accountId).in("provider_message_id", part);
          if (result.error) throw new Error("REMOTE_MESSAGE_VERIFY_FAILED");
          const found = new Set(result.data.map((item) => item.provider_message_id));
          missing += part.filter((id) => !found.has(id)).length;
          verified += found.size;
        }
      }
      const attachments = await client.from("channel_attachments").select("id", { count: "exact", head: true })
        .eq("workspace_id", mapping.workspaceId).eq("storage_bucket", "channel-attachments");
      if (attachments.error) throw new Error("REMOTE_ATTACHMENT_VERIFY_FAILED");
      console.log("ZALO_HISTORY_BACKFILL_VERIFY");
      console.log(`LOCAL_MESSAGES=${rows.length}`);
      console.log(`REMOTE_MATCHED_MESSAGES=${verified}`);
      console.log(`MISSING_MESSAGES=${missing}`);
      console.log(`REMOTE_HISTORY_ATTACHMENTS=${attachments.count ?? 0}`);
      if (missing !== 0 || verified !== rows.length) process.exitCode = 1;
    } else if (enrichIdentities) {
      const mapping = await resolveHistoryAccounts(client, externalIds);
      const identities = new Map();
      for (const row of rows) {
        const mapped = mapZaloHistoryRow(row, profileRoot);
        if (!mapped.ok || (!mapped.value.conversationName && !mapped.value.avatarUrl)) continue;
        const key = `${mapped.value.accountId}:${mapped.value.providerConversationId}`;
        const current = identities.get(key) ?? { accountId: mapped.value.accountId, providerConversationId: mapped.value.providerConversationId,
          conversationKind: mapped.value.conversationKind, conversationName: null, avatarUrl: null };
        current.conversationName = mapped.value.conversationName ?? current.conversationName;
        current.avatarUrl = mapped.value.avatarUrl ?? current.avatarUrl;
        identities.set(key, current);
      }
      let matched = 0, updated = 0, contactsUpdated = 0;
      for (const externalId of externalIds) {
        const accountId = mapping.accounts.get(externalId);
        const accountIdentities = [...identities.values()].filter((item) => item.accountId === externalId);
        for (let index = 0; index < accountIdentities.length; index += 100) {
          const part = accountIdentities.slice(index, index + 100);
          const result = await client.from("omnichannel_conversations").select("id,contact_id,provider_conversation_id,subject,metadata")
            .eq("workspace_id", mapping.workspaceId).eq("channel_account_id", accountId)
            .in("provider_conversation_id", part.map((item) => item.providerConversationId));
          if (result.error) throw new Error("IDENTITY_CONVERSATION_QUERY_FAILED");
          const identityByThread = new Map(part.map((item) => [item.providerConversationId, item]));
          for (const conversation of result.data) {
            const identity = identityByThread.get(conversation.provider_conversation_id);
            if (!identity) continue;
            matched += 1;
            const metadata = conversation.metadata && typeof conversation.metadata === "object" && !Array.isArray(conversation.metadata)
              ? conversation.metadata : {};
            const update = await client.from("omnichannel_conversations").update({
              ...(identity.conversationKind === "GROUP" && identity.conversationName ? { subject: identity.conversationName } : {}),
              metadata: { ...metadata, participantDisplayName: identity.conversationName ?? metadata.participantDisplayName,
                conversationDisplayName: identity.conversationName ?? metadata.conversationDisplayName,
                avatarUrl: identity.avatarUrl ?? metadata.avatarUrl, conversationKind: identity.conversationKind },
            }).eq("workspace_id", mapping.workspaceId).eq("id", conversation.id);
            if (update.error) throw new Error("IDENTITY_CONVERSATION_UPDATE_FAILED");
            updated += 1;
            if (typeof conversation.contact_id === "string" && identity.conversationName) {
              const contact = await client.from("contacts").update({ full_name: identity.conversationName })
                .eq("workspace_id", mapping.workspaceId).eq("id", conversation.contact_id);
              if (contact.error) throw new Error("IDENTITY_CONTACT_UPDATE_FAILED");
              contactsUpdated += 1;
            }
          }
        }
      }
      console.log("ZALO_HISTORY_IDENTITY_ENRICHMENT_PASS");
      console.log(`SOURCE_IDENTITIES=${identities.size}`);
      console.log(`MATCHED_CONVERSATIONS=${matched}`);
      console.log(`UPDATED_CONVERSATIONS=${updated}`);
      console.log(`UPDATED_CONTACTS=${contactsUpdated}`);
    } else {
      await ensurePrivateHistoryBucket(client);
      const mapping = await resolveHistoryAccounts(client, externalIds);
      const effectiveOffset = tail > 0 ? Math.max(rows.length - tail, 0) : offset;
      const effectiveLimit = tail > 0 ? tail : limit;
      const batchRows = database.prepare(`${select} limit ? offset ?`).all(effectiveLimit, effectiveOffset);
      const groups = new Map();
      for (const row of batchRows) {
        const mapped = mapZaloHistoryRow(row, profileRoot);
        if (!mapped.ok) throw new Error("BATCH_ROW_INVALID");
        const key = `${mapped.value.accountId}:${mapped.value.providerConversationId}`;
        const group = groups.get(key) ?? [];
        group.push(mapped.value);
        groups.set(key, group);
      }
      let processed = 0, uploaded = 0;
      const lanes = Array.from(groups.values());
      let laneIndex = 0;
      async function worker() {
        while (laneIndex < lanes.length) {
          const lane = lanes[laneIndex];
          laneIndex += 1;
          for (const message of lane) {
            const result = await persistHistoryMessage(client, mapping, message);
            processed += 1; uploaded += result.uploaded;
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, lanes.length) }, () => worker()));
      console.log("ZALO_HISTORY_BACKFILL_BATCH_PASS");
      console.log(`OFFSET=${effectiveOffset}`);
      console.log(`PROCESSED=${processed}`);
      console.log(`MEDIA_UPLOADED_OR_VERIFIED=${uploaded}`);
      console.log(`NEXT_OFFSET=${effectiveOffset + processed}`);
    }
  }
} finally { database.close(); }
