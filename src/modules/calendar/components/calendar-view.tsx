"use client";

import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus, Repeat, Users, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { EVENT_KIND_LABEL, EVENT_KINDS, formatOccurrence, isoWeekday, RECURRENCE_LABEL, RECURRENCES, REMIND_CHOICES, remindLabel, vnDayString, vnInputValue, WEEKDAY_LABEL, type EventKind } from "../core/calendar";
import { cancelEventAction, saveEventAction, setMyEventReminderAction, setMyReminderDefaultsAction, type CalendarActionState } from "../server/calendar-actions";
import type { CalendarScope, OccurrenceView } from "../server/calendar-data";

const DAY = 86_400_000;
const VN = 7 * 3_600_000;
const initial: CalendarActionState = { status: "idle", message: null };
const KIND_STYLE: Record<EventKind, string> = {
  HOP: "bg-blue-50 text-blue-700 border-blue-200", PHONG_VAN: "bg-violet-50 text-violet-700 border-violet-200", GAP_KHACH: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CA_NHAN: "bg-amber-50 text-amber-800 border-amber-200", KHAC: "bg-slate-100 text-slate-600 border-slate-200",
};
const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").toLowerCase();
const hm = (at: number) => new Date(at + VN).toISOString().slice(11, 16);
const dayLabel = (day: number) => { const d = new Date(day * DAY); return `${WEEKDAY_LABEL[isoWeekday(day)]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
type Member = { id: string; name: string };
type Editing = { mode: "new"; start: number } | { mode: "open"; item: OccurrenceView };

export function CalendarView({ monday, today, scope, seesAll, hasTeam, occurrences, members, userId, defaults }: {
  monday: number; today: number; scope: CalendarScope; seesAll: boolean; hasTeam: boolean; occurrences: OccurrenceView[]; members: Member[]; userId: string; defaults: { minutes: number; zalo: boolean };
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const days = Array.from({ length: 7 }, (_, index) => monday + index);
  const byDay = useMemo(() => {
    const map = new Map<number, OccurrenceView[]>();
    for (const item of occurrences) { const day = Math.floor((item.start + VN) / DAY); map.set(day, [...(map.get(day) ?? []), item]); }
    return map;
  }, [occurrences]);
  const href = (week: number, nextScope = scope) => `/calendar?tuan=${vnDayString(week)}${nextScope === "MINE" ? "" : `&pham_vi=${nextScope}`}`;
  const scopes: Array<[CalendarScope, string]> = [["MINE", "Của tôi"], ...(hasTeam || seesAll ? [["TEAM", "Team"] as [CalendarScope, string]] : []), ...(seesAll ? [["ALL", "Công ty"] as [CalendarScope, string]] : [])];

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-950"><CalendarDays className="size-6 text-blue-600"/>Lịch hẹn</h1>
        <p className="mt-1 text-sm text-slate-500">Lịch họp, phỏng vấn, gặp khách. Soda nhắc từng người qua Zalo riêng theo giờ nhắc của người đó. Có thể nhờ Soda tạo lịch, ví dụ “@Soda tạo lịch họp thứ 2 hàng tuần 13h45 với Trinh”.</p>
      </div>
      <button type="button" onClick={() => setEditing({ mode: "new", start: nextSlot(today === Math.max(today, monday) && today <= monday + 6 ? today : monday) })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-sm font-semibold text-white hover:bg-blue-700"><Plus className="size-4"/>Thêm lịch</button>
    </header>

    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <Link href={href(monday - 7)} aria-label="Tuần trước" className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronLeft className="size-4"/></Link>
      <Link href={href(today)} className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Tuần này</Link>
      <Link href={href(monday + 7)} aria-label="Tuần sau" className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronRight className="size-4"/></Link>
      <span className="text-sm font-semibold text-slate-800">{dayLabel(monday).split(" ").slice(-1)} – {dayLabel(monday + 6).split(" ").slice(-1)}/{new Date((monday + 6) * DAY).getUTCFullYear()}</span>
      <div className="ml-auto flex items-center gap-1" role="group" aria-label="Phạm vi">
        {scopes.map(([value, label]) => <Link key={value} href={href(monday, value)} aria-current={scope === value ? "page" : undefined} className={`h-8 rounded-full border px-3 text-xs font-semibold leading-8 ${scope === value ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>{label}</Link>)}
      </div>
      <ReminderDefaults defaults={defaults}/>
    </div>

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
      {days.map((day) => <section key={day} className={`min-h-[140px] rounded-2xl border bg-white p-2.5 shadow-sm ${day === today ? "border-blue-300 ring-1 ring-blue-200" : "border-slate-200"}`}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className={`text-xs font-bold uppercase tracking-wide ${day === today ? "text-blue-700" : "text-slate-500"}`}>{dayLabel(day)}</h2>
          <button type="button" onClick={() => setEditing({ mode: "new", start: nextSlot(day) })} aria-label={`Thêm lịch ${dayLabel(day)}`} className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600"><Plus className="size-3.5"/></button>
        </div>
        <ul className="space-y-1.5">
          {(byDay.get(day) ?? []).map((item) => <li key={`${item.eventId}:${item.start}`}>
            <button type="button" onClick={() => setEditing({ mode: "open", item })} className={`w-full rounded-lg border px-2 py-1.5 text-left hover:shadow-sm ${KIND_STYLE[item.kind]} ${item.myDeclined ? "opacity-50 line-through" : ""}`}>
              <p className="text-[11px] font-semibold">{hm(item.start)}–{hm(item.end)}{item.repeat ? <Repeat className="ml-1 inline size-3"/> : null}</p>
              <p className="text-sm font-semibold leading-snug text-slate-900">{item.title}</p>
              {item.location ? <p className="flex items-center gap-1 truncate text-[11px] text-slate-500"><MapPin className="size-3 shrink-0"/>{item.location}</p> : null}
              {item.attendees.length > 1 || item.createdBy !== userId ? <p className="flex items-center gap-1 truncate text-[11px] text-slate-500"><Users className="size-3 shrink-0"/>{item.attendees.map((person) => person.name).join(", ")}</p> : null}
            </button>
          </li>)}
        </ul>
        {(byDay.get(day) ?? []).length === 0 ? <p className="pt-4 text-center text-xs text-slate-300">Trống</p> : null}
      </section>)}
    </div>

    {editing ? editing.mode === "new" || editing.item.canEdit
      ? <EventForm key={editing.mode === "new" ? "new" : `${editing.item.eventId}`} item={editing.mode === "open" ? editing.item : null} start={editing.mode === "new" ? editing.start : editing.item.start} members={members} userId={userId} onClose={() => setEditing(null)}/>
      : <EventDetails item={editing.item} onClose={() => setEditing(null)}/> : null}
  </div>;
}

