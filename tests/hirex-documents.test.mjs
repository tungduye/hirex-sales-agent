import assert from "node:assert/strict";
import test from "node:test";
import { cleanFolder, documentTitle, latestRun, textToHtml } from "../src/modules/human-documents/core/hirex-documents.ts";

test("text becomes simple library HTML", () => {
  assert.equal(textToHtml("Quy trình <A>\nDòng 2\n\n- Bước 1\n- Bước 2\n\n1. Một\n2) Hai"), "<p>Quy trình &lt;A&gt;<br>Dòng 2</p>\n<ul><li>Bước 1</li><li>Bước 2</li></ul>\n<ol><li>Một</li><li>Hai</li></ol>");
});

test("folder and title", () => {
  assert.equal(cleanFolder(null), "Soda lưu");
  assert.equal(cleanFolder("  Quy trình/HR  "), "Quy trình - HR");
  assert.equal(documentTitle(" Quy trình onboard ", null, "x"), "Quy trình onboard");
  assert.equal(documentTitle(null, "Hop dong.docx", "x"), "Hop dong");
  assert.equal(documentTitle(null, null, "\n# Hướng dẫn gửi CV\nNội dung"), "Hướng dẫn gửi CV");
  assert.ok(documentTitle(null, null, "a".repeat(120)).endsWith("…"));
});

test("the document just sent: the newest run of messages close together", () => {
  const at = (minutes) => new Date(Date.parse("2026-10-21T07:00:00Z") + minutes * 60_000).toISOString();
  const run = latestRun([
    { id: "4", text: "phần 3", at: at(10), attachments: 0 },
    { id: "3", text: "phần 2", at: at(9.9), attachments: 0 },
    { id: "2", text: "phần 1", at: at(9.8), attachments: 0 },
    { id: "1", text: "câu hỏi cũ", at: at(0), attachments: 0 },
  ]);
  assert.deepEqual(run.map((message) => message.id), ["2", "3", "4"]);
  assert.deepEqual(latestRun([{ id: "1", text: " ", at: at(1), attachments: 0 }]), []);
  assert.deepEqual(latestRun([{ id: "f", text: null, at: at(1), attachments: 1 }]).map((message) => message.id), ["f"]);
});
