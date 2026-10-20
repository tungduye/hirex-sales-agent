import { test } from "node:test";
import assert from "node:assert/strict";
import { isBotCall, parseLinkCode, splitZaloParts, stripBotCall, toZaloText } from "../src/modules/assistant/core/zalo-bot-text.ts";

test("called in a group by /tl or @name", () => {
  assert.equal(isBotCall("/tl hôm nay có gì?", "Kiều Trang"), true);
  assert.equal(isBotCall("@Kiều Trang chiến dịch thế nào", "Kiều Trang"), true);
  assert.equal(isBotCall("@kieu trang chien dich", "Kiều Trang"), true);
  assert.equal(isBotCall("mọi người ơi họp lúc 3h", "Kiều Trang"), false);
});
test("question without the call", () => {
  assert.equal(stripBotCall("/tl hôm nay có gì?", "Kiều Trang"), "hôm nay có gì?");
  assert.equal(stripBotCall("@Kiều Trang, chiến dịch thế nào", "Kiều Trang"), "chiến dịch thế nào");
});
test("link codes", () => {
  assert.equal(parseLinkCode(" 123456 "), "123456");
  assert.equal(parseLinkCode("/lienket 654321"), "654321");
  assert.equal(parseLinkCode("Liên kết 111222"), "111222");
  assert.equal(parseLinkCode("SĐT em 0912345678"), null);
});
test("plain Zalo text with full links", () => {
  assert.equal(toZaloText("**Gấp**\n- [Mở Suối Nguồn](/inbox)", "https://app.hirexmkt.online/"), "Gấp\n• Mở Suối Nguồn (https://app.hirexmkt.online/inbox)");
});
test("long answers split at breaks", () => {
  const text = Array.from({ length: 10 }, (_, i) => `Đoạn ${i} ` + "x".repeat(500)).join("\n\n");
  const parts = splitZaloParts(text, 1800);
  assert.ok(parts.length >= 3 && parts.every((part) => part.length <= 1900));
});
