// node --test moduleHS/record/minutes.test.mjs — biên bản (bản mới): làm sạch JSON của AI, dựng Word / HTML theo mẫu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanMinutes, hasMinutes, minutesDocx, minutesHtml, minutesText } from "./minutes.ts";
import { docxText, unzip } from "./office.ts";

const raw = { title: " Họp R&D ", attendees: ["Anh Dũng (CEO)", ""], summary: "Chốt **Suối Nguồn**.", topics: [{ title: "Suối Nguồn – tab", points: [{ text: "Đổi **Khác → Quan trọng**", sub: ["Tất cả", " "] }, { text: "", sub: [] }] }, { title: "", points: [{ text: "x", sub: [] }] }], decisions: ["Bỏ tab Khác"], tasks: [{ task: "Sửa tab", owner: "**Tùng**", due: "", note: "" }, { task: "", owner: "A", due: "B", note: "" }], open: [] };
const h = { title: "Họp R&D", date: "21/10/2026", time: "21:30 – 23:25", dur: "1 giờ 54 phút" };

test("cleanMinutes: bỏ mục rỗng, owner không đậm, hạn trống = Chưa nêu", () => {
  const m = cleanMinutes(raw);
  assert.equal(m.title, "Họp R&D"); assert.deepEqual(m.attendees, ["Anh Dũng (CEO)"]);
  assert.equal(m.topics.length, 1); assert.equal(m.topics[0].points.length, 1); assert.deepEqual(m.topics[0].points[0].sub, ["Tất cả"]);
  assert.deepEqual(m.tasks, [{ task: "Sửa tab", owner: "Tùng", due: "Chưa nêu", note: "" }]); assert.ok(hasMinutes(m)); assert.ok(!hasMinutes(cleanMinutes({})));
});
test("minutesDocx: tiêu đề, đánh số mục La Mã, bảng công việc, chân trang", () => {
  const m = cleanMinutes(raw), b = minutesDocx(m, h), t = docxText(b), z = unzip(b);
  assert.match(t, /TÊN CUỘC HỌP: HỌP R&D/); assert.match(t, /I\. TÓM TẮT ĐIỀU HÀNH/); assert.match(t, /II\. NỘI DUNG THẢO LUẬN/); assert.match(t, /1\. Suối Nguồn – tab/);
  assert.match(t, /III\. KẾT LUẬN VÀ QUYẾT ĐỊNH/); assert.match(t, /IV\. CÔNG VIỆC CẦN THỰC HIỆN/); assert.ok(!/VẤN ĐỀ CHƯA CHỐT/.test(t));
  assert.ok(z.has("word/footer1.xml")); assert.match(z.get("word/styles.xml").toString(), /C00000/);
});
test("minutesHtml / minutesText: in đậm, không lộ dấu **", () => {
  const m = cleanMinutes(raw), html = minutesHtml(m, h), txt = minutesText(m, h);
  assert.match(html, /<strong>Khác → Quan trọng<\/strong>/); assert.ok(!html.includes("**")); assert.ok(!txt.includes("**")); assert.match(txt, /Thành phần: Anh Dũng \(CEO\)/);
});
