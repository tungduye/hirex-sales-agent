import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { readGeneratedFile } from "@/modules/documents-out/server/generated-files";

// Download of a Word file made by the Trợ lý: its creator, or an administrator.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const account = await getAccountContext();
  if (!account?.workspaceId) return new Response("Phiên đăng nhập đã hết hạn.", { status: 401 });
  if (!UUID.test(fileId)) return new Response("Không tìm thấy tài liệu.", { status: 404 });
  const file = await readGeneratedFile({ workspaceId: account.workspaceId, userId: account.userId, isAdmin: await isWorkspaceAdmin() }, fileId);
  if (!file) return new Response("Không tìm thấy tài liệu.", { status: 404 });
  return new Response(new Uint8Array(file.bytes), { headers: {
    "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
