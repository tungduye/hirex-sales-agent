import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { buildDocx, docxFilename, markdownToBlocks } from "../src/modules/documents-out/core/docx.ts";
import { crc32 } from "../src/modules/documents-out/core/zip.ts";

/** Reads a ZIP made by zip.ts back into { path: text }. */
function unzip(buffer) {
  const files = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const packed = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extra;
    const data = inflateRawSync(buffer.subarray(start, start + packed));
    assert.equal(crc32(data), buffer.readUInt32LE(offset + 14), `crc ${name}`);
    files[name] = data.toString("utf8");
    offset = start + packed;
  }
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50, "end of central directory");
  return files;
}

test("markdown subset to blocks", () => {
  const blocks = markdownToBlocks("# JD BrSE\n\nMô tả **quan trọng** ở đây\nvẫn đoạn này\n\n## Yêu cầu\n- N2\n- 3 năm\n\n1. Vòng 1\n2. Vòng 2\n\n| Mục | Giá trị |\n|---|---|\n| Lương | 60M |");
  assert.deepEqual(blocks.map((block) => block.type), ["h1", "p", "h2", "ul", "ol", "table"]);
  assert.deepEqual(blocks[1].runs, [{ text: "Mô tả ", bold: false }, { text: "quan trọng", bold: true }, { text: " ở đây vẫn đoạn này", bold: false }]);
  assert.equal(blocks[5].rows.length, 2, "separator row dropped");
});

test("a valid Word package", () => {
  const buffer = buildDocx({ title: "JD BrSE", company: "Intalent Việt Nam", subtitle: "JD", createdAt: new Date("2026-10-20T10:00:00Z"),
    blocks: markdownToBlocks("## Yêu cầu\n- Tiếng Nhật N2 & <đọc hiểu>\n1. Một\n\n| A | B |\n|---|---|\n| 1 | 2 |") });
  const files = unzip(buffer);
  for (const name of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/header1.xml", "word/footer1.xml", "word/_rels/document.xml.rels", "docProps/core.xml"]) assert.ok(files[name], name);
  assert.match(files["word/document.xml"], /Tiếng Nhật N2 &amp; &lt;đọc hiểu&gt;/u);
  assert.match(files["word/document.xml"], /<w:pStyle w:val="Title"\/><\/w:pPr><w:r><w:rPr><\/w:rPr><w:t xml:space="preserve">JD BrSE/u, "title added when the text has none");
  assert.match(files["word/header1.xml"], /INTALENT VIỆT NAM/u);
  assert.match(files["word/footer1.xml"], /NUMPAGES/u);
  assert.match(files["word/numbering.xml"], /<w:num w:numId="3">/u, "each list gets its own numbering");
});

test("file names", () => {
  assert.equal(docxFilename("JD BrSE – Hà Nội (N2)"), "JD-BrSE-Ha-Noi-N2.docx");
  assert.equal(docxFilename("!!!"), "Tai-lieu.docx");
});

test("JD from the job board", async () => {
  const { jdMarkdown, cleanWrittenMarkdown } = await import("../src/modules/documents-out/core/jd.ts");
  const job = { code: "HCM_BRSE_03", title: "BrSE/PM", careerTrack: "BrSE", companyName: "Namitech", companyNamePublic: false, location: "Hồ Chí Minh", workMode: null,
    japaneseLevelMin: "N2", experienceMin: "3 năm", salaryRange: "60–70M gross", sellingPoints: "- Dự án ổn định\n- Onsite ngắn hạn", summary: "Làm cầu nối", requirements: null, interviewProcess: "2 vòng", jdLink: null };
  const hidden = jdMarkdown(job, { hideCompany: true, contact: null });
  assert.doesNotMatch(hidden, /Namitech/u);
  assert.match(hidden, /\| Mức lương \| 60–70M gross \|/u);
  assert.match(hidden, /## Điểm hấp dẫn\n\n- Dự án ổn định\n- Onsite ngắn hạn/u);
  assert.doesNotMatch(hidden, /Yêu cầu|Hình thức/u, "empty fields are left out");
  assert.match(jdMarkdown(job, { hideCompany: false, contact: "Mai – 0900" }), /# BrSE\/PM – Namitech[\s\S]*## Liên hệ/u);
  assert.equal(cleanWrittenMarkdown("```markdown\n# A\n```"), "# A");
});
