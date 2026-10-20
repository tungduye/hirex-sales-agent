import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { cardStateFromStatus, type CardAction, type ChatMessage } from "@/modules/assistant/core/assistant-conversation";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

async function context(params: Promise<{ id: string }>) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return null;
  const account = await getAccountContext();
  if (!account?.workspaceId) return null;
  return { id, account, supabase: await createClient() };
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin || origin.endsWith("://app.hirexmkt.online");
}

/** One saved conversation with its messages; proposal cards show their current state. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context(params);
  if (!ctx) return NextResponse.json({ ok: false }, { status: 404 });
  const { data: conversation } = await ctx.supabase.from("assistant_conversations").select("id,title,pinned,updated_at").eq("id", ctx.id).eq("user_id", ctx.account.userId).maybeSingle();
  if (!conversation) return NextResponse.json({ ok: false }, { status: 404 });
  const { data: rows } = await ctx.supabase.from("assistant_messages").select("role,content,tools_used,action_ids,is_error,created_at").eq("conversation_id", ctx.id).order("created_at").limit(400);
  const actionIds = [...new Set((rows ?? []).flatMap((row) => (row.action_ids ?? []) as string[]))];
  const actions = new Map<string, CardAction>();
  if (actionIds.length) {
    const { data } = await ctx.supabase.from("assistant_actions").select("id,preview,status,result_message,expires_at").in("id", actionIds).eq("user_id", ctx.account.userId);
    for (const row of data ?? []) actions.set(row.id as string, { id: row.id as string, preview: row.preview as CardAction["preview"], expiresAt: row.expires_at as string, state: cardStateFromStatus(row.status as string), result: (row.result_message as string | null) ?? (row.status === "EXPIRED" ? "Đề xuất đã hết hạn." : undefined) });
  }
  const messages: ChatMessage[] = (rows ?? []).map((row) => ({
    role: row.role as ChatMessage["role"], content: row.content as string, toolsUsed: (row.tools_used ?? []) as string[], error: row.is_error === true,
    actions: ((row.action_ids ?? []) as string[]).flatMap((id) => actions.get(id) ?? []),
  }));
  return NextResponse.json({ ok: true, conversation: { id: conversation.id, title: conversation.title, pinned: conversation.pinned, updatedAt: conversation.updated_at }, messages }, { headers: { "Cache-Control": "no-store" } });
}

const patchSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), pinned: z.boolean().optional() });

/** Rename or pin one of my conversations. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 });
  const ctx = await context(params);
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!ctx || !body.success || (body.data.title === undefined && body.data.pinned === undefined)) return NextResponse.json({ ok: false }, { status: 400 });
  const { error } = await ctx.supabase.from("assistant_conversations").update(body.data).eq("id", ctx.id).eq("user_id", ctx.account.userId);
  return NextResponse.json({ ok: !error }, { status: error ? 500 : 200 });
}

/** Delete one of my conversations (its messages go with it). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 });
  const ctx = await context(params);
  if (!ctx) return NextResponse.json({ ok: false }, { status: 404 });
  const { error } = await ctx.supabase.from("assistant_conversations").delete().eq("id", ctx.id).eq("user_id", ctx.account.userId);
  return NextResponse.json({ ok: !error }, { status: error ? 500 : 200 });
}
