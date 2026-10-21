// Word/Excel cho Cuộc họp: tạo .docx/.xlsx, đọc chữ trong file mẫu, ĐIỀN THẲNG vào file mẫu (giữ logo, đầu/chân trang, style).
// Thao tác thẳng trên XML của OOXML, vì điền mẫu phải giữ nguyên từng đoạn/ô của file gốc (exceljs/docx sẽ dựng lại file).
// Thuần (chỉ node:zlib) để chạy được test.
import zlib from "node:zlib";

/* ---------- ZIP tối giản ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(files: Record<string, string | Buffer>): Buffer {
  const out: Buffer[] = [], cen: Buffer[] = []; let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const raw = Buffer.from(data), def = zlib.deflateRawSync(raw), n = Buffer.from(name), crc = crc32(raw);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(0x5c21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(def.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0x5c21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(def.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    out.push(h, n, def); cen.push(c, n); off += 30 + n.length + def.length;
  }
  const cd = Buffer.concat(cen), end = Buffer.alloc(22), k = cen.length / 2;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(k, 8); end.writeUInt16LE(k, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...out, cd, end]);
}
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>(); let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) return out;
  let p = buf.readUInt32LE(e + 16);
  for (let n = buf.readUInt16LE(e + 10); n > 0 && buf.readUInt32LE(p) === 0x02014b50; n--) {
    const method = buf.readUInt16LE(p + 10), cs = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl), ds = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), raw = buf.subarray(ds, ds + cs);
    try { out.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw); } catch { /* bỏ qua mục hỏng */ }
    p += 46 + nl + xl + cl;
  }
  return out;
}

const X = (s: unknown) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const dec = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = "http://schemas.openxmlformats.org/";
const REL = (t: string, id: string, target: string) => `<Relationship Id="${id}" Type="${NS}officeDocument/2006/relationships/${t}" Target="${target}"/>`;
const rels = (body: string) => `${XML}<Relationships xmlns="${NS}package/2006/relationships">${body}</Relationships>`;
const NAVY = "000000";

