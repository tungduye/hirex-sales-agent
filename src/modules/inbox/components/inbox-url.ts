"use client";

/**
 * Suối Nguồn filters live in the address. The list is loaded by the browser (InboxShell), so changing a filter only
 * rewrites the address: no server render of the page (that cost a round trip, and rebuilt the open chat each time).
 */
export function replaceInboxQuery(pathname: string, query: URLSearchParams) {
  const next = query.toString();
  window.history.replaceState(null, "", `${pathname}${next ? `?${next}` : ""}`);
}

export type ViewCounts = Record<"all" | "waiting" | "mine" | "groups" | "other" | "important", number> & { capped: boolean };

// The filters the tab badges depend on (not the tab, cursor or open conversation), in one fixed order.
const COUNT_PARAMS = ["channel", "account", "owner", "grp", "tag", "tagMode", "firstFrom", "firstTo", "q", "unread"] as const;
export function countKeyOf(query: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const name of COUNT_PARAMS) for (const value of query.getAll(name)) out.append(name, value);
  return out.toString();
}

// Badges per filter set and Phạm vi, kept a minute; a request already on its way is shared, so the list frame can
// ask for them together with the list instead of after it.
const counts = new Map<string, { at: number; request: Promise<ViewCounts | null> }>();
function scopeCookie(): string { return /(?:^|;\s*)hirex_inbox_scope=([^;]*)/u.exec(document.cookie)?.[1] ?? ""; }
export function loadViewCounts(key: string): Promise<ViewCounts | null> {
  const cacheKey = `${scopeCookie()}|${key}`;
  const hit = counts.get(cacheKey);
  if (hit && Date.now() - hit.at < 60_000) return hit.request;
  const request = fetch(`/api/inbox/view-counts${key ? `?${key}` : ""}`, { cache: "no-store" })
    .then((response) => response.ok ? response.json() as Promise<ViewCounts> : null).catch(() => null);
  counts.set(cacheKey, { at: Date.now(), request });
  void request.then((value) => { if (!value && counts.get(cacheKey)?.request === request) counts.delete(cacheKey); });
  return request;
}
/** After a bulk change (read, tags…) the badges are counted again. */
export function clearViewCounts() { counts.clear(); }
