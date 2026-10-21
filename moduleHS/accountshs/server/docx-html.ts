import "server-only";

import JSZip from "jszip";
import { SaxesParser } from "saxes";

/* Word (.docx) → HTML để xem nhanh đính kèm — port đúng docx_html() của v7.py (đoạn văn, tiêu đề, danh sách, bảng, in đậm/nghiêng/
   gạch, màu, highlight, siêu liên kết, ảnh nhúng base64). Dùng jszip + saxes (đã có trong node_modules qua exceljs). */

export interface El { tag: string; attrs: Record<string, string>; kids: Array<El | string>; parent?: El }
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const V = "urn:schemas-microsoft-com:vml";
/** html.escape() của Python */
const he = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]!);

export function parseXml(xml: string): El | null {
  const p = new SaxesParser({ xmlns: true });
  const root: El = { tag: "#root", attrs: {}, kids: [] }; let cur = root; let err: Error | null = null;
  p.on("error", (e) => { err = e; });
  p.on("opentag", (n) => {
    const attrs: Record<string, string> = {};
    for (const [k, a] of Object.entries(n.attributes)) { attrs[(a.uri ? `{${a.uri}}` : "") + a.local] = a.value; attrs[k] = a.value; }
    const el: El = { tag: `{${n.uri}}${n.local}`, attrs, kids: [], parent: cur }; cur.kids.push(el); cur = el;
  });
  p.on("closetag", () => { cur = cur.parent ?? root; });
  p.on("text", (t) => { cur.kids.push(t); });
  try { p.write(xml).close(); } catch (e) { err = e as Error; }
  if (err) return null;
  return (root.kids.find((k) => typeof k !== "string") as El | undefined) ?? null;
}
export const children = (e: El) => e.kids.filter((k): k is El => typeof k !== "string");
export const find = (e: El, tag: string) => children(e).find((c) => c.tag === tag);
export const text = (e: El): string => e.kids.map((k) => (typeof k === "string" ? k : text(k))).join("");
/** Element.iter(tag) của Python (gồm cả chính nó) */
export function* iter(e: El, tag: string): Generator<El> { if (e.tag === tag) yield e; for (const c of children(e)) yield* iter(c, tag); }

/** .rels → {rId: đường dẫn trong zip} */
export async function rels(z: JSZip, path: string) {
  const base = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const rp = (base ? base + "/" : "") + "_rels/" + path.slice(path.lastIndexOf("/") + 1) + ".rels";
  const f = z.file(rp); const out: Record<string, string> = {};
  if (!f) return out;
  const root = parseXml(await f.async("string")); if (!root) return out;
  for (const r of children(root)) {
    const tg = r.attrs.Target || "", id = r.attrs.Id;
    if (r.attrs.TargetMode === "External") { out[id] = tg; continue; }
    let full: string;
    if (tg.startsWith("/")) full = tg.replace(/^\/+/, "");
    else { const st: string[] = []; for (const x of [...(base ? base.split("/") : []), ...tg.split("/")]) { if (x === "..") st.pop(); else if (x && x !== ".") st.push(x); } full = st.join("/"); }
    out[id] = full;
  }
  return out;
}
/** ảnh nhúng: kiểu MIME theo ATT_MIME của v7.py (đuôi khác → application/octet-stream như bản gốc) */
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon", avif: "image/avif" };

