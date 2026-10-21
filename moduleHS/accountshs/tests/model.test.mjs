import { test } from "node:test";
import assert from "node:assert/strict";
import { DP, fold, hcls, rteText, attStr, fmtD } from "../core/text.ts";
import { buildIndex, emptyIndex, facet, getView, initialState, inScope, parseQ, scopeCalc, treeOrder, applyDelta, cellText } from "../core/model.ts";

/* Dữ liệu mẫu: 2 bộ phận, owner cha-con, 2 tab (Facebook ↔ Email liên kết) */
function sample() {
  const S = initialState();
  S.meta = {
    depts: [{ id: 1, name: "Sale", color: "#6366f1", pos: 1 }, { id: 2, name: "Ads", color: "#f59e0b", pos: 2 }],
    owners: [{ id: 10, dept_id: 1, parent_id: null, name: "Trưởng", color: "#667085", pos: 1 }, { id: 11, dept_id: 1, parent_id: 10, name: "Nhân viên", color: "#667085", pos: 2 }, { id: 20, dept_id: 2, parent_id: null, name: "Ads lead", color: "#667085", pos: 1 }],
    tabs: [
      { id: 100, name: "Facebook", icon: "facebook", color: "#667085", pos: 1, grp: "", lazy: 0, tint: 0,
        fields: [{ id: 1001, tab_id: 100, label: "UID", type: "text", opts: "", link_tab: null, pos: 1 }, { id: 1002, tab_id: 100, label: "Mật khẩu", type: "secret", opts: "", link_tab: null, pos: 2 }, { id: 1003, tab_id: 100, label: "Email xác minh", type: "link", opts: "", link_tab: 200, pos: 3 }, { id: 1004, tab_id: 100, label: "Ngày tạo", type: "date", opts: "", link_tab: null, pos: 4 }],
        statuses: [{ id: 1, tab_id: 100, label: "Live", color: "#10b981", pos: 1 }, { id: 2, tab_id: 100, label: "Die", color: "#ef4444", pos: 2 }] },
      { id: 200, name: "Email", icon: "mail", color: "#667085", pos: 2, grp: "", lazy: 0, tint: 0,
        fields: [{ id: 2001, tab_id: 200, label: "Email", type: "text", opts: "", link_tab: null, pos: 1 }], statuses: [{ id: 3, tab_id: 200, label: "Live", color: "#10b981", pos: 1 }] },
    ],
    grp_icons: {}, tab_keys: {},
  };
  S.accs = [
    { id: 1, tab_id: 100, dept_id: 1, owner_id: 11, status_id: 1, device_id: null, note: "<p>Ghi chú <b>đậm</b></p><p>dòng 2</p>", data: { 1001: "100001", 1002: "secret", 1004: "2026-01-15" }, created: 100, updated: 300 },
    { id: 2, tab_id: 100, dept_id: 1, owner_id: 10, status_id: 2, device_id: null, note: "", data: { 1001: "100002", 1004: "15/02/2026" }, created: 200, updated: 200 },
    { id: 3, tab_id: 100, dept_id: 2, owner_id: 20, status_id: 1, device_id: null, note: "", data: { 1001: "300003" }, created: 50, updated: 50 },
    { id: 4, tab_id: 200, dept_id: 1, owner_id: 11, status_id: 3, device_id: null, note: "", data: { 2001: "a@b.com" }, created: 10, updated: 10 },
  ];
  S.links = [{ id: 1, src: 1, dst: 4, f: 1003 }];
  const I = emptyIndex();
  buildIndex(S, I); scopeCalc(S, I);
  S.tab = 100;
  return { S, I };
}

test("fold/hcls/DP/rteText/attStr", () => {
  assert.equal(fold("Mật Khẩu Đăng nhập"), "mat khau dang nhap");
  assert.equal(hcls("#10b981"), "g"); assert.equal(hcls("#ef4444"), "b"); assert.equal(hcls("#f59e0b"), "w"); assert.equal(hcls("#d4d4d8"), "n");
  assert.equal(DP.parse("15/02/2026"), "2026-02-15"); assert.equal(DP.parse("2026-1-5"), "2026-01-05"); assert.equal(DP.parse("abc"), null);
  assert.equal(fmtD("2026-01-15"), "15/01/2026");
  assert.equal(rteText("<p>Ghi chú <b>đậm</b></p><p>dòng 2</p>"), "Ghi chú đậm\ndòng 2");
  assert.equal(attStr([{ id: "x", n: "a.pdf", s: 1, m: "", t: 0 }, { id: "y", n: "b.txt", s: 1, m: "", t: 0 }]), "a.pdf, b.txt");
});

