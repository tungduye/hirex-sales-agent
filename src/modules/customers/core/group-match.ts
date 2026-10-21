// Which company a Zalo group belongs to, from its name: "30/09 - BRISASOFT - BrSE HN - Mai" → Brisasoft.
// Only suggestions: an AM confirms or rejects them.

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase();
/** Lower case, no marks, words separated by single spaces. */
export function words(value: string) { return ` ${fold(value).replace(/[^a-z0-9]+/gu, " ").trim()} `; }

// Legal and generic words dropped from a company name to get its usual short name.
const GENERIC = new Set(["cong", "ty", "co", "phan", "tnhh", "mtv", "jsc", "joint", "stock", "company", "ltd", "limited", "inc", "corp", "corporation", "group", "vietnam", "viet", "nam",
  "japan", "jp", "vn", "software", "technology", "technologies", "tech", "solutions", "solution", "global", "holdings", "holding", "system", "systems", "consulting", "service", "services", "lab", "labs"]);
const LEGAL_COUNTRY = new Set(["cong", "ty", "co", "phan", "tnhh", "mtv", "jsc", "joint", "stock", "company", "ltd", "limited", "inc", "corp", "corporation", "vietnam", "viet", "nam", "japan", "jp", "vn"]);
const SITE_WORDS = new Set(["jobs", "careers", "career", "recruit", "about", "corp", "home", "blog", "info", "masothue", "linkedin", "facebook", "google", "github", "topdev", "itviec", "vietnamworks"]);
/** A name the sync gave a group it only knew by id ("Zalo group 1408…"): not a name. */
export const PLACEHOLDER_GROUP = /^zalo group\s*[0-9]*$/iu;
// Words a group name often has for other reasons (place, job, team name): never a company on their own.
const COMMON = new Set(["shift", "data", "smart", "new", "next", "first", "best", "top", "one", "the", "and", "sale", "sales", "dev", "brse", "test", "hot", "team",
  "tokyo", "osaka", "fukuoka", "nagoya", "hanoi", "ha noi", "hcm", "saigon", "da nang", "danang", "hue", "techlead", "intalent", "magnet", "hsvn", "human", "hirex", "free"]);

export function companyAliases(name: string | null, website: string | null): string[] {
  const aliases = new Set<string>();
  if (name) {
    const full = words(name).trim();
    if (full.length >= 3) aliases.add(full);
    // Without the legal form and the country ("ntq consulting" from "NTQ Consulting Japan"), then without any generic word ("ntq").
    const mid = full.split(" ").filter((word) => word && !LEGAL_COUNTRY.has(word)).join(" ");
    if (mid && mid !== full && mid.includes(" ") && mid.length >= 6) aliases.add(mid);
    const core = full.split(" ").filter((word) => word && !GENERIC.has(word)).join(" ");
    if (core && core !== full && (core.length >= 4 || (core.length === 3 && !core.includes(" "))) && !COMMON.has(core)) aliases.add(core);
    // The first, distinctive word of a longer name ("sapphire" from "SAPPHIRE STREAM").
    const first = (core || full).split(" ")[0] ?? "";
    if ((core || full).includes(" ") && first.length >= 6 && !COMMON.has(first) && !GENERIC.has(first)) aliases.add(first);
  }
  if (website) {
    // The site's own name: "brisasoft" from brisasoft.com; never a generic label ("group" in group.ntt, "jobs", "careers").
    const host = website.toLowerCase().replace(/^[a-z]+:\/\//u, "").replace(/^www\d*\./u, "").split(/[/?#:]/u)[0] ?? "";
    const label = host.split(".").map((part) => part.replace(/[^a-z0-9]/gu, "")).find((part) => part.length >= 4 && !GENERIC.has(part) && !COMMON.has(part) && !SITE_WORDS.has(part)) ?? "";
    if (label) aliases.add(label);
  }
  return [...aliases];
}

export interface MatchCompany { id: number; name: string | null; website: string | null }

/**
 * Best companies for one group name (several when equally good). The company comes first in the group name
 * ("Softroad - Mai - Techlead + PM" is Softroad), so the earliest match wins, then the longest.
 */
export function matchGroup(groupName: string, companies: ReadonlyArray<MatchCompany & { aliases?: string[] }>): Array<{ id: number; score: number }> {
  if (!groupName.trim() || PLACEHOLDER_GROUP.test(groupName.trim())) return [];
  const haystack = words(groupName);
  const squashed = haystack.replace(/ /gu, "");
  const hits: Array<{ id: number; score: number; at: number }> = [];
  for (const company of companies) {
    let best: { score: number; at: number } | null = null;
    for (const alias of company.aliases ?? companyAliases(company.name, company.website)) {
      // Whole words ("kss" in "kss tri dev"), or a one-word alias glued in the group name ("vnext" in "x1 vnext mai").
      const word = haystack.indexOf(` ${alias} `);
      // Also with the spaces taken out: "t t design" (T&T Design) is "tt design" in a group name.
      const flat = alias.replace(/ /gu, "");
      const glued = flat.length >= (alias.includes(" ") ? 6 : 5) ? squashed.indexOf(flat) : -1;
      if (word < 0 && glued < 0) continue;
      const at = word >= 0 ? haystack.slice(0, word).replace(/ /gu, "").length : glued;
      const score = alias.replace(/ /gu, "").length;
      if (!best || at < best.at || (at === best.at && score > best.score)) best = { score, at };
    }
    if (best) hits.push({ id: company.id, ...best });
  }
  if (!hits.length) return [];
  const first = Math.min(...hits.map((hit) => hit.at));
  const early = hits.filter((hit) => hit.at === first);
  const longest = Math.max(...early.map((hit) => hit.score));
  return early.filter((hit) => hit.score === longest).slice(0, 5).map(({ id, score }) => ({ id, score }));
}
