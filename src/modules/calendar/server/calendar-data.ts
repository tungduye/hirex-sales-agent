import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";
import { teamOf } from "@/modules/inbox/core/inbox-scope";
import { canViewEvent, DEFAULT_REMIND_MINUTES, describeRepeat, occurrences, type EventKind, type Recurrence, type Viewer } from "../core/calendar";
import type { EventInput } from "../core/calendar-input";

// Lịch hẹn, server side. The tables are service-role only; every read and write goes through here and
// applies the rules: a member sees their own events (created or invited), the events of the people
// they manage, and everything when they are an administrator or may view roles; only the creator (or
// an administrator) edits or cancels an event; each attendee sets their own reminder.

export interface CalendarContext { workspaceId: string; userId: string; permissions: readonly string[]; isAdmin: boolean }
export type CalendarScope = "MINE" | "TEAM" | "ALL";
type Row = Record<string, unknown>;
type Db = ReturnType<typeof createPrivilegedClient>;

export interface Member { id: string; name: string; managerId: string | null }
export interface OccurrenceView {
  eventId: string; start: number; end: number; title: string; kind: EventKind; location: string | null; note: string | null;
  repeat: string | null; recurrence: Recurrence; recurrenceDays: number[]; recurrenceUntil: string | null; startsAt: string; durationMinutes: number;
  createdBy: string; createdByName: string; attendees: Array<{ id: string; name: string; declined: boolean }>;
  canEdit: boolean; isAttendee: boolean; myRemindMinutes: number | null; myDeclined: boolean;
  contactId: string | null; conversationId: string | null;
}

const seesAll = (context: CalendarContext) => context.isAdmin || context.permissions.includes("roles.view");

export async function loadMembers(db: Db, workspaceId: string): Promise<Member[]> {
  const { data } = await db.from("profiles").select("id,full_name,manager_id").eq("workspace_id", workspaceId).order("full_name");
  return ((data ?? []) as Row[]).map((row) => ({ id: String(row.id), name: typeof row.full_name === "string" && row.full_name.trim() ? row.full_name : "Thành viên", managerId: typeof row.manager_id === "string" ? row.manager_id : null }));
}

export function viewerFor(context: CalendarContext, members: Member[]): Viewer {
  return { userId: context.userId, team: teamOf(context.userId, members.map((member) => ({ id: member.id, managerId: member.managerId }))), seesAll: seesAll(context) };
}

async function loadEvents(db: Db, workspaceId: string, from: number, to: number, ids?: string[]) {
  let query = db.from("calendar_events").select("id,title,kind,starts_at,duration_minutes,location,note,recurrence,recurrence_days,recurrence_until,contact_id,conversation_id,created_by,status")
    .eq("workspace_id", workspaceId).eq("status", "ACTIVE").limit(3000);
  if (ids) query = query.in("id", ids);
  else query = query.lte("starts_at", new Date(to).toISOString()).or(`recurrence.neq.NONE,starts_at.gte.${new Date(from - 86_400_000).toISOString()}`);
  const { data, error } = await query;
  if (error) throw new Error("CALENDAR_LOAD_FAILED");
  const events = (data ?? []) as Row[];
  const attendeeRows: Row[] = [];
  for (let index = 0; index < events.length; index += 150) {
    const { data: rows } = await db.from("calendar_event_attendees").select("event_id,profile_id,remind_minutes,declined").eq("workspace_id", workspaceId).in("event_id", events.slice(index, index + 150).map((row) => String(row.id)));
    attendeeRows.push(...((rows ?? []) as Row[]));
  }
  const attendees = new Map<string, Row[]>();
  for (const row of attendeeRows) attendees.set(String(row.event_id), [...(attendees.get(String(row.event_id)) ?? []), row]);
  return events.map((row) => ({ row, attendees: attendees.get(String(row.id)) ?? [] }));
}

const timing = (row: Row) => ({
  startsAt: String(row.starts_at), durationMinutes: Number(row.duration_minutes), recurrence: row.recurrence as Recurrence,
  recurrenceDays: Array.isArray(row.recurrence_days) ? (row.recurrence_days as number[]).map(Number) : [], recurrenceUntil: typeof row.recurrence_until === "string" ? row.recurrence_until : null,
});

/**
 * Occurrences in [from, to) the member may see. scope MINE: events they created or are invited to;
 * TEAM: also those of the people they manage; ALL: everyone (administrators / Vai trò · Xem).
 * personIds narrows to events of those people (each must be visible to the member).
 */
