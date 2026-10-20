import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { scopeFromCookie } from "@/modules/inbox/core/inbox-scope";

/** Everything the Suối Nguồn list column needs (accounts, members, tags, first page of conversations). */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const data = await getOmnichannelInboxData({
    // Phạm vi (Của tôi / Team / Tất cả) is remembered per browser in a cookie.
    scope: scopeFromCookie(request.headers.get("cookie")),
    channelType: query.getAll("channel"),
    accountId: query.get("account") ?? undefined,
    ownerIds: query.getAll("owner"),
    page: query.get("page") ?? undefined,
    tagIds: query.getAll("tag"),
    tagMatchMode: query.get("tagMode") ?? undefined,
    firstMessageFrom: query.get("firstFrom") ?? undefined,
    firstMessageTo: query.get("firstTo") ?? undefined,
  });
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
