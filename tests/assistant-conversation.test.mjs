import { test } from "node:test";
import assert from "node:assert/strict";
import { cardStateFromStatus, conversationTitle, recencyGroup } from "../src/modules/assistant/core/assistant-conversation.ts";

test("title from the first question", () => {
  assert.equal(conversationTitle("  Các chiến dịch đang chạy thế nào?\nchi tiết"), "Các chiến dịch đang chạy thế nào?");
  assert.equal(conversationTitle(""), "Cuộc trò chuyện mới");
  assert.ok(conversationTitle("a".repeat(100)).length <= 60);
});
test("card state from the saved action", () => {
  assert.equal(cardStateFromStatus("EXECUTED"), "done");
  assert.equal(cardStateFromStatus("EXPIRED"), "cancelled");
  assert.equal(cardStateFromStatus("PROPOSED"), "pending");
});
test("recency groups in Vietnam time", () => {
  const now = Date.parse("2026-10-20T10:00:00+07:00");
  assert.equal(recencyGroup("2026-10-20T00:30:00+07:00", now), "Hôm nay");
  assert.equal(recencyGroup("2026-10-19T23:30:00+07:00", now), "Hôm qua");
  assert.equal(recencyGroup("2026-10-15T10:00:00+07:00", now), "7 ngày qua");
  assert.equal(recencyGroup("2026-08-01T10:00:00+07:00", now), "Cũ hơn");
});
