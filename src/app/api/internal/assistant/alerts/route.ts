import { timingSafeEqual } from "node:crypto";
import { scanAllAlerts } from "@/modules/assistant/server/alert-scan";
import { runDueHumanPartnerSyncs } from "@/modules/customers/server/partner-sync";
import { runDueCvPins } from "@/modules/customers/server/cv-pins";
import { classifyCampaignReplies } from "@/modules/campaigns/server/reply-insights";

// Called by scripts/assistant-alerts-worker.mjs every few minutes (same secret as the other workers).
function equal(left: string, right: string) { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }

export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
  if (!expected || !equal(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Khách hàng from Human, every 6 hours (in the background: it can take a minute).
  void runDueHumanPartnerSyncs().catch((error) => console.error("[customers] scheduled Human sync failed", error instanceof Error ? error.message : error));
  // Soda pins Tình trạng CV in the companies' Zalo groups at the chosen time of day.
  void runDueCvPins().catch((error) => console.error("[customers] CV pins failed", error instanceof Error ? error.message : error));
  // Soda: what candidates meant after replying to Zalo / Facebook cá nhân campaigns (new or changed replies only).
  void classifyCampaignReplies().catch((error) => console.error("[campaigns] reply reading failed", error instanceof Error ? error.message : error));
  try {
    return Response.json({ workspaces: await scanAllAlerts() });
  } catch (error) {
    console.error("[alerts] scan failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Alert scan is unavailable." }, { status: 503 });
  }
}