/** 9:00 on that day, rounded up to the next half hour when that day is today. */
function nextSlot(day: number) {
  const nine = day * DAY - VN + 9 * 3_600_000;
  const soon = Math.ceil((Date.now() + 15 * 60_000) / 1_800_000) * 1_800_000;
  return Math.max(nine, Math.min(soon, day * DAY - VN + 21 * 3_600_000));
}

function ReminderDefaults({ defaults }: { defaults: { minutes: number; zalo: boolean } }) {
  const [minutes, setMinutes] = useState(defaults.minutes);
  const [zalo, setZalo] = useState(defaults.zalo);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const save = (next: { minutes: number; zalo: boolean }) => start(async () => { const result = await setMyReminderDefaultsAction(next); setMessage(result.status === "error" ? result.message : "Đã lưu"); });
  return <div className="flex items-center gap-2 border-l border-slate-200 pl-3 text-xs text-slate-600">
    <label className="flex items-center gap-1.5"><input type="checkbox" checked={zalo} disabled={pending} onChange={(event) => { setZalo(event.target.checked); save({ minutes, zalo: event.target.checked }); }} className="size-3.5 rounded border-slate-300"/>Soda nhắc tôi qua Zalo</label>
    <select value={minutes} disabled={pending || !zalo} onChange={(event) => { const next = Number(event.target.value); setMinutes(next); save({ minutes: next, zalo }); }} className="h-7 rounded-lg border border-slate-200 bg-white px-1.5 text-xs font-semibold" aria-label="Giờ nhắc mặc định">
      {[...new Set([...REMIND_CHOICES, minutes])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{remindLabel(value)}</option>)}
    </select>
    {message ? <span className="text-[11px] text-slate-400">{message}</span> : null}
  </div>;
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`block ${wide ? "sm:col-span-2" : ""}`}><span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>;
}
const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400";

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  return <div role="dialog" aria-label={title} className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" onClick={onClose}>
    <div onClick={(event) => event.stopPropagation()} className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5"><h2 className="font-bold text-slate-900">{title}</h2><button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-5"/></button></div>
      {children}
    </div>
  </div>;
}

