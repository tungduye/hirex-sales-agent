import { test } from "node:test";
import assert from "node:assert/strict";
import { isBotCall, parseLinkCode, splitZaloParts, stripBotCall, toZaloText } from "../src/modules/assistant/core/zalo-bot-text.ts";

test("called in a group by /tl or @name", () => {
  assert.equal(isBotCall("/tl hôm nay có gì?", "Kiều Trang"), true);
  assert.equal(isBotCall("@Kiều Trang chiến dịch thế nào", "Kiều Trang"), true);
  assert.equal(isBotCall("@kieu trang chien dich", "Kiều Trang"), true);
  assert.equal(isBotCall("mọi người ơi họp lúc 3h", "Kiều Trang"), false);
  assert.equal(isBotCall("@Soda nay anh có lịch gì", ["Kiều Trang", "Soda"]), true);
  assert.equal(stripBotCall("@Soda nay anh có lịch gì", ["Kiều Trang", "Soda"]), "nay anh có lịch gì");
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
  assert.equal(toZaloText("**Gấp**\n- [Mở Suối Nguồn](/inbox)", "https://app.hirexmkt.online/"), "Gấp\n• Mở Suối Nguồn: https://app.hirexmkt.online/inbox");
  assert.equal(toZaloText("• 31 hội thoại: [Suối Nguồn]( /inbox/all)", "https://app.hirexmkt.online"), "• 31 hội thoại: Suối Nguồn: https://app.hirexmkt.online/inbox/all");
});
test("long answers split at breaks", () => {
  const text = Array.from({ length: 10 }, (_, i) => `Đoạn ${i} ` + "x".repeat(500)).join("\n\n");
  const parts = splitZaloParts(text, 1800);
  assert.ok(parts.length >= 3 && parts.every((part) => part.length <= 1900));
});

test('confirmations from Zalo', async () => {
  const { parseConfirmation, describeProposals } = await import('../src/modules/assistant/core/zalo-bot-text.ts');
  assert.deepEqual(parseConfirmation('OK'), { decision: 'confirm', index: null });
  assert.deepEqual(parseConfirmation('ok 2'), { decision: 'confirm', index: 2 });
  assert.deepEqual(parseConfirmation('Xác nhận 1'), { decision: 'confirm', index: 1 });
  assert.deepEqual(parseConfirmation('Huỷ 1'), { decision: 'cancel', index: 1 });
  assert.deepEqual(parseConfirmation('hủy'), { decision: 'cancel', index: null });
  assert.equal(parseConfirmation('ok em gửi lại báo cáo'), null);
  const text = describeProposals([{ title: 'Tạo công việc', lines: ['Tiêu đề: Gọi lại'], expiresAt: '2026-10-20T08:15:00Z' }]);
  assert.match(text, /1\) Tạo công việc/);
  assert.match(text, /OK để em thực hiện/);
});
