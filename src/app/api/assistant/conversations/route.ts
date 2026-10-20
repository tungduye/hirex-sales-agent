import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

/** The signed-in member's saved Trợ lý conversations, pinned first then most recent (row security: own only). */
export async function GET() {
  const account = await getAccountContext();
  if (!account?.workspaceId) return NextResponse.json({ ok: false, conversations: [] }, { status: 401 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("assistant_conversations").select("id,title,pinned,updated_at")
    .eq("workspace_id", account.workspaceId).eq("user_id", account.userId).order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(300);
  if (error) return NextResponse.json({ ok: false, conversations: [] }, { status: 500 });
  return NextResponse.json({ ok: true, conversations: (data ?? []).map((row) => ({ id: row.id, title: row.title, pinned: row.pinned, updatedAt: row.updated_at })) }, { headers: { "Cache-Control": "no-store" } });
}
