// A tiny, safe subset of Markdown for assistant answers: paragraphs, bullet/numbered lists,
// **bold** and [text](/internal-link). No HTML is ever produced; the panel renders these tokens
// as React elements. External or odd links become plain text. Pure; unit-tested.
import { isInternalLink } from "./assistant-instructions.ts";

export type Inline = { type: "text"; text: string } | { type: "bold"; text: string } | { type: "link"; text: string; href: string };
export type Block = { type: "paragraph"; inlines: Inline[] } | { type: "list"; ordered: boolean; start: number; items: Inline[][] } | { type: "heading"; inlines: Inline[] };

// Models sometimes write "[tên]( /link )" with spaces inside the parentheses; accept that too.
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/g;

export function parseInline(text: string): Inline[] {
  const result: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index! > last) result.push({ type: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) result.push({ type: "bold", text: match[1] });
    else if (isInternalLink(match[3])) result.push({ type: "link", text: match[2], href: match[3] });
    else result.push({ type: "text", text: match[2] });
    last = match.index! + match[0].length;
  }
  if (last < text.length) result.push({ type: "text", text: text.slice(last) });
  return result;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,4}\s+(.*)$/;

export function parseAnswer(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { blocks.push({ type: "paragraph", inlines: parseInline(paragraph.join(" ")) }); paragraph = []; } };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(BULLET);
    const numbered = line.match(NUMBERED);
    const heading = line.match(HEADING);
    if (!line.trim()) { flush(); continue; }
    if (heading) { flush(); blocks.push({ type: "heading", inlines: parseInline(heading[1].replace(/\*\*/g, "")) }); continue; }
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered && !bullet);
      const item = parseInline(bullet ? bullet[1] : numbered![2]);
      const previous = blocks[blocks.length - 1];
      if (previous?.type === "list" && previous.ordered === ordered) previous.items.push(item);
      // Keep the author's numbering when a numbered list is interrupted by sub-bullets (1. … 2. …).
      else blocks.push({ type: "list", ordered, start: ordered ? Number(numbered![1]) || 1 : 1, items: [item] });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
