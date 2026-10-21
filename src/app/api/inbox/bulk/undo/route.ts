import { z } from "zod";
import { undoBulkAction } from "@/modules/inbox/server/inbox-bulk";

/** Undo a bulk action (its author, within 10 minutes). */
export async function POST(request: Request) {
  const parsed = z.object({ operationId: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 400 });
  const result = await undoBulkAction(parsed.data.operationId);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
