import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { sendReply } from "@/modules/assistant/server/zalo-bot";
import { dueReminders, formatOccurrence, remindLabel, type Recurrence } from "../core/calendar";
import { loadEvents } from "./calendar-data";

// Zalo reminders of Lịch hẹn: each attendee who linked their Zalo gets a private message from the Trợ lý
// nick at their own reminder time (per event, else their default, else 30 minutes). Each person and
// occurrence is reminded once; a person without a linked Zalo (or with reminders off) is skipped.
// Called about once a minute by the Trợ lý worker route.

type Row = Record<string, unknown>;
const HOUR = 3_600_000;
const MAX_PER_RUN = 40;

/**
 * The private chat with the Zalo the member last used to talk to the Trợ lý (a member may link several
 * Zalo accounts; the reminder goes to the one they actually use), else any private chat with them.
 */
async function privateChat(db: ReturnType<typeof createPrivilegedClient>, workspaceId: string, botAccount: string, zaloIds: string[]) {
  if (!zaloIds.length) return null;
  const { data: chats } = await db.from("omnichannel_conversations").select("id,provider_conversation_id").eq("workspace_id", workspaceId).eq("channel_account_id", botAccount).in("provider_conversation_id", zaloIds);
  const byZalo = new Map(((chats ?? []) as Row[]).map((row) => [String(row.provider_conversation_id), { id: String(row.id) }]));
  if (zaloIds.length > 1) {
    const { data: last } = await db.from("omnichannel_messages").select("sender_external_id").eq("workspace_id", workspaceId).eq("channel_account_id", botAccount)
      .eq("direction", "INBOUND").in("sender_external_id", zaloIds).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const preferred = last ? byZalo.get(String(last.sender_external_id)) : undefined;
    if (preferred) return preferred;
  }
  return zaloIds.map((id) => byZalo.get(id)).find(Boolean) ?? null;
}

