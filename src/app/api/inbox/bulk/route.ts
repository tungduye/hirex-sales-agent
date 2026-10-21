import { bulkRequestSchema, runBulkAction } from "@/modules/inbox/server/inbox-bulk";

/** Gắn nhãn hàng loạt and the other Suối Nguồn bulk actions (dryRun = count only). */
export async function POST(request: Request) {
  const parsed = bulkRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 400 });
  const result = await runBulkAction(parsed.data, request.headers.get("cookie"));
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
