import { timingSafeEqual } from "node:crypto";
import { processNextAssistantBotJob } from "@/modules/assistant/server/zalo-bot";
import { sendDueCalendarReminders } from "@/modules/calendar/server/calendar-reminders";
import { runBroadcastTick } from "@/modules/broadcasts/server/broadcast-runner";

// Called by scripts/assistant-zalo-worker.mjs: answers one queued Zalo question per call (one member per
// request, so per-request caches never mix two members).
// Lịch hẹn reminders ride on the same worker, at most once a minute.
let lastReminderRun = 0;
async function remindersOncePerMinute() {
  if (Date.now() - lastReminderRun < 60_000) return;
  lastReminderRun = Date.now();
  try { await sendDueCalendarReminders(); } catch (error) { console.error("[assistant-zalo] reminders failed", error instanceof Error ? error.message : error); }
}

// Group broadcasts (Gửi hàng loạt Zalo) also ride on this worker, one tick about every 20 s.
let lastBroadcastTick = 0;
async function broadcastsEvery20s() {
  if (Date.now() - lastBroadcastTick < 20_000) return;
  lastBroadcastTick = Date.now();
  try { await runBroadcastTick(); } catch (error) { console.error("[assistant-zalo] broadcasts failed", error instanceof Error ? error.message : error); }
}

function equal(left: string, right: string) { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }

export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
  if (!expected || !equal(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await processNextAssistantBotJob();
    await remindersOncePerMinute();
    await broadcastsEvery20s();
    return Response.json(result);
  } catch (error) {
    console.error("[assistant-zalo] job failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Zalo assistant is unavailable." }, { status: 503 });
  }
}
