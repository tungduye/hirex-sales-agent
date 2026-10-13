import test from "node:test";
import assert from "node:assert/strict";
import { facebookProfileMessageTimestamp } from "../scripts/lib/facebook-profile-message-timestamp.mjs";

test("uses an exact provider datetime for Facebook Profile messages", () => {
  assert.deepEqual(facebookProfileMessageTimestamp({ datetime: "2026-10-13T03:15:00.000Z", fallback: "later" }), {
    occurredAt: "2026-10-13T03:15:00.000Z",
    verified: true,
  });
});

test("accepts Messenger unix timestamps in seconds and milliseconds", () => {
  assert.equal(facebookProfileMessageTimestamp({ unixTimestamp: "1791861300" }).occurredAt, "2026-10-13T03:15:00.000Z");
  assert.equal(facebookProfileMessageTimestamp({ unixTimestamp: "1791861300000" }).occurredAt, "2026-10-13T03:15:00.000Z");
});

test("marks fallback sync time as unverified", () => {
  assert.deepEqual(facebookProfileMessageTimestamp({ fallback: "2026-10-13T04:00:00.000Z" }), {
    occurredAt: "2026-10-13T04:00:00.000Z",
    verified: false,
  });
});
