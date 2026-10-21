// node --test moduleHS/record/office.test.mjs — Word/Excel của Cuộc họp (thuần, không cần mạng).
import { test } from "node:test";
import assert from "node:assert/strict";
import { docx, xlsx, docxText, xlsxText, docxOutline, fillDocx, fillXlsx, xlsxSheets, cleanHtml, unzip } from "./office.ts";

test("docx: biên bản từ HTML, đánh số mục, bảng", () => {
  const b = docx({ title: "Biên bản cuộc họp", sub: "Giao ban", lines: ["Ngày họp: 21/10/2026"], html: "<h2>Thành phần</h2><p><strong>A</strong>, B</p><h2>Phân công</h2><table><tr><th>Việc</th><th>Ai</th></tr><tr><td>X</td><td>A</td></tr></table>" });
  const t = docxText(b);
  assert.match(t, /BIÊN BẢN CUỘC HỌP/); assert.match(t, /I\. Thành phần/); assert.match(t, /II\. Phân công/); assert.match(t, /Việc\s+Ai/);
});
test("cleanHtml: bỏ thẻ lạ và tiêu đề trùng", () => {
  assert.equal(cleanHtml('<h2>BIÊN BẢN CUỘC HỌP</h2><div class="x"><p>a</p><script>x</script></div>'), "<p>a</p>");
});
test("xlsx: bảng + công thức, đọc lại được", () => {
  const b = xlsx([{ name: "Việc", rows: [["Việc", "Số"], ["A", 2], ["Tổng", "=SUM(B2:B2)"]] }]);
  assert.deepEqual(xlsxSheets(b)[0].rows, [["Việc", "Số"], ["A", 2], ["Tổng", "=SUM(B2:B2)"]]);
  assert.match(xlsxText(b), /\[Sheet: Việc\]/);
});
test("fillDocx: thay chữ đoạn, chèn khối sau đoạn, giữ phần còn lại", () => {
  const tpl = docx({ title: "Mẫu", text: "Thời gian: ....\nNội dung:\nChữ ký" });
  const o = docxOutline(tpl); assert.match(o, /\[\d+\] Thời gian: \.\.\.\./);
  const p = +/\[(\d+)\] Thời gian/.exec(o)[1], q = +/\[(\d+)\] Nội dung/.exec(o)[1];
  const t = docxText(fillDocx(tpl, [{ p, text: "Thời gian: <strong>9h</strong>" }, { p: q, after: "<p>Đã chốt</p>" }]));
  assert.match(t, /Thời gian: 9h\nNội dung:\nĐã chốt\nChữ ký/);
});
test("fillXlsx: ghi ô, giữ ô cũ, bỏ calcChain", () => {
  const tpl = xlsx([{ name: "S", rows: [["Việc", "Ai"]] }]);
  const out = fillXlsx(tpl, [{ sheet: "S", ref: "A2", v: "Làm X" }, { sheet: "s", ref: "B2", v: 5 }, { ref: "bad", v: 1 }]);
  assert.deepEqual(xlsxSheets(out)[0].rows, [["Việc", "Ai"], ["Làm X", 5]]);
  assert.ok(!unzip(out).has("xl/calcChain.xml"));
});
