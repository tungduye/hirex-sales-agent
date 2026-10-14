import { timingSafeEqual } from "node:crypto";
import { scanAllAlerts } from "@/modules/assistant/server/alert-scan";

// Called by scripts/assistant-alerts-worker.mjs every few minutes (same secret as the other workers).
function equal(left: string, right: string) { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }

export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
  if (!expected || !equal(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json({ workspaces: await scanAllAlerts() });
  } catch (error) {
    console.error("[alerts] scan failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Alert scan is unavailable." }, { status: 503 });
  }
}
