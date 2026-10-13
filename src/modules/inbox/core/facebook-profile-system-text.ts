const FACEBOOK_PROFILE_SYSTEM_PLACEHOLDERS = new Set([
  "không khôi phục được tin nhắn",
  "couldn't restore message",
  "could not restore message",
  "this message could not be restored",
]);

export function isFacebookProfileSystemPlaceholder(value: unknown): boolean {
  return typeof value === "string" && FACEBOOK_PROFILE_SYSTEM_PLACEHOLDERS.has(value.trim().toLocaleLowerCase("vi"));
}
