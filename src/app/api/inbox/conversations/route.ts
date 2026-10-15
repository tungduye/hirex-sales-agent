import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";

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
  if (data.error) return Response.json({ error: data.error }, { status: 400 });
  return Response.json({ conversations: data.conversations, hasNextPage: data.hasNextPage, page: data.selectedPage }, { headers: { "Cache-Control": "private, no-store" } });
}
