import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

/** "Hội thoại được gán thẻ": the conversations with this tag on the nicks this member may see (newest first, up to 300). */
export async function GET(_request: Request, { params }: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await params;
  if (!z.string().uuid().safeParse(tagId).success) return Response.json({ error: "Nhãn không hợp lệ." }, { status: 400 });
  const account = await getAccountContext();
  if (!account?.workspaceId) return Response.json({ error: "Phiên đăng nhập đã hết, hãy đăng nhập lại." }, { status: 401 });
  if (!account.permissions.includes("inbox.view")) return Response.json({ error: "Bạn chưa có quyền xem Suối Nguồn." }, { status: 403 });
  const accessible = await getAccessibleChannelAccountIds();
  if (accessible?.length === 0) return Response.json({ conversations: [], total: 0 });
  const db = createPrivilegedClient();
  const { data: links, error } = await db.from("conversation_tag_links").select("conversation_id").eq("workspace_id", account.workspaceId).eq("tag_id", tagId).limit(5000);
  if (error) return Response.json({ error: "Chưa tải được hội thoại của nhãn." }, { status: 400 });
  const ids = (links ?? []).map((row) => String(row.conversation_id));
  const rows: Array<Record<string, unknown>> = [];
  for (let start = 0; start < ids.length; start += 200) {
    let query = db.from("omnichannel_conversations").select("id,channel_type,channel_account_id,metadata,last_message_at,contacts(full_name),channel_accounts(display_name)")
      .eq("workspace_id", account.workspaceId).in("id", ids.slice(start, start + 200));
    if (accessible) query = query.in("channel_account_id", accessible);
    const { data } = await query;
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
  }
  const visible = rows.filter((row) => (row.metadata as Record<string, unknown> | null)?.hidden !== true && (row.metadata as Record<string, unknown> | null)?.hidden !== "true")
    .sort((a, b) => String(b.last_message_at ?? "").localeCompare(String(a.last_message_at ?? "")));
  return Response.json({
    total: visible.length,
    conversations: visible.slice(0, 300).map((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
      const nick = Array.isArray(row.channel_accounts) ? row.channel_accounts[0] : row.channel_accounts;
      const named = [(contact as { full_name?: unknown } | null)?.full_name, metadata.conversationDisplayName, metadata.groupName, metadata.threadName, metadata.participantDisplayName]
        .find((value) => typeof value === "string" && value.trim() && !/^\d+$/u.test(value.trim()));
      const avatar = typeof metadata.avatarUrl === "string" && metadata.avatarUrl.startsWith("https://") && metadata.avatarUrl.length < 2048 ? metadata.avatarUrl : null;
      return { id: String(row.id), name: typeof named === "string" ? named.trim() : "Khách chưa rõ tên", avatarUrl: avatar, channelType: String(row.channel_type), accountName: typeof (nick as { display_name?: unknown } | null)?.display_name === "string" ? String((nick as { display_name: string }).display_name) : "" };
    }),
  });
}
