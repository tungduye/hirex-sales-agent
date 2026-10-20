// "Phạm vi" of Suối Nguồn: which of the accounts a member may access are shown by default.
//   MINE: accounts whose main user (Người dùng chính) is me.
//   TEAM: mine + those of everyone I manage, directly or further down.
//   ALL:  every account I may access.
// Pure module (unit-tested in tests/inbox-scope.test.mjs).

export const INBOX_SCOPES = ["MINE", "TEAM", "ALL"] as const;
export type InboxScope = (typeof INBOX_SCOPES)[number];
export const INBOX_SCOPE_COOKIE = "hirex_inbox_scope";

/** Me and everyone below me in the "Quản lý trực tiếp" chain (cycles are ignored). */
export function teamOf(me: string, managers: Array<{ id: string; managerId: string | null }>) {
  const team = new Set([me]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const person of managers) if (person.managerId && team.has(person.managerId) && !team.has(person.id)) { team.add(person.id); grew = true; }
  }
  return team;
}

export function scopeAccounts(scope: InboxScope, me: string, accounts: Array<{ id: string; primaryProfileId: string | null }>, managers: Array<{ id: string; managerId: string | null }>) {
  if (scope === "ALL") return accounts.map((account) => account.id);
  const people = scope === "MINE" ? new Set([me]) : teamOf(me, managers);
  return accounts.filter((account) => account.primaryProfileId && people.has(account.primaryProfileId)).map((account) => account.id);
}

/** The scope asked for, or the default: MINE when I own an account, else ALL. TEAM only when I manage someone. */
export function resolveScope(requested: string | null | undefined, counts: { mine: number; team: number; hasTeam: boolean }): InboxScope {
  const value = (requested ?? "").toUpperCase();
  if (value === "ALL") return "ALL";
  if (value === "TEAM" && counts.hasTeam) return "TEAM";
  if (value === "MINE" || value === "TEAM") return counts.mine > 0 ? "MINE" : "ALL";
  return counts.mine > 0 ? "MINE" : "ALL";
}

/** Reads the scope cookie from a Cookie header. */
export function scopeFromCookie(header: string | null) {
  const match = /(?:^|;\s*)hirex_inbox_scope=([A-Z]+)/u.exec(header ?? "");
  return match?.[1] ?? null;
}
