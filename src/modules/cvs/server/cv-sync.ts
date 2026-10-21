import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { readHumanApiToken } from "@/modules/human-documents/server/api-sync";
import { cvFilter, HUMAN_CV_PAGE_SIZE, HUMAN_CV_URL, mapCv, parseCvPage, type MappedCv } from "../core/cv-parse";

// Màn CV: copies the CVs of every enabled block from Human (by hand, or every 6 hours from the alerts worker).
// A failed block keeps its old rows; CVs no longer in any block are hidden only after every block came back.

const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;
const running = new Set<string>();

function vietnamToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function fetchBlock(token: string, blockKey: string) {
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < 60; page += 1) {
    const url = `${HUMAN_CV_URL}?page=${page}&size=${HUMAN_CV_PAGE_SIZE}&sort=cvId%2ChistoryId%2Cdesc`;
    const response = await fetch(url, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(120_000),
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(cvFilter(blockKey, vietnamToday())) });
    if (response.status === 401 || response.status === 403) throw Error("HUMAN_TOKEN_EXPIRED");
    if (!response.ok) throw Error(`HUMAN_HTTP_${response.status}`);
    const text = await response.text();
    if (text.length > 96 * 1024 * 1024) throw Error("RESPONSE_TOO_LARGE");
    const parsed = parseCvPage(JSON.parse(text));
    rows.push(...parsed.rows);
    if (parsed.rows.length < HUMAN_CV_PAGE_SIZE || (parsed.total !== null && rows.length >= parsed.total)) break;
  }
  return rows;
}

async function codeNames(db: ReturnType<typeof createPrivilegedClient>, workspaceId: string) {
  const codes = new Map<number, string>();
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await db.from("human_master_codes").select("master_id,name").eq("workspace_id", workspaceId).range(from, from + 999);
    for (const row of data ?? []) codes.set(Number(row.master_id), String(row.name));
    if ((data ?? []).length < 1000) break;
  }
  return codes;
}

