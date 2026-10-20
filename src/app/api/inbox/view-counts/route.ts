import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { scopeFromCookie } from "@/modules/inbox/core/inbox-scope";
import { inboxFiltersFrom } from "@/modules/inbox/server/inbox-request-filters";

/** Tab badges for the Suối Nguồn list, with the same filters (loaded after the list, never before it). */
export async function GET(request: Request) {
  const startedAt = performance.now();
  const query = new URL(request.url).searchParams;
  const data = await getOmnichannelInboxData({ ...inboxFiltersFrom(query), scope: scopeFromCookie(request.headers.get("cookie")), mode: "counts" });
  if (data.error || !data.viewCounts) return Response.json({ error: data.error ?? "Chưa đếm được hội thoại." }, { status: 400 });
  return Response.json(data.viewCounts, { headers: { "Cache-Control": "private, max-age=30", "Server-Timing": `total;dur=${Math.round(performance.now() - startedAt)}` } });
}
