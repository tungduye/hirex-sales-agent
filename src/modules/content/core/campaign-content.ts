// Turning library content into campaign text. Pure; unit-tested.

export interface PickedContent { id: string; code: string; title: string; body: string; content_format: string; department: string; category_id: string | null; content_language: string }

/** Text sent as a Zalo/Facebook message: comments are the body only; posts keep their headline. */
export function messageTextOf(item: Pick<PickedContent, "title" | "body" | "content_format">) {
  return item.content_format === "COMMENT" ? item.body.trim() : `${item.title.trim()}\n\n${item.body.trim()}`;
}

/** Plain text → simple email HTML (paragraphs and line breaks, everything escaped). */
export function emailHtmlOf(body: string) {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return body.trim().split(/\n\s*\n/u).map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
}

