import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";

const SAFE_ID = /^[1-9][0-9]{0,127}$/u;
const MEDIA_TYPES = new Set(["chat.photo", "chat.video.msg", "share.file", "chat.sticker"]);

function safeId(value) {
  const text = typeof value === "bigint" ? value.toString() : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === "string" && SAFE_ID.test(text) ? text : null;
}

function safeExternalId(value) {
  const text = typeof value === "bigint" ? value.toString() : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === "string" && text.trim() === text && text.length > 0 && text.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/u.test(text) ? text : null;
}

function safeName(value) {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 255 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) ? value : null;
}

function safeAvatarUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.toString() : null; } catch { return null; }
}

function safeTimestamp(value) {
  const text = typeof value === "bigint" ? value.toString() : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^[0-9]{10}(?:[0-9]{3})?$/u.test(text)) return null;
  const milliseconds = text.length === 10 ? Number(text) * 1000 : Number(text);
  return Number.isSafeInteger(milliseconds) && Number.isFinite(new Date(milliseconds).getTime()) ? new Date(milliseconds).toISOString() : null;
}

function jsonObject(value) {
  if (typeof value !== "string") return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}

function textContent(value, messageType) {
  if (typeof value === "string" && value.trim() && value.length <= 100_000 && !value.includes("\0")) return value;
  const labels = {
    "chat.photo": "[Zalo image]", "chat.video.msg": "[Zalo video]", "share.file": "[Zalo file]",
    "chat.sticker": "[Zalo sticker]", "chat.ecard": "[Zalo contact card]", "chat.recommended": "[Zalo recommendation]",
    "group.poll": "[Zalo poll]", "chat.delete": "[Zalo deleted message]", system: "[Zalo system event]",
  };
  return labels[messageType] ?? "[Zalo provider event]";
}

function mediaCandidates(row, profileRoot) {
  const paths = jsonObject(row.local_paths);
  const candidates = [];
  for (const [role, value] of Object.entries(paths)) {
    if (typeof value !== "string" || !value.trim()) continue;
    const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(profileRoot, value);
    const allowedRoot = path.resolve(profileRoot).toLowerCase() + path.sep;
    if (!absolute.toLowerCase().startsWith(allowedRoot)) continue;
    let sizeBytes = null;
    try { const stat = statSync(absolute); if (stat.isFile() && stat.size <= 25 * 1024 * 1024) sizeBytes = stat.size; }
    catch { /* Missing historical media remains metadata-only. */ }
    candidates.push({ role, path: absolute, exists: sizeBytes !== null, sizeBytes });
  }
  return candidates;
}

export function mapZaloHistoryRow(row, profileRoot) {
  const accountId = safeId(row.account_id), providerMessageId = safeExternalId(row.provider_message_id);
  const threadId = safeId(row.thread_id), senderId = safeExternalId(row.sender_id), occurredAt = safeTimestamp(row.timestamp_text);
  if (!accountId || !providerMessageId || !threadId || !senderId || !occurredAt || ![0, 1].includes(row.thread_type) || ![0, 1].includes(row.is_sent) || typeof row.msg_type !== "string")
    return { ok: false, code: "ROW_INVALID" };
  const media = mediaCandidates(row, profileRoot);
  return {
    ok: true,
    value: {
      accountId, providerMessageId, providerConversationId: threadId, senderId,
      direction: row.is_sent === 1 ? "OUTBOUND" : "INBOUND", conversationKind: row.thread_type === 1 ? "GROUP" : "USER",
      conversationName: safeName(row.conversation_name), avatarUrl: safeAvatarUrl(row.avatar_url),
      messageType: row.msg_type, occurredAt, text: textContent(row.content, row.msg_type), media,
      attachmentCount: Math.max(media.length, MEDIA_TYPES.has(row.msg_type) ? 1 : 0),
      idempotencyKey: createHash("sha256").update(`zalo-history:${accountId}:${providerMessageId}`).digest("hex"),
    },
  };
}

export function summarizeZaloHistory(rows, profileRoot) {
  const summary = { total: 0, valid: 0, invalid: 0, inbound: 0, outbound: 0, user: 0, group: 0, attachments: 0, mediaAvailable: 0,
    named: 0, avatars: 0, byAccount: {}, byType: {} };
  for (const row of rows) {
    summary.total += 1;
    const mapped = mapZaloHistoryRow(row, profileRoot);
    if (!mapped.ok) { summary.invalid += 1; continue; }
    summary.valid += 1;
    summary[mapped.value.direction.toLowerCase()] += 1;
    summary[mapped.value.conversationKind.toLowerCase()] += 1;
    summary.attachments += mapped.value.attachmentCount;
    summary.mediaAvailable += mapped.value.media.filter((item) => item.exists).length;
    if (mapped.value.conversationName) summary.named += 1;
    if (mapped.value.avatarUrl) summary.avatars += 1;
    summary.byAccount[mapped.value.accountId] = (summary.byAccount[mapped.value.accountId] ?? 0) + 1;
    summary.byType[mapped.value.messageType] = (summary.byType[mapped.value.messageType] ?? 0) + 1;
  }
  return summary;
}
