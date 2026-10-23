// Biên bản cuộc họp (bản mới): AI trả về JSON có cấu trúc → dựng Word + HTML cùng một bố cục.
// Bố cục theo mẫu người dùng chọn: Arial 10, tiêu đề đỏ có gạch chân, đề mục xanh đậm có đường kẻ, gạch đầu dòng thụt lề,
// bảng công việc nền xanh nhạt, chân trang "Trang x / y". Thuần (chỉ office.ts) để chạy được test.
import { zip } from "./office.ts";

export interface MinutePoint { text: string; sub: string[] }
export interface MinuteTopic { title: string; points: MinutePoint[] }
export interface MinuteTask { task: string; owner: string; due: string; note: string }
export interface Minutes { title: string; attendees: string[]; summary: string; topics: MinuteTopic[]; decisions: string[]; tasks: MinuteTask[]; open: string[] }
export interface MinutesHead { title: string; date: string; time: string; dur: string }

/** JSON của AI → Minutes sạch (bỏ dòng rỗng, cắt độ dài) — không tin cấu trúc model trả về. */
export function cleanMinutes(raw: unknown): Minutes {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max = 1200) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const list = (v: unknown, max = 60) => arr(v).map((x) => s(x)).filter(Boolean).slice(0, max);
  const topics = arr(o.topics).map((t) => {
    const x = (t || {}) as Record<string, unknown>;
    return { title: s(x.title, 200), points: arr(x.points).map((p) => { const y = (p || {}) as Record<string, unknown>; return { text: s(typeof p === "string" ? p : y.text), sub: list(y.sub, 40) }; }).filter((p) => p.text || p.sub.length).slice(0, 60) };
  }).filter((t) => t.title && t.points.length).slice(0, 40);
  const none = (v: unknown) => s(v, 200).replace(/\*\*/g, "") || "Chưa nêu";
  const tasks = arr(o.tasks).map((t) => { const x = (t || {}) as Record<string, unknown>; return { task: s(x.task, 400), owner: none(x.owner), due: none(x.due), note: s(x.note, 400) }; }).filter((t) => t.task).slice(0, 80);
  return { title: s(o.title, 120), attendees: list(o.attendees, 30).map((a) => a.slice(0, 80)), summary: s(o.summary, 2000), topics, decisions: list(o.decisions), tasks, open: list(o.open) };
}

/** Đã có nội dung để làm biên bản chưa (tránh tài liệu trống). */
export const hasMinutes = (m: Minutes) => !!(m.summary || m.topics.length || m.decisions.length || m.tasks.length);

/** Chữ thuần của biên bản (lưu vào Tài liệu / tìm kiếm). */
export function minutesText(m: Minutes, h: MinutesHead) {
  const st = (t: string) => t.replace(/\*\*/g, "");
  const L = [`TÊN CUỘC HỌP: ${h.title}`, `Ngày họp: ${h.date} · ${h.time} (${h.dur})`, ...(m.attendees.length ? [`Thành phần: ${m.attendees.join(", ")}`] : []), ""];
  let n = 0;
  if (m.summary) L.push(`${roman(++n)}. TÓM TẮT ĐIỀU HÀNH`, st(m.summary), "");
  if (m.topics.length) { L.push(`${roman(++n)}. NỘI DUNG THẢO LUẬN`); m.topics.forEach((t, i) => { L.push(`${i + 1}. ${st(t.title)}`); for (const p of t.points) { if (p.text) L.push(`- ${st(p.text)}`); for (const x of p.sub) L.push(`  + ${st(x)}`); } }); L.push(""); }
  if (m.decisions.length) L.push(`${roman(++n)}. KẾT LUẬN VÀ QUYẾT ĐỊNH`, ...m.decisions.map((d) => `- ${st(d)}`), "");
  if (m.tasks.length) L.push(`${roman(++n)}. CÔNG VIỆC CẦN THỰC HIỆN`, ...m.tasks.map((t) => `- ${st(t.task)} · ${st(t.owner)} · ${st(t.due)}${t.note ? " · " + st(t.note) : ""}`), "");
  if (m.open.length) L.push(`${roman(++n)}. VẤN ĐỀ CHƯA CHỐT`, ...m.open.map((d) => `- ${st(d)}`));
  return L.join("\n").trim();
}

