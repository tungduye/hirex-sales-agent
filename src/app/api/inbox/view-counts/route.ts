import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { scopeFromCookie } from "@/modules/inbox/core/inbox-scope";
import { inboxFiltersFrom } from "@/modules/inbox/server/inbox-request-filters";

/** Tab badges for the Suối Nguồn list, with the same filters (asked for together with the list; the browser keeps them a minute per filter set and Phạm vi). */
export async function GET(request: Request) {
  const startedAt = performance.now();
  const query = new URL(request.url).searchParams;
  const data = await getOmnichannelInboxData({ ...inboxFiltersFrom(query), scope: scopeFromCookie(request.headers.get("cookie")), mode: "counts" });
  if (data.error || !data.viewCounts) return Response.json({ error: data.error ?? "Chưa đếm được hội thoại." }, { status: 400 });
  return Response.json(data.viewCounts, { headers: { "Cache-Control": "private, no-store", "Server-Timing": `total;dur=${Math.round(performance.now() - startedAt)}` } });
}