export async function sendDueCalendarReminders(now = Date.now()) {
  const db = createPrivilegedClient();
  const { data: bots } = await db.from("assistant_bot_settings").select("workspace_id,channel_account_id").eq("enabled", true).not("channel_account_id", "is", null);
  let sent = 0, skipped = 0, failed = 0;
  for (const bot of (bots ?? []) as Row[]) {
    const workspaceId = String(bot.workspace_id), botAccount = String(bot.channel_account_id);
    const events = await loadEvents(db, workspaceId, now, now + 7 * 24 * HOUR + HOUR);
    if (!events.length) continue;
    const [settings, already] = await Promise.all([
      db.from("calendar_member_settings").select("profile_id,remind_minutes,zalo_reminders").eq("workspace_id", workspaceId),
      db.from("calendar_reminders_sent").select("event_id,profile_id,occurrence_start").eq("workspace_id", workspaceId).gte("occurrence_start", new Date(now - HOUR).toISOString()),
    ]);
    const defaults = new Map(((settings.data ?? []) as Row[]).map((row) => [String(row.profile_id), { minutes: Number(row.remind_minutes), zalo: row.zalo_reminders !== false }]));
    const sentKeys = new Set(((already.data ?? []) as Row[]).map((row) => `${row.event_id}|${row.profile_id}|${new Date(String(row.occurrence_start)).toISOString()}`));
    const shaped = events.map(({ row, attendees }) => ({
      id: String(row.id), startsAt: String(row.starts_at), durationMinutes: Number(row.duration_minutes), recurrence: row.recurrence as Recurrence,
      recurrenceDays: Array.isArray(row.recurrence_days) ? (row.recurrence_days as number[]).map(Number) : [], recurrenceUntil: typeof row.recurrence_until === "string" ? row.recurrence_until : null,
      attendees: attendees.map((item) => ({ profileId: String(item.profile_id), remindMinutes: typeof item.remind_minutes === "number" ? item.remind_minutes : null, declined: item.declined === true })),
    }));
    const due = dueReminders(shaped, defaults, sentKeys, now).slice(0, MAX_PER_RUN);
    if (!due.length) continue;
    const profileIds = [...new Set([...due.map((item) => item.profileId), ...events.flatMap((event) => event.attendees.map((item) => String(item.profile_id)))])];
    const [links, profiles] = await Promise.all([
      db.from("assistant_zalo_links").select("profile_id,zalo_user_id,created_at").eq("workspace_id", workspaceId).in("profile_id", [...new Set(due.map((item) => item.profileId))]).order("created_at"),
      db.from("profiles").select("id,full_name").eq("workspace_id", workspaceId).in("id", profileIds),
    ]);
    const names = new Map(((profiles.data ?? []) as Row[]).map((row) => [String(row.id), String(row.full_name ?? "")]));
    const zaloOf = new Map<string, string[]>();
    for (const row of (links.data ?? []) as Row[]) zaloOf.set(String(row.profile_id), [...(zaloOf.get(String(row.profile_id)) ?? []), String(row.zalo_user_id)]);
    const base = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.hirexmkt.online").replace(/\/+$/u, "");
    for (const item of due) {
      const event = events.find((entry) => String(entry.row.id) === item.eventId);
      if (!event) continue;
      const occurrence = new Date(item.occurrence).toISOString();
      const mark = async (status: "SENT" | "FAILED" | "SKIPPED") => (await db.from("calendar_reminders_sent").insert({ event_id: item.eventId, workspace_id: workspaceId, profile_id: item.profileId, occurrence_start: occurrence, status })).error === null;
      const conversation = await privateChat(db, workspaceId, botAccount, zaloOf.get(item.profileId) ?? []);
      if (!conversation) { await mark("SKIPPED"); skipped += 1; continue; }
      // Claim first, so two workers never remind twice.
      if (!await mark("SENT")) continue;
      const { data: job } = await db.from("assistant_bot_jobs").insert({ workspace_id: workspaceId, channel_account_id: botAccount, conversation_id: conversation.id, message_id: null, kind: "REMINDER", status: "RUNNING", attempts: 1, started_at: new Date().toISOString(), profile_id: item.profileId }).select("id").single();
      const row = event.row;
      const others = event.attendees.filter((entry) => entry.profile_id !== item.profileId && entry.declined !== true).map((entry) => names.get(String(entry.profile_id)) || "Thành viên");
      const text = [
        `Dạ, em nhắc sếp lịch sắp tới ạ (${item.minutes ? `còn ${remindLabel(item.minutes).replace(/^Trước /u, "")}` : "bắt đầu ngay"}):`,
        `📌 ${String(row.title)}`,
        `🕒 ${formatOccurrence(item.occurrence, Number(row.duration_minutes))}`,
        ...(typeof row.location === "string" && row.location ? [`📍 ${row.location}`] : []),
        ...(others.length ? [`👥 ${others.slice(0, 8).join(", ")}${others.length > 8 ? ` và ${others.length - 8} người khác` : ""}`] : []),
        ...(typeof row.note === "string" && row.note ? [`📝 ${row.note.slice(0, 300)}`] : []),
        `Xem lịch: ${base}/calendar`,
      ].join("\n");
      const ok = job ? await sendReply(db, workspaceId, String(job.id), botAccount, text).catch(() => false) : false;
      if (job) await db.from("assistant_bot_jobs").update({ status: ok ? "DONE" : "FAILED", completed_at: new Date().toISOString(), ...(ok ? {} : { safe_error_code: "SEND_FAILED" }) }).eq("id", job.id);
      if (!ok) { await db.from("calendar_reminders_sent").update({ status: "FAILED" }).eq("event_id", item.eventId).eq("profile_id", item.profileId).eq("occurrence_start", occurrence); failed += 1; } else sent += 1;
    }
  }
  return { sent, skipped, failed };
}
