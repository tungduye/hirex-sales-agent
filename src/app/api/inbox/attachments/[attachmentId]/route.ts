import "server-only";

import { createHash } from "node:crypto";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { createPrivilegedClient } from "@/lib/supabase/privileged";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(_request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const { attachmentId } = await params;
  if (!UUID.test(attachmentId)) return new Response("Not found", { status: 404 });
  const account = await getAccountContext();
  if (!account?.workspaceId) return new Response("Unauthorized", { status: 401 });
  const client = createPrivilegedClient();
  const { data, error } = await client.from("channel_attachments")
    .select("storage_bucket,storage_path,filename,content_type,size_bytes,sha256")
    .eq("id", attachmentId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (error || !data || typeof data.storage_bucket !== "string" || typeof data.storage_path !== "string" ||
      typeof data.filename !== "string" || typeof data.content_type !== "string" || !Number.isSafeInteger(data.size_bytes) ||
      typeof data.sha256 !== "string") return new Response("Not found", { status: 404 });
  const { data: blob, error: downloadError } = await client.storage.from(data.storage_bucket).download(data.storage_path);
  if (downloadError || !blob) return new Response("Attachment unavailable", { status: 503 });
  const bytes = Buffer.from(await blob.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== data.size_bytes || digest !== data.sha256) return new Response("Attachment unavailable", { status: 503 });
  const ascii = data.filename.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 100) || "attachment";
  return new Response(bytes, { headers: {
    "Content-Type": data.content_type,
    "Content-Length": String(bytes.byteLength),
    "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(data.filename)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}