function MyReminder({ item }: { item: OccurrenceView }) {
  const [minutes, setMinutes] = useState<string>(item.myRemindMinutes === null ? "" : String(item.myRemindMinutes));
  const [declined, setDeclined] = useState(item.myDeclined);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const save = (nextMinutes: string, nextDeclined: boolean) => start(async () => {
    const result = await setMyEventReminderAction({ eventId: item.eventId, minutes: nextMinutes === "" ? null : Number(nextMinutes), declined: nextDeclined });
    setMessage(result.message);
  });
  if (!item.isAttendee) return null;
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
    <p className="mb-2 text-xs font-semibold text-slate-600">Của tôi</p>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2">Nhắc tôi<select value={minutes} disabled={pending || declined} onChange={(event) => { setMinutes(event.target.value); save(event.target.value, declined); }} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm">
        <option value="">Theo mặc định của tôi</option>{REMIND_CHOICES.map((value) => <option key={value} value={value}>{remindLabel(value)}</option>)}
      </select></label>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={declined} disabled={pending} onChange={(event) => { setDeclined(event.target.checked); save(minutes, event.target.checked); }} className="size-4 rounded border-slate-300"/>Tôi không tham gia</label>
      {message ? <span className="text-xs text-slate-400">{message}</span> : null}
    </div>
  </div>;
}

function Details({ item }: { item: OccurrenceView }) {
  return <dl className="space-y-2 text-sm">
    <div><dt className="text-xs font-semibold text-slate-500">Thời gian</dt><dd className="text-slate-900">{formatOccurrence(item.start, item.durationMinutes)}{item.repeat ? ` · ${item.repeat}` : ""}</dd></div>
    <div><dt className="text-xs font-semibold text-slate-500">Loại</dt><dd>{EVENT_KIND_LABEL[item.kind]}</dd></div>
    {item.location ? <div><dt className="text-xs font-semibold text-slate-500">Địa điểm</dt><dd>{item.location}</dd></div> : null}
    <div><dt className="text-xs font-semibold text-slate-500">Người tạo</dt><dd>{item.createdByName}</dd></div>
    <div><dt className="text-xs font-semibold text-slate-500">Người tham gia</dt><dd>{item.attendees.map((person) => `${person.name}${person.declined ? " (không tham gia)" : ""}`).join(", ")}</dd></div>
    {item.note ? <div><dt className="text-xs font-semibold text-slate-500">Ghi chú</dt><dd className="whitespace-pre-wrap">{item.note}</dd></div> : null}
    {item.conversationId ? <div><Link href={`/inbox/all/${item.conversationId}`} className="text-sm font-semibold text-blue-700 hover:underline">Mở hội thoại liên quan</Link></div> : null}
  </dl>;
}

function EventDetails({ item, onClose }: { item: OccurrenceView; onClose: () => void }) {
  return <Drawer title={item.title} onClose={onClose}><div className="space-y-4 overflow-y-auto px-5 py-4"><Details item={item}/><MyReminder item={item}/></div></Drawer>;
}

