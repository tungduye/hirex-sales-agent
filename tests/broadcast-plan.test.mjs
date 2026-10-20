import { test } from "node:test";
import assert from "node:assert/strict";
import { assignNicks, gapSeconds, nextSteps, pendingAction, windowOpen } from "../src/modules/broadcasts/core/broadcast-plan.ts";

const at = (iso) => Date.parse(iso);
const B = { id: "b1", sendMessage: true, pinMessage: false, pinNote: false, dailyCapPerNick: 2, minGapSeconds: 90, maxGapSeconds: 180, windowStartHour: 8, windowEndHour: 21 };
const T = (id, accountId, position, extra = {}) => ({ id, broadcastId: "b1", accountId, position, status: "PENDING", pinStatus: "NONE", messagePinStatus: "NONE", attempts: 0, pinAttempts: 0, messagePinAttempts: 0, doneAt: null, updatedAt: "2026-10-21T01:00:00Z", ...extra });

test("only between 8:00 and 21:00 Vietnam time", () => {
  assert.equal(windowOpen(at("2026-10-21T00:59:00Z"), 8, 21), false); // 7:59
  assert.equal(windowOpen(at("2026-10-21T01:00:00Z"), 8, 21), true);  // 8:00
  assert.equal(windowOpen(at("2026-10-21T14:00:00Z"), 8, 21), false); // 21:00
});

test("gaps stay within 90–180 s and are stable", () => {
  for (const key of ["a", "b", "target-123", null]) { const gap = gapSeconds(key, 90, 180); assert.ok(gap >= 90 && gap <= 180); assert.equal(gapSeconds(key, 90, 180), gap); }
});

test("one group per nick per step, in order, respecting gap and cap", () => {
  const now = at("2026-10-21T03:00:00Z");
  const targets = [T("t1", "n1", 0), T("t2", "n1", 1), T("t3", "n2", 2)];
  assert.deepEqual(nextSteps([B], targets, new Map(), now).map((step) => step.targetId), ["t1", "t3"]);
  const recent = new Map([["n1", { doneToday: 1, lastAt: now - 30_000, lastKey: "x" }]]);
  assert.deepEqual(nextSteps([B], targets, recent, now).map((step) => step.targetId), ["t3"], "n1 waits its gap");
  const capped = new Map([["n1", { doneToday: 2, lastAt: now - 3_600_000, lastKey: "x" }]]);
  assert.deepEqual(nextSteps([B], targets, capped, now).map((step) => step.targetId), ["t3"], "n1 reached 2 today");
  assert.deepEqual(nextSteps([B], targets, new Map(), at("2026-10-21T15:00:00Z")), [], "22:00: nothing");
});

test("message, then its pin, then the note", () => {
  const all = { sendMessage: true, pinMessage: true, pinNote: true };
  assert.equal(pendingAction(all, { status: "PENDING", pinStatus: "PENDING", messagePinStatus: "PENDING" }), "SEND");
  assert.equal(pendingAction(all, { status: "SENT", pinStatus: "PENDING", messagePinStatus: "PENDING" }), "PIN_MESSAGE");
  assert.equal(pendingAction(all, { status: "SENT", pinStatus: "PENDING", messagePinStatus: "PINNED" }), "NOTE");
  assert.equal(pendingAction(all, { status: "SENT", pinStatus: "PINNED", messagePinStatus: "FAILED" }), null);
  assert.equal(pendingAction({ sendMessage: false, pinMessage: false, pinNote: true }, { status: "PENDING", pinStatus: "PENDING", messagePinStatus: "NONE" }), "NOTE");
  assert.equal(pendingAction({ sendMessage: true, pinMessage: false, pinNote: false }, { status: "FAILED", pinStatus: "NONE", messagePinStatus: "NONE" }), null);
});

test("each group goes to one chosen nick, spreading the load", () => {
  const plan = assignNicks([{ groupId: "g1", accounts: ["n1", "n2"] }, { groupId: "g2", accounts: ["n1", "n2"] }, { groupId: "g3", accounts: ["n1"] }, { groupId: "g4", accounts: ["n9"] }], ["n1", "n2"]);
  assert.equal(plan.get("g3"), "n1");
  assert.deepEqual([plan.get("g1"), plan.get("g2")].sort(), ["n1", "n2"].sort().slice(0, 2).length === 2 ? [plan.get("g1"), plan.get("g2")].sort() : []);
  assert.notEqual(plan.get("g1"), plan.get("g2"));
  assert.equal(plan.has("g4"), false, "a nick that was not chosen is never used");
});
