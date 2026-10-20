import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignHealth } from "../src/modules/campaigns/domain/campaign-health.ts";

const now = Date.parse("2026-10-20T10:00:00Z");
const base = { status: "RUNNING", archivedAt: null, canSend: true, senderIssues: [], startedAt: "2026-10-16T04:00:00Z", lastSentAt: null, sent: 0, recipients: 361 };

test("flags a mailbox that needs reconnecting", () => {
  assert.equal(campaignHealth({ ...base, canSend: false, senderIssues: ["a@x.test"] }, now)?.text, "Hộp gửi cần kết nối lại");
});
test("flags a running campaign that never sent", () => {
  assert.equal(campaignHealth(base, now)?.text, "Chưa gửi được thư nào");
});
test("quiet when sending recently or finished", () => {
  assert.equal(campaignHealth({ ...base, sent: 10, lastSentAt: "2026-10-20T09:00:00Z" }, now), null);
  assert.equal(campaignHealth({ ...base, status: "COMPLETED" }, now), null);
  assert.equal(campaignHealth({ ...base, startedAt: "2026-10-20T09:00:00Z" }, now), null);
});
