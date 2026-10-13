import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const HISTORY_BUCKET = "channel-attachments";
const enrichedConversations = new Set();

export function stableUuid(namespace) {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function filename(value, fallback) {
  const base = path.basename(value).normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f]/gu, "_").trim();
  return base && base.length <= 255 ? base : fallback;
}
function contentType(name, role) {
  const extension = path.extname(name).toLowerCase();
  const types = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".pdf": "application/pdf", ".txt": "text/plain", ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".zip": "application/zip" };
  return types[extension] ?? (role === "thumb" || role === "main" ? "image/jpeg" : "application/octet-stream");
}
async function required(result, code) { if (result.error) throw new Error(code); return result.data; }

async function maybeSingle(query, code) {
  const result = await query.maybeSingle();
  if (result.error) throw new Error(code);
  return result.data;
}

export async function resolveHistoryAccounts(client, externalIds) {
  const result = await client.from("channel_accounts").select("id,workspace_id,external_account_id,status,operator_enabled")
    .eq("channel_type", "ZALO").eq("provider", "ZALO_BRIDGE").in("external_account_id", externalIds);
  const rows = await required(result, "CHANNEL_ACCOUNT_QUERY_FAILED");
  if (!Array.isArray(rows) || rows.length !== externalIds.length || rows.some((row) => row.status !== "CONNECTED" || row.operator_enabled !== true))
    throw new Error("CHANNEL_ACCOUNT_MAPPING_INVALID");
  const workspaces = new Set(rows.map((row) => row.workspace_id));
  if (workspaces.size !== 1 || rows.some((row) => typeof row.id !== "string" || typeof row.external_account_id !== "string"))
    throw new Error("CHANNEL_ACCOUNT_WORKSPACE_INVALID");
  return { workspaceId: rows[0].workspace_id, accounts: new Map(rows.map((row) => [row.external_account_id, row.id])) };
}

export async function ensurePrivateHistoryBucket(client) {
  const listed = await client.storage.listBuckets();
  if (listed.error) throw new Error("STORAGE_BUCKET_QUERY_FAILED");
  const existing = listed.data.find((bucket) => bucket.name === HISTORY_BUCKET);
  if (existing) { if (existing.public) throw new Error("STORAGE_BUCKET_PUBLIC"); return; }
  const created = await client.storage.createBucket(HISTORY_BUCKET, { public: false, fileSizeLimit: 25 * 1024 * 1024 });
  if (created.error) throw new Error("STORAGE_BUCKET_CREATE_FAILED");
}

export async function inspectHistoryRemote(client, externalIds) {
  const mapping = await resolveHistoryAccounts(client, externalIds);
  const listed = await client.storage.listBuckets();
  if (listed.error) throw new Error("STORAGE_BUCKET_QUERY_FAILED");
  const bucket = listed.data.find((item) => item.name === HISTORY_BUCKET);
  return {
    workspaceId: mapping.workspaceId,
    accountCount: mapping.accounts.size,
    bucketExists: Boolean(bucket),
    bucketPrivate: bucket ? bucket.public === false : null,
  };
}