/* ---------- HTML (tập thẻ hạn chế) → cây ---------- */
interface Node { n: string; c: (Node | string)[] }
export function cleanHtml(h: unknown) {
  return String(h || "").replace(/```(?:html)?/gi, "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<h1(\s[^>]*)?>([\s\S]*?)<\/h1>/gi, "<h2>$2</h2>")
    .replace(/<h[23](\s[^>]*)?>\s*(?:BIÊN\s*BẢN\s*CUỘC\s*HỌP|TÊN\s*CUỘC\s*HỌP)(?:\s*[:\-–—].*?)?\s*<\/h[23]>/gi, "")
    .replace(/<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi, (t, n: string) => /^(h2|h3|p|strong|em|s|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|hr|br)$/i.test(n) ? (t.startsWith("</") ? `</${n.toLowerCase()}>` : `<${n.toLowerCase()}>`) : "");
}
function parse(html: string): Node {
  const root: Node = { n: "root", c: [] }, st: Node[] = [root];
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)>|([^<]+)/gi)) {
    const top = st.at(-1)!;
    if (m[3] != null) top.c.push(dec(m[3]));
    else if (m[1]) { const i = st.findLastIndex((x) => x.n === m[2]); if (i > 0) st.length = i; }
    else if (m[2] === "hr" || m[2] === "br") top.c.push({ n: m[2], c: [] });
    else { const o: Node = { n: m[2], c: [] }; top.c.push(o); st.push(o); }
  }
  return root;
}

/* ---------- DOCX ---------- */
interface Fmt { b?: number; i?: number; s?: number; color?: string }
interface Run extends Fmt { v: string }
const run = (t: string, f: Fmt = {}) => (t ? `<w:r><w:rPr>${f.b ? "<w:b/>" : ""}${f.i ? "<w:i/>" : ""}${f.s ? "<w:strike/>" : ""}${f.color ? `<w:color w:val="${f.color}"/>` : ""}</w:rPr><w:t xml:space="preserve">${X(t)}</w:t></w:r>` : "");
const para = (inner: string, ppr = "") => `<w:p><w:pPr>${ppr}</w:pPr>${inner}</w:p>`;
const isNode = (x: Node | string): x is Node => typeof x !== "string";
const inl = (nodes: (Node | string)[], f: Fmt = {}): Run[] => nodes.flatMap((x) => !isNode(x) ? [{ v: x.replace(/\s+/g, " "), ...f }]
  : x.n === "strong" ? inl(x.c, { ...f, b: 1 }) : x.n === "em" ? inl(x.c, { ...f, i: 1 }) : x.n === "s" ? inl(x.c, { ...f, s: 1 })
  : /^(ul|ol|table)$/.test(x.n) ? [] : [...inl(x.c, f), ...(x.n === "p" ? [{ v: " ", ...f }] : [])]);
const runsXml = (rs: Run[], base: Fmt = {}) => {
  const a = rs.filter((r) => r.v); if (!a.length) return "";
  a[0] = { ...a[0], v: a[0].v.replace(/^\s+/, "") }; a[a.length - 1] = { ...a.at(-1)!, v: a.at(-1)!.v.replace(/\s+$/, "") };
  return a.map((r) => run(r.v, { b: r.b || base.b, i: r.i, s: r.s, color: base.color })).join("");
};
const plain = (n: (Node | string)[]) => inl(n).map((r) => r.v).join("").trim();
const roman = (n: number) => { let r = ""; for (const [v, s] of [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const) while (n >= v) { r += s; n -= v; } return r; };
interface Ctx { ol: number; nums: number[]; k?: number; plain?: number }

function docBody(root: Node, ctx: Ctx) {
  const W = 9071; let h2 = 0, h3 = 0, o = "";
  const list = (x: Node, lvl: number): string => {
    const num = x.n === "ol" ? ++ctx.ol + 1 : 1; if (x.n === "ol") { ctx.nums.push(num); ctx.k = 0; }
    let s = "";
    for (const li of x.c.filter((c): c is Node => isNode(c) && c.n === "li")) {
      const t = runsXml(inl(li.c)); if (t) s += ctx.plain ? para(run(x.n === "ol" ? `${(ctx.k = (ctx.k || 0) + 1)}. ` : "• ") + t, `<w:ind w:left="${360 * (lvl + 1)}" w:hanging="240"/><w:spacing w:after="40"/>`) : para(t, `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${num}"/></w:numPr>`);
      for (const sub of li.c.filter((c): c is Node => isNode(c) && (c.n === "ul" || c.n === "ol"))) s += list(sub, Math.min(lvl + 1, 2));
    }
    return s;
  };
  const table = (x: Node) => {
    const rows = x.c.flatMap((c) => !isNode(c) ? [] : c.n === "tr" ? [c] : c.c.filter((r): r is Node => isNode(r) && r.n === "tr")).map((r) => r.c.filter((c): c is Node => isNode(c) && (c.n === "td" || c.n === "th"))).filter((r) => r.length);
    const n = Math.max(0, ...rows.map((r) => r.length)); if (!n) return "";
    const w = Array.from({ length: n }, (_, c) => { const l = rows.filter((r) => r[c]).map((r) => Math.min(60, plain(r[c].c).length)); return Math.min(40, Math.max(8, l.reduce((a, b) => a + b, 0) / (l.length || 1))); });
    const tw = w.reduce((a, b) => a + b, 0), cols = w.map((v) => Math.max(900, Math.round((v / tw) * W))); cols[n - 1] += W - cols.reduce((a, b) => a + b, 0);
    const head = rows[0].some((c) => c.n === "th");
    return `<w:tbl><w:tblPr><w:tblW w:w="${W}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${cols.map((c) => `<w:gridCol w:w="${c}"/>`).join("")}</w:tblGrid>`
      + rows.map((r, ri) => { const H = head && !ri; return `<w:tr><w:trPr><w:cantSplit/>${H ? "<w:tblHeader/>" : ""}</w:trPr>${cols.map((cw, c) => { const cell = r[c], hd = H || cell?.n === "th"; return `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/>${hd ? '<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' : ""}</w:tcPr>${para(runsXml(inl(cell?.c || []), hd ? { b: 1, color: NAVY } : {}), '<w:spacing w:after="0"/>')}</w:tc>`; }).join("")}</w:tr>`; }).join("")
      + "</w:tbl>" + para("", '<w:spacing w:after="120" w:line="120" w:lineRule="exact"/>');
  };
  const strip2 = (t: string) => t.replace(/^\s*(?:[IVXLCDM]{1,6}|\d{1,2})\s*[.)\-–:](?!\d)\s*/, ""), strip3 = (t: string) => t.replace(/^\s*(?:\d{1,2}(?:\.\d{1,2})*|[A-Za-z])\s*[.)](?!\d)\s*/, "");
  for (const x of root.c) {
    if (!isNode(x)) { if (x.trim()) o += para(run(x.trim())); continue; }
    if (x.n === "h2") { h2++; h3 = 0; o += para(run(`${roman(h2)}. ${strip2(plain(x.c))}`, { b: 1, color: ctx.plain ? "" : NAVY }), ctx.plain ? '<w:keepNext/><w:spacing w:before="160" w:after="80"/>' : '<w:pStyle w:val="Heading1"/>'); }
    else if (x.n === "h3") { h3++; o += para(run(`${h3}. ${strip3(plain(x.c))}`, { b: 1, color: ctx.plain ? "" : NAVY }), ctx.plain ? '<w:keepNext/><w:spacing w:before="120" w:after="60"/>' : '<w:pStyle w:val="Heading2"/>'); }
    else if (x.n === "ul" || x.n === "ol") o += list(x, 0);
    else if (x.n === "table") o += table(x);
    else if (x.n === "hr") o += para("", '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="A6A6A6"/></w:pBdr>');
    else { const t = runsXml(inl(x.c)); if (t) o += para(t, x.n === "blockquote" ? '<w:ind w:left="567"/>' : ""); }
  }
  return o;
}

