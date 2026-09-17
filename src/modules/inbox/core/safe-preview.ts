const URL_LIKE = /\b(?:https?:\/\/|www\.)[^\s<>"'()\[\]]+/giu;

/** A list preview is not a place to expose URL query credentials or fragments. */
export function safeInboxPreview(value: string | null, maxLength = 240): string | null {
  if (value === null) return null;
  const cleaned = value.replace(URL_LIKE, (candidate) => {
    const query = candidate.indexOf("?");
    const fragment = candidate.indexOf("#");
    const end = Math.min(query < 0 ? candidate.length : query, fragment < 0 ? candidate.length : fragment);
    return candidate.slice(0, end);
  }).replace(/\s+/gu, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trimEnd()}…` : cleaned;
}
