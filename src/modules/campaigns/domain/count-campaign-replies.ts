// Page through only replies; never infer totals from a truncated embedded audience.
export async function countCampaignReplies(
  fetchPage: (after: string | null) => Promise<Array<{ id: string; campaign_id: string }>>,
) {
  const counts = new Map<string, number>();
  let after: string | null = null;
  for (;;) {
    const rows = await fetchPage(after);
    if (!rows.length) return counts;
    const last = rows[rows.length - 1].id;
    if (last === after) throw new Error("REPLY_PAGINATION_STALLED");
    for (const row of rows) counts.set(row.campaign_id, (counts.get(row.campaign_id) ?? 0) + 1);
    after = last;
  }
}
