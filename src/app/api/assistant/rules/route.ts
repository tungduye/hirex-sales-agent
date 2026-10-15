import { NextResponse } from "next/server";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

// Turning a rule on/off or deleting it (owner or administrator). Creating goes through the assistant card.
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("toggle"), id: z.string().uuid(), enabled: z.boolean() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
]);

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && !origin.endsWith("://app.hirexmkt.online")) return NextResponse.json({ ok: false, message: "Không được phép." }, { status: 403 });
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return NextResponse.json({ ok: false, message: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, message: "Yêu cầu không hợp lệ." }, { status: 400 });
  const db = createPrivilegedClient();
  const { data: rule } = await db.from("assistant_rules").select("id,created_by").eq("workspace_id", account.workspaceId).eq("id", body.data.id).maybeSingle();
  if (!rule || (rule.created_by !== account.userId && !await isWorkspaceAdmin())) return NextResponse.json({ ok: false, message: "Không tìm thấy quy tắc hoặc không có quyền." }, { status: 404 });
  const { error } = body.data.action === "delete"
    ? await db.from("assistant_rules").delete().eq("id", rule.id)
    : await db.from("assistant_rules").update({ enabled: body.data.enabled, updated_at: new Date().toISOString() }).eq("id", rule.id);
  if (error) return NextResponse.json({ ok: false, message: "Không lưu được thay đổi." }, { status: 503 });
  // Turning off or deleting: its open alerts disappear now (deleting cascades; turning off resolves them).
  if (body.data.action === "toggle" && !body.data.enabled) await db.from("assistant_alerts").update({ resolved_at: new Date().toISOString() }).eq("rule_id", rule.id).is("resolved_at", null);
  return NextResponse.json({ ok: true });
}
