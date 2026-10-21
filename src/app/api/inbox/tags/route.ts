import { revalidateTag } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

/** Create a tag from the bulk tag picker; answers with the new tag so it can be used at once. */
export async function POST(request: Request) {
  const parsed = z.object({ name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/u).optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Tên nhãn không hợp lệ (1–80 ký tự)." }, { status: 400 });
  const account = await getAccountContext();
  if (!account?.workspaceId) return Response.json({ error: "Phiên đăng nhập đã hết, hãy đăng nhập lại." }, { status: 401 });
  if (!account.permissions.includes("inbox.update")) return Response.json({ error: "Bạn không có quyền tạo nhãn." }, { status: 403 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_conversation_tag", { p_name: parsed.data.name, p_color: parsed.data.color ?? null });
  if (error || typeof data !== "string") return Response.json({ error: "Chưa tạo được nhãn (có thể tên nhãn đã tồn tại)." }, { status: 400 });
  revalidateTag("inbox-metadata", { expire: 0 });
  return Response.json({ id: data, name: parsed.data.name, color: parsed.data.color ?? null });
}