export async function syncHumanCvs(workspaceId: string, trigger: "MANUAL" | "SCHEDULE", startedBy: string | null): Promise<{ ok: boolean; rows: number; message: string }> {
  if (running.has(workspaceId)) return { ok: false, rows: 0, message: "Đang cập nhật, vui lòng chờ." };
  running.add(workspaceId);
  const db = createPrivilegedClient();
  const startedAt = new Date().toISOString();
  const { data: log } = await db.from("human_cv_syncs").insert({ workspace_id: workspaceId, trigger, started_by: startedBy }).select("id").single();
  const finish = async (ok: boolean, rows: number, error: string | null) => {
    if (log?.id) await db.from("human_cv_syncs").update({ finished_at: new Date().toISOString(), ok, rows, error }).eq("id", log.id);
  };
  try {
    const token = await readHumanApiToken(workspaceId);
    if (!token) { await finish(false, 0, "NO_TOKEN"); return { ok: false, rows: 0, message: "Chưa có token Human. Admin dán token trong \"Cài đặt API Human\"." }; }
    const { data: blocks } = await db.from("human_cv_blocks").select("block_key").eq("workspace_id", workspaceId).eq("enabled", true).order("sort");
    const blockKeys = (blocks ?? []).map((row) => String(row.block_key));
    if (!blockKeys.length) { await finish(false, 0, "NO_BLOCKS"); return { ok: false, rows: 0, message: "Chưa bật khối CV nào trong Cài đặt." }; }
    const codes = await codeNames(db, workspaceId);
    const cvs = new Map<number, MappedCv & { block_keys: string[]; history_count: number }>();
    const failed: string[] = [];
    for (const blockKey of blockKeys) {
      try {
        const rows = await fetchBlock(token, blockKey);
        const seen = new Set<number>();
        for (const row of rows) {
          const mapped = mapCv(row, codes);
          if (!mapped) continue;
          seen.add(mapped.cv_id);
          const previous = cvs.get(mapped.cv_id);
          // Rows come newest history first: the first one of a CV is kept, the others only counted.
          if (previous) { previous.history_count += 1; if (!previous.block_keys.includes(blockKey)) previous.block_keys.push(blockKey); continue; }
          cvs.set(mapped.cv_id, { ...mapped, block_keys: [blockKey], history_count: 1 });
        }
        await db.from("human_cv_blocks").update({ last_synced_at: new Date().toISOString(), last_count: seen.size, last_error: null }).eq("workspace_id", workspaceId).eq("block_key", blockKey);
      } catch (error) {
        const code = error instanceof Error ? error.message : "FAILED";
        failed.push(`${blockKey}: ${code}`);
        await db.from("human_cv_blocks").update({ last_error: code.slice(0, 200) }).eq("workspace_id", workspaceId).eq("block_key", blockKey);
        if (code === "HUMAN_TOKEN_EXPIRED") break;
      }
    }
    const now = new Date().toISOString();
    const rows = [...cvs.values()].map((cv) => ({ ...cv, workspace_id: workspaceId, active: true, synced_at: now }));
    for (let offset = 0; offset < rows.length; offset += 500) {
      const { error } = await db.from("human_cvs").upsert(rows.slice(offset, offset + 500), { onConflict: "workspace_id,cv_id" });
      if (error) throw Error("SAVE_FAILED");
    }
    if (!failed.length) await db.from("human_cvs").update({ active: false }).eq("workspace_id", workspaceId).eq("active", true).lt("synced_at", startedAt);
    // Rec ids seen in the CVs, so an admin can link them to HireX members (same table as Sale / AM).
    const people = new Map<string, string | null>();
    for (const cv of cvs.values()) if (cv.recer_human_id && !people.has(cv.recer_human_id)) people.set(cv.recer_human_id, cv.recer_name && cv.recer_name !== cv.recer_human_id ? cv.recer_name : null);
    if (people.size) {
      const { data: known } = await db.from("human_user_links").select("human_user_id,human_name").eq("workspace_id", workspaceId);
      const have = new Map((known ?? []).map((row) => [String(row.human_user_id), row.human_name as string | null]));
      const fresh = [...people].filter(([id]) => !have.has(id)).map(([id, name]) => ({ workspace_id: workspaceId, human_user_id: id, human_name: name }));
      for (let offset = 0; offset < fresh.length; offset += 500) await db.from("human_user_links").insert(fresh.slice(offset, offset + 500));
      for (const [id, name] of people) if (name && have.has(id) && !have.get(id)) await db.from("human_user_links").update({ human_name: name }).eq("workspace_id", workspaceId).eq("human_user_id", id);
    }
    await finish(!failed.length, rows.length, failed.length ? failed.join("; ").slice(0, 500) : null);
    if (failed.some((item) => item.includes("HUMAN_TOKEN_EXPIRED"))) return { ok: false, rows: rows.length, message: "Token Human đã hết hạn. Admin dán token mới trong \"Cài đặt API Human\"; dữ liệu cũ được giữ." };
    return failed.length
      ? { ok: false, rows: rows.length, message: `Cập nhật ${rows.length.toLocaleString("vi-VN")} CV; khối lỗi: ${failed.join(", ")}. CV của khối lỗi giữ bản cũ.` }
      : { ok: true, rows: rows.length, message: `Đã cập nhật ${rows.length.toLocaleString("vi-VN")} CV từ ${blockKeys.length} khối.` };
  } catch (error) {
    await finish(false, 0, error instanceof Error ? error.message.slice(0, 200) : "FAILED");
    return { ok: false, rows: 0, message: "Chưa cập nhật được CV từ Human; dữ liệu cũ được giữ nguyên." };
  } finally { running.delete(workspaceId); }
}

/** Every 6 hours per workspace that has a token and enabled CV blocks (called by the alerts worker every 5 minutes). */
export async function runDueHumanCvSyncs() {
  const db = createPrivilegedClient();
  const { data: blocks } = await db.from("human_cv_blocks").select("workspace_id").eq("enabled", true);
  for (const workspaceId of new Set((blocks ?? []).map((row) => String(row.workspace_id)))) {
    const { data: last } = await db.from("human_cv_syncs").select("started_at").eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.started_at && Date.now() - Date.parse(String(last.started_at)) < SYNC_EVERY_MS) continue;
    if (!await readHumanApiToken(workspaceId).catch(() => null)) continue;
    await syncHumanCvs(workspaceId, "SCHEDULE", null);
  }
}
