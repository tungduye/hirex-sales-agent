import { revalidateTag } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

/** "Quản lý thẻ phân loại": the order set by dragging (migration 140, inbox.update). */
export async function POST(request: Request) {
  const parsed = z.object({ tagIds: z.array(z.string().uuid()).min(1).max(500) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Danh sách nhãn không hợp lệ." }, { status: 400 });
  const account = await getAccountContext();
  if (!account?.workspaceId) return Response.json({ error: "Phiên đăng nhập đã hết, hãy đăng nhập lại." }, { status: 401 });
  if (!account.permissions.includes("inbox.update")) return Response.json({ error: "Bạn không có quyền sắp xếp nhãn." }, { status: 403 });
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_conversation_tags", { p_tag_ids: parsed.data.tagIds });
  if (error) return Response.json({ error: "Chưa lưu được thứ tự nhãn." }, { status: 400 });
  revalidateTag("inbox-metadata", { expire: 0 });
  return Response.json({ ok: true });
}
