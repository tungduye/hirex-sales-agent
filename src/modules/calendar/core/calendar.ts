// Lịch hẹn: event kinds, repeating events, who may see an event and when a reminder is due.
// Times are Vietnam time (UTC+7, no daylight saving). Pure module (tests/calendar.test.mjs).

export const EVENT_KINDS = ["HOP", "PHONG_VAN", "GAP_KHACH", "CA_NHAN", "KHAC"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_KIND_LABEL: Record<EventKind, string> = { HOP: "Họp", PHONG_VAN: "Phỏng vấn", GAP_KHACH: "Gặp khách", CA_NHAN: "Cá nhân", KHAC: "Khác" };
export const RECURRENCES = ["NONE", "DAILY", "WEEKLY", "MONTHLY"] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export const RECURRENCE_LABEL: Record<Recurrence, string> = { NONE: "Không lặp", DAILY: "Hằng ngày", WEEKLY: "Hằng tuần", MONTHLY: "Hằng tháng" };
export const WEEKDAY_LABEL = ["", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"];
export const DEFAULT_REMIND_MINUTES = 30;
export const REMIND_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440] as const;

const VN = 7 * 3_600_000;
const DAY = 86_400_000;

export interface EventTiming { startsAt: string; durationMinutes: number; recurrence: Recurrence; recurrenceDays: number[]; recurrenceUntil: string | null }

/** Vietnam calendar day number (days since 1970-01-01) of an instant. */
export const vnDay = (at: number) => Math.floor((at + VN) / DAY);
/** 1 = Monday … 7 = Sunday, for a Vietnam day number. */
export const isoWeekday = (day: number) => ((day + 3) % 7) + 1;
const dayStart = (day: number) => day * DAY - VN;

/** "2026-10-23 13:45" (Vietnam) → epoch ms; null when not a real date and time. */
export function parseVnDateTime(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/u.exec(value.trim());
  if (!match) return null;
  const [year, month, date, hour, minute] = match.slice(1).map(Number);
  if (hour > 23 || minute > 59) return null;
  const utc = Date.UTC(year, month - 1, date, hour, minute);
  const check = new Date(utc);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return null;
  return utc - VN;
}
/** "2026-10-23" → Vietnam day number, or null. */
export function parseVnDay(value: string): number | null {
  const at = parseVnDateTime(`${value} 00:00`);
  return at === null ? null : vnDay(at);
}
export function vnDayString(day: number) { return new Date(day * DAY).toISOString().slice(0, 10); }
export function vnInputValue(at: number) { const d = new Date(at + VN); return d.toISOString().slice(0, 16); }

/** "Thứ Năm 23/10, 13:45–14:45" */
export function formatOccurrence(start: number, durationMinutes: number) {
  const local = new Date(start + VN);
  const end = new Date(start + durationMinutes * 60_000 + VN);
  const hm = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const sameDay = vnDay(start) === vnDay(start + durationMinutes * 60_000);
  return `${WEEKDAY_LABEL[isoWeekday(vnDay(start))]} ${String(local.getUTCDate()).padStart(2, "0")}/${String(local.getUTCMonth() + 1).padStart(2, "0")}, ${hm(local)}–${hm(end)}${sameDay ? "" : " (hôm sau)"}`;
}

/** Start instants of an event's occurrences that overlap [from, to), oldest first, at most `cap`. */
export function occurrences(event: EventTiming, from: number, to: number, cap = 500): number[] {
  const first = Date.parse(event.startsAt);
  if (!Number.isFinite(first)) return [];
  const length = event.durationMinutes * 60_000;
  if (event.recurrence === "NONE") return first < to && first + length > from ? [first] : [];
  const timeOfDay = first - dayStart(vnDay(first));
  const firstDay = vnDay(first);
  const until = event.recurrenceUntil ? parseVnDay(event.recurrenceUntil) : null;
  const days = event.recurrenceDays.length ? event.recurrenceDays : [isoWeekday(firstDay)];
  const dom = new Date(first + VN).getUTCDate();
  const out: number[] = [];
  for (let day = Math.max(firstDay, vnDay(from - length)); day <= vnDay(to) && out.length < cap; day++) {
    if (until !== null && day > until) break;
    if (event.recurrence === "WEEKLY" && !days.includes(isoWeekday(day))) continue;
    if (event.recurrence === "MONTHLY" && new Date(day * DAY).getUTCDate() !== dom) continue;
    const start = dayStart(day) + timeOfDay;
    if (start < to && start + length > from && start >= first) out.push(start);
  }
  return out;
}

export function describeRepeat(event: Pick<EventTiming, "recurrence" | "recurrenceDays" | "recurrenceUntil">) {
  if (event.recurrence === "NONE") return null;
  const days = event.recurrence === "WEEKLY" && event.recurrenceDays.length ? ` (${[...event.recurrenceDays].sort().map((day) => WEEKDAY_LABEL[day]).join(", ")})` : "";
  const until = event.recurrenceUntil ? `, đến ${event.recurrenceUntil.split("-").reverse().join("/")}` : "";
  return `${RECURRENCE_LABEL[event.recurrence]}${days}${until}`;
}

export function remindLabel(minutes: number) {
  if (minutes === 0) return "Đúng giờ";
  if (minutes % 1440 === 0) return `Trước ${minutes / 1440} ngày`;
  if (minutes % 60 === 0) return `Trước ${minutes / 60} giờ`;
  return `Trước ${minutes} phút`;
}

export interface Viewer { userId: string; team: ReadonlySet<string>; seesAll: boolean }
/** An event is seen by its creator and attendees, their managers (up the chain), and administrators. */
export function canViewEvent(viewer: Viewer, createdBy: string, attendeeIds: readonly string[]) {
  return viewer.seesAll || createdBy === viewer.userId || attendeeIds.includes(viewer.userId)
    || viewer.team.has(createdBy) || attendeeIds.some((id) => viewer.team.has(id));
}

export interface ReminderCandidate { eventId: string; profileId: string; occurrence: number; minutes: number }
/**
 * Reminders due now: the reminder time has passed (by at most `grace`) and the occurrence has not
 * started yet. Each (event, person, occurrence) is reminded once (`sent` holds "event|person|iso").
 */
export function dueReminders(
  events: Array<EventTiming & { id: string; attendees: Array<{ profileId: string; remindMinutes: number | null; declined: boolean }> }>,
  defaults: ReadonlyMap<string, { minutes: number; zalo: boolean }>,
  sent: ReadonlySet<string>,
  now: number,
  grace = 15 * 60_000,
): ReminderCandidate[] {
  const out: ReminderCandidate[] = [];
  for (const event of events) {
    for (const attendee of event.attendees) {
      if (attendee.declined) continue;
      const setting = defaults.get(attendee.profileId);
      if (setting && !setting.zalo) continue;
      const minutes = attendee.remindMinutes ?? setting?.minutes ?? DEFAULT_REMIND_MINUTES;
      for (const occurrence of occurrences(event, now, now + minutes * 60_000 + 1, 3)) {
        const at = occurrence - minutes * 60_000;
        if (occurrence < now || at > now || now - at > grace) continue;
        if (sent.has(`${event.id}|${attendee.profileId}|${new Date(occurrence).toISOString()}`)) continue;
        out.push({ eventId: event.id, profileId: attendee.profileId, occurrence, minutes });
      }
    }
  }
  return out;
}

export const CALENDAR_PERIODS = ["HOM_NAY", "NGAY_MAI", "TUAN_NAY", "TUAN_SAU", "7_NGAY_TOI"] as const;
export type CalendarPeriod = (typeof CALENDAR_PERIODS)[number];
/** Range for the Trợ lý's "lich_hen": a ready-made period or explicit days (inclusive), default the next 7 days. */
export function calendarRange(period: CalendarPeriod | null, fromDay: string | null, toDay: string | null, now: number): { from: number; to: number } | { error: string } {
  const today = vnDay(now);
  if (fromDay || toDay) {
    const from = fromDay ? parseVnDay(fromDay) : today;
    const to = toDay ? parseVnDay(toDay) : from;
    if (from === null || to === null) return { error: "Ngày không hợp lệ (dùng YYYY-MM-DD)." };
    if (to < from) return { error: "Ngày kết thúc trước ngày bắt đầu." };
    if (to - from > 62) return { error: "Tối đa 2 tháng mỗi lần xem." };
    return { from: dayStart(from), to: dayStart(to + 1) };
  }
  const monday = today - (isoWeekday(today) - 1);
  switch (period) {
    case "HOM_NAY": return { from: dayStart(today), to: dayStart(today + 1) };
    case "NGAY_MAI": return { from: dayStart(today + 1), to: dayStart(today + 2) };
    case "TUAN_NAY": return { from: dayStart(monday), to: dayStart(monday + 7) };
    case "TUAN_SAU": return { from: dayStart(monday + 7), to: dayStart(monday + 14) };
    default: return { from: dayStart(today), to: dayStart(today + 7) };
  }
}
