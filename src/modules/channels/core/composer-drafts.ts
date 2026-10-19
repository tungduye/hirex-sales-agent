// Unsent text per conversation, kept in this browser (like Zalo's drafts): typing in one chat, switching to
// another and coming back finds the text again. Never leaves the browser; cleared once the message is sent.

export const DRAFT_EVENT = "hirex:draft";
const PREFIX = "hirex:draft:v1:";
const MAX_AGE_MS = 14 * 86_400_000;
export interface ComposerDraft { text: string; picks: Array<{ uid: string; name: string }>; savedAt: number }
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem"> & { length?: number; key?: (index: number) => string | null };

export function draftKey(conversationId: string) { return `${PREFIX}${conversationId}`; }

/** The browser's storage, or null where it is unavailable (private mode, blocked site data, server). */
export function draftStore(): Store | null {
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch { return null; }
}

export function readDraft(store: Store | null, conversationId: string, now: number): ComposerDraft | null {
  if (!store) return null;
  try {
    const raw = store.getItem(draftKey(conversationId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ComposerDraft>;
    if (typeof value.text !== "string" || !value.text.trim() || typeof value.savedAt !== "number" || now - value.savedAt > MAX_AGE_MS) {
      store.removeItem(draftKey(conversationId)); return null;
    }
    const picks = Array.isArray(value.picks) ? value.picks.filter((pick) => pick && typeof pick.uid === "string" && typeof pick.name === "string") : [];
    return { text: value.text.slice(0, 100_000), picks, savedAt: value.savedAt };
  } catch { return null; }
}

/** Saves the draft, or removes it when the text is empty. */
export function writeDraft(store: Store | null, conversationId: string, text: string, picks: ComposerDraft["picks"], now: number) {
  if (!store) return;
  try {
    if (!text.trim()) store.removeItem(draftKey(conversationId));
    else store.setItem(draftKey(conversationId), JSON.stringify({ text: text.slice(0, 100_000), picks, savedAt: now }));
  } catch { /* storage full or blocked: the draft just is not kept */ }
}

/** Conversation id -> draft text, for every saved draft (the inbox list shows "Nháp: ..."). */
export function listDrafts(store: Store | null, now: number): Map<string, string> {
  const drafts = new Map<string, string>();
  if (!store || typeof store.length !== "number" || !store.key) return drafts;
  try {
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const id = key.slice(PREFIX.length), draft = readDraft(store, id, now);
      if (draft) drafts.set(id, draft.text);
    }
  } catch { /* unreadable storage: no drafts shown */ }
  return drafts;
}