test("buildIndex: nhãn, đường dẫn owner, liên kết đi/đến, đếm theo bộ phận", () => {
  const { S, I } = sample();
  assert.equal(I.acc[1].label, "100001"); assert.equal(I.acc[4].label, "a@b.com");
  assert.deepEqual(I.own[11].path, [10, 11]);
  assert.deepEqual(I.out[1][1003], [4]); assert.deepEqual(I.inn[4], [{ src: 1, f: 1003 }]);
  assert.equal(I.deptN[1], 3); assert.equal(I.sub[10], 3);
  assert.deepEqual(treeOrder(I, 1).map((x) => [x.o.id, x.d]), [[10, 0], [11, 1]]);
  S.dept = 1; S.owner = 10; S.sub = true; scopeCalc(S, I);
  assert.equal(inScope(S, I, I.acc[2]), true); assert.equal(inScope(S, I, I.acc[3]), false);
  S.sub = false; scopeCalc(S, I); assert.equal(inScope(S, I, I.acc[1]), false);
});

test("parseQ + getView: tìm cú pháp, loại trừ, lọc trạng thái, sắp xếp", () => {
  const { S, I } = sample();
  assert.deepEqual(parseQ(S, 'uid:1000 -die "ghi chu"'), [{ neg: false, k: [1001], t: "1000" }, { neg: true, k: null, t: "die" }, { neg: false, k: null, t: "ghi chu" }]);
  assert.deepEqual(getView(S, I).map((a) => a.id), [2, 1, 3]);              // mặc định: mới tạo trước; phạm vi "all" gồm cả bộ phận 2
  S.dept = 1; scopeCalc(S, I); assert.deepEqual(getView(S, I).map((a) => a.id), [2, 1]);
  S.dept = "all"; scopeCalc(S, I);
  S.q = "-die"; assert.deepEqual(getView(S, I).map((a) => a.id), [1, 3]);
  S.q = "email:a@b"; assert.deepEqual(getView(S, I).map((a) => a.id), [1]);  // tìm theo trường liên kết (nhãn dòng đích)
  S.q = ""; S.st = new Set([2]); assert.deepEqual(getView(S, I).map((a) => a.id), [2]);
  S.st.clear(); S.sort = { 100: { k: 1001, d: -1 } }; assert.deepEqual(getView(S, I).map((a) => a.id), [3, 2, 1]);
  S.sort = {}; S.fl = { 100: [{ k: 1004, op: "range", v: ["2026-02-01", "2026-12-31"] }] };
  assert.deepEqual(getView(S, I).map((a) => a.id), [2]);
  S.fl = { 100: [{ k: "owner", op: "in", v: ["Nhân viên"] }] }; assert.deepEqual(getView(S, I).map((a) => a.id), [1]);
  S.fl = {}; const m = facet(S, I, "status"); assert.equal(m.get("Live"), 2); assert.equal(m.get("Die"), 1);
  assert.equal(cellText(S, I, I.acc[1], 1003), "a@b.com"); assert.equal(cellText(S, I, I.acc[1], "note"), "Ghi chú đậm dòng 2");
});

test("applyDelta: cập nhật/thêm/xoá dòng và liên kết liên quan", () => {
  const { S, I } = sample();
  applyDelta(S, { accounts: [{ ...S.accs[0], note: "x", updated: 999 }, { id: 9, tab_id: 100, dept_id: 1, owner_id: null, status_id: 1, device_id: null, note: "", data: { 1001: "9" }, created: 1, updated: 1 }], links: [{ id: 5, src: 9, dst: 4, f: 1003 }], deleted: [2] });
  assert.equal(S.accs.find((a) => a.id === 1).note, "x"); assert.equal(S.accs.some((a) => a.id === 2), false); assert.equal(S.accs.some((a) => a.id === 9), true);
  assert.deepEqual(S.links.map((l) => l.id).sort(), [5]);                      // liên kết của dòng 1 (đã chạm) bị thay bằng danh sách mới
  buildIndex(S, I); assert.equal(I.acc[9].label, "9");
});
