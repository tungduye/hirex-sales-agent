// Which company a Zalo group belongs to, from its name: "30/09 - BRISASOFT - BrSE HN - Mai" → Brisasoft.
// Only suggestions: an AM confirms or rejects them.

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase();
/** Lower case, no marks, words separated by single spaces. */
export function words(value: string) { return ` ${fold(value).replace(/[^a-z0-9]+/gu, " ").trim()} `; }

// Legal and generic words dropped from a company name to get its usual short name.
const GENERIC = new Set(["cong", "ty", "co", "phan", "tnhh", "mtv", "jsc", "joint", "stock", "company", "ltd", "limited", "inc", "corp", "corporation", "group", "vietnam", "viet", "nam",
  "japan", "jp", "vn", "software", "technology", "technologies", "tech", "solutions", "solution", "global", "holdings", "holding", "system", "systems", "consulting", "service", "services", "lab", "labs"]);
const COMMON = new Set(["shift", "data", "smart", "new", "next", "first", "best", "top", "one", "the", "and", "sale", "dev", "brse", "test", "hot", "team"]);

export function companyAliases(name: string | null, website: string | null): string[] {
  const aliases = new Set<string>();
  if (name) {
    const full = words(name).trim();
    if (full.length >= 3) aliases.add(full);
    const core = full.split(" ").filter((word) => word && !GENERIC.has(word)).join(" ");
    if (core && core !== full && (core.length >= 4 || (core.length === 3 && !core.includes(" "))) && !COMMON.has(core)) aliases.add(core);
  }
  if (website) {
    const host = website.toLowerCase().replace(/^[a-z]+:\/\//u, "").replace(/^www\./u, "").split(/[/?#]/u)[0] ?? "";
    const label = host.split(".")[0]?.replace(/[^a-z0-9]/gu, "") ?? "";
    if (label.length >= 4 && !COMMON.has(label)) aliases.add(label);
  }
  return [...aliases];
}

export interface MatchCompany { id: number; name: string | null; website: string | null }

/** Best companies for one group name (several when equally good), with a score (the matched alias length). */
export function matchGroup(groupName: string, companies: ReadonlyArray<MatchCompany & { aliases?: string[] }>): Array<{ id: number; score: number }> {
  const haystack = words(groupName);
  const squashed = haystack.replace(/ /gu, "");
  let best = 0;
  let found: Array<{ id: number; score: number }> = [];
  for (const company of companies) {
    let score = 0;
    for (const alias of company.aliases ?? companyAliases(company.name, company.website)) {
      // Whole words ("kss" in "kss tri dev"), or a one-word alias glued in the group name ("vnext" in "x1 vnext mai").
      const hit = haystack.includes(` ${alias} `) || (!alias.includes(" ") && alias.length >= 5 && squashed.includes(alias));
      if (hit) score = Math.max(score, alias.replace(/ /gu, "").length);
    }
    if (!score) continue;
    if (score > best) { best = score; found = [{ id: company.id, score }]; }
    else if (score === best) found.push({ id: company.id, score });
  }
  return found.slice(0, 5);
}
