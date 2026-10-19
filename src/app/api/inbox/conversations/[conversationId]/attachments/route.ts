import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { canAccessChannelAccount, hasPermission } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { fileExtension, zaloContentType, zaloFileName, zaloFileProblem, ZALO_FILE_PROBLEM_TEXT } from "@/modules/channels/core/zalo-files";

// A file a member is about to send into a Zalo chat. Stored privately for the sender, nothing is sent here:
// the composer then asks to send it (sendZaloFileReply), which runs the usual checks and approval.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BUCKET = "channel-attachments";

function fail(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && !origin.endsWith("://app.hirexmkt.online")) return fail("Không được phép.", 403);
  const { conversationId } = await params;
  if (!UUID.test(conversationId)) return fail("Không tìm thấy hội thoại.", 404);
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return fail("Phiên đăng nhập đã hết hạn.", 401);
  if (!await hasPermission("inbox.reply")) return fail("Tài khoản của bạn không có quyền trả lời hội thoại.", 403);
  const db = createPrivilegedClient();
  const { data: conversation } = await db.from("omnichannel_conversations").select("channel_account_id,channel_type")
    .eq("id", conversationId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (!conversation || typeof conversation.channel_account_id !== "string" || !await canAccessChannelAccount(conversation.channel_account_id))
    return fail("Bạn chưa được cấp quyền sử dụng tài khoản kết nối của hội thoại này.", 403);
  if (conversation.channel_type !== "ZALO") return fail("Hiện chỉ gửi được tệp qua Zalo.", 400);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("Chưa chọn tệp.", 400);
  const problem = zaloFileProblem({ name: file.name, size: file.size });
  if (problem) return fail(ZALO_FILE_PROBLEM_TEXT[problem], 400);
  const filename = zaloFileName(file.name)!;
  const contentType = zaloContentType(filename, file.type);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) return fail("Tệp tải lên chưa đủ, thử lại.", 400);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = randomUUID();
  const storagePath = `${account.workspaceId}/outbound/${id}.${fileExtension(filename)}`;
  const upload = await db.storage.from(BUCKET).upload(storagePath, bytes, { contentType, upsert: false });
  if (upload.error) return fail("Chưa lưu được tệp, thử lại sau.", 502);
  const { error } = await db.from("channel_attachments").insert({ id, workspace_id: account.workspaceId, storage_bucket: BUCKET, storage_path: storagePath,
    filename, content_type: contentType, size_bytes: bytes.byteLength, sha256, source: "HUMAN_UPLOAD", created_by: account.userId });
  if (error) {
    await db.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return fail("Chưa lưu được tệp, thử lại sau.", 500);
  }
  return NextResponse.json({ ok: true, id, filename, contentType, sizeBytes: bytes.byteLength }, { headers: { "Cache-Control": "no-store" } });
}
