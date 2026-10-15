import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";

/** Everything the Hồ Chứa list column needs (accounts, members, tags, first page of conversations). */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const data = await getOmnichannelInboxData({
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