/** docx({title, lines, html}) — html = HTML fragment (biên bản) hoặc text = văn bản thuần (bản gốc, bản dịch). */
export function docx({ title, sub = "", lines = [], html = "", text = "" }: { title: string; sub?: string; lines?: string[]; html?: string; text?: string }) {
  const ctx: Ctx = { ol: 0, nums: [] };
  const head = para(run(String(title).toLocaleUpperCase("vi-VN"), { b: 1, color: NAVY }), '<w:pStyle w:val="Title"/>')
    + (sub ? para(run(sub, { b: 1 }), '<w:jc w:val="center"/><w:spacing w:after="200"/>') : "")
    + lines.map((l) => para(run(l, { i: 1 }), '<w:spacing w:after="60"/>')).join("") + para("");
  const body = text ? text.split(/\n+/).filter(Boolean).map((t) => para(run(t), '<w:jc w:val="both"/>')).join("") : docBody(parse(cleanHtml(html)), ctx);
  const lvl = (i: number, fmt: string, t: string) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${t}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${567 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
  const lv = (fmt: string, t = "") => [0, 1, 2].map((i) => lvl(i, fmt, fmt === "bullet" ? t : `%${i + 1}.`)).join("");
  const numbering = `${XML}<w:numbering xmlns:w="${NS}wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lv("bullet", "•")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lv("decimal")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${ctx.nums.map((n) => `<w:num w:numId="${n}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join("")}</w:numbering>`;
  const sty = (id: string, name: string, rpr: string, ppr = "") => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
  const stylesXml = `${XML}<w:styles xmlns:w="${NS}wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="26"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`
    + sty("Title", "Title", "<w:b/><w:sz w:val=\"32\"/>", '<w:jc w:val="center"/><w:spacing w:after="160"/>') + sty("Heading1", "heading 1", "<w:b/><w:sz w:val=\"28\"/>", '<w:keepNext/><w:spacing w:before="240" w:after="120"/>')
    + sty("Heading2", "heading 2", "<w:b/><w:sz w:val=\"26\"/>", '<w:keepNext/><w:spacing w:before="160" w:after="80"/>') + sty("ListParagraph", "List Paragraph", "", '<w:spacing w:after="60"/>') + "</w:styles>";
  return zip({
    "[Content_Types].xml": `${XML}<Types xmlns="${NS}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
    "_rels/.rels": rels(REL("officeDocument", "rId1", "word/document.xml")),
    "word/_rels/document.xml.rels": rels(REL("styles", "rId1", "styles.xml") + REL("numbering", "rId2", "numbering.xml")),
    "word/document.xml": `${XML}<w:document xmlns:w="${NS}wordprocessingml/2006/main"><w:body>${head}${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    "word/styles.xml": stylesXml, "word/numbering.xml": numbering,
  });
}

/* ---------- XLSX ---------- */
export type Cell = string | number | null;
export interface Sheet { name?: string; col_widths?: number[]; rows?: Cell[][] }
const colName = (i: number) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
/** xlsx([{name, col_widths, rows:[[ô,...]]}]) — ô: chuỗi | số | null; chuỗi bắt đầu bằng "=" là công thức. */
export function xlsx(sheets: Sheet[]) {
  const used = new Set<string>();
  const list = sheets.map((s, i) => {
    let name = String(s.name || "Sheet" + (i + 1)).replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Sheet" + (i + 1);
    while (used.has(name.toLowerCase())) name = name.slice(0, 28) + "_" + (i + 1); used.add(name.toLowerCase());
    return { ...s, name };
  });
  const sheetXml = (s: Sheet) => `${XML}<worksheet xmlns="${NS}spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + (s.col_widths?.length ? `<cols>${s.col_widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(80, Math.max(6, +w || 14))}" customWidth="1"/>`).join("")}</cols>` : "")
    + `<sheetData>${(s.rows || []).map((r, ri) => `<row r="${ri + 1}">${(r || []).map((v, ci) => {
      if (v == null || v === "") return ""; const ref = colName(ci) + (ri + 1), sx = ri ? 2 : 1;
      if (typeof v === "number" && isFinite(v)) return `<c r="${ref}" s="${sx}"><v>${v}</v></c>`;
      const t = String(v); return t.startsWith("=") && t.length > 1 ? `<c r="${ref}" s="${sx}"><f>${X(t.slice(1))}</f></c>` : `<c r="${ref}" s="${sx}" t="inlineStr"><is><t xml:space="preserve">${X(t)}</t></is></c>`;
    }).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const stylesXml = `${XML}<styleSheet xmlns="${NS}spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FF${NAVY}"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEEEEE"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFA6A6A6"/></left><right style="thin"><color rgb="FFA6A6A6"/></right><top style="thin"><color rgb="FFA6A6A6"/></top><bottom style="thin"><color rgb="FFA6A6A6"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`;
  const f: Record<string, string> = {
    "[Content_Types].xml": `${XML}<Types xmlns="${NS}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": rels(REL("officeDocument", "rId1", "xl/workbook.xml")),
    "xl/workbook.xml": `${XML}<workbook xmlns="${NS}spreadsheetml/2006/main" xmlns:r="${NS}officeDocument/2006/relationships"><sheets>${list.map((s, i) => `<sheet name="${X(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`,
    "xl/_rels/workbook.xml.rels": rels(list.map((_, i) => REL("worksheet", `rId${i + 1}`, `worksheets/sheet${i + 1}.xml`)).join("") + REL("styles", "rIdS", "styles.xml")),
    "xl/styles.xml": stylesXml,
  };
  list.forEach((s, i) => { f[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s); });
  return zip(f);
}

/* ---------- Trích chữ từ .docx / .xlsx (file mẫu, tải văn bản lên đọc) ---------- */
export const normText = (t: unknown) => String(t).replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const xt = (s: string) => dec(s.replace(/<[^>]+>/g, ""));
export function docxText(buf: Buffer) {
  let x = unzip(buf).get("word/document.xml")?.toString("utf8"); if (!x) return "";
  x = x.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, "").replace(/<\/w:p>|<w:br\/>|<w:cr\/>/g, "\n").replace(/<w:tab\/>|<\/w:tc>/g, "\t");
  return normText(xt(x));
}
export function xlsxText(buf: Buffer, maxRows = 300) {
  const z = unzip(buf), t = (n: string) => z.get(n)?.toString("utf8") ?? "";
  const ss = [...t("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => xt(m[1]));
  const rel = Object.fromEntries([...t("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const out: string[] = [];
  for (const m of t("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(m[0])?.[1], tg = (rel[/r:id="([^"]+)"/.exec(m[0])?.[1] ?? ""] || "").replace(/^\//, ""); if (!name || !tg) continue;
    out.push(`[Sheet: ${dec(name)}]`); let rows = 0;
    for (const r of t(tg.startsWith("xl/") ? tg : "xl/" + tg).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (++rows > maxRows) { out.push("…"); break; }
      const cells: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1] || "", ty = /\bt="([^"]+)"/.exec(c[1])?.[1], inner = c[2] || "", v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const f = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner); let val = ty === "inlineStr" ? xt(inner) : v ? (ty === "s" ? ss[+v[1]] ?? "" : xt(v[1])) : "";
        val = val.replace(/\s+/g, " ").trim(); if (val || f) cells.push(`${ref}=${val}${f ? ` (=${xt(f[1])})` : ""}`);
      }
      if (cells.length) out.push(cells.join(" | "));
    }
  }
  return normText(out.join("\n"));
}

/* ---------- Điền thẳng vào file mẫu Word ---------- */
const TOK = /<w:p(?=[\s>/])[^>]*>|<\/w:p>|<w:tbl>|<\/w:tbl>|<w:tr(?=[\s>])[^>]*>|<\/w:tr>|<w:tc(?=[\s>])[^>]*>|<\/w:tc>/g;
interface CellPos { n: number; r: number; c: number }
interface Leaf { s: number; e: number; cell: CellPos | null }
/** Các đoạn "lá" (không chứa đoạn con) trong document.xml, kèm vị trí trong bảng. */
function leaves(x: string): Leaf[] {
  const out: Leaf[] = [], st: { s: number; cell: CellPos | null; kid?: number }[] = []; let tbl = 0; const tb: CellPos[] = [];
  for (const m of x.matchAll(TOK)) {
    const t = m[0], i = m.index!;
    if (t === "<w:tbl>") { tb.push({ n: ++tbl, r: 0, c: 0 }); continue; }
    if (t === "</w:tbl>") { tb.pop(); continue; }
    if (t.startsWith("<w:tr")) { const b = tb.at(-1); if (b) { b.r++; b.c = 0; } continue; }
    if (t.startsWith("<w:tc")) { const b = tb.at(-1); if (b) b.c++; continue; }
    if (t === "</w:tr>" || t === "</w:tc>") continue;
    const cell = tb.at(-1) ? { ...tb.at(-1)! } : null;
    if (t === "</w:p>") { const o = st.pop(); if (o && !o.kid) out.push({ s: o.s, e: i + 6, cell: o.cell }); continue; }
    if (st.length) st.at(-1)!.kid = 1;
    if (t.endsWith("/>")) out.push({ s: i, e: i + t.length, cell }); else st.push({ s: i, cell });
  }
  return out.sort((a, b) => a.s - b.s);
}
const pText = (p: string) => dec(p.replace(/<w:delText\b[\s\S]*?<\/w:delText>/g, "").replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<[^>]+>/g, (_, t) => t ?? ""));
const hasPic = (p: string) => /<w:drawing|<w:pict|<w:object/.test(p);
/** Mô tả file mẫu Word cho AI: mỗi đoạn một dòng [số] (bảng · dòng · ô) nội dung. */
export function docxOutline(buf: Buffer, max = 14000) {
  const x = unzip(buf).get("word/document.xml")?.toString("utf8") || ""; let o = "";
  for (const [i, l] of leaves(x).entries()) {
    const p = x.slice(l.s, l.e), t = pText(p).replace(/\s+$/g, "");
    const line = `[${i}]${l.cell ? ` (bảng ${l.cell.n} · dòng ${l.cell.r} · ô ${l.cell.c})` : ""} ${t || (hasPic(p) ? "[hình]" : "(trống)")}\n`;
    if (o.length + line.length > max) { o += "…\n"; break; } o += line;
  }
  return o.trim();
}
const RORDER = ["rStyle", "rFonts", "b", "bCs", "i", "iCs"];
function rprWith(rpr: string, f: Fmt) {
  let r = (rpr || "<w:rPr></w:rPr>").replace(/<w:(b|i)(?:\s[^>]*)?\/>/g, "");
  for (const k of ["i", "b"] as const) if (f[k]) { const prev = RORDER.slice(0, RORDER.indexOf(k)); let at = r.indexOf(">") + 1; for (const n of prev) { const m = new RegExp(`<w:${n}\\b[^>]*/>|<w:${n}\\b[^>]*>[\\s\\S]*?</w:${n}>`).exec(r); if (m) at = Math.max(at, m.index + m[0].length); } r = r.slice(0, at) + `<w:${k}/>` + r.slice(at); }
  return r === "<w:rPr></w:rPr>" ? "" : r;
}
function setText(p: string, html: string) {
  const head = /^<w:p\b[^>]*?(\/?)>/.exec(p)!, open = head[0].replace(/\/>$/, ">"), ppr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] || "";
  const runs = [...p.matchAll(/<w:r(?=[\s>])[^>]*>([\s\S]*?)<\/w:r>/g)], tr = runs.find((r) => /<w:t[\s>]/.test(r[1])) || runs[0];
  const base = tr ? /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(tr[1])?.[0] || "" : "", keep = runs.filter((r) => hasPic(r[1])).map((r) => r[0]).join("");
  const rs = inl(parse(cleanHtml(String(html).includes("<") ? html : X(html))).c).filter((r) => r.v);
  const body = rs.map((r) => `<w:r>${rprWith(base, r)}${r.v.split("\n").map((t, i) => (i ? "<w:br/>" : "") + `<w:t xml:space="preserve">${X(t)}</w:t>`).join("")}</w:r>`).join("");
  return `${open}${ppr}${keep}${body}</w:p>`;
}
const blocks = (html: string) => docBody(parse(cleanHtml(html)), { ol: 0, nums: [], plain: 1 });
/** Áp các chỉnh sửa AI trả về: [{p, text?, after?}] — text thay chữ của đoạn (giữ định dạng), after chèn khối HTML ngay sau đoạn. */
export function fillDocx(buf: Buffer, edits: unknown[]) {
  const z = unzip(buf), x = z.get("word/document.xml")?.toString("utf8"); if (!x) throw new Error("bad_template");
  const L = leaves(x), by = new Map<number, { text?: string; after?: string }>();
  for (const e of (edits || []) as { p?: unknown; text?: unknown; after?: unknown }[]) { const i = Number(e?.p); if (!Number.isInteger(i) || !L[i]) continue; const o = by.get(i) || {}; if (typeof e.text === "string") o.text = e.text; if (typeof e.after === "string" && e.after.trim()) o.after = (o.after || "") + e.after; by.set(i, o); }
  let out = x;
  for (const i of [...by.keys()].sort((a, b) => L[b].s - L[a].s)) {
    const l = L[i], o = by.get(i)!, p = out.slice(l.s, l.e);
    const np = o.text != null ? setText(p, o.text) : p; let add = o.after ? blocks(o.after) : "";
    if (add && l.cell && !/<\/w:p>$/.test(add)) add += "<w:p/>";
    out = out.slice(0, l.s) + np + add + out.slice(l.e);
  }
  z.set("word/document.xml", Buffer.from(out)); return zip(Object.fromEntries(z));
}
/** Xem trước .docx bất kỳ thành HTML đơn giản (đoạn, in đậm, bảng). */
export function docxHtml(buf: Buffer) {
  const x = unzip(buf).get("word/document.xml")?.toString("utf8") || "", L = new Map(leaves(x).map((l) => [l.s, l])); let o = "", skip = 0;
  for (const m of x.matchAll(TOK)) {
    if (m.index! < skip) continue; const t = m[0];
    if (t === "<w:tbl>") o += /<w:tblStyle w:val="(?:TableGrid|[^"]*Grid[^"]*)"|<w:tblBorders>[\s\S]*?w:val="single"/.test(x.slice(m.index, x.indexOf("</w:tblPr>", m.index) + 1 || m.index! + 800)) ? '<table class="g">' : "<table>"; else if (t === "</w:tbl>") o += "</table>"; else if (t.startsWith("<w:tr")) o += "<tr>"; else if (t === "</w:tr>") o += "</tr>";
    else if (t.startsWith("<w:tc")) o += "<td>"; else if (t === "</w:tc>") o += "</td>";
    else if (L.has(m.index!)) {
      const l = L.get(m.index!)!, p = x.slice(l.s, l.e); skip = l.e;
      const runs = [...p.matchAll(/<w:r(?=[\s>])[^>]*>([\s\S]*?)<\/w:r>/g)].map((r) => { const t2 = pText(r[1]).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!).replace(/\n/g, "<br>"); return /<w:b(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(r[1]) && t2.trim() ? `<strong>${t2}</strong>` : t2; }).join("");
      const jc = /<w:jc w:val="(center|right|both)"/.exec(p)?.[1], hd = /<w:pStyle w:val="(Title|Heading\d)"/.exec(p)?.[1];
      o += `<p${jc === "center" || jc === "right" ? ` style="text-align:${jc}"` : ""}${hd ? ' class="h"' : ""}>${runs || "&nbsp;"}</p>`;
    }
  }
  return o;
}

/* ---------- Excel mẫu: đọc thành bảng + ghi ô (giữ style của mẫu) ---------- */
const colIx = (s: string) => [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
function parts(z: Map<string, Buffer>) {
  const t = (n: string) => z.get(n)?.toString("utf8") ?? "";
  const rel = Object.fromEntries([...t("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  return [...t("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)].map((m) => { const tg = (rel[/r:id="([^"]+)"/.exec(m[0])?.[1] ?? ""] || "").replace(/^\//, ""); return { name: dec(/name="([^"]*)"/.exec(m[0])?.[1] || ""), path: tg.startsWith("xl/") ? tg : "xl/" + tg }; }).filter((s) => s.name && z.has(s.path));
}
/** [{name, rows:[[giá trị | "=công thức"]]}] để xem trước. */
export function xlsxSheets(buf: Buffer, maxRows = 500) {
  const z = unzip(buf), ss = [...(z.get("xl/sharedStrings.xml")?.toString("utf8") || "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => xt(m[1]));
  return parts(z).map(({ name, path }) => {
    const rows: Cell[][] = [];
    for (const r of z.get(path)!.toString("utf8").matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const ri = +(/\br="(\d+)"/.exec(r[1])?.[1] || rows.length + 1) - 1; if (ri >= maxRows) break; const row: Cell[] = [];
      for (const c of (r[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+)\d+"/.exec(c[1])?.[1]; if (!ref) continue; const ty = /\bt="([^"]+)"/.exec(c[1])?.[1], inner = c[2] || "", v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1], f = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1];
        const val: Cell = f ? "=" + xt(f) : ty === "inlineStr" ? xt(inner) : v == null ? null : ty === "s" ? ss[+v] ?? "" : ty === "str" || ty === "b" ? xt(v) : isNaN(+v) ? xt(v) : +v;
        row[colIx(ref)] = val;
      }
      rows[ri] = Array.from(row, (x) => x ?? null);
    }
    return { name, rows: Array.from(rows, (r) => r || []) };
  });
}
const cellXml = (ref: string, s: string, v: unknown) => {
  const a = `r="${ref}"${s ? ` s="${s}"` : ""}`;
  if (v == null || v === "") return `<c ${a}/>`;
  if (typeof v === "number" && isFinite(v)) return `<c ${a}><v>${v}</v></c>`;
  const t = String(v); if (t.startsWith("=") && t.length > 1) return `<c ${a}><f>${X(t.slice(1))}</f></c>`;
  if (/^-?\d+(\.\d+)?$/.test(t.trim()) && t.trim().length < 15) return `<c ${a}><v>${t.trim()}</v></c>`;
  return `<c ${a} t="inlineStr"><is><t xml:space="preserve">${X(t)}</t></is></c>`;
};
/** cells: [{sheet, ref:"B5", v}] — ghi vào đúng ô của file mẫu, giữ định dạng; ô mới lấy style của ô cùng cột ở dòng trên. */
export function fillXlsx(buf: Buffer, cells: unknown[]) {
  const z = unzip(buf), P = parts(z); if (!P.length) throw new Error("bad_template");
  const group = new Map<string, { col: number; row: number; ref: string; v: unknown }[]>();
  for (const c of (cells || []) as { ref?: unknown; sheet?: unknown; v?: unknown }[]) {
    const m = /^\$?([A-Z]{1,3})\$?(\d{1,6})$/.exec(String(c?.ref || "").toUpperCase()); if (!m) continue;
    const sh = P.find((p) => p.name === c.sheet) || P.find((p) => p.name.toLowerCase() === String(c.sheet || "").toLowerCase()) || P[0];
    if (!group.has(sh.path)) group.set(sh.path, []); group.get(sh.path)!.push({ col: colIx(m[1]), row: +m[2], ref: m[1] + m[2], v: c.v });
  }
  for (const [path, list] of group) {
    let x = z.get(path)!.toString("utf8"); const sd = /<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/.exec(x); if (!sd) continue;
    const rows = new Map<number, { attr: string; cs: Map<number, { xml: string; s: string; shared?: boolean }> }>();
    for (const r of (sd[1] || "").matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const n = +(/\br="(\d+)"/.exec(r[1])?.[1] ?? 0); if (!n) continue; const cs = new Map<number, { xml: string; s: string; shared?: boolean }>();
      for (const c of (r[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) { const ref = /\br="([A-Z]+)\d+"/.exec(c[1])?.[1]; if (ref) cs.set(colIx(ref), { xml: c[0], s: /\bs="(\d+)"/.exec(c[1])?.[1] || "", shared: /<f\b[^>]*t="shared"[^>]*ref=/.test(c[2] || "") }); }
      rows.set(n, { attr: r[1].replace(/\s*spans="[^"]*"/, ""), cs });
    }
    const styleAbove = (row: number, col: number) => { for (let n = row - 1; n > 0; n--) { const c = rows.get(n)?.cs.get(col); if (c) return c.s; } return ""; };
    for (const c of list) {
      if (!rows.has(c.row)) rows.set(c.row, { attr: ` r="${c.row}"`, cs: new Map() });
      const r = rows.get(c.row)!, cur = r.cs.get(c.col);
      if (cur?.shared) continue;
      const s = cur ? cur.s : styleAbove(c.row, c.col); r.cs.set(c.col, { xml: cellXml(c.ref, s, c.v), s });
    }
    const body = [...rows.keys()].sort((a, b) => a - b).map((n) => { const r = rows.get(n)!; return `<row${r.attr}>${[...r.cs.keys()].sort((a, b) => a - b).map((k) => r.cs.get(k)!.xml).join("")}</row>`; }).join("");
    x = x.slice(0, sd.index) + `<sheetData>${body}</sheetData>` + x.slice(sd.index + sd[0].length);
    x = x.replace(/<dimension\b[^>]*\/>/, ""); z.set(path, Buffer.from(x));
  }
  if (z.has("xl/calcChain.xml")) {
    z.delete("xl/calcChain.xml");
    const ct = z.get("[Content_Types].xml")?.toString("utf8"); if (ct) z.set("[Content_Types].xml", Buffer.from(ct.replace(/<Override[^>]*calcChain[^>]*\/>/, "")));
    const rl = z.get("xl/_rels/workbook.xml.rels")?.toString("utf8"); if (rl) z.set("xl/_rels/workbook.xml.rels", Buffer.from(rl.replace(/<Relationship[^>]*calcChain[^>]*\/>/, "")));
  }
  let wb = z.get("xl/workbook.xml")!.toString("utf8");
  if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b([^>]*?)(\/?)>/, (_m, a: string, sl: string) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"${sl}>`);
  else wb = wb.replace(/(<\/definedNames>|<\/sheets>)/, '$1<calcPr fullCalcOnLoad="1"/>');
  z.set("xl/workbook.xml", Buffer.from(wb));
  return zip(Object.fromEntries(z));
}
