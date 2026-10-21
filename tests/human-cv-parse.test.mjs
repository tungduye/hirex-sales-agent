import assert from "node:assert/strict";
import test from "node:test";
import { applicationOf, cvFilter, emailKeys, learnCodes, mapCv, named, phoneKey, phoneKeys, recName } from "../src/modules/cvs/core/cv-parse.ts";

test("filter body for one block, up to today", () => {
  const body = cvFilter("CV_GOC", "2026-10-21");
  assert.equal(body.blockId, "CV_GOC"); assert.equal(body.endDate, "2026-10-21"); assert.equal(body.checkJob, "all"); assert.deepEqual(body.recerId, []);
});

test("phones and e-mails as match keys", () => {
  assert.equal(phoneKey("0901 234 567"), "84901234567");
  assert.equal(phoneKey("+84 901234567"), "84901234567");
  assert.equal(phoneKey("901234567"), "84901234567");
  assert.equal(phoneKey("12345"), null);
  assert.deepEqual(phoneKeys("0901234567, 0912345678 / 0901234567"), ["84901234567", "84912345678"]);
  assert.deepEqual(emailKeys("An <An.Nguyen@Gmail.com>; b@x.jp"), ["an.nguyen@gmail.com", "b@x.jp"]);
});

test("a CV row: field names in any case, codes named, raw kept, searchable", () => {
  const codes = new Map([[7222, "Brse/PM"], [24, "Hà Nội"]]);
  const cv = mapCv({ cvId: 6311, historyId: 9, userCode: "RE6311", cv_name: "Lê Duy An", phoneNumber: "0901234567", email: "an@mail.vn", cvPosition: "7222", cv_skill: "Java",
    cv_address: "24", statusCv2: "PV (Chưa chốt lịch)", recerId: { id: 188, name: "Vân Anh" }, history: "VTI, Border z", createdDate: "2026-06-11 10:00:00", note: "<b>BrSE N2</b>" }, codes);
  assert.equal(cv.cv_id, 6311); assert.equal(cv.history_id, 9); assert.equal(cv.code, "RE6311"); assert.equal(cv.name, "Lê Duy An");
  assert.equal(cv.position, "Brse/PM"); assert.equal(cv.location, "Hà Nội"); assert.equal(cv.status2, "PV (Chưa chốt lịch)");
  assert.equal(cv.recer_human_id, "188"); assert.equal(cv.recer_name, "Vân Anh"); assert.equal(cv.companies, "VTI, Border z");
  assert.equal(cv.human_created_at, "2026-06-11T03:00:00.000Z");
  assert.deepEqual(cv.phone_keys, ["84901234567"]); assert.deepEqual(cv.email_keys, ["an@mail.vn"]);
  assert.ok(cv.search_text.includes("le duy an") && cv.search_text.includes("border z") && cv.search_text.includes("84901234567"));
  assert.equal(cv.data.note, "<b>BrSE N2</b>");
  assert.equal(mapCv({ cvName: "Không có mã" }), null);
});

test("coded values: each part named, unknown kept", () => {
  assert.equal(named("7222,999", new Map([[7222, "Brse/PM"]])), "Brse/PM, 999");
  assert.equal(named(null, new Map()), null);
});

test("the real /cv row: nameCv, Rec = userId with name from empName, one row per company", () => {
  const codes = new Map([[11002, "CV gửi"], [7222, "Brse/PM"]]);
  const row = { cvId: 32538, historyId: 49104, nameCv: "Nguyễn Thế Quyền", phone: "0921655858", email: "quyen283hn@gmail.com", userId: 313, empName: "Rec nguồn: JP 1 Tiêu chuẩn: Cường J3",
    statusCv: 15001, statusCv2: 11002, positionId: 7222, partnerId: 25229, partnerName: "Monstarlab", updatedDate: "2026-10-19 14:49:14.537", changeStatus2Date: "2026-10-20 10:30:17.326", createdDateApplication: "2026-10-16 12:16:00.994" };
  const cv = mapCv(row, codes);
  assert.equal(cv.name, "Nguyễn Thế Quyền"); assert.equal(cv.recer_human_id, "313"); assert.equal(cv.recer_name, "Cường J3");
  assert.equal(cv.status2, "CV gửi"); assert.equal(cv.position, "Brse/PM"); assert.equal(cv.status1, "15001");
  assert.equal(cv.human_created_at, "2026-10-16T05:16:00.994Z");
  assert.deepEqual(applicationOf(row, codes), { history_id: 49104, partner_id: 25229, partner_name: "Monstarlab", status1: "15001", status2: "CV gửi", updated_at: "2026-10-19T07:49:14.537Z", status2_at: "2026-10-20T03:30:17.326Z" });
  assert.equal(recName("Cường J3"), "Cường J3"); assert.equal(recName(null), null);
});

test("code names learnt from the Tình trạng CV of the same application", () => {
  const rows = [{ cvId: 1, historyId: 10, statusCv2: 11002, statusCv: 15001, positionId: 7222, skillId: 10077 }, { cvId: 2, historyId: 11, statusCv2: 11002, positionId: 7222 }, { cvId: 3, historyId: 12, statusCv2: 11001 }];
  const items = [
    { raw: { historyId: 10 }, status: "CV gửi", statusCode: "AA", position: "Brse/PM", skill: "Other", code: "RE1" },
    { raw: { history_id: 11 }, status: "CV gửi", statusCode: null, position: "Brse/PM", skill: null, code: null },
  ];
  const learnt = learnCodes(rows, items);
  assert.deepEqual(Object.fromEntries([...learnt.names].map(([id, entry]) => [id, entry.name])), { 11002: "CV gửi", 15001: "AA", 7222: "Brse/PM", 10077: "Other" });
  assert.equal(learnt.names.get(11002).kind, "Tình trạng CV");
  assert.deepEqual([...learnt.userCodes], [[1, "RE1"]]);
});
