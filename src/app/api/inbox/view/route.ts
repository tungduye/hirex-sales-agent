import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { scopeFromCookie } from "@/modules/inbox/core/inbox-scope";
import { inboxFiltersFrom } from "@/modules/inbox/server/inbox-request-filters";

/** Everything the Suối Nguồn list column needs (accounts, members, tags, first page of conversations). */
export async function GET(request: Request) {
  const startedAt = performance.now();
  const query = new URL(request.url).searchParams;
  // Phạm vi (Của tôi / Team / Tất cả) is remembered per browser in a cookie.
  const data = await getOmnichannelInboxData({ ...inboxFiltersFrom(query), scope: scopeFromCookie(request.headers.get("cookie")) });
  return Response.json(data, { headers: { "Cache-Control": "private, no-store", "Server-Timing": `db;desc="danh sách";dur=${data.listMs ?? 0}, total;dur=${Math.round(performance.now() - startedAt)}` } });
}
