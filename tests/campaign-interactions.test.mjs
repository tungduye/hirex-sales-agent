import assert from "node:assert/strict";
import test from "node:test";
import { answerDelay, daysLeft, interestOf, keepRow, nameInCampaign, ownerLabel, parseInsights, progressHints, tally, transcript } from "../src/modules/campaigns/core/interactions.ts";

const row = (over = {}) => ({
  recipient_id: "r1", campaign_id: "c1", campaign_name: "MKT Tháng 10 (Tuấn Rec)", campaign_status: "RUNNING", owner_name: "204", campaign_type: "REC",
  channel_type: "ZALO", channel_account_id: "n1", conversation_id: "v1", contact_id: null, candidate_name: "Minh", replied_at: "2026-10-20T01:00:00Z",
  first_reply: "Lương bao nhiêu em?", owner_replied_at: null, owner_messages: 0, inbound_messages: 1, last_inbound_at: null, last_inbound_text: null,
  cv_file: null, rec_outcome: null, rec_step: null, interest: null, interest_reason: null, ...over,
});

test("owner: linked name, else the name in the campaign title, plus the code", () => {
  assert.equal(nameInCampaign("MKT Tháng 10 (Tuấn Rec)"), "Tuấn Rec");
  assert.equal(nameInCampaign("MKT Tháng 10 (Tùng Sale) IT"), "Tùng Sale");
  assert.equal(nameInCampaign("Không có tên"), null);
  assert.deepEqual(ownerLabel("204", "MKT (Tuấn Rec)", new Map()), { key: "204", label: "Tuấn Rec (#204)" });
  assert.deepEqual(ownerLabel("204", "MKT (Tuấn Rec)", new Map([["204", "Nguyễn Văn Tuấn"]])), { key: "204", label: "Nguyễn Văn Tuấn (#204)" });
  assert.equal(ownerLabel(null, "MKT (Hải REC)", new Map()).label, "Hải REC");
  assert.equal(ownerLabel(null, "MKT", new Map()).label, "Chưa ghi owner");
});

test("interest: Luồng Rec and CV files first, then the AI reading", () => {
  assert.equal(interestOf(row()), null);
  assert.equal(interestOf(row({ interest: "CHUA_RO" })), "CHUA_RO");
  assert.equal(interestOf(row({ interest: "KHONG_QUAN_TAM", cv_file: "CV.pdf" })), "QUAN_TAM");
  assert.equal(interestOf(row({ interest: "QUAN_TAM", rec_outcome: "NOT_INTERESTED" })), "KHONG_QUAN_TAM");
  assert.equal(interestOf(row({ rec_outcome: "NEED_OTHER_JOB" })), "QUAN_TAM");
});

test("tally and filters", () => {
  const rows = [
    row({ owner_replied_at: "2026-10-20T03:00:00Z", interest: "QUAN_TAM" }),
    row({ recipient_id: "r2", cv_file: "CV.pdf", owner_replied_at: "2026-10-20T02:00:00Z" }),
    row({ recipient_id: "r3", interest: "KHONG_QUAN_TAM" }),
    row({ recipient_id: "r4" }),
  ];
  const sum = tally(rows);
  assert.equal(sum.tuong_tac, 4); assert.equal(sum.owner_da_tra_loi, 2); assert.equal(sum.owner_chua_tra_loi, 2);
  assert.equal(sum.quan_tam, 2); assert.equal(sum.khong_quan_tam, 1); assert.equal(sum.ai_chua_doc, 1);
  assert.equal(sum.co_cv, 1); assert.equal(sum.ty_le_cv, "25.0%");
  assert.equal(rows.filter((item) => keepRow(item, "OWNER_CHUA_TRA_LOI")).length, 2);
  assert.equal(rows.filter((item) => keepRow(item, "DA_CO_CV")).length, 1);
  assert.equal(rows.filter((item) => keepRow(item, "CHUA_DOC")).length, 1);
  assert.equal(rows.filter((item) => keepRow(item, null)).length, 4);
});

