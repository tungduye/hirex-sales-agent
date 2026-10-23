// Suối Nguồn people filter: nicks grouped Bộ phận → Thị trường → Owner → nick. A whole branch is kept as a group
// ("d:Rec", "m:Rec|IT_JP", "o:Rec|IT_JP|<owner id>") so a nick added later to that branch is included by itself.
// Pure; covered by tests/account-tree.test.mjs.

export const DEPARTMENTS = ["Sale", "Rec", "AM", "AI Chat", "NB", "CTV"] as const;
export const MARKETS = [{ key: "IT", label: "IT" }, { key: "IT_JP", label: "IT JP" }, { key: "OTHER", label: "Khác" }] as const;
export type MarketKey = (typeof MARKETS)[number]["key"];
const NONE = "_";

export interface TreeAccount { id: string; displayName: string; ownerId: string | null; ownerName: string | null; department: string | null; market: string | null }
export interface TreeOwner { key: string; label: string; accounts: TreeAccount[] }
export interface TreeMarket { key: string; label: string; owners: TreeOwner[] }
export interface TreeDepartment { key: string; label: string; markets: TreeMarket[] }

const clean = (value: string | null | undefined) => (value ?? "").replace(/[|:]/gu, " ").replace(/\s+/gu, " ").trim();
/** "rec" → "Rec" (the preset spelling), anything else as written, none → "_". */
export function departmentKey(value: string | null | undefined) {
  const text = clean(value);
  if (!text) return NONE;
  return DEPARTMENTS.find((item) => item.toLowerCase() === text.toLowerCase()) ?? text;
}
export const marketKey = (value: string | null | undefined): MarketKey => value === "IT" || value === "IT_JP" ? value : "OTHER";
export const marketLabel = (key: string) => MARKETS.find((item) => item.key === key)?.label ?? "Khác";
export const departmentLabel = (key: string) => key === NONE ? "Chưa xếp bộ phận" : key;
const keysOf = (account: TreeAccount) => {
  const dept = departmentKey(account.department), market = marketKey(account.market), owner = account.ownerId ?? NONE;
  return { dept, market, owner, d: `d:${dept}`, m: `m:${dept}|${market}`, o: `o:${dept}|${market}|${owner}` };
};

export function buildTree(accounts: TreeAccount[]): TreeDepartment[] {
  const depts = new Map<string, Map<string, Map<string, TreeOwner>>>();
  for (const account of accounts) {
    const { dept, market, owner } = keysOf(account);
    const markets = depts.get(dept) ?? new Map<string, Map<string, TreeOwner>>(); depts.set(dept, markets);
    const owners = markets.get(market) ?? new Map<string, TreeOwner>(); markets.set(market, owners);
    const entry = owners.get(owner) ?? { key: owner, label: owner === NONE ? "Chưa có chủ nick" : account.ownerName ?? "Người khác", accounts: [] };
    entry.accounts.push(account); owners.set(owner, entry);
  }
  const deptRank = (key: string) => key === NONE ? 999 : DEPARTMENTS.findIndex((item) => item === key) >= 0 ? DEPARTMENTS.findIndex((item) => item === key) : 100;
  return [...depts.entries()].sort((a, b) => deptRank(a[0]) - deptRank(b[0]) || a[0].localeCompare(b[0], "vi")).map(([dept, markets]) => ({
    key: dept, label: departmentLabel(dept),
    markets: MARKETS.filter((market) => markets.has(market.key)).map((market) => ({ key: market.key, label: market.label,
      owners: [...markets.get(market.key)!.values()].sort((a, b) => Number(a.key === NONE) - Number(b.key === NONE) || a.label.localeCompare(b.label, "vi"))
        .map((owner) => ({ ...owner, accounts: owner.accounts.slice().sort((a, b) => a.displayName.localeCompare(b.displayName, "vi")) })) })),
  }));
}

const GROUP = /^(?:d:[^|:]{1,60}|m:[^|:]{1,60}\|(?:IT|IT_JP|OTHER)|o:[^|:]{1,60}\|(?:IT|IT_JP|OTHER)\|(?:_|[0-9a-f-]{36}))$/iu;
/** Group keys from the address, checked and capped. */
export const cleanGroups = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter((value) => GROUP.test(value)))].slice(0, 50);

/** The nicks a set of groups covers. */
export function accountsInGroups(accounts: TreeAccount[], groups: string[]) {
  const wanted = new Set(groups);
  return accounts.filter((account) => { const keys = keysOf(account); return wanted.has(keys.d) || wanted.has(keys.m) || wanted.has(keys.o); }).map((account) => account.id);
}

/** Picked nicks → the shortest description: whole branches as groups, the rest as nick ids. */
export function compactSelection(tree: TreeDepartment[], picked: Set<string>) {
  const groups: string[] = [], accounts: string[] = [];
  const all = (ids: string[]) => ids.length > 0 && ids.every((id) => picked.has(id));
  for (const dept of tree) {
    const deptIds = dept.markets.flatMap((market) => market.owners.flatMap((owner) => owner.accounts.map((account) => account.id)));
    if (all(deptIds)) { groups.push(`d:${dept.key}`); continue; }
    for (const market of dept.markets) {
      const marketIds = market.owners.flatMap((owner) => owner.accounts.map((account) => account.id));
      if (all(marketIds)) { groups.push(`m:${dept.key}|${market.key}`); continue; }
      for (const owner of market.owners) {
        const ids = owner.accounts.map((account) => account.id);
        if (all(ids) && ids.length > 1) groups.push(`o:${dept.key}|${market.key}|${owner.key}`);
        else accounts.push(...ids.filter((id) => picked.has(id)));
      }
    }
  }
  return { groups, accounts };
}

/** "Rec", "Rec › IT JP", "Long · IT JP" for the active-filter chips. */
export function groupLabel(group: string, ownerName: (id: string) => string | null) {
  const [kind, rest = ""] = [group.slice(0, 1), group.slice(2)];
  const [dept, market, owner] = rest.split("|");
  if (kind === "d") return departmentLabel(dept);
  if (kind === "m") return `${departmentLabel(dept)} › ${marketLabel(market)}`;
  return `${owner === NONE ? "Chưa có chủ nick" : ownerName(owner) ?? "Owner"} · ${marketLabel(market)}`;
}
