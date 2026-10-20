import { timingSafeEqual } from "node:crypto";
import { processNextAssistantBotJob } from "@/modules/assistant/server/zalo-bot";

// Called by scripts/assistant-zalo-worker.mjs: answers one queued Zalo question per call (one member per
// request, so per-request caches never mix two members).
function equal(left: string, right: string) { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }

export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
  if (!expected || !equal(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await processNextAssistantBotJob());
  } catch (error) {
    console.error("[assistant-zalo] job failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Zalo assistant is unavailable." }, { status: 503 });
  }
}
