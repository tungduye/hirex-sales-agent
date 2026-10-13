const MAX_DISPLAY_LENGTH = 4_000;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(CONTROL_CHARACTERS, " ").trim();
  return normalized ? normalized.slice(0, MAX_DISPLAY_LENGTH) : null;
}

function objectText(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const primary = [row.title, row.description, row.text, row.content].map(clean).filter((item): item is string => Boolean(item));
  const unique = [...new Set(primary)];
  if (unique.length > 0) return unique.join("\n").slice(0, MAX_DISPLAY_LENGTH);
  const href = clean(row.href);
  return href && /^https?:\/\/[^\s]+$/iu.test(href) ? href.slice(0, MAX_DISPLAY_LENGTH) : null;
}

export function zaloProviderDisplayText(value: string | null): string | null {
  const original = clean(value);
  if (!original || (!original.startsWith("{") && !original.startsWith("["))) return original;
  try {
    const parsed: unknown = JSON.parse(original);
    if (Array.isArray(parsed)) {
      const items = parsed.slice(0, 10).map(objectText).filter((item): item is string => Boolean(item));
      return items.length > 0 ? items.join("\n").slice(0, MAX_DISPLAY_LENGTH) : "Zalo provider event";
    }
    return objectText(parsed) ?? "Zalo provider event";
  } catch {
    return original;
  }
}
