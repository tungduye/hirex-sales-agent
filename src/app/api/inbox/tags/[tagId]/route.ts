import { revalidateTag } from "next/cache";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

// "Chi tiết thẻ phân loại" (Suối Nguồn → Phân loại): rename / recolour a tag (inbox.update), delete it (admin only).
const id = z.string().uuid();
const patch = z.object({ name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/u).nullable() });

async function context(tagId: string) {
  if (!id.safeParse(tagId).success) return { error: Response.json({ error: "Nhãn không hợp lệ." }, { status: 400 }) };
  const account = await getAccountContext();
  if (!account?.workspaceId) return { error: Response.json({ error: "Phiên đăng nhập đã hết, hãy đăng nhập lại." }, { status: 401 }) };
  return { account: { ...account, workspaceId: account.workspaceId } };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await params;
  const found = await context(tagId);
  if (found.error) return found.error;
  const { account } = found;
  if (!account.permissions.includes("inbox.update")) return Response.json({ error: "Bạn không có quyền sửa nhãn." }, { status: 403 });
  const parsed = patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Tên nhãn không hợp lệ (1–80 ký tự)." }, { status: 400 });
  const db = createPrivilegedClient();
  const { data, error } = await db.from("conversation_tags").update({ name: parsed.data.name, color: parsed.data.color, updated_at: new Date().toISOString() })
    .eq("id", tagId).eq("workspace_id", account.workspaceId).select("id,name,color").maybeSingle();
  if (error?.code === "23505") return Response.json({ error: "Đã có nhãn trùng tên." }, { status: 409 });
  if (error || !data) return Response.json({ error: "Chưa lưu được nhãn." }, { status: 400 });
  await db.from("audit_logs").insert({ workspace_id: account.workspaceId, actor_id: account.userId, action: "CONVERSATION_TAG_UPDATED", entity_type: "CONVERSATION_TAG", entity_id: tagId, metadata: { name: parsed.data.name, color: parsed.data.color } });
  revalidateTag("inbox-metadata", { expire: 0 });
  return Response.json(data);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await params;
  const found = await context(tagId);
  if (found.error) return found.error;
  const { account } = found;
  if (!await isWorkspaceAdmin()) return Response.json({ error: "Chỉ quản trị viên được xóa nhãn." }, { status: 403 });
  const db = createPrivilegedClient();
  const { data, error } = await db.from("conversation_tags").delete().eq("id", tagId).eq("workspace_id", account.workspaceId).select("id,name").maybeSingle();
  if (error || !data) return Response.json({ error: "Chưa xóa được nhãn." }, { status: 400 });
  await db.from("audit_logs").insert({ workspace_id: account.workspaceId, actor_id: account.userId, action: "CONVERSATION_TAG_DELETED", entity_type: "CONVERSATION_TAG", entity_id: tagId, metadata: { name: data.name } });
  revalidateTag("inbox-metadata", { expire: 0 });
  return Response.json({ ok: true });
}
