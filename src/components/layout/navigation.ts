// Exactly one item is highlighted: the one whose href is the longest prefix of the current path.
// (Previously "/settings" also lit up on /settings/ai-recruiter.)
export function activeNavigationHref(pathname: string, hrefs: string[]) {
  let best: string | null = null;
  for (const href of hrefs) {
    const matches = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (!best || href.length > best.length)) best = href;
  }
  return best;
}
