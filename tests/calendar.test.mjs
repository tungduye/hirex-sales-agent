import { test } from "node:test";
import assert from "node:assert/strict";
import { canViewEvent, describeRepeat, dueReminders, formatOccurrence, occurrences, parseVnDateTime } from "../src/modules/calendar/core/calendar.ts";

const at = (value) => parseVnDateTime(value);
const iso = (list) => list.map((value) => new Date(value).toISOString());

test("Vietnam date and time", () => {
  assert.equal(new Date(at("2026-10-23 13:45")).toISOString(), "2026-10-23T06:45:00.000Z");
  assert.equal(at("2026-02-30 10:00"), null);
  assert.equal(at("2026-10-23 25:00"), null);
  assert.equal(formatOccurrence(at("2026-10-23 13:45"), 60), "Thứ Sáu 23/10, 13:45–14:45");
});

test("one-off and repeating events", () => {
  const once = { startsAt: "2026-10-23T06:45:00Z", durationMinutes: 60, recurrence: "NONE", recurrenceDays: [], recurrenceUntil: null };
  assert.equal(occurrences(once, at("2026-10-19 00:00"), at("2026-10-26 00:00")).length, 1);
  assert.equal(occurrences(once, at("2026-10-24 00:00"), at("2026-10-26 00:00")).length, 0);
  // Every Monday 13:45 from 19/10, until 02/11.
  const weekly = { startsAt: "2026-10-19T06:45:00Z", durationMinutes: 60, recurrence: "WEEKLY", recurrenceDays: [1], recurrenceUntil: "2026-11-02" };
  assert.deepEqual(iso(occurrences(weekly, at("2026-10-01 00:00"), at("2026-12-01 00:00"))), ["2026-10-19T06:45:00.000Z", "2026-10-26T06:45:00.000Z", "2026-11-02T06:45:00.000Z"]);
  const twice = { ...weekly, recurrenceDays: [2, 4], recurrenceUntil: null };
  assert.deepEqual(iso(occurrences(twice, at("2026-10-19 00:00"), at("2026-10-26 00:00"))), ["2026-10-20T06:45:00.000Z", "2026-10-22T06:45:00.000Z"]);
  const daily = { ...once, recurrence: "DAILY" };
  assert.equal(occurrences(daily, at("2026-10-01 00:00"), at("2026-10-30 00:00")).length, 7);
  const monthly = { ...once, startsAt: "2026-01-31T02:00:00Z", recurrence: "MONTHLY" };
  assert.deepEqual(iso(occurrences(monthly, at("2026-02-01 00:00"), at("2026-04-01 00:00"))), ["2026-03-31T02:00:00.000Z"]);
  assert.equal(describeRepeat(weekly), "Hằng tuần (Thứ Hai), đến 02/11/2026");
});

test("who sees an event", () => {
  const viewer = { userId: "me", team: new Set(["me", "staff"]), seesAll: false };
  assert.equal(canViewEvent(viewer, "me", []), true);
  assert.equal(canViewEvent(viewer, "boss", ["me"]), true);
  assert.equal(canViewEvent(viewer, "staff", []), true);
  assert.equal(canViewEvent(viewer, "other", ["someone"]), false);
  assert.equal(canViewEvent({ ...viewer, seesAll: true }, "other", []), true);
});

test("reminders: own time, default, once, not after the start", () => {
  const event = { id: "e1", startsAt: "2026-10-23T06:45:00Z", durationMinutes: 60, recurrence: "NONE", recurrenceDays: [], recurrenceUntil: null,
    attendees: [{ profileId: "a", remindMinutes: null, declined: false }, { profileId: "b", remindMinutes: 10, declined: false }, { profileId: "c", remindMinutes: null, declined: true }] };
  const defaults = new Map([["a", { minutes: 30, zalo: true }]]);
  const now = at("2026-10-23 13:16");
  assert.deepEqual(dueReminders([event], defaults, new Set(), now).map((row) => row.profileId), ["a"]);
  assert.deepEqual(dueReminders([event], defaults, new Set(), at("2026-10-23 13:36")).map((row) => row.profileId), ["b"]);
  assert.deepEqual(dueReminders([event], defaults, new Set(["e1|a|2026-10-23T06:45:00.000Z"]), now), []);
  assert.deepEqual(dueReminders([event], defaults, new Set(), at("2026-10-23 13:46")), []);
  assert.deepEqual(dueReminders([event], new Map([["a", { minutes: 30, zalo: false }]]), new Set(), now), []);
});

test("periods for the Trợ lý", async () => {
  const { calendarRange } = await import("../src/modules/calendar/core/calendar.ts");
  const now = at("2026-10-20 15:00"); // Tuesday
  const show = (range) => [new Date(range.from).toISOString(), new Date(range.to).toISOString()];
  assert.deepEqual(show(calendarRange("HOM_NAY", null, null, now)), ["2026-10-19T17:00:00.000Z", "2026-10-20T17:00:00.000Z"]);
  assert.deepEqual(show(calendarRange("TUAN_SAU", null, null, now)), ["2026-10-25T17:00:00.000Z", "2026-11-01T17:00:00.000Z"]);
  assert.deepEqual(show(calendarRange(null, "2026-10-23", null, now)), ["2026-10-22T17:00:00.000Z", "2026-10-23T17:00:00.000Z"]);
  assert.ok("error" in calendarRange(null, "2026-10-23", "2026-10-01", now));
});
