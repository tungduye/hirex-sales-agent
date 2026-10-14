import { NextResponse } from "next/server";
import { z } from "zod";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { decideAssistantAction } from "@/modules/assistant/server/assistant-proposals";

const bodySchema = z.object({ decision: z.enum(["confirm", "cancel"]) });

/** The member confirms or cancels one of their own assistant proposals. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && !origin.endsWith("://app.hirexmkt.online")) {
    return NextResponse.json({ ok: false, message: "Không được phép." }, { status: 403 });
  }
  const { id } = await params;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !body.success) return NextResponse.json({ ok: false, message: "Yêu cầu không hợp lệ." }, { status: 400 });
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return NextResponse.json({ ok: false, message: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
  const result = await decideAssistantAction(id, body.data.decision, {
    workspaceId: account.workspaceId, userId: account.userId, permissions: account.permissions, isAdmin: await isWorkspaceAdmin(),
  });
  return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}