export async function persistHistoryMessage(client, mapping, message, options = {}) {
  const accountId = mapping.accounts.get(message.accountId);
  if (!accountId) throw new Error("CHANNEL_ACCOUNT_NOT_MAPPED");
  if (options.reconcile) {
    const active = await maybeSingle(client.from("channel_accounts").select("id")
      .eq("workspace_id", mapping.workspaceId).eq("id", accountId).eq("channel_type", "ZALO")
      .eq("status", "CONNECTED").eq("operator_enabled", true).is("deleted_at", null), "CHANNEL_ACCOUNT_CHECK_FAILED");
    if (!active) throw new Error("CHANNEL_ACCOUNT_INACTIVE");
  }
  const peerId = message.conversationKind === "GROUP" ? `group:${message.providerConversationId}` :
    message.direction === "INBOUND" ? message.senderId : message.providerConversationId;
  let existingConversation = await maybeSingle(client.from("omnichannel_conversations").select("id,contact_id,last_message_at,subject,metadata")
    .eq("workspace_id", mapping.workspaceId).eq("channel_account_id", accountId)
    .eq("provider_conversation_id", message.providerConversationId), "CONVERSATION_QUERY_FAILED");
  let contactId = existingConversation?.contact_id;
  if (typeof contactId !== "string") {
    contactId = stableUuid(`zalo-history:contact:${mapping.workspaceId}:${accountId}:${peerId}`);
    const channelId = stableUuid(`zalo-history:contact-channel:${mapping.workspaceId}:${accountId}:${peerId}`);
    await required(await client.from("contacts").upsert({ id: contactId, workspace_id: mapping.workspaceId,
      full_name: message.conversationName ?? (message.conversationKind === "GROUP" ? `Zalo group ${message.providerConversationId}` : `Zalo ${peerId}`), source: "ZALO_INBOUND" },
    { onConflict: "id", ignoreDuplicates: true }), "CONTACT_UPSERT_FAILED");
    await required(await client.from("contact_channels").upsert({ id: channelId, workspace_id: mapping.workspaceId, contact_id: contactId,
      channel_type: "ZALO", channel_value: peerId, is_primary: true, metadata: { channelAccountId: accountId, historical: true } },
    { onConflict: "id", ignoreDuplicates: true }), "CONTACT_CHANNEL_UPSERT_FAILED");
  }
  let conversationId = existingConversation?.id;
  if (typeof conversationId !== "string") {
    const inserted = await client.from("omnichannel_conversations").insert({
      id: stableUuid(`zalo-history:conversation:${mapping.workspaceId}:${accountId}:${message.providerConversationId}`),
      workspace_id: mapping.workspaceId, channel_account_id: accountId, channel_type: "ZALO",
      provider_conversation_id: message.providerConversationId, contact_id: contactId,
      subject: message.conversationKind === "GROUP" ? message.conversationName ?? `Zalo group ${message.providerConversationId}` : null,
      last_message_at: message.occurredAt,
      metadata: { participantExternalId: peerId, participantDisplayName: message.conversationName, conversationDisplayName: message.conversationName,
        avatarUrl: message.avatarUrl, conversationKind: message.conversationKind,
        ...(options.reconcile ? { syncSource: "recent-reconciliation" } : { historical: true }) },
    }).select("id").single();
    if (options.reconcile && inserted.error?.code === "23505") {
      existingConversation = await maybeSingle(client.from("omnichannel_conversations").select("id,contact_id,last_message_at,subject,metadata")
        .eq("workspace_id", mapping.workspaceId).eq("channel_account_id", accountId)
        .eq("provider_conversation_id", message.providerConversationId), "CONVERSATION_RACE_QUERY_FAILED");
      if (!existingConversation?.id) throw new Error("CONVERSATION_INSERT_FAILED");
      conversationId = existingConversation.id;
    } else {
      if (inserted.error || typeof inserted.data?.id !== "string") throw new Error("CONVERSATION_INSERT_FAILED");
      conversationId = inserted.data.id;
    }
  } else {
    const enrichmentKey = `${accountId}:${message.providerConversationId}`;
    if (!options.reconcile && !enrichedConversations.has(enrichmentKey) && (message.conversationName || message.avatarUrl)) {
      const metadata = existingConversation.metadata && typeof existingConversation.metadata === "object" && !Array.isArray(existingConversation.metadata)
        ? existingConversation.metadata : {};
      await required(await client.from("omnichannel_conversations").update({
        ...(message.conversationKind === "GROUP" && message.conversationName ? { subject: message.conversationName } : {}),
        metadata: { ...metadata, participantDisplayName: message.conversationName ?? metadata.participantDisplayName,
          conversationDisplayName: message.conversationName ?? metadata.conversationDisplayName,
          avatarUrl: message.avatarUrl ?? metadata.avatarUrl, conversationKind: message.conversationKind },
      }).eq("id", conversationId).eq("workspace_id", mapping.workspaceId), "CONVERSATION_IDENTITY_UPDATE_FAILED");
      if (typeof contactId === "string" && message.conversationName)
        await required(await client.from("contacts").update({ full_name: message.conversationName }).eq("id", contactId).eq("workspace_id", mapping.workspaceId), "CONTACT_IDENTITY_UPDATE_FAILED");
      enrichedConversations.add(enrichmentKey);
    }
  }
  async function updateLatestTimestamp() {
    if (!existingConversation || (existingConversation.last_message_at && Date.parse(existingConversation.last_message_at) >= Date.parse(message.occurredAt))) return;
    let timestampUpdate = client.from("omnichannel_conversations").update({ last_message_at: message.occurredAt })
      .eq("id", conversationId).eq("workspace_id", mapping.workspaceId);
    timestampUpdate = existingConversation.last_message_at === null
      ? timestampUpdate.is("last_message_at", null)
      : timestampUpdate.eq("last_message_at", existingConversation.last_message_at);
    await required(await timestampUpdate, "CONVERSATION_TIMESTAMP_FAILED");
  }
  if (!options.reconcile) await updateLatestTimestamp();
  const metadataAttachments = Array.from({ length: message.attachmentCount }, (_, index) => {
    const media = message.media[index];
    return { filename: media ? filename(media.path, `zalo-attachment-${index + 1}`) : null, contentType: media ? contentType(media.path, media.role) : null,
      sizeBytes: media?.sizeBytes ?? null };
  });
  const existingMessage = await maybeSingle(client.from("omnichannel_messages").select("id")
    .eq("workspace_id", mapping.workspaceId).eq("channel_account_id", accountId)
    .eq("provider_message_id", message.providerMessageId), "MESSAGE_QUERY_FAILED");
  let messageId = existingMessage?.id;
  if (typeof messageId !== "string") {
    messageId = stableUuid(`zalo-history:message:${mapping.workspaceId}:${accountId}:${message.providerMessageId}`);
    const inserted = await client.from("omnichannel_messages").insert({ id: messageId, workspace_id: mapping.workspaceId,
      conversation_id: conversationId, channel_account_id: accountId, channel_type: "ZALO", provider_message_id: message.providerMessageId,
      provider_event_id: `history:${message.idempotencyKey}`, direction: message.direction, sender_external_id: message.senderId,
      recipient_external_ids: [message.direction === "INBOUND" ? message.accountId : peerId], text_content: message.text,
      attachment_count: message.attachmentCount, ...(message.direction === "INBOUND" ? { received_at: message.occurredAt } : { sent_at: message.occurredAt }),
      metadata: { ...(options.reconcile ? { syncSource: "recent-reconciliation" } : { historical: true }), messageType: message.messageType, attachments: metadataAttachments },
    });
    if (options.reconcile && inserted.error?.code === "23505") {
      const winner = await maybeSingle(client.from("omnichannel_messages").select("id,conversation_id")
        .eq("workspace_id", mapping.workspaceId).eq("channel_account_id", accountId)
        .eq("provider_message_id", message.providerMessageId), "MESSAGE_RACE_QUERY_FAILED");
      if (!winner?.id || winner.conversation_id !== conversationId) throw new Error("MESSAGE_INSERT_FAILED");
      messageId = winner.id;
    } else if (inserted.error) throw new Error("MESSAGE_INSERT_FAILED");
  }
  if (options.reconcile) await updateLatestTimestamp();
  if (options.skipMedia) return { messageId, conversationId, uploaded: 0 };
  let uploaded = 0;
  for (const [position, media] of message.media.entries()) {
    if (!media.exists) continue;
    const bytes = readFileSync(media.path);
    if (bytes.byteLength !== media.sizeBytes || bytes.byteLength > 25 * 1024 * 1024) throw new Error("MEDIA_SIZE_CHANGED");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const attachmentId = stableUuid(`zalo-history:attachment:${mapping.workspaceId}:${accountId}:${message.providerMessageId}:${position}`);
    const safeName = filename(media.path, `zalo-attachment-${position + 1}`);
    const existingAttachment = await maybeSingle(client.from("channel_attachments")
      .select("storage_bucket,storage_path,size_bytes,sha256").eq("id", attachmentId).eq("workspace_id", mapping.workspaceId),
    "ATTACHMENT_QUERY_FAILED");
    let storagePath;
    if (existingAttachment) {
      if (existingAttachment.storage_bucket !== HISTORY_BUCKET || existingAttachment.size_bytes !== bytes.byteLength || existingAttachment.sha256 !== digest)
        throw new Error(`ATTACHMENT_EVIDENCE_CHANGED:${attachmentId}`);
      storagePath = existingAttachment.storage_path;
    } else {
      const extension = path.extname(safeName).toLowerCase();
      const safeExtension = /^\.[a-z0-9]{1,10}$/u.test(extension) ? extension : "";
      storagePath = `${mapping.workspaceId}/${accountId}/${messageId}/${position}-${attachmentId}${safeExtension}`;
      const upload = await client.storage.from(HISTORY_BUCKET).upload(storagePath, bytes, { contentType: contentType(safeName, media.role), upsert: false });
      if (upload.error) {
        const existing = await client.storage.from(HISTORY_BUCKET).download(storagePath);
        const existingBytes = existing.data ? Buffer.from(await existing.data.arrayBuffer()) : null;
        const existingDigest = existingBytes ? createHash("sha256").update(existingBytes).digest("hex") : null;
        if (existing.error || !existingBytes || existingDigest !== digest)
          throw new Error(`MEDIA_UPLOAD_FAILED:${stableUuid(`media-diagnostic:${storagePath}`)}:${bytes.byteLength}:${existingBytes?.byteLength ?? -1}:${digest.slice(0, 12)}:${existingDigest?.slice(0, 12) ?? "NONE"}:${String(upload.error.name ?? "UNKNOWN").slice(0, 40)}:${String(upload.error.statusCode ?? upload.error.status ?? upload.error.code ?? "UNKNOWN").slice(0, 20)}`);
      }
      const metadataInsert=await client.from("channel_attachments").upsert({ id: attachmentId, workspace_id: mapping.workspaceId,
        storage_bucket: HISTORY_BUCKET, storage_path: storagePath, filename: safeName, content_type: contentType(safeName, media.role),
        size_bytes: bytes.byteLength, sha256: digest, source: "INBOUND_PROVIDER" },{onConflict:"id",ignoreDuplicates:true});
      if(metadataInsert.error)throw new Error(`ATTACHMENT_METADATA_FAILED:${metadataInsert.error.code ?? "UNKNOWN"}:${metadataInsert.error.message ?? "UNKNOWN"}`);
      const verifiedAttachment=await maybeSingle(client.from("channel_attachments").select("workspace_id,storage_bucket,storage_path,size_bytes,sha256")
        .eq("id",attachmentId),"ATTACHMENT_VERIFY_FAILED");
      if(!verifiedAttachment||verifiedAttachment.workspace_id!==mapping.workspaceId||verifiedAttachment.storage_bucket!==HISTORY_BUCKET||
        verifiedAttachment.storage_path!==storagePath||verifiedAttachment.size_bytes!==bytes.byteLength||verifiedAttachment.sha256!==digest)
        throw new Error("ATTACHMENT_EVIDENCE_CHANGED");
    }
    await required(await client.from("channel_message_attachments").upsert({ workspace_id: mapping.workspaceId, message_id: messageId,
      attachment_id: attachmentId, position }, { onConflict: "message_id,attachment_id", ignoreDuplicates: true }), "ATTACHMENT_LINK_FAILED");
    uploaded += 1;
  }
  return { messageId, conversationId, uploaded };
}
