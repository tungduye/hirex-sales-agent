// Word (.docx) files from a small Markdown subset: "# / ## / ###" headings, paragraphs, "- " bullets,
// "1. " numbered lists, "| a | b |" tables (first row = header) and **bold**. A simple letterhead
// (company name) in the header and "Trang x / y" in the footer. Pure; unit-tested (tests/docx.test.mjs).
import { zip } from "./zip.ts";

export type Inline = { text: string; bold: boolean };
export type Block =
  | { type: "h1" | "h2" | "h3" | "p"; runs: Inline[] }
  | { type: "ul" | "ol"; items: Inline[][] }
  | { type: "table"; rows: Inline[][][] };

export function inline(text: string): Inline[] {
  const runs: Inline[] = [];
  const parts = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/gu, "$1 ($2)").split(/(\*\*[^*]+\*\*)/u);
  for (const part of parts) {
    if (!part) continue;
    const bold = /^\*\*[^*]+\*\*$/u.test(part);
    const value = (bold ? part.slice(2, -2) : part).replace(/(^|[^*])\*([^*\s][^*]*)\*/gu, "$1$2").replace(/`([^`]*)`/gu, "$1");
    if (value) runs.push({ text: value, bold });
  }
  return runs;
}

export function markdownToBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { blocks.push({ type: "p", runs: inline(paragraph.join(" ")) }); paragraph = []; } };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trimEnd();
    const trimmed = line.trim();
    if (!trimmed || /^```/u.test(trimmed) || /^(-{3,}|\*{3,}|_{3,})$/u.test(trimmed)) { flush(); continue; }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(trimmed);
    if (heading) { flush(); blocks.push({ type: heading[1].length === 1 ? "h1" : heading[1].length === 2 ? "h2" : "h3", runs: inline(heading[2].replace(/#+$/u, "").trim()) }); continue; }
    const bullet = /^[-*•+]\s+(.*)$/u.exec(trimmed);
    const numbered = /^\d{1,3}[.)]\s+(.*)$/u.exec(trimmed);
    if (bullet || numbered) {
      flush();
      const type = bullet ? "ul" : "ol";
      const last = blocks[blocks.length - 1];
      const item = inline((bullet ?? numbered)![1]);
      if (last && last.type === type) last.items.push(item); else blocks.push({ type, items: [item] });
      continue;
    }
    if (/^\|.*\|$/u.test(trimmed)) {
      flush();
      const rows: Inline[][][] = [];
      while (index < lines.length && /^\|.*\|$/u.test(lines[index].trim())) {
        const cells = lines[index].trim().slice(1, -1).split("|").map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{2,}:?$/u.test(cell))) rows.push(cells.map(inline));
        index++;
      }
      index--;
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }
    paragraph.push(trimmed.replace(/^>\s?/u, ""));
  }
  flush();
  return blocks;
}

const escapeXml = (value: string) => value.replace(/[&<>"]/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]!)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, "");
const run = (item: Inline, extra = "") => `<w:r><w:rPr>${item.bold ? "<w:b/>" : ""}${extra}</w:rPr><w:t xml:space="preserve">${escapeXml(item.text)}</w:t></w:r>`;
const runs = (items: Inline[], extra = "") => items.map((item) => run(item, extra)).join("");
const para = (style: string | null, body: string, props = "") => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${props}</w:pPr>${body}</w:p>`;

export interface DocxInput { title: string; blocks: Block[]; company: string; subtitle?: string; createdAt: Date }

export function buildDocx(input: DocxInput): Buffer {
  const numbering: string[] = [];
  let numId = 1;
  const body: string[] = [];
  const startsWithTitle = input.blocks[0]?.type === "h1";
  if (!startsWithTitle) body.push(para("Title", run({ text: input.title, bold: false })));
  for (const block of input.blocks) {
    if (block.type === "h1") body.push(para("Title", runs(block.runs)));
    else if (block.type === "h2") body.push(para("Heading1", runs(block.runs)));
    else if (block.type === "h3") body.push(para("Heading2", runs(block.runs)));
    else if (block.type === "p") body.push(para(null, runs(block.runs)));
    else if (block.type === "ul" || block.type === "ol") {
      const id = ++numId;
      numbering.push(`<w:num w:numId="${id}"><w:abstractNumId w:val="${block.type === "ul" ? 0 : 1}"/>${block.type === "ol" ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ""}</w:num>`);
      for (const item of block.items) body.push(para("ListParagraph", runs(item), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`));
    } else if (block.type === "table") {
      const columns = Math.max(...block.rows.map((row) => row.length));
      const width = Math.floor(9360 / columns);
      const rows = block.rows.map((row, rowIndex) => `<w:tr>${Array.from({ length: columns }, (_, column) => {
        const cell = row[column] ?? [];
        const shade = rowIndex === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="DCE6F2"/>' : "";
        return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>${para(null, runs(cell, rowIndex === 0 ? "<w:b/>" : ""), '<w:spacing w:before="40" w:after="40"/>')}</w:tc>`;
      }).join("")}</w:tr>`).join("");
      const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`;
      body.push(`<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${rows}</w:tbl>`);
      body.push(para(null, ""));
    }
  }
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns}><w:body>${body.join("")}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1134" w:bottom="1134" w:left="1418" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const date = `${String(input.createdAt.getUTCDate()).padStart(2, "0")}/${String(input.createdAt.getUTCMonth() + 1).padStart(2, "0")}/${input.createdAt.getUTCFullYear()}`;
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${ns}><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="1F4E79"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="9354"/></w:tabs></w:pPr>${run({ text: input.company.toUpperCase(), bold: true }, '<w:color w:val="1F4E79"/><w:sz w:val="22"/>')}<w:r><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="18"/></w:rPr><w:tab/><w:t xml:space="preserve">${escapeXml(input.subtitle ?? "")}</w:t></w:r></w:p></w:hdr>`;
  const field = (code: string) => `<w:r><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="18"/></w:rPr><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`;
  const grey = (text: string) => `<w:r><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${ns}><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9354"/></w:tabs></w:pPr>${grey(`${input.company} · ${date}`)}<w:r><w:tab/></w:r>${grey("Trang ")}${field("PAGE")}${grey(" / ")}${field("NUMPAGES")}</w:p></w:ftr>`;
  const font = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="120" w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4E79"/><w:sz w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4E79"/><w:sz w:val="27"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
  const level = (format: string, text: string) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${format === "bullet" ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>' : ""}</w:lvl>`;
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${level("bullet", "")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${level("decimal", "%1.")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${numbering.join("")}</w:numbering>`;
  const iso = input.createdAt.toISOString().replace(/\.\d{3}Z$/u, "Z");
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(input.title)}</dc:title><dc:creator>${escapeXml(input.company)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created></cp:coreProperties>`],
    ["word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`],
    ["word/document.xml", document],
    ["word/styles.xml", styles],
    ["word/numbering.xml", numberingXml],
    ["word/header1.xml", header],
    ["word/footer1.xml", footer],
  ]);
}

/** "JD BrSE Hà Nội!" → "JD-BrSE-Ha-Noi.docx" (ASCII, safe on every system and in Zalo). */
export function docxFilename(title: string) {
  const base = title.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D")
    .replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "Tai-lieu";
  return `${base}.docx`;
}
