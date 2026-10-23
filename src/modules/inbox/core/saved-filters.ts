/** Saved filters ("Bộ lọc đã lưu") for Suối Nguồn: what is kept and how it is named. */

export const SAVED_FILTER_PARAMS = ["channel", "account", "owner", "tag", "tagMode", "firstFrom", "firstTo"] as const;
export const SAVED_FILTER_VIEWS = ["all", "waiting", "mine", "groups", "other", "important"] as const;
export const MAX_SAVED_FILTERS = 20;
export type SavedFilterView = (typeof SAVED_FILTER_VIEWS)[number];
export type SavedFilterScope = "MINE" | "TEAM" | "ALL";
export interface SavedFilter { id: string; name: string; query: string; scope: SavedFilterScope | null; view: SavedFilterView | null }

const VIEW_LABELS: Record<SavedFilterView, string> = { all: "All", waiting: "Chưa trả lời", mine: "Của tôi", groups: "Nhóm", other: "Thư tự động", important: "Quan trọng" };
const SCOPE_LABELS: Record<SavedFilterScope, string> = { MINE: "Cá nhân", TEAM: "Nhân viên", ALL: "Tất cả tài khoản" };
const CHANNEL_LABELS: Record<string, string> = { ZALO: "Zalo", FACEBOOK: "Page", FACEBOOK_PROFILE: "FB cá nhân", EMAIL: "Email" };

/** Keeps only the list filters (no page, no conversation), in a stable order. */
export function cleanFilterQuery(query: string): string {
  const input = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const output = new URLSearchParams();
  for (const key of SAVED_FILTER_PARAMS) for (const value of input.getAll(key)) {
    const clean = value.trim().slice(0, 4000);
    if (clean) output.append(key, clean);
  }
  if (!output.has("tag")) output.delete("tagMode");
  return output.toString();
}

export function isSavedFilterView(value: unknown): value is SavedFilterView { return typeof value === "string" && (SAVED_FILTER_VIEWS as readonly string[]).includes(value); }
export function isSavedFilterScope(value: unknown): value is SavedFilterScope { return value === "MINE" || value === "TEAM" || value === "ALL"; }

/** A readable default name: "Của tôi · Zalo · Chưa trả lời · 2 tài khoản". */
export function suggestFilterName(input: { scope: SavedFilterScope | null; view: SavedFilterView | null; query: string; accountName?: string | null; tagNames?: string[]; ownerNames?: string[] }): string {
  const query = new URLSearchParams(input.query);
  const parts: string[] = [];
  if (input.scope) parts.push(SCOPE_LABELS[input.scope]);
  const channels = query.getAll("channel").flatMap((value) => value.split(",")).filter(Boolean);
  if (channels.length) parts.push(channels.map((value) => CHANNEL_LABELS[value] ?? value).join("+"));
  if (input.view && input.view !== "all") parts.push(VIEW_LABELS[input.view]);
  const accounts = query.getAll("account").flatMap((value) => value.split(",")).filter(Boolean);
  if (accounts.length === 1 && input.accountName) parts.push(input.accountName);
  else if (accounts.length) parts.push(`${accounts.length} tài khoản`);
  for (const name of input.ownerNames ?? []) parts.push(`PT ${name}`);
  for (const name of input.tagNames ?? []) parts.push(name);
  if (query.get("firstFrom") || query.get("firstTo")) parts.push("theo ngày");
  return (parts.join(" · ") || "Bộ lọc của tôi").slice(0, 60);
}
