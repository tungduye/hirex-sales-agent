import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { EVENT_KIND_LABEL, describeRepeat, formatOccurrence, parseVnDateTime, remindLabel, type EventKind, type Recurrence } from "@/modules/calendar/core/calendar";
import { checkEventInput, type EventInput } from "@/modules/calendar/core/calendar-input";
import { cancelEvent, getVisibleEvent, saveEvent, setMyEventReminder, setMyReminderDefaults } from "@/modules/calendar/server/calendar-data";
import type { ActionContext, Built, Executed } from "@/modules/assistant/server/assistant-proposals";

// Trợ lý cards for Lịch hẹn: create, cancel, and one's own reminder. Every member has a calendar, so
// these need no permission beyond being a member; cancelling stays with the creator (or an admin).

type Row = Record<string, unknown>;
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().replace(/^@/u, "").trim();

/** Members by name: HireX name or a linked Zalo name (what "@name" shows in a group). */
async function resolveMembers(workspaceId: string, names: string[]): Promise<{ ok: true; people: Array<{ id: string; name: string }> } | { ok: false; error: string }> {
  if (!names.length) return { ok: true, people: [] };
  const db = createPrivilegedClient();
  const [{ data: profiles }, { data: links }] = await Promise.all([
    db.from("profiles").select("id,full_name").eq("workspace_id", workspaceId),
    db.from("assistant_zalo_links").select("profile_id,zalo_name").eq("workspace_id", workspaceId),
  ]);
  const candidates = [
    ...((profiles ?? []) as Row[]).map((row) => ({ id: String(row.id), label: String(row.full_name ?? "") })),
    ...((links ?? []) as Row[]).filter((row) => typeof row.zalo_name === "string").map((row) => ({ id: String(row.profile_id), label: String(row.zalo_name) })),
  ];
  const nameOf = new Map(((profiles ?? []) as Row[]).map((row) => [String(row.id), String(row.full_name ?? "")]));
  const people: Array<{ id: string; name: string }> = [];
  for (const raw of names) {
    const wanted = fold(raw);
    if (!wanted) continue;
    const exact = [...new Set(candidates.filter((item) => fold(item.label) === wanted).map((item) => item.id))];
    const partial = [...new Set(candidates.filter((item) => fold(item.label).includes(wanted) || (wanted.length >= 3 && fold(item.label).split(/\s+/u).includes(wanted))).map((item) => item.id))];
    const ids = exact.length ? exact : partial;
    if (!ids.length) return { ok: false, error: `Không tìm thấy thành viên "${raw}". Hỏi lại tên trong HireX.` };
    if (ids.length > 1) return { ok: false, error: `"${raw}" khớp nhiều người: ${ids.map((id) => nameOf.get(id)).join(", ")}. Hỏi lại người dùng muốn mời ai.` };
    if (!people.some((person) => person.id === ids[0])) people.push({ id: ids[0], name: nameOf.get(ids[0]) ?? raw });
  }
  return { ok: true, people };
}

export async function proposeCreateEvent(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const startsAt = parseVnDateTime(String(args.bat_dau ?? ""));
  if (startsAt === null) return { ok: false, error: "Thời gian bắt đầu cần dạng YYYY-MM-DD HH:mm (giờ Việt Nam)." };
  if (startsAt < Date.now() - 60 * 60_000 && (args.lap_lai ?? "NONE") === "NONE") return { ok: false, error: "Thời gian bắt đầu đã qua. Hỏi lại ngày giờ." };
  const resolved = await resolveMembers(context.workspaceId, Array.isArray(args.nguoi_tham_gia) ? (args.nguoi_tham_gia as string[]) : []);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const recurrence = (typeof args.lap_lai === "string" ? args.lap_lai : "NONE") as Recurrence;
  const checked = checkEventInput({
    title: String(args.tieu_de ?? ""), kind: (typeof args.loai === "string" ? args.loai : "HOP") as EventKind, startsAt,
    durationMinutes: typeof args.thoi_luong_phut === "number" ? args.thoi_luong_phut : 60,
    location: typeof args.dia_diem === "string" ? args.dia_diem : null, note: typeof args.ghi_chu === "string" ? args.ghi_chu : null,
    recurrence, recurrenceDays: recurrence === "WEEKLY" && Array.isArray(args.thu_trong_tuan) ? args.thu_trong_tuan as number[] : [],
    recurrenceUntil: recurrence !== "NONE" && typeof args.lap_den === "string" ? args.lap_den : null,
    attendeeIds: resolved.people.map((person) => person.id).filter((id) => id !== context.userId),
    contactId: null, conversationId: typeof args.conversation_id === "string" ? args.conversation_id : null,
  });
  if (!checked.ok) return { ok: false, error: checked.error };
  const input: EventInput = checked.value;
  const remind = typeof args.nhac_toi_truoc_phut === "number" ? args.nhac_toi_truoc_phut : null;
  const repeat = describeRepeat({ recurrence: input.recurrence, recurrenceDays: input.recurrenceDays, recurrenceUntil: input.recurrenceUntil });
  return {
    ok: true, kind: "CREATE_EVENT",
    params: { input, myRemindMinutes: remind },
    preview: {
      title: "Tạo lịch hẹn",
      lines: [
        `${EVENT_KIND_LABEL[input.kind]}: ${input.title}`,
        `Thời gian: ${formatOccurrence(input.startsAt, input.durationMinutes)}${repeat ? ` · ${repeat}` : ""}`,
        ...(input.location ? [`Địa điểm: ${input.location}`] : []),
        `Người tham gia: ${["sếp", ...resolved.people.filter((person) => person.id !== context.userId).map((person) => person.name)].join(", ")}`,
        ...(remind !== null ? [`Nhắc sếp: ${remindLabel(remind)}`] : []),
        "Mỗi người được Soda nhắc qua Zalo riêng theo giờ nhắc của họ.",
      ],
      link: "/calendar",
    },
  };
}

