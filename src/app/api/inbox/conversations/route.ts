import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { scopeFromCookie } from "@/modules/inbox/core/inbox-scope";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const data = await getOmnichannelInboxData({
    // Phạm vi (Của tôi / Team / Tất cả) is remembered per browser in a cookie.
    scope: scopeFromCookie(request.headers.get("cookie")),
    channelType: query.getAll("channel"),
    accountId: query.getAll("account"),
    ownerIds: query.getAll("owner"),
    page: query.get("page") ?? undefined,
    tagIds: query.getAll("tag"),
    tagMatchMode: query.get("tagMode") ?? undefined,
    firstMessageFrom: query.get("firstFrom") ?? undefined,
    firstMessageTo: query.get("firstTo") ?? undefined,
  });
  if (data.error) return Response.json({ error: data.error }, { status: 400 });
  return Response.json({ conversations: data.conversations, hasNextPage: data.hasNextPage, page: data.selectedPage }, { headers: { "Cache-Control": "private, no-store" } });
}
