/** Text rules of the Zalo Trợ lý: when it is being called, link codes, and answers as plain Zalo text. */

const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase();

/** In a group the Trợ lý answers only when called: "/tl …" or "@<one of its names> …". */
export function isBotCall(text: string, botNames: string | string[]): boolean {
  const clean = fold(text.trim());
  if (/^\/tl(\s|$)/u.test(clean)) return true;
  return (Array.isArray(botNames) ? botNames : [botNames]).some((botName) => { const name = fold(botName.trim()); return name.length > 0 && clean.includes(`@${name}`); });
}

/** The question without "/tl" or "@<one of its names>". */
export function stripBotCall(text: string, botNames: string | string[]): string {
  let out = text.trim().replace(/^\/tl\b\s*/iu, "");
  for (const raw of Array.isArray(botNames) ? botNames : [botNames]) {
  const name = raw.trim();
  if (name) {
    const pattern = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "giu");
    out = out.replace(pattern, " ");
    // Zalo may send the name without accents in some clients.
    const folded = fold(name);
    if (folded !== name.toLowerCase()) out = out.split(/\s+/u).join(" ").replace(new RegExp(`@${folded.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "giu"), " ");
  }
  }
  return out.replace(/\s+/gu, " ").replace(/^[,:\s]+/u, "").trim();
}

/** "123456" or "/lienket 123456" (private chat only). */
export function parseLinkCode(text: string): string | null {
  const match = /^\s*(?:\/?li[eê]n\s*k[eế]t\s*)?(\d{6})\s*$/iu.exec(text);
  return match ? match[1] : null;
}

/** Markdown answer → plain Zalo text: no **, links written out in full so they can be tapped. */
export function toZaloText(markdown: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/u, "");
  return markdown
    .replace(/\[([^\]]+)\]\(\s*(\/[^)\s]*)\s*\)/gu, (_all, label: string, path: string) => `${label}: ${base}${path}`)
    .replace(/\[([^\]]+)\]\(\s*(https?:\/\/[^)\s]+)\s*\)/gu, (_all, label: string, url: string) => `${label}: ${url}`)
    // Bare app paths the model wrote without a link ("( /inbox/all)") become full links too.
    .replace(/\(\s*(\/(?:inbox|settings|campaigns|tasks|content|jobs|contacts|companies|assistant|scan|documents|accounts)[^)\s]*)\s*\)/gu, (_all, path: string) => `${base}${path}`)
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/^#{1,6}\s*/gmu, "")
    .replace(/^\s*[-*]\s+/gmu, "• ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** Splits a long answer at paragraph (then line) breaks into messages of at most `limit` characters. */
export function splitZaloParts(text: string, limit = 1800, maxParts = 5): string[] {
  const parts: string[] = [];
  let current = "";
  const push = () => { if (current.trim()) parts.push(current.trim()); current = ""; };
  for (const block of text.split(/\n{2,}/u)) {
    const pieces = block.length > limit ? block.split(/\n/u) : [block];
    for (const piece of pieces) {
      const chunk = piece.length > limit ? piece.slice(0, limit - 1) + "…" : piece;
      const joined = current ? `${current}${pieces.length > 1 && current && !current.endsWith("\n\n") ? "\n" : "\n\n"}${chunk}` : chunk;
      if (joined.length > limit) { push(); current = chunk; } else current = joined;
    }
  }
  push();
  if (parts.length > maxParts) { const kept = parts.slice(0, maxParts); kept[maxParts - 1] = `${kept[maxParts - 1]}\n\n(Câu trả lời dài, xem đầy đủ trên trang Trợ lý.)`; return kept; }
  return parts;
}

/** "OK 2", "xác nhận", "Huỷ 1"… → which proposal (1-based, null = the only one) and what to do; null if not a confirmation. */
export function parseConfirmation(text: string): { decision: "confirm" | "cancel"; index: number | null } | null {
  const clean = fold(text.trim()).replace(/[.!]+$/u, "").trim();
  const match = /^(ok|oke|okay|xac nhan|dong y|yes|y|huy|bo|khong|cancel)\s*(?:so\s*)?(\d{1,2})?$/u.exec(clean);
  if (!match) return null;
  return { decision: ["huy", "bo", "khong", "cancel"].includes(match[1]) ? "cancel" : "confirm", index: match[2] ? Number(match[2]) : null };
}

/** The proposal cards of an answer, numbered, with how to confirm them from Zalo. */
export function describeProposals(cards: Array<{ title: string; lines: string[]; expiresAt: string }>): string {
  if (!cards.length) return "";
  const until = new Date(Math.min(...cards.map((card) => Date.parse(card.expiresAt)))).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
  const blocks = cards.map((card, index) => `${index + 1}) ${card.title}${card.lines.length ? `\n${card.lines.slice(0, 6).map((line) => `   ${line}`).join("\n")}` : ""}`);
  const how = cards.length === 1 ? "Sếp trả lời OK để em thực hiện, hoặc Huỷ để bỏ" : `Sếp trả lời OK kèm số (ví dụ OK 1) để em thực hiện, hoặc Huỷ kèm số để bỏ`;
  return `Dạ, cần sếp xác nhận:\n${blocks.join("\n")}\n\n${how} (hết hạn lúc ${until}).`;
}