const roman = (n: number) => { let r = ""; for (const [v, s] of [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const) while (n >= v) { r += s; n -= v; } return r; };
const up = (t: string) => t.toLocaleUpperCase("vi-VN");
/** "**đậm**" → các đoạn [chữ, đậm?] */
const spans = (t: string): [string, boolean][] => String(t).split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((x) => (/^\*\*[^*]+\*\*$/.test(x) ? [x.slice(2, -2), true] : [x.replace(/\*\*/g, ""), false]));

/* ---------- HTML (trình xem, Tài liệu) ---------- */
const H = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const hi = (t: string) => spans(t).map(([x, b]) => (b ? `<strong>${H(x)}</strong>` : H(x))).join("");
export function minutesHtml(m: Minutes, h: MinutesHead) {
  let n = 0, o = `<h1 class="mm-t">TÊN CUỘC HỌP: ${H(up(h.title))}</h1><p class="mm-d">Ngày họp: ${H(h.date)} · ${H(h.time)} (${H(h.dur)})</p>`;
  if (m.attendees.length) o += `<p class="mm-d">Thành phần: ${H(m.attendees.join(", "))}</p>`;
  const sec = (t: string) => `<h2>${roman(++n)}. ${H(t)}</h2>`;
  const ul = (a: string[], strong = false) => `<ul>${a.map((x) => `<li>${strong ? `<strong>${H(x.replace(/\*\*/g, ""))}</strong>` : hi(x)}</li>`).join("")}</ul>`;
  if (m.summary) o += sec("TÓM TẮT ĐIỀU HÀNH") + `<p class="mm-b">${hi(m.summary)}</p>`;
  if (m.topics.length) {
    o += sec("NỘI DUNG THẢO LUẬN");
    m.topics.forEach((t, i) => { o += `<h3>${i + 1}. ${hi(t.title)}</h3><ul>${t.points.map((p) => `<li>${hi(p.text)}${p.sub.length ? `<ul>${p.sub.map((x) => `<li>${hi(x)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>`; });
  }
  if (m.decisions.length) o += sec("KẾT LUẬN VÀ QUYẾT ĐỊNH") + ul(m.decisions, true);
  if (m.tasks.length) o += sec("CÔNG VIỆC CẦN THỰC HIỆN") + `<table><thead><tr><th>Công việc</th><th>Phụ trách</th><th>Hạn hoàn thành</th><th>Ghi chú</th></tr></thead><tbody>${m.tasks.map((t) => `<tr><td>${hi(t.task)}</td><td>${hi(t.owner)}</td><td>${hi(t.due)}</td><td>${hi(t.note)}</td></tr>`).join("")}</tbody></table>`;
  if (m.open.length) o += sec("VẤN ĐỀ CHƯA CHỐT") + ul(m.open);
  return o;
}

/* ---------- DOCX ---------- */
const X = (s: unknown) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', NS = "http://schemas.openxmlformats.org/";
const W = `xmlns:w="${NS}wordprocessingml/2006/main" xmlns:r="${NS}officeDocument/2006/relationships"`;
const NAVY = "1F2A44";
const r = (t: string, b = false, color = "") => (t ? `<w:r>${b || color ? `<w:rPr>${b ? "<w:b/><w:bCs/>" : ""}${color ? `<w:color w:val="${color}"/>` : ""}</w:rPr>` : ""}<w:t xml:space="preserve">${X(t)}</w:t></w:r>` : "");
const rich = (t: string, allBold = false, color = "") => spans(t).map(([x, b]) => r(x, allBold || b, color)).join("");
const p = (style: string, inner: string, extra = "") => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${inner}</w:p>`;
const li = (inner: string, lvl = 0) => p("ListParagraph", inner, `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="1"/></w:numPr>`);
const sty = (id: string, name: string, ppr: string, rpr = "", custom = false) => `<w:style w:type="paragraph"${custom ? ' w:customStyle="1"' : ""} w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${ppr}</w:pPr>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}</w:style>`;
const STYLES = `${XML}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="vi-VN" w:eastAsia="vi-VN" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="336" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
  + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
  + sty("MeetingTitle", "Meeting Title", '<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="C00000"/></w:pBdr><w:spacing w:before="0" w:after="160" w:line="276" w:lineRule="auto"/>', '<w:b/><w:bCs/><w:color w:val="C00000"/><w:sz w:val="26"/><w:szCs w:val="26"/>', true)
  + sty("MeetingDate", "Meeting Date", '<w:spacing w:before="0" w:after="60"/>', '<w:i/><w:iCs/><w:color w:val="595959"/><w:sz w:val="19"/><w:szCs w:val="19"/>', true)
  + sty("Heading1", "heading 1", `<w:keepNext/><w:keepLines/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="3" w:color="A6A6A6"/></w:pBdr><w:spacing w:before="360" w:after="140" w:line="276" w:lineRule="auto"/><w:outlineLvl w:val="0"/>`, `<w:b/><w:bCs/><w:color w:val="${NAVY}"/><w:sz w:val="24"/><w:szCs w:val="24"/>`)
  + sty("Heading2", "heading 2", '<w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="80" w:line="276" w:lineRule="auto"/><w:outlineLvl w:val="1"/>', `<w:b/><w:bCs/><w:color w:val="${NAVY}"/><w:sz w:val="22"/><w:szCs w:val="22"/>`)
  + sty("BodyText", "Body Text", '<w:spacing w:before="0" w:after="120" w:line="336" w:lineRule="auto"/><w:ind w:firstLine="567"/><w:jc w:val="both"/>')
  + sty("ListParagraph", "List Paragraph", '<w:spacing w:before="0" w:after="60" w:line="324" w:lineRule="auto"/><w:jc w:val="both"/>')
  + sty("TableText", "Table Text", '<w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/>', '<w:sz w:val="19"/><w:szCs w:val="19"/>', true)
  + sty("Footer", "footer", '<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="BFBFBF"/></w:pBdr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/>', '<w:color w:val="7F7F7F"/><w:sz w:val="16"/><w:szCs w:val="16"/>')
  + "</w:styles>";
const BUL = (i: number, t: string, left: number) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${t}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="283"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:hint="default"/></w:rPr></w:lvl>`;
const NUMBERING = `${XML}<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${BUL(0, "•", 567)}${BUL(1, "–", 1021)}${BUL(2, "◦", 1475)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
const FOOTER = `${XML}<w:ftr ${W}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t xml:space="preserve">Trang </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> / </w:t></w:r><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
const REL = (t: string, id: string, target: string) => `<Relationship Id="${id}" Type="${NS}officeDocument/2006/relationships/${t}" Target="${target}"/>`;
const rels = (body: string) => `${XML}<Relationships xmlns="${NS}package/2006/relationships">${body}</Relationships>`;

function table(rows: string[][], cols = [3175, 1587, 1134, 3175]) {
  const cell = (t: string, w: number, head: boolean) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="DCE3EF"/><w:vAlign w:val="center"/>' : '<w:vAlign w:val="top"/>'}</w:tcPr>${p("TableText", head ? r(t, true, NAVY) : rich(t))}</w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9071" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${cols.map((c) => `<w:gridCol w:w="${c}"/>`).join("")}</w:tblGrid>`
    + rows.map((row, i) => `<w:tr><w:trPr><w:cantSplit/>${i ? "" : "<w:tblHeader/>"}</w:trPr>${cols.map((w, c) => cell(row[c] ?? "", w, !i)).join("")}</w:tr>`).join("") + "</w:tbl>";
}

/** Bộ dựng đoạn / bảng theo kiểu chữ của mẫu (dùng lại cho báo cáo Kiểm thử). */
export const docKit = { r, rich, p, li, table };
/** Gói .docx với kiểu chữ / đánh số / chân trang của mẫu. */
export function styledDocx(body: string) {
  return zip({
    "[Content_Types].xml": `${XML}<Types xmlns="${NS}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`,
    "_rels/.rels": rels(REL("officeDocument", "rId1", "word/document.xml")),
    "word/_rels/document.xml.rels": rels(REL("styles", "rId1", "styles.xml") + REL("numbering", "rId2", "numbering.xml") + REL("footer", "rId3", "footer1.xml")),
    "word/document.xml": `${XML}<w:document ${W}><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    "word/styles.xml": STYLES, "word/numbering.xml": NUMBERING, "word/footer1.xml": FOOTER,
  });
}

export function minutesDocx(m: Minutes, h: MinutesHead) {
  let n = 0, o = p("MeetingTitle", r(`TÊN CUỘC HỌP: ${up(h.title)}`)) + p("MeetingDate", r(`Ngày họp: ${h.date} · ${h.time} (${h.dur})`));
  if (m.attendees.length) o += p("MeetingDate", r(`Thành phần: ${m.attendees.join(", ")}`));
  o += p("Normal", "", '<w:spacing w:after="0" w:line="120" w:lineRule="exact"/>');
  const sec = (t: string) => p("Heading1", r(`${roman(++n)}. ${t}`));
  if (m.summary) o += sec("TÓM TẮT ĐIỀU HÀNH") + p("BodyText", rich(m.summary));
  if (m.topics.length) {
    o += sec("NỘI DUNG THẢO LUẬN");
    m.topics.forEach((t, i) => { o += p("Heading2", r(`${i + 1}. ${t.title.replace(/\*\*/g, "")}`)); for (const x of t.points) { if (x.text) o += li(rich(x.text)); for (const s of x.sub) o += li(rich(s), x.text ? 1 : 0); } });
  }
  if (m.decisions.length) o += sec("KẾT LUẬN VÀ QUYẾT ĐỊNH") + m.decisions.map((d) => li(rich(d, true))).join("");
  if (m.tasks.length) o += sec("CÔNG VIỆC CẦN THỰC HIỆN") + table([["Công việc", "Phụ trách", "Hạn hoàn thành", "Ghi chú"], ...m.tasks.map((t) => [t.task, t.owner, t.due, t.note])]) + p("Normal", "", '<w:spacing w:after="0"/>');
  if (m.open.length) o += sec("VẤN ĐỀ CHƯA CHỐT") + m.open.map((d) => li(rich(d))).join("");
  return styledDocx(o);
}

/** Bản gốc / bản dịch: cùng kiểu chữ với biên bản (tiêu đề đỏ, Arial), các đoạn căn đều. */
export function textDocx(kick: string, h: MinutesHead, text: string) {
  const body = p("MeetingTitle", r(`${kick}: ${up(h.title)}`)) + p("MeetingDate", r(`Ngày họp: ${h.date} · ${h.time} (${h.dur})`)) + p("Normal", "", '<w:spacing w:after="120"/>')
    + text.split(/\n+/).map((t) => t.trim()).filter(Boolean).map((t) => /^\[\d{1,2}:\d{2}(?::\d{2})?\]/.test(t) ? p("ListParagraph", r(t.slice(0, t.indexOf("]") + 1), true, "595959") + r(t.slice(t.indexOf("]") + 1))) : p("ListParagraph", r(t))).join("");
  return styledDocx(body);
}