function EventForm({ item, start, members, userId, onClose }: { item: OccurrenceView | null; start: number; members: Member[]; userId: string; onClose: () => void }) {
  const [state, save, pending] = useActionState(saveEventAction, initial);
  const [recurrence, setRecurrence] = useState(item?.recurrence ?? "NONE");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(item ? item.attendees.map((person) => person.id) : [userId]));
  const [search, setSearch] = useState("");
  const [cancelling, startCancel] = useTransition();
  const [cancelError, setCancelError] = useState<string | null>(null);
  useEffect(() => { if (state.status === "success") onClose(); }, [state, onClose]);
  const firstStart = item ? Date.parse(item.startsAt) : start;
  const startDay = Math.floor((firstStart + VN) / DAY);
  const shown = members.filter((member) => !search || fold(member.name).includes(fold(search)));
  const toggle = (id: string) => setChosen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <Drawer title={item ? "Sửa lịch" : "Thêm lịch"} onClose={onClose}>
    <form action={save} className="flex min-h-0 flex-1 flex-col">
      <fieldset disabled={pending} className="grid flex-1 grid-cols-1 content-start gap-3.5 overflow-y-auto px-5 py-4 sm:grid-cols-2">
        {item ? <input type="hidden" name="id" value={item.eventId}/> : null}
        <Field label="Tiêu đề *" wide><input name="title" required maxLength={200} defaultValue={item?.title ?? ""} className={inputClass} placeholder="Họp team Rec"/></Field>
        <Field label="Loại"><select name="kind" defaultValue={item?.kind ?? "HOP"} className={inputClass}>{EVENT_KINDS.map((value) => <option key={value} value={value}>{EVENT_KIND_LABEL[value]}</option>)}</select></Field>
        <Field label={item?.repeat ? "Bắt đầu (lần đầu) *" : "Bắt đầu *"}><input name="startsAt" type="datetime-local" required defaultValue={vnInputValue(firstStart)} className={inputClass}/></Field>
        <Field label="Thời lượng"><select name="durationMinutes" defaultValue={String(item?.durationMinutes ?? 60)} className={inputClass}>{[15, 30, 45, 60, 90, 120, 180, 240, 480].concat(item && ![15, 30, 45, 60, 90, 120, 180, 240, 480].includes(item.durationMinutes) ? [item.durationMinutes] : []).map((value) => <option key={value} value={value}>{value < 60 ? `${value} phút` : `${value / 60} giờ`}</option>)}</select></Field>
        <Field label="Địa điểm / link họp"><input name="location" maxLength={300} defaultValue={item?.location ?? ""} className={inputClass} placeholder="Phòng họp tầng 3, Google Meet…"/></Field>
        <Field label="Lặp lại"><select name="recurrence" value={recurrence} onChange={(event) => setRecurrence(event.target.value as typeof recurrence)} className={inputClass}>{RECURRENCES.map((value) => <option key={value} value={value}>{RECURRENCE_LABEL[value]}</option>)}</select></Field>
        {recurrence !== "NONE" ? <Field label="Lặp đến ngày (không bắt buộc)"><input name="recurrenceUntil" type="date" defaultValue={item?.recurrenceUntil ?? ""} className={inputClass}/></Field> : null}
        {recurrence === "WEEKLY" ? <div className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-600">Các thứ trong tuần</span><div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((value) => <label key={value} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs"><input type="checkbox" name="recurrenceDays" value={value} defaultChecked={item?.recurrenceDays.length ? item.recurrenceDays.includes(value) : value === isoWeekday(startDay)} className="size-3.5"/>{WEEKDAY_LABEL[value]}</label>)}
        </div></div> : null}
        <Field label="Nhắc tôi"><select name="myRemindMinutes" defaultValue={item?.myRemindMinutes === null || item?.myRemindMinutes === undefined ? "" : String(item.myRemindMinutes)} className={inputClass}><option value="">Theo mặc định của tôi</option>{REMIND_CHOICES.map((value) => <option key={value} value={value}>{remindLabel(value)}</option>)}</select></Field>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Người tham gia ({chosen.size}) · mỗi người tự chọn giờ nhắc của mình</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm thành viên…" className={`${inputClass} mb-2`}/>
          <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {shown.map((member) => <label key={member.id} className="flex items-center gap-1.5 truncate text-sm"><input type="checkbox" checked={chosen.has(member.id) || member.id === (item?.createdBy ?? userId)} disabled={member.id === (item?.createdBy ?? userId)} onChange={() => toggle(member.id)} className="size-3.5"/>{member.name}</label>)}
          </div>
          {[...chosen].map((id) => <input key={id} type="hidden" name="attendeeIds" value={id}/>)}
        </div>
        <Field label="Ghi chú" wide><textarea name="note" rows={3} maxLength={2000} defaultValue={item?.note ?? ""} className={inputClass}/></Field>
      </fieldset>
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
        {state.status === "error" ? <p className="mr-auto text-sm text-rose-600">{state.message}</p> : cancelError ? <p className="mr-auto text-sm text-rose-600">{cancelError}</p> : null}
        {item ? <button type="button" disabled={cancelling} onClick={() => { if (!window.confirm(item.repeat ? "Huỷ cả chuỗi lịch lặp này?" : "Huỷ lịch này?")) return; startCancel(async () => { const result = await cancelEventAction(item.eventId); if (result.status === "success") onClose(); else setCancelError(result.message); }); }} className="mr-auto h-9 rounded-lg border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60">Huỷ lịch</button> : null}
        <button type="button" onClick={onClose} className="h-9 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Đóng</button>
        <button type="submit" disabled={pending} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{pending ? "Đang lưu…" : item ? "Lưu" : "Thêm lịch"}</button>
      </div>
    </form>
  </Drawer>;
}
