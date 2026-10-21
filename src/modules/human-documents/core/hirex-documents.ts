// Tài liệu HireX: what a member asked Soda to keep in the document library. Pure helpers (text → HTML, folder,
// title, which chat messages make up "the document I just sent"); covered by tests/hirex-documents.test.mjs.

export const HIREX_ROOT_FOLDER = "Tài liệu HireX";
export const DEFAULT_HIREX_FOLDER = "Soda lưu";
export const MAX_DOCUMENT_CHARS = 200_000;

const escape = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");

/** Plain text (a chat message, Word paragraphs) → the simple HTML the library shows: paragraphs, line breaks, lists. */
export function textToHtml(text: string): string {
  const blocks = text.replace(/\r\n?/gu, "\n").split(/\n{2,}/u).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trimEnd());
    if (lines.length > 1 && lines.every((line) => /^\s*(?:[-*•+]|\d+[.)])\s+/u.test(line))) {
      const ordered = lines.every((line) => /^\s*\d+[.)]\s+/u.test(line));
      const items = lines.map((line) => `<li>${escape(line.replace(/^\s*(?:[-*•+]|\d+[.)])\s+/u, ""))}</li>`).join("");
      return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
    }
    return `<p>${lines.map(escape).join("<br>")}</p>`;
  }).join("\n");
}

/** Folder name the member asked for, cleaned ("Quy trình/HR" → "Quy trình - HR"); default "Soda lưu". */
export function cleanFolder(value: string | null | undefined): string {
  const folder = (value ?? "").replace(/[\\/]+/gu, " - ").replace(/[\u0000-\u001f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 120);
  return folder || DEFAULT_HIREX_FOLDER;
}

/** A title: the one asked for, else the file name without extension, else the first line of the text. */
export function documentTitle(asked: string | null | undefined, fileName: string | null, text: string): string {
  const clean = (value: string) => value.replace(/[\u0000-\u001f]/gu, " ").replace(/\s+/gu, " ").trim();
  const fromAsked = clean(asked ?? "");
  if (fromAsked) return fromAsked.slice(0, 200);
  const fromFile = fileName ? clean(fileName.replace(/\.[A-Za-z0-9]{1,6}$/u, "")) : "";
  if (fromFile) return fromFile.slice(0, 200);
  const firstLine = clean(text.split("\n").find((line) => line.trim()) ?? "").replace(/^#+\s*/u, "");
  return (firstLine.length > 80 ? `${firstLine.slice(0, 80).trimEnd()}…` : firstLine) || "Tài liệu";
}

export interface ChatMessage { id: string; text: string | null; at: string; attachments: number }
/**
 * "Tài liệu anh vừa nhắn": the member's messages just before the request, newest run only. Zalo cuts a long
 * paste into several messages sent seconds apart, so messages less than `gapMs` apart belong together.
 * `messages` are the member's own messages in that chat, newest first, without the request itself.
 */
export function latestRun(messages: ChatMessage[], gapMs = 3 * 60_000, maxMessages = 40): ChatMessage[] {
  const run: ChatMessage[] = [];
  for (const message of messages) {
    const text = message.text?.trim() ?? "";
    if (!text && !message.attachments) continue;
    if (run.length && Date.parse(run[run.length - 1].at) - Date.parse(message.at) > gapMs) break;
    run.push(message);
    if (run.length >= maxMessages) break;
  }
  return run.reverse();
}
