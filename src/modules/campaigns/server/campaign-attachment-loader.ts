import "server-only";

import { sha256, validateAttachmentDescriptor, validateStepAttachmentSet, type SafeAttachment } from "@/modules/campaigns/domain/attachment-rules";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

const MAX_CACHE = 36 * 1024 * 1024;

export function isStorageNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: unknown; statusCode?: unknown; message?: unknown };
  return value.status === 404 || value.statusCode === 404 || value.statusCode === "404"
    || (typeof value.message === "string" && value.message.toLowerCase().includes("not found"));
}

export function createCampaignAttachmentLoader(db = createPrivilegedSupabaseClient()) {
  const cache = new Map<string, SafeAttachment>();
  let cachedBytes = 0;
  return async function load(workspaceId: string, campaignId: string, deliveryId: string) {
    const { data: delivery, error } = await db.from("email_campaign_recipient_steps").select("campaign_step_id").eq("id", deliveryId).eq("workspace_id", workspaceId).eq("campaign_id", campaignId).maybeSingle();
    if (error || !delivery) return { ok: false as const, code: "ATTACHMENT_FETCH_FAILED" as const };
    const { data, error: metadataError } = await db.from("email_campaign_step_attachments").select("sort_order,email_attachments!inner(id,storage_bucket,storage_path,original_filename,mime_type,size_bytes,sha256,deleted_at)").eq("workspace_id", workspaceId).eq("campaign_id", campaignId).eq("step_id", delivery.campaign_step_id).order("sort_order");
    if (metadataError) return { ok: false as const, code: "ATTACHMENT_FETCH_FAILED" as const };
    const rows = (data ?? []).map((row) => row.email_attachments as unknown as { id: string; storage_bucket: string; storage_path: string; original_filename: string; mime_type: string; size_bytes: number; sha256: string; deleted_at: string | null });
    if (rows.some((item) => item.deleted_at !== null) || rows.some((item) => validateAttachmentDescriptor(item.original_filename, item.mime_type, item.size_bytes))) return { ok: false as const, code: "ATTACHMENT_INVALID" as const };
    if (validateStepAttachmentSet(rows.map((item) => ({ sizeBytes: item.size_bytes })))) return { ok: false as const, code: "ATTACHMENT_SIZE_LIMIT" as const };
    const attachments: SafeAttachment[] = [];
    for (const row of rows) {
      const key = `${row.id}:${row.sha256}`;
      const hit = cache.get(key);
      if (hit) { attachments.push(hit); continue; }
      const { data: file, error: fileError } = await db.storage.from(row.storage_bucket).download(row.storage_path);
      if (fileError || !file) return { ok: false as const, code: isStorageNotFoundError(fileError) ? "ATTACHMENT_MISSING" as const : "ATTACHMENT_FETCH_FAILED" as const };
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.length !== row.size_bytes || sha256(bytes) !== row.sha256) return { ok: false as const, code: "ATTACHMENT_INTEGRITY_FAILED" as const };
      const attachment = { id: row.id, filename: row.original_filename, mimeType: row.mime_type, sizeBytes: row.size_bytes, sha256: row.sha256, bytes };
      attachments.push(attachment);
      if (cachedBytes + bytes.length <= MAX_CACHE) { cache.set(key, attachment); cachedBytes += bytes.length; }
    }
    return { ok: true as const, attachments };
  };
}
