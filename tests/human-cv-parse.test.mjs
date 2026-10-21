import assert from "node:assert/strict";
import test from "node:test";
import { cvFilter, emailKeys, mapCv, named, phoneKey, phoneKeys } from "../src/modules/cvs/core/cv-parse.ts";

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
