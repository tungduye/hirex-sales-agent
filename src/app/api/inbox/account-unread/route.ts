import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { scopeFromCookie } from "@/modules/inbox/core/inbox-scope";

/** Unread conversations per account (account picker in the filter panel). */
export async function GET(request: Request) {
  const data = await getOmnichannelInboxData({ scope: scopeFromCookie(request.headers.get("cookie")), mode: "unread" });
  if (data.error || !data.accountUnread) return Response.json({ error: data.error ?? "Chưa đếm được tin chưa đọc." }, { status: 400 });
  return Response.json(data.accountUnread, { headers: { "Cache-Control": "private, max-age=20" } });
}
