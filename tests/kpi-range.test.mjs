import { test } from "node:test";
import assert from "node:assert/strict";
import { kpiRange } from "../src/modules/assistant/core/kpi-range.ts";

// Tuesday 2026-10-20 09:00 in Vietnam = 02:00 UTC.
const NOW = Date.parse("2026-10-20T02:00:00Z");
const iso = (range) => [range.from.toISOString(), range.to.toISOString(), range.label];

test("ready-made periods in Vietnam time", () => {
  assert.deepEqual(iso(kpiRange("HOM_NAY", null, null, NOW)), ["2026-10-19T17:00:00.000Z", "2026-10-20T17:00:00.000Z", "20/10/2026"]);
  assert.deepEqual(iso(kpiRange("HOM_QUA", null, null, NOW)).slice(2), ["19/10/2026"]);
  assert.deepEqual(iso(kpiRange("TUAN_NAY", null, null, NOW)).slice(2), ["19/10/2026 – 20/10/2026"]);
  assert.deepEqual(iso(kpiRange("TUAN_TRUOC", null, null, NOW)).slice(2), ["12/10/2026 – 18/10/2026"]);
  assert.deepEqual(iso(kpiRange("THANG_TRUOC", null, null, NOW)).slice(2), ["01/09/2026 – 30/09/2026"]);
  assert.deepEqual(iso(kpiRange(null, null, null, NOW)).slice(2), ["14/10/2026 – 20/10/2026"]);
  assert.deepEqual(iso(kpiRange("30_NGAY", null, null, NOW)).slice(2), ["21/09/2026 – 20/10/2026"]);
});

test("a late evening in Vietnam is still the same day", () => {
  const late = Date.parse("2026-10-20T16:30:00Z"); // 23:30 Vietnam
  assert.equal(kpiRange("HOM_NAY", null, null, late).label, "20/10/2026");
});

test("explicit dates", () => {
  assert.deepEqual(iso(kpiRange(null, "2026-10-01", "2026-10-15", NOW)), ["2026-09-30T17:00:00.000Z", "2026-10-15T17:00:00.000Z", "01/10/2026 – 15/10/2026"]);
  assert.equal(kpiRange(null, "2026-10-01", null, NOW).label, "01/10/2026 – 20/10/2026");
  assert.ok("error" in kpiRange(null, "2026-10-15", "2026-10-01", NOW));
  assert.ok("error" in kpiRange(null, "2026-02-30", null, NOW));
  assert.ok("error" in kpiRange(null, "2024-01-01", "2026-10-01", NOW));
});