export async function listOccurrences(context: CalendarContext, options: { from: number; to: number; scope: CalendarScope; personIds?: string[] }) {
  const db = createPrivilegedClient();
  // Members and the week's events do not depend on each other: load them together.
  const [members, events] = await Promise.all([loadMembers(db, context.workspaceId), loadEvents(db, context.workspaceId, options.from, options.to)]);
  const names = new Map(members.map((member) => [member.id, member.name]));
  const viewer = viewerFor(context, members);
  const scope: CalendarScope = options.scope === "ALL" && !viewer.seesAll ? "TEAM" : options.scope;
  const people = options.personIds?.length ? new Set(options.personIds) : scope === "MINE" ? new Set([context.userId]) : scope === "TEAM" ? viewer.team : null;
  const out: OccurrenceView[] = [];
  for (const { row, attendees } of events) {
    const createdBy = String(row.created_by);
    const attendeeIds = attendees.map((item) => String(item.profile_id));
    if (!canViewEvent(viewer, createdBy, attendeeIds)) continue;
    if (people && !people.has(createdBy) && !attendeeIds.some((id) => people.has(id))) continue;
    const mine = attendees.find((item) => item.profile_id === context.userId);
    const shape = timing(row);
    for (const start of occurrences(shape, options.from, options.to, 200)) {
      out.push({
        eventId: String(row.id), start, end: start + shape.durationMinutes * 60_000, title: String(row.title), kind: row.kind as EventKind,
        location: typeof row.location === "string" ? row.location : null, note: typeof row.note === "string" ? row.note : null,
        repeat: describeRepeat(shape), ...shape, createdBy, createdByName: names.get(createdBy) ?? "Thành viên",
        attendees: attendees.map((item) => ({ id: String(item.profile_id), name: names.get(String(item.profile_id)) ?? "Thành viên", declined: item.declined === true })),
        canEdit: createdBy === context.userId || context.isAdmin, isAttendee: Boolean(mine),
        myRemindMinutes: mine && typeof mine.remind_minutes === "number" ? mine.remind_minutes : null, myDeclined: mine?.declined === true,
        contactId: typeof row.contact_id === "string" ? row.contact_id : null, conversationId: typeof row.conversation_id === "string" ? row.conversation_id : null,
      });
    }
  }
  return { occurrences: out.sort((a, b) => a.start - b.start), members, viewer, scope };
}

export async function getMyReminderDefaults(context: CalendarContext) {
  const { data } = await createPrivilegedClient().from("calendar_member_settings").select("remind_minutes,zalo_reminders").eq("workspace_id", context.workspaceId).eq("profile_id", context.userId).maybeSingle();
  return { minutes: typeof data?.remind_minutes === "number" ? data.remind_minutes : DEFAULT_REMIND_MINUTES, zalo: data?.zalo_reminders !== false };
}

