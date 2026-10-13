const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();

/** Keep anonymous previews useful without exposing employer, compensation or JD. */
export function containsJobDisclosure(text: string, jobs: Record<string, unknown>[]) {
  const value = normalize(text);
  if (/(?:https?:\/\/|www\.)|\d[\d.,\s–-]*(?:m\b|man\b|triệu|trieu|万円|円|vnd|usd|jpy)|[$¥₫]/iu.test(text)) return true;
  return jobs.some(job => ['company_name', 'salary_range', 'jd_link'].some(key => {
    const secret = typeof job[key] === 'string' ? normalize(job[key]) : '';
    return secret.length >= 2 && value.includes(secret);
  }));
}

export function anonymousJobPreviews(jobs: Record<string, unknown>[]) {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean).filter(Boolean);
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return undefined;
    // Drop whole clauses instead of rewriting a requirement into a false claim.
    return value.split(/\n|(?<=[.!;])\s+/u).filter(part => !containsJobDisclosure(part, jobs)).join(' ').trim() || undefined;
  };
  return jobs.map(job => Object.fromEntries([
    ['external_job_id', job.external_job_id],
    ...['candidate_type', 'location', 'japanese_level_min', 'japan_years_min', 'summary', 'requirements'].map(key => [key, clean(job[key])]),
  ]));
}
