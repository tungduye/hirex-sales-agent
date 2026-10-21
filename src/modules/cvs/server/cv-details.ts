import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { readHumanApiToken } from "@/modules/human-documents/server/api-sync";
import { HUMAN_CV_URL } from "../core/cv-parse";
import { detailSearchText, trimDetail, unwrapDetail } from "../core/cv-detail";

// Hồ sơ chi tiết per CV: Human answers one CV per request (GET /cv/{cvId}), so HireX asks a few at a time after each
// list update (only CVs that changed) and keeps a copy; opening a CV fetches it again when the copy is over an hour old.

const STALE_MS = 60 * 60 * 1000;
const running = new Set<string>();
type Db = ReturnType<typeof createPrivilegedClient>;

async function fetchDetail(token: string, cvId: number) {
  const response = await fetch(`${HUMAN_CV_URL}/${cvId}`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  if (response.status === 401 || response.status === 403) throw Error("HUMAN_TOKEN_EXPIRED");
  if (!response.ok) throw Error(`HUMAN_HTTP_${response.status}`);
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) throw Error("RESPONSE_TOO_LARGE");
  const detail = unwrapDetail(text ? JSON.parse(text) : null);
  if (!detail) throw Error("EMPTY_DETAIL");
  return trimDetail(detail) as Record<string, unknown>;
}

async function save(db: Db, workspaceId: string, cvId: number, fingerprint: string | null, detail: Record<string, unknown> | null, error: string | null) {
  await db.from("human_cvs").update(detail
    ? { detail, detail_fingerprint: fingerprint, detail_fetched_at: new Date().toISOString(), detail_error: null, detail_search: detailSearchText(detail) }
    : { detail_fetched_at: new Date().toISOString(), detail_error: (error ?? "FAILED").slice(0, 100) }).eq("workspace_id", workspaceId).eq("cv_id", cvId);
}

/** After a list update: fetch the hồ sơ of CVs that are new or changed (4 at a time, at most 4,000 per run). Background. */
export async function refreshCvDetails(workspaceId: string) {
  if (running.has(workspaceId)) return 0;
  running.add(workspaceId);
  try {
    const token = await readHumanApiToken(workspaceId);
    if (!token) return 0;
    const db = createPrivilegedClient();
    const queue: Array<{ cvId: number; fingerprint: string | null }> = [];
    for (let from = 0; from < 200_000 && queue.length < 4000; from += 1000) {
      const { data } = await db.from("human_cvs").select("cv_id,fingerprint,detail_fingerprint,detail_error,detail_fetched_at").eq("workspace_id", workspaceId).eq("active", true).order("cv_id", { ascending: false }).range(from, from + 999);
      for (const row of data ?? []) {
        // A failed fetch is retried after a day, not on every run.
        const retryLater = row.detail_error && Date.now() - Date.parse(String(row.detail_fetched_at)) < 24 * 3_600_000;
        if (!retryLater && (row.detail_fingerprint !== row.fingerprint || row.detail_fingerprint == null)) queue.push({ cvId: Number(row.cv_id), fingerprint: row.fingerprint as string | null });
      }
      if ((data ?? []).length < 1000) break;
    }
    let done = 0, stop = false;
    const worker = async () => {
      while (!stop) {
        const item = queue.shift();
        if (!item) return;
        try { await save(db, workspaceId, item.cvId, item.fingerprint, await fetchDetail(token, item.cvId), null); done += 1; }
        catch (error) {
          const code = error instanceof Error ? error.message.slice(0, 100) : "FAILED";
          if (code === "HUMAN_TOKEN_EXPIRED") { stop = true; return; }
          await save(db, workspaceId, item.cvId, item.fingerprint, null, code);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return done;
  } finally { running.delete(workspaceId); }
}

/** One CV's hồ sơ for the detail panel: the copy, or a fresh one when missing, changed or older than an hour. */
export async function cvDetail(workspaceId: string, cvId: number) {
  const db = createPrivilegedClient();
  const { data: row } = await db.from("human_cvs").select("detail,detail_fingerprint,fingerprint,detail_fetched_at,detail_error").eq("workspace_id", workspaceId).eq("cv_id", cvId).maybeSingle();
  if (!row) return null;
  const fresh = row.detail && row.detail_fingerprint === row.fingerprint && Date.now() - Date.parse(String(row.detail_fetched_at)) < STALE_MS;
  if (fresh) return { detail: row.detail as Record<string, unknown>, fetchedAt: String(row.detail_fetched_at), error: null };
  const token = await readHumanApiToken(workspaceId).catch(() => null);
  if (!token) return { detail: (row.detail as Record<string, unknown> | null) ?? null, fetchedAt: row.detail_fetched_at as string | null, error: "NO_TOKEN" };
  try {
    const detail = await fetchDetail(token, cvId);
    await save(db, workspaceId, cvId, row.fingerprint as string | null, detail, null);
    return { detail, fetchedAt: new Date().toISOString(), error: null };
  } catch (error) {
    return { detail: (row.detail as Record<string, unknown> | null) ?? null, fetchedAt: row.detail_fetched_at as string | null, error: error instanceof Error ? error.message : "FAILED" };
  }
}
