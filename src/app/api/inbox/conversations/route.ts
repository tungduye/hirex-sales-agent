import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { scopeFromCookie } from "@/modules/inbox/core/inbox-scope";
import { inboxFiltersFrom } from "@/modules/inbox/server/inbox-request-filters";

/** The next page of the Suối Nguồn list (after ?cursor=). */
export async function GET(request: Request) {
  const startedAt = performance.now();
  const query = new URL(request.url).searchParams;
  const data = await getOmnichannelInboxData({ ...inboxFiltersFrom(query), scope: scopeFromCookie(request.headers.get("cookie")) });
  if (data.error) return Response.json({ error: data.error }, { status: 400 });
  return Response.json({ conversations: data.conversations, hasNextPage: data.hasNextPage, nextCursor: data.nextCursor ?? null }, { headers: { "Cache-Control": "private, no-store", "Server-Timing": `db;desc="danh sách";dur=${data.listMs ?? 0}, total;dur=${Math.round(performance.now() - startedAt)}` } });
}
