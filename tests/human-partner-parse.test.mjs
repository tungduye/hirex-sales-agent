import assert from "node:assert/strict";
import test from "node:test";
import { mapPartner, parsePartnerPage, partnerFilter } from "../src/modules/customers/core/partner-parse.ts";

test("đọc được các kiểu phản hồi của Human", () => {
  assert.equal(parsePartnerPage({ code: 200, data: [{ partnerId: 1 }] }).rows.length, 1);
  assert.deepEqual(parsePartnerPage({ code: 200, data: { content: [{ partnerId: 1 }, { partnerId: 2 }], totalElements: 9 } }).total, 9);
  assert.equal(parsePartnerPage([{ id: 3 }]).rows.length, 1);
  assert.throws(() => parsePartnerPage({ code: 401, message: "x" }));
  assert.throws(() => parsePartnerPage("<html>"));
});

test("lấy cột từ tên trường Human, giữ nguyên bản gốc", () => {
  const row = mapPartner({ partnerId: 42, name: "Công ty Ánh Dương", statusName: "Đang chăm", email: "hr@anhduong.vn", saleId: 7, saleName: "Hải", rateAmId: { id: 9, name: "Linh" }, other1: "x" });
  assert.equal(row.partner_id, 42);
  assert.equal(row.status, "Đang chăm");
  assert.equal(row.sale_human_id, "7");
  assert.equal(row.am_human_id, "9");
  assert.equal(row.am_name, "Linh");
  assert.equal(row.data.other1, "x");
  assert.match(row.search_text, /cong ty anh duong/);
  assert.equal(mapPartner({ name: "không có mã" }), null);
});

test("bộ lọc gửi đúng khối", () => assert.equal(partnerFilter(36310).blockId, "36310"));