test("answer delay wording", () => {
  assert.equal(answerDelay("2026-10-20T01:00:00Z", null), null);
  assert.equal(answerDelay("2026-10-20T01:00:00Z", "2026-10-20T01:35:00Z"), "sau 35 phút");
  assert.equal(answerDelay("2026-10-20T01:00:00Z", "2026-10-20T04:00:00Z"), "sau 3 giờ");
  assert.equal(answerDelay("2026-10-20T01:00:00Z", "2026-10-23T01:00:00Z"), "sau 3 ngày");
});

const progress = (over = {}) => ({ campaign_id: "c1", campaign_name: "MKT (Tuấn Rec)", campaign_status: "RUNNING", owner_name: "204", campaign_type: "REC", started_at: null,
  daily_limit: 100, channel_account_id: "n1", recipients: 1000, reached: 500, replied: 50, waiting: 500, failed: 0, unknown: 0, stopped: 0, messages_sent: 500, sent_24h: 70, sent_7d: 490, last_sent_at: "2026-10-21T01:00:00Z", ...over });

test("progress suggestions", () => {
  const nicks = new Map([["n1", { name: "Xuân Ly", status: "CONNECTED" }], ["n2", { name: "Flora", status: "DISCONNECTED" }]]);
  assert.equal(daysLeft(progress()), 8);
  assert.equal(daysLeft(progress({ sent_7d: 0 })), null);
  assert.equal(daysLeft(progress({ waiting: 0 })), 0);
  const now = Date.parse("2026-10-21T08:00:00Z");
  const hints = progressHints([
    progress(),
    progress({ campaign_id: "c2", channel_account_id: "n2", campaign_name: "MKT (Hải REC)" }),
    progress({ campaign_id: "c3", campaign_name: "MKT (Long Rec)", sent_24h: 0, sent_7d: 30, last_sent_at: "2026-10-19T08:00:00Z" }),
    progress({ campaign_id: "c4", campaign_name: "MKT (Dương Rec)", waiting: 20, reached: 300, replied: 3 }),
  ], nicks, new Map([["n1", 4]]), now);
  assert.match(hints[0], /Flora · MKT \(Hải REC\): nick đang mất kết nối/u);
  assert.match(hints.join("\n"), /Long Rec\): không gửi tin nào trong 24 giờ \(lần cuối 48 giờ trước\)/u);
  assert.match(hints.join("\n"), /Xuân Ly: 4 UV đã phản hồi nhưng chưa được trả lời/u);
  assert.match(hints.join("\n"), /Dương Rec\): sắp gửi hết/u);
  assert.match(hints.join("\n"), /Dương Rec\): tỉ lệ phản hồi 1\.0% thấp/u);
  assert.ok(hints.findIndex((hint) => /Long Rec/u.test(hint)) < hints.findIndex((hint) => /sắp gửi hết/u.test(hint)), "urgent first");
});

test("AI reading: transcript keeps the end; only asked ids, valid levels", () => {
  const chat = transcript([{ direction: "OUTBOUND", text: "Chào anh, em bên Intalent", files: [] }, { direction: "INBOUND", text: null, files: ["CV_Minh.pdf"] }, { direction: "INBOUND", text: "  ok   em ", files: [] }]);
  assert.equal(chat, "[Nick] Chào anh, em bên Intalent\n[Ứng viên] [gửi file: CV_Minh.pdf]\n[Ứng viên] ok em");
  assert.ok(transcript([{ direction: "INBOUND", text: "a".repeat(600), files: [] }, { direction: "INBOUND", text: "cuối", files: [] }], 100).endsWith("cuối"));
  const parsed = parseInsights(JSON.stringify({ ket_qua: [{ id: "r1", muc_do: "QUAN_TAM", ly_do: "Hỏi lương" }, { id: "x", muc_do: "QUAN_TAM", ly_do: "" }, { id: "r2", muc_do: "MAYBE", ly_do: "" }, { id: "r1", muc_do: "CHUA_RO", ly_do: "" }] }), ["r1", "r2"]);
  assert.deepEqual(parsed, [{ id: "r1", interest: "QUAN_TAM", reason: "Hỏi lương" }]);
  assert.deepEqual(parseInsights("not json", ["r1"]), []);
});