export async function setMyReminderDefaults(context: CalendarContext, minutes: number, zalo: boolean) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) return { ok: false as const, error: "Thời gian nhắc không hợp lệ." };
  const { error } = await createPrivilegedClient().from("calendar_member_settings")
    .upsert({ workspace_id: context.workspaceId, profile_id: context.userId, remind_minutes: minutes, zalo_reminders: zalo, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,profile_id" });
  return error ? { ok: false as const, error: "Chưa lưu được cài đặt nhắc lịch." } : { ok: true as const };
}

/** Creates (no id) or saves an event. The creator is always an attendee. */
export async function saveEvent(context: CalendarContext, input: EventInput, id: string | null, options: { myRemindMinutes?: number | null; source?: "WEB" | "ASSISTANT" } = {}) {
  const db = createPrivilegedClient();
  const members = await loadMembers(db, context.workspaceId);
  const known = new Set(members.map((member) => member.id));
  const attendeeIds = [...new Set([context.userId, ...input.attendeeIds])];
  if (attendeeIds.some((value) => !known.has(value))) return { ok: false as const, error: "Có người tham gia không thuộc công ty." };
  let creator = context.userId;
  if (id) {
    const { data: current } = await db.from("calendar_events").select("id,created_by,status").eq("workspace_id", context.workspaceId).eq("id", id).maybeSingle();
    if (!current || current.status !== "ACTIVE") return { ok: false as const, error: "Không tìm thấy lịch." };
    if (current.created_by !== context.userId && !context.isAdmin) return { ok: false as const, error: "Chỉ người tạo lịch được sửa lịch này." };
    creator = String(current.created_by);
    if (!attendeeIds.includes(creator)) attendeeIds.push(creator);
  }
  if (input.conversationId) {
    const { data: conversation } = await db.from("omnichannel_conversations").select("id,channel_account_id").eq("workspace_id", context.workspaceId).eq("id", input.conversationId).maybeSingle();
    const accessible = await getAccessibleChannelAccountIds();
    if (!conversation || (accessible && !accessible.includes(String(conversation.channel_account_id)))) return { ok: false as const, error: "Không tìm thấy hội thoại hoặc không có quyền." };
  }
  const row = {
    title: input.title, kind: input.kind, starts_at: new Date(input.startsAt).toISOString(), duration_minutes: input.durationMinutes, location: input.location, note: input.note,
    recurrence: input.recurrence, recurrence_days: input.recurrence === "WEEKLY" ? [...new Set(input.recurrenceDays)].sort() : [], recurrence_until: input.recurrenceUntil,
    contact_id: input.contactId, conversation_id: input.conversationId,
  };
  const saved = id
    ? await db.from("calendar_events").update(row).eq("workspace_id", context.workspaceId).eq("id", id).select("id").single()
    : await db.from("calendar_events").insert({ ...row, workspace_id: context.workspaceId, created_by: context.userId, source: options.source ?? "WEB" }).select("id").single();
  if (saved.error || !saved.data) return { ok: false as const, error: "Chưa lưu được lịch, thử lại sau." };
  const eventId = String(saved.data.id);
  if (id) await db.from("calendar_event_attendees").delete().eq("workspace_id", context.workspaceId).eq("event_id", eventId).not("profile_id", "in", `(${attendeeIds.join(",")})`);
  await db.from("calendar_event_attendees").upsert(attendeeIds.map((profileId) => ({ event_id: eventId, workspace_id: context.workspaceId, profile_id: profileId })), { onConflict: "event_id,profile_id", ignoreDuplicates: true });
  if (options.myRemindMinutes !== undefined) await db.from("calendar_event_attendees").update({ remind_minutes: options.myRemindMinutes }).eq("event_id", eventId).eq("profile_id", context.userId);
  return { ok: true as const, id: eventId };
}

export async function cancelEvent(context: CalendarContext, id: string) {
  const db = createPrivilegedClient();
  const { data: current } = await db.from("calendar_events").select("id,title,created_by,status").eq("workspace_id", context.workspaceId).eq("id", id).maybeSingle();
  if (!current || current.status !== "ACTIVE") return { ok: false as const, error: "Không tìm thấy lịch." };
  if (current.created_by !== context.userId && !context.isAdmin) return { ok: false as const, error: "Chỉ người tạo lịch được huỷ lịch này." };
  const { error } = await db.from("calendar_events").update({ status: "CANCELLED" }).eq("id", id).eq("workspace_id", context.workspaceId);
  return error ? { ok: false as const, error: "Chưa huỷ được lịch." } : { ok: true as const, title: String(current.title) };
}

/** An attendee's own reminder for one event (null = their default) and whether they take part. */
export async function setMyEventReminder(context: CalendarContext, eventId: string, minutes: number | null, declined?: boolean) {
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080)) return { ok: false as const, error: "Thời gian nhắc không hợp lệ." };
  const { data, error } = await createPrivilegedClient().from("calendar_event_attendees")
    .update({ remind_minutes: minutes, ...(declined === undefined ? {} : { declined }) })
    .eq("workspace_id", context.workspaceId).eq("event_id", eventId).eq("profile_id", context.userId).select("event_id").maybeSingle();
  if (error) return { ok: false as const, error: "Chưa lưu được." };
  return data ? { ok: true as const } : { ok: false as const, error: "Sếp không có trong lịch này." };
}

/** One event the member may see (for the Trợ lý's cards). */
export async function getVisibleEvent(context: CalendarContext, id: string) {
  const db = createPrivilegedClient();
  const members = await loadMembers(db, context.workspaceId);
  const [event] = await loadEvents(db, context.workspaceId, 0, 0, [id]);
  if (!event || !canViewEvent(viewerFor(context, members), String(event.row.created_by), event.attendees.map((item) => String(item.profile_id)))) return null;
  return { id, title: String(event.row.title), createdBy: String(event.row.created_by), isAttendee: event.attendees.some((item) => item.profile_id === context.userId), ...timing(event.row) };
}

export { loadEvents };
