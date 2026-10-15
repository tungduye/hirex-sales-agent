import { NextResponse } from "next/server";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

// The bell in the header: the member's open alerts, and marking them as seen.
const noStore = { "Cache-Control": "no-store" };

async function member() {
  const account = await getAccountContext();
  return account?.workspaceId && account.configurationComplete ? { workspaceId: account.workspaceId, userId: account.userId } : null;
}

export async function GET() {
  const me = await member();
  if (!me) return NextResponse.json({ ok: false }, { status: 401, headers: noStore });
  const db = createPrivilegedClient();
  const { data, error } = await db.from("assistant_alerts")
    .select("id,kind,severity,title,body,link,created_at,read_at,action_id")
    .eq("workspace_id", me.workspaceId).eq("user_id", me.userId).is("resolved_at", null)
    .order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ ok: false }, { status: 503, headers: noStore });
  // Proposals attached by rules: only still-open ones show "Xác nhận" in the bell.
  const actionIds = (data ?? []).flatMap((row) => row.action_id ? [row.action_id] : []);
  const { data: actions } = actionIds.length
    ? await db.from("assistant_actions").select("id,status,expires_at,preview").eq("workspace_id", me.workspaceId).eq("user_id", me.userId).in("id", actionIds)
    : { data: [] as { id: string; status: string; expires_at: string; preview: unknown }[] };
  type ActionRow = { id: string; status: string; expires_at: string; preview: unknown };
  const byId = new Map(((actions ?? []) as ActionRow[]).map((row) => [row.id, row]));
  const alerts = (data ?? []).map(({ action_id, ...row }) => {
    const action = action_id ? byId.get(action_id) : undefined;
    const open = action && action.status === "PROPOSED" && Date.parse(action.expires_at) > Date.now();
    return { ...row, action: open ? { id: action.id, preview: action.preview } : null };
  });
  return NextResponse.json({ ok: true, alerts }, { headers: noStore });
}

const bodySchema = z.object({ action: z.literal("read"), ids: z.array(z.string().uuid()).max(50).optional() });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && !origin.endsWith("://app.hirexmkt.online")) return NextResponse.json({ ok: false }, { status: 403 });
  const me = await member();
  if (!me) return NextResponse.json({ ok: false }, { status: 401, headers: noStore });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false }, { status: 400, headers: noStore });
  let query = createPrivilegedClient().from("assistant_alerts").update({ read_at: new Date().toISOString() })
    .eq("workspace_id", me.workspaceId).eq("user_id", me.userId).is("read_at", null);
  if (body.data.ids) query = query.in("id", body.data.ids);
  const { error } = await query;
  return NextResponse.json({ ok: !error }, { status: error ? 503 : 200, headers: noStore });
}
