"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { parseVnDateTime } from "../core/calendar";
import { checkEventInput } from "../core/calendar-input";
import { cancelEvent, saveEvent, setMyEventReminder, setMyReminderDefaults, type CalendarContext } from "./calendar-data";

export interface CalendarActionState { status: "idle" | "success" | "error"; message: string | null }

async function context(): Promise<CalendarContext | null> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return null;
  return { workspaceId: account.workspaceId, userId: account.userId, permissions: account.permissions, isAdmin: await isWorkspaceAdmin() };
}
const uuid = z.string().uuid();
const done = (message: string): CalendarActionState => { revalidatePath("/calendar"); return { status: "success", message }; };

/** Web form: adds (no id) or saves an event. */
export async function saveEventAction(_state: CalendarActionState, form: FormData): Promise<CalendarActionState> {
  const member = await context();
  if (!member) return { status: "error", message: "Phiên đăng nhập đã hết hạn." };
  const id = form.get("id");
  if (id && !uuid.safeParse(id).success) return { status: "error", message: "Không tìm thấy lịch." };
  const startsAt = parseVnDateTime(String(form.get("startsAt") ?? ""));
  if (startsAt === null) return { status: "error", message: "Thời gian bắt đầu chưa hợp lệ." };
  const recurrence = String(form.get("recurrence") ?? "NONE");
  const checked = checkEventInput({
    title: String(form.get("title") ?? ""), kind: String(form.get("kind") ?? "HOP"), startsAt,
    durationMinutes: Number(form.get("durationMinutes") ?? 60), location: String(form.get("location") ?? ""), note: String(form.get("note") ?? ""),
    recurrence, recurrenceDays: recurrence === "WEEKLY" ? form.getAll("recurrenceDays").map(Number) : [],
    recurrenceUntil: recurrence !== "NONE" && form.get("recurrenceUntil") ? String(form.get("recurrenceUntil")) : null,
    attendeeIds: form.getAll("attendeeIds").map(String), contactId: null, conversationId: null,
  });
  if (!checked.ok) return { status: "error", message: checked.error };
  const remindRaw = form.get("myRemindMinutes");
  const myRemindMinutes = remindRaw === null || remindRaw === "" ? null : Number(remindRaw);
  const result = await saveEvent(member, checked.value, typeof id === "string" && id ? id : null, { myRemindMinutes });
  return result.ok ? done(id ? "Đã lưu lịch." : "Đã thêm lịch.") : { status: "error", message: result.error };
}

export async function cancelEventAction(id: string): Promise<CalendarActionState> {
  const member = await context();
  if (!member || !uuid.safeParse(id).success) return { status: "error", message: "Không tìm thấy lịch." };
  const result = await cancelEvent(member, id);
  return result.ok ? done("Đã huỷ lịch.") : { status: "error", message: result.error };
}

/** An attendee's own reminder for one event ("" = my default) and whether they join. */
export async function setMyEventReminderAction(input: { eventId: string; minutes: number | null; declined: boolean }): Promise<CalendarActionState> {
  const member = await context();
  if (!member || !uuid.safeParse(input.eventId).success) return { status: "error", message: "Không tìm thấy lịch." };
  const result = await setMyEventReminder(member, input.eventId, input.minutes, input.declined);
  return result.ok ? done("Đã lưu.") : { status: "error", message: result.error };
}

export async function setMyReminderDefaultsAction(input: { minutes: number; zalo: boolean }): Promise<CalendarActionState> {
  const member = await context();
  if (!member) return { status: "error", message: "Phiên đăng nhập đã hết hạn." };
  const result = await setMyReminderDefaults(member, input.minutes, input.zalo);
  return result.ok ? done("Đã lưu cài đặt nhắc lịch.") : { status: "error", message: result.error };
}
