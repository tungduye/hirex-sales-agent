import assert from "node:assert/strict";
import test from "node:test";
import { mapPartner, parsePartnerPage, partnerFilter, statusEntries } from "../src/modules/customers/core/partner-parse.ts";

test("đọc được các kiểu phản hồi của Human", () => {
  assert.equal(parsePartnerPage({ code: 200, data: [{ partnerId: 1 }] }).rows.length, 1);
  assert.deepEqual(parsePartnerPage({ code: 200, data: { content: [{ partnerId: 1 }, { partnerId: 2 }], totalElements: 9 } }).total, 9);
  assert.equal(parsePartnerPage([{ id: 3 }]).rows.length, 1);
  assert.throws(() => parsePartnerPage({ code: 401, message: "x" }));
  assert.throws(() => parsePartnerPage("<html>"));
});

test("lấy cột từ tên trường Human, đổi mã sang tên, giữ nguyên bản gốc", () => {
  const codes = new Map([[200223, "Hạng 1"], [200261, "Doing"], [24, "Hà Nội"]]);
  const row = mapPartner({ partner_id: 239577, partner_name: "Trusted AI", address: "24", rankJobId: 200223, rateAmId: 200461, rateAmId2: 200261, amId: 233, saleId: 94,
    allCv: 23, allCvSent: 9, typePartner: "B1. Leader_Chờ nhiệm thu", created_by: "TriSA27", other1: "x",
    statusNew: "2026-09-07: TriSA27 -  - Data Sale - Trusted AI\n2026-09-17: MaiSA79 <p><strong>Đã gửi lại HĐ</strong></p>" }, codes);
  assert.equal(row.name, "Trusted AI");
  assert.equal(row.location, "Hà Nội");
  assert.equal(row.job_rank, "Hạng 1");
  assert.equal(row.am_rank, "Mã 200461");
  assert.equal(row.am_rank2, "Doing");
  assert.deepEqual(row.am_ranks, ["Mã 200461", "Doing"]);
  assert.deepEqual(mapPartner({ partner_id: 1, rateAmId: "200261,null,200261" }, codes).am_ranks, ["Doing"]);
  assert.equal(row.am_human_id, "233");
  assert.equal(row.sale_human_id, "94");
  assert.equal(row.cv_sent, 9);
  assert.equal(row.project_rank, "B1. Leader_Chờ nhiệm thu");
  assert.equal(row.last_note, "MaiSA79: Đã gửi lại HĐ");
  assert.equal(row.last_note_at, "2026-09-17");
  assert.equal(row.data.other1, "x");
  assert.match(row.search_text, /trusted ai/);
  assert.equal(mapPartner({ name: "không có mã" }), null);
});

test("tách nhật ký status của Human", () => {
  const entries = statusEntries("2026-09-07: TriSA27 -  - Data Sale - Trusted AI\n2026-09-16: MaiSA79 <p><span style=\"color: red\"><strong>AM đã gửi chào 3 UV</strong></span></p>");
  assert.deepEqual(entries, [{ date: "2026-09-07", author: "TriSA27", text: "Data Sale - Trusted AI" }, { date: "2026-09-16", author: "MaiSA79", text: "AM đã gửi chào 3 UV" }]);
});

test("bộ lọc gửi đúng khối", () => assert.equal(partnerFilter(36310).blockId, "36310"));

test("đọc Tình trạng CV theo từng danh sách", async () => {
  const { parseCvReport, cvReportCounts } = await import("../src/modules/customers/core/partner-parse.ts");
  const report = { code: 200, type: "ok", data: {
    sentList: [{ cvName: "Lê Văn A", userCode: "RE6980", cvPosition: "Brse/PM", cvSkill: "Other", cvAddress: "24", statusCv: "AB", statusCv2: "CV gửi", updateDate: "2026-10-06T03:00:00Z", history: "Trusted AI, VTI*" }],
    waitingList: [{ cvName: "B", updateDate: "2026-10-01T00:00:00Z" }, { cvName: "C", updateDate: "2026-10-05T00:00:00Z" }],
    falseList: [] } };
  const lists = parseCvReport(report);
  assert.deepEqual(lists.map((list) => list.label), ["CV chờ gửi", "CV đã gửi", "CV fail"]);
  assert.equal(lists[0].items[0].name, "C");
  assert.deepEqual(lists[1].items[0].companies, ["Trusted AI", "VTI*"]);
  assert.deepEqual(cvReportCounts(report), { report_waiting: 2, report_sent: 1, report_failed: 0 });
  assert.equal(cvReportCounts(null), null);
});
