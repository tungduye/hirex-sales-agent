import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { readHumanApiToken } from "@/modules/human-documents/server/api-sync";
import { HUMAN_PARTNER_REPORT_URL, cvReportCounts } from "../core/partner-parse";

// Tình trạng CV per company: Human answers one company per request, so HireX asks a few at a time and keeps
// a copy; a company is asked again only when its counts / status changed (fingerprint) or the copy is old.

const STALE_MS = 60 * 60 * 1000;

async function saveCounts(db: ReturnType<typeof createPrivilegedClient>, workspaceId: string, partnerId: number, data: unknown) {
  const counts = cvReportCounts(data);
  if (counts) await db.from("human_partners").update(counts).eq("workspace_id", workspaceId).eq("partner_id", partnerId);
}
const running = new Set<string>();

async function fetchReport(token: string, partnerId: number) {
  const response = await fetch(HUMAN_PARTNER_REPORT_URL(partnerId), { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  if (response.status === 401 || response.status === 403) throw Error("HUMAN_TOKEN_EXPIRED");
  if (!response.ok) throw Error(`HUMAN_HTTP_${response.status}`);
  const text = await response.text();
  if (text.length > 4 * 1024 * 1024) throw Error("RESPONSE_TOO_LARGE");
  return text ? JSON.parse(text) as unknown : null;
}

/** After a list update: fetch the reports whose fingerprint changed (4 at a time). Runs in the background. */
export async function refreshPartnerReports(workspaceId: string, wanted: Array<{ partnerId: number; fingerprint: string }>) {
  if (running.has(workspaceId)) return;
  running.add(workspaceId);
  try {
    const token = await readHumanApiToken(workspaceId);
    if (!token) return;
    const db = createPrivilegedClient();
    const known = new Map<number, string | null>();
    for (let from = 0; from < 100_000; from += 1000) {
      const { data } = await db.from("human_partner_reports").select("partner_id,fingerprint,error").eq("workspace_id", workspaceId).range(from, from + 999);
      for (const row of data ?? []) known.set(Number(row.partner_id), row.error ? null : (row.fingerprint as string | null));
      if ((data ?? []).length < 1000) break;
    }
    const queue = wanted.filter((item) => known.get(item.partnerId) !== item.fingerprint);
    let stop = false;
    const worker = async () => {
      while (!stop) {
        const item = queue.shift();
        if (!item) return;
        try {
          const data = await fetchReport(token, item.partnerId);
          await db.from("human_partner_reports").upsert({ workspace_id: workspaceId, partner_id: item.partnerId, data, fingerprint: item.fingerprint, fetched_at: new Date().toISOString(), error: null }, { onConflict: "workspace_id,partner_id" });
          await saveCounts(db, workspaceId, item.partnerId, data);
        } catch (error) {
          const code = error instanceof Error ? error.message.slice(0, 100) : "FAILED";
          if (code === "HUMAN_TOKEN_EXPIRED") { stop = true; return; }
          await db.from("human_partner_reports").upsert({ workspace_id: workspaceId, partner_id: item.partnerId, fingerprint: null, fetched_at: new Date().toISOString(), error: code }, { onConflict: "workspace_id,partner_id" });
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    // Copies fetched before the counts existed: fill the counts from the kept report.
    const { data: missing } = await db.from("human_partners").select("partner_id").eq("workspace_id", workspaceId).is("report_waiting", null).limit(5000);
    const ids = (missing ?? []).map((row) => Number(row.partner_id));
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data: copies } = await db.from("human_partner_reports").select("partner_id,data").eq("workspace_id", workspaceId).in("partner_id", ids.slice(offset, offset + 100)).not("data", "is", null);
      for (const copy of copies ?? []) await saveCounts(db, workspaceId, Number(copy.partner_id), copy.data);
    }
  } finally { running.delete(workspaceId); }
}

/** One company's report for the detail panel: the copy, or a fresh one when the copy is missing or older than an hour. */
export async function partnerReport(workspaceId: string, partnerId: number, fingerprint: string | null) {
  const db = createPrivilegedClient();
  const { data: copy } = await db.from("human_partner_reports").select("data,fetched_at,error,fingerprint").eq("workspace_id", workspaceId).eq("partner_id", partnerId).maybeSingle();
  const fresh = copy && !copy.error && Date.now() - Date.parse(String(copy.fetched_at)) < STALE_MS && (!fingerprint || copy.fingerprint === fingerprint);
  if (fresh) return { data: copy.data as unknown, fetchedAt: String(copy.fetched_at), error: null };
  const token = await readHumanApiToken(workspaceId).catch(() => null);
  if (!token) return copy ? { data: copy.data as unknown, fetchedAt: String(copy.fetched_at), error: "NO_TOKEN" } : null;
  try {
    const data = await fetchReport(token, partnerId);
    const fetchedAt = new Date().toISOString();
    await db.from("human_partner_reports").upsert({ workspace_id: workspaceId, partner_id: partnerId, data, fingerprint, fetched_at: fetchedAt, error: null }, { onConflict: "workspace_id,partner_id" });
    await saveCounts(db, workspaceId, partnerId, data);
    return { data, fetchedAt, error: null };
  } catch (error) {
    return { data: copy?.data as unknown ?? null, fetchedAt: copy ? String(copy.fetched_at) : null, error: error instanceof Error ? error.message : "FAILED" };
  }
}