export async function executeCreateEvent(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const checked = checkEventInput(params.input);
  if (!checked.ok) return { ok: false, message: checked.error };
  const result = await saveEvent(context, checked.value, null, { myRemindMinutes: typeof params.myRemindMinutes === "number" ? params.myRemindMinutes : undefined, source: "ASSISTANT" });
  return result.ok ? { ok: true, message: `Đã tạo lịch "${checked.value.title}".`, link: "/calendar" } : { ok: false, message: result.error };
}

export async function proposeCancelEvent(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const event = await getVisibleEvent(context, String(args.event_id));
  if (!event) return { ok: false, error: "Không tìm thấy lịch (hoặc không có quyền xem)." };
  if (event.createdBy !== context.userId && !context.isAdmin) return { ok: false, error: "Chỉ người tạo lịch được huỷ lịch này. Người tham gia có thể báo không tham gia (de_xuat_cai_nhac_lich, khong_tham_gia = true)." };
  const repeat = describeRepeat(event);
  return {
    ok: true, kind: "CANCEL_EVENT", params: { eventId: event.id },
    preview: { title: "Huỷ lịch hẹn", lines: [`Lịch: ${event.title}`, `Bắt đầu: ${formatOccurrence(Date.parse(event.startsAt), event.durationMinutes)}`, ...(repeat ? [`Huỷ cả chuỗi: ${repeat}`] : [])], link: "/calendar" },
  };
}

export async function executeCancelEvent(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const result = await cancelEvent(context, String(params.eventId));
  return result.ok ? { ok: true, message: `Đã huỷ lịch "${result.title}".`, link: "/calendar" } : { ok: false, message: result.error };
}

export async function proposeSetReminder(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const minutes = typeof args.nhac_truoc_phut === "number" ? args.nhac_truoc_phut : null;
  if (typeof args.event_id === "string") {
    const event = await getVisibleEvent(context, args.event_id);
    if (!event || !event.isAttendee) return { ok: false, error: "Sếp không có trong lịch này." };
    const declined = typeof args.khong_tham_gia === "boolean" ? args.khong_tham_gia : undefined;
    if (minutes === null && declined === undefined) return { ok: false, error: "Cần giờ nhắc hoặc tham gia/không tham gia." };
    return {
      ok: true, kind: "SET_REMINDER", params: { eventId: event.id, minutes, declined: declined ?? null },
      preview: { title: "Lịch của sếp", lines: [`Lịch: ${event.title}`, ...(minutes !== null ? [`Nhắc sếp: ${remindLabel(minutes)}`] : []), ...(declined === true ? ["Sếp không tham gia (không nhắc nữa)"] : declined === false ? ["Sếp tham gia lại"] : [])], link: "/calendar" },
    };
  }
  const zalo = typeof args.nhan_qua_zalo === "boolean" ? args.nhan_qua_zalo : null;
  if (minutes === null && zalo === null) return { ok: false, error: "Cần giờ nhắc mặc định hoặc bật/tắt nhắc qua Zalo." };
  return {
    ok: true, kind: "SET_REMINDER", params: { eventId: null, minutes, zalo },
    preview: { title: "Cài đặt nhắc lịch của sếp", lines: [...(minutes !== null ? [`Mặc định nhắc: ${remindLabel(minutes)} cho mọi lịch`] : []), ...(zalo === false ? ["Tắt nhắc qua Zalo"] : zalo === true ? ["Bật nhắc qua Zalo"] : [])], link: "/calendar" },
  };
}

export async function executeSetReminder(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  if (typeof params.eventId === "string") {
    const current = await getVisibleEvent(context, params.eventId);
    if (!current) return { ok: false, message: "Không tìm thấy lịch." };
    const db = createPrivilegedClient();
    const { data } = await db.from("calendar_event_attendees").select("remind_minutes,declined").eq("event_id", params.eventId).eq("profile_id", context.userId).maybeSingle();
    const minutes = typeof params.minutes === "number" ? params.minutes : (typeof data?.remind_minutes === "number" ? data.remind_minutes : null);
    const result = await setMyEventReminder(context, params.eventId, minutes, typeof params.declined === "boolean" ? params.declined : undefined);
    return result.ok ? { ok: true, message: "Đã lưu lịch của sếp.", link: "/calendar" } : { ok: false, message: result.error };
  }
  const db = createPrivilegedClient();
  const { data } = await db.from("calendar_member_settings").select("remind_minutes,zalo_reminders").eq("workspace_id", context.workspaceId).eq("profile_id", context.userId).maybeSingle();
  const minutes = typeof params.minutes === "number" ? params.minutes : (typeof data?.remind_minutes === "number" ? data.remind_minutes : 30);
  const zalo = typeof params.zalo === "boolean" ? params.zalo : data?.zalo_reminders !== false;
  const result = await setMyReminderDefaults(context, minutes, zalo);
  return result.ok ? { ok: true, message: `Đã lưu: ${zalo ? `nhắc ${remindLabel(minutes).toLowerCase()}` : "tắt nhắc qua Zalo"}.`, link: "/calendar" } : { ok: false, message: result.error };
}
