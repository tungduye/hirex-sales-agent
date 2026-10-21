import assert from "node:assert/strict";
import test from "node:test";
import { countBy, enteredAt, gatherCvs, humanTime, inRange, interviewRound, resolveBlocks, statusMatches, topValues } from "../src/modules/customers/core/customer-stats.ts";

const blocks = [{ block_id: 36310, name: "HĐ Khối Nhật" }, { block_id: 36309, name: "Hot Do IT" }, { block_id: 36308, name: "Hot Do Nhật" }, { block_id: 36307, name: "HĐ Khối IT" }];

test("blocks by name or code", () => {
  assert.equal(resolveBlocks(blocks, null), null);
  assert.deepEqual(resolveBlocks(blocks, "IT").map((block) => block.block_id), [36309, 36307]);
  assert.deepEqual(resolveBlocks(blocks, "ngành IT").map((block) => block.block_id), [36309, 36307]);
  assert.deepEqual(resolveBlocks(blocks, "hot do").map((block) => block.block_id), [36309, 36308]);
  assert.deepEqual(resolveBlocks(blocks, "Hot Do Nhat").map((block) => block.block_id), [36308]);
  assert.deepEqual(resolveBlocks(blocks, "36310").map((block) => block.block_id), [36310]);
  assert.deepEqual(resolveBlocks(blocks, "Sale"), []);
});

test("first day in a block, date ranges in Vietnam time", () => {
  assert.equal(enteredAt({ 36309: "2026-10-20T03:00:00Z", 36308: "2026-09-01T00:00:00Z" }, [36309, 36308]), "2026-09-01T00:00:00Z");
  assert.equal(enteredAt({ 36309: "2026-10-20T03:00:00Z" }, [36307]), null);
  assert.equal(humanTime("2026-10-21"), Date.parse("2026-10-20T17:00:00Z"));
  assert.equal(humanTime("2026-10-21 09:30:00"), Date.parse("2026-10-21T02:30:00Z"));
  assert.ok(inRange("2026-10-21 09:30:00", new Date("2026-10-20T17:00:00Z"), new Date("2026-10-21T17:00:00Z")));
  assert.ok(!inRange(null, new Date(0), null));
  assert.ok(inRange(null, null, null));
});

test("counts by Hạng in natural order, blanks last", () => {
  const row = (job_rank, block_ids = [36309]) => ({ partner_id: 1, name: "x", block_ids, project_rank: null, job_rank, am_ranks: [], location: null, sale_human_id: null, am_human_id: null, cv_total: 2, cv_sent: 1, cv_offer: 0, cv_done: 0 });
  const counted = countBy([row("Hạng 10"), row("Hạng 2"), row("Hạng 2"), row(null)], "HANG", new Map(), new Map());
  assert.deepEqual(counted.map((entry) => [entry.gia_tri, entry.so_cong_ty, entry.cv_tong]), [["Hạng 2", 2, 4], ["Hạng 10", 1, 2], ["(trống)", 1, 2]]);
  const byBlock = countBy([row("Hạng 1", [36309, 36307])], "KHOI", new Map([[36309, "Hot Do IT"], [36307, "HĐ Khối IT"]]), new Map());
  assert.deepEqual(byBlock.map((entry) => entry.gia_tri), ["HĐ Khối IT", "Hot Do IT"]);
});

test("interview rounds and status filters", () => {
  assert.equal(interviewRound("PV2 (Đã chốt lịch)"), "PV2");
  assert.equal(interviewRound("Phỏng vấn vòng 1"), "PV1");
  assert.equal(interviewRound("PV (Chưa chốt lịch)"), null);
  assert.ok(statusMatches("PV 2 - đã chốt", "PV2"));
  assert.ok(!statusMatches("PV1", "PV2"));
  assert.ok(statusMatches("PV (Chưa chốt lịch)", "chưa chốt"));
  assert.ok(statusMatches("bất kỳ", null));
});

test("CVs gathered from many reports; common skills", () => {
  const report = { data: { prList: [{ cv_name: "An", statusCv2: "PV2", interview_date: "2026-10-22 10:00:00", cv_skill: "Java, AWS" }], waitingList: [{ cvName: "Bình", cv_skill: "Java" }] } };
  const cvs = gatherCvs([{ partner_id: 7, name: "VTI", data: report }], ["PHONG_VAN", "CHO_GUI"]);
  assert.deepEqual(cvs.map((cv) => [cv.company, cv.kind, cv.item.name, cv.item.interviewAt]), [["VTI", "PHONG_VAN", "An", "2026-10-22 10:00:00"], ["VTI", "CHO_GUI", "Bình", null]]);
  assert.deepEqual(topValues(["Java, AWS", "java", null]), [{ gia_tri: "Java", so_cv: 2 }, { gia_tri: "AWS", so_cv: 1 }]);
});