export async function docxHtml(raw: Buffer): Promise<string> {
  const z = await JSZip.loadAsync(raw);
  const docFile = z.file("word/document.xml"); if (!docFile) throw new Error("Không đọc được nội dung Word");
  const doc = parseXml(await docFile.async("string")); if (!doc) throw new Error("Không đọc được nội dung Word");
  const rl = await rels(z, "word/document.xml");
  const imgs = new Map<string, string>();
  const img = async (rid: string | undefined) => {
    if (!rid) return ""; if (imgs.has(rid)) return imgs.get(rid)!;
    let h = ""; const p = rl[rid]; const f = p ? z.file(p) : null;
    if (f) { const b = await f.async("nodebuffer"); if (b.length < 8 * 1024 * 1024) h = `<img src="data:${MIME[(p.split("/").pop()!.match(/[^.]\.([A-Za-z0-9]{1,8})$/)?.[1] ?? "").toLowerCase()] ?? "application/octet-stream"};base64,${b.toString("base64")}">`; }
    imgs.set(rid, h); return h;
  };
  const on = (pr: El, tag: string) => { const e = find(pr, `{${W}}${tag}`); return !!e && !["0", "false", "none"].includes(e.attrs[`{${W}}val`] ?? ""); };
  const run = async (r: El): Promise<string> => {
    const pr = find(r, `{${W}}rPr`); const out: string[] = [];
    for (const c of children(r)) {
      if (c.tag === `{${W}}t`) out.push(he(text(c)));
      else if (c.tag === `{${W}}tab`) out.push("&emsp;");
      else if (c.tag === `{${W}}br` || c.tag === `{${W}}cr`) out.push("<br>");
      else if (c.tag === `{${W}}drawing`) for (const bl of iter(c, `{${A}}blip`)) out.push(await img(bl.attrs[`{${R}}embed`]));
      else if (c.tag === `{${W}}pict`) for (const im of iter(c, `{${V}}imagedata`)) out.push(await img(im.attrs[`{${R}}id`]));
    }
    let h = out.join(""); if (!h || !pr) return h;
    if (on(pr, "b")) h = `<b>${h}</b>`; if (on(pr, "i")) h = `<i>${h}</i>`; if (on(pr, "u")) h = `<u>${h}</u>`; if (on(pr, "strike") || on(pr, "dstrike")) h = `<s>${h}</s>`;
    const va = find(pr, `{${W}}vertAlign`)?.attrs[`{${W}}val`]; if (va === "superscript" || va === "subscript") { const t = va === "superscript" ? "sup" : "sub"; h = `<${t}>${h}</${t}>`; }
    const col = find(pr, `{${W}}color`)?.attrs[`{${W}}val`] ?? ""; if (/^[0-9A-Fa-f]{6}$/.test(col) && col !== "000000") h = `<span style="color:#${col}">${h}</span>`;
    const hl = find(pr, `{${W}}highlight`); if (hl && hl.attrs[`{${W}}val`] && hl.attrs[`{${W}}val`] !== "none") h = `<mark>${h}</mark>`;
    return h;
  };
  const inline = async (p: El): Promise<string> => {
    const out: string[] = [];
    for (const c of children(p)) {
      if (c.tag === `{${W}}r`) out.push(await run(c));
      else if (c.tag === `{${W}}hyperlink`) { const inner = await inline(c); const url = rl[c.attrs[`{${R}}id`] ?? ""] || ""; out.push(/^(https?:\/\/|mailto:)/.test(url) ? `<a href="${he(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner); }
      else if ([`{${W}}ins`, `{${W}}smartTag`, `{${W}}sdt`, `{${W}}sdtContent`, `{${W}}fldSimple`].includes(c.tag)) out.push(await inline(c));
    }
    return out.join("");
  };
  const para = async (p: El): Promise<string> => {
    const pp = find(p, `{${W}}pPr`); let tag = "p", style = "", li = false;
    if (pp) {
      const sv = find(pp, `{${W}}pStyle`)?.attrs[`{${W}}val`] ?? ""; const m = /^heading\s*(\d)/i.exec(sv);
      if (sv.toLowerCase() === "title") tag = "h1"; else if (m) tag = `h${Math.min(6, Math.max(1, +m[1]))}`; else if (sv.toLowerCase() === "subtitle") tag = "h3";
      const jc = find(pp, `{${W}}jc`)?.attrs[`{${W}}val`]; if (jc && ["center", "right", "both"].includes(jc)) style = ` style="text-align:${jc === "both" ? "justify" : jc}"`;
      li = !!find(pp, `{${W}}numPr`) || sv.toLowerCase().includes("list");
    }
    const body = await inline(p);
    return li ? `<li${style}>${body || "&nbsp;"}</li>` : `<${tag}${style}>${body || "&nbsp;"}</${tag}>`;
  };
  const block = async (el: El): Promise<string> => {
    const out: string[] = []; let lst: string[] = [];
    const flush = () => { if (lst.length) { out.push(`<ul>${lst.join("")}</ul>`); lst = []; } };
    for (const c of children(el)) {
      if (c.tag === `{${W}}p`) { const h = await para(c); if (h.startsWith("<li")) { lst.push(h); continue; } flush(); out.push(h); }
      else { flush(); if (c.tag === `{${W}}tbl`) out.push(await table(c)); else if ([`{${W}}sdt`, `{${W}}sdtContent`, `{${W}}customXml`].includes(c.tag)) out.push(await block(c)); }
    }
    flush(); return out.join("");
  };
  const table = async (t: El): Promise<string> => {
    const rows: string[] = [];
    for (const tr of children(t).filter((x) => x.tag === `{${W}}tr`)) {
      const cells: string[] = [];
      for (const tc of children(tr).filter((x) => x.tag === `{${W}}tc`)) { const sp = find(tc, `{${W}}tcPr`) ? find(find(tc, `{${W}}tcPr`)!, `{${W}}gridSpan`) : undefined; cells.push(`<td${sp ? ` colspan="${he(sp.attrs[`{${W}}val`] ?? "")}"` : ""}>${await block(tc)}</td>`); }
      rows.push(`<tr>${cells.join("")}</tr>`);
    }
    return `<table>${rows.join("")}</table>`;
  };
  const body = find(doc, `{${W}}body`);
  return body ? block(body) : "";
}
