import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { dispatchApprovedZaloQaAction } from "@/modules/channels/server/dispatch-manual-zalo-action";

const bodySchema = z.object({ actionId: z.string().uuid() }).strict();
function equal(left: string, right: string) {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
  if (!expected || !supplied || !equal(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.HIREX_ZALO_REAL_OUTBOUND_QA_ENABLED !== "1") return Response.json({ error: "QA delivery is disabled." }, { status: 403 });
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
    const result = await dispatchApprovedZaloQaAction(parsed.data.actionId);
    return Response.json({ result });
  } catch {
    return Response.json({ error: "Zalo QA dispatch is unavailable." }, { status: 503 });
  }
}
