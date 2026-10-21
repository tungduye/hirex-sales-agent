import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { readHumanApiToken } from "@/modules/human-documents/server/api-sync";
import { HUMAN_PARTNER_PAGE_SIZE, HUMAN_PARTNER_URL, mapPartner, parsePartnerPage, partnerFilter, reportFingerprint, type MappedPartner } from "../core/partner-parse";
import { refreshPartnerReports } from "./partner-reports";

const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;
const running = new Set<string>();

async function fetchBlock(token: string, blockId: number) {
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < 20; page += 1) {
    const url = `${HUMAN_PARTNER_URL}?page=${page}&size=${HUMAN_PARTNER_PAGE_SIZE}&sort=partner_id%2Cdesc`;
    const response = await fetch(url, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(90_000),
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(partnerFilter(blockId)) });
    if (response.status === 401 || response.status === 403) throw Error("HUMAN_TOKEN_EXPIRED");
    if (!response.ok) throw Error(`HUMAN_HTTP_${response.status}`);
    const text = await response.text();
    if (text.length > 64 * 1024 * 1024) throw Error("RESPONSE_TOO_LARGE");
    const parsed = parsePartnerPage(JSON.parse(text));
    rows.push(...parsed.rows);
    if (parsed.rows.length < HUMAN_PARTNER_PAGE_SIZE || (parsed.total !== null && rows.length >= parsed.total)) break;
  }
  return rows;
}

/** Copies the customers of every enabled block from Human. A failed block keeps its old rows. */
export async function syncHumanPartners(workspaceId: string, trigger: "MANUAL" | "SCHEDULE", startedBy: string | null): Promise<{ ok: boolean; rows: number; message: string }> {
  if (running.has(workspaceId)) return { ok: false, rows: 0, message: "Đang cập nhật, vui lòng chờ." };
  running.add(workspaceId);
  const db = createPrivilegedClient();
  const startedAt = new Date().toISOString();
  const { data: log } = await db.from("human_partner_syncs").insert({ workspace_id: workspaceId, trigger, started_by: startedBy }).select("id").single();
  const finish = async (ok: boolean, rows: number, error: string | null) => {
    if (log?.id) await db.from("human_partner_syncs").update({ finished_at: new Date().toISOString(), ok, rows, error }).eq("id", log.id);
  };
  try {
    const token = await readHumanApiToken(workspaceId);
    if (!token) { await finish(false, 0, "NO_TOKEN"); return { ok: false, rows: 0, message: "Chưa có token Human. Admin dán token trong \"Cài đặt API Human\"." }; }
    const { data: blocks } = await db.from("human_partner_blocks").select("block_id").eq("workspace_id", workspaceId).eq("enabled", true).order("sort");
    const blockIds = (blocks ?? []).map((row) => Number(row.block_id)).filter(Number.isSafeInteger);
    if (!blockIds.length) { await finish(false, 0, "NO_BLOCKS"); return { ok: false, rows: 0, message: "Chưa bật khối nào trong Cài đặt." }; }
    // The company's bộ mã: codes become names (Hạng 1, Doing, Hà Nội, …).
    const codes = new Map<number, string>();
    for (let from = 0; from < 20000; from += 1000) {
      const { data: codeRows } = await db.from("human_master_codes").select("master_id,name").eq("workspace_id", workspaceId).range(from, from + 999);
      for (const row of codeRows ?? []) codes.set(Number(row.master_id), String(row.name));
      if ((codeRows ?? []).length < 1000) break;
    }
    const partners = new Map<number, MappedPartner & { block_ids: number[] }>();
    const failed: string[] = [];
    for (const blockId of blockIds) {
      try {
        const rows = await fetchBlock(token, blockId);
        let count = 0;
        for (const row of rows) {
          const mapped = mapPartner(row, codes);
          if (!mapped) continue;
          count += 1;
          const previous = partners.get(mapped.partner_id);
          partners.set(mapped.partner_id, { ...mapped, block_ids: [...new Set([...(previous?.block_ids ?? []), blockId])] });
        }
        await db.from("human_partner_blocks").update({ last_synced_at: new Date().toISOString(), last_count: count, last_error: null }).eq("workspace_id", workspaceId).eq("block_id", blockId);
      } catch (error) {
        const code = error instanceof Error ? error.message : "FAILED";
        failed.push(`${blockId}: ${code}`);
        await db.from("human_partner_blocks").update({ last_error: code.slice(0, 200) }).eq("workspace_id", workspaceId).eq("block_id", blockId);
        if (code === "HUMAN_TOKEN_EXPIRED") break;
      }
    }
    const rows = [...partners.values()].map((partner) => ({ ...partner, workspace_id: workspaceId, active: true, synced_at: new Date().toISOString() }));
    for (let offset = 0; offset < rows.length; offset += 500) {
      const { error } = await db.from("human_partners").upsert(rows.slice(offset, offset + 500), { onConflict: "workspace_id,partner_id" });
      if (error) throw Error("SAVE_FAILED");
    }
    // Customers no longer in any enabled block are hidden, only after every block came back.
    if (!failed.length) await db.from("human_partners").update({ active: false }).eq("workspace_id", workspaceId).eq("active", true).lt("synced_at", startedAt);
    // Sale / AM ids seen in the data, so an admin can link them to HireX members.
    const people = new Map<string, string | null>();
    for (const partner of partners.values()) for (const [id, name] of [[partner.sale_human_id, partner.sale_name], [partner.am_human_id, partner.am_name], [partner.am2_human_id, partner.am2_name]] as const)
      if (id && !people.has(id)) people.set(id, name && name !== id ? name : null);
    if (people.size) {
      const { data: known } = await db.from("human_user_links").select("human_user_id").eq("workspace_id", workspaceId);
      const have = new Set((known ?? []).map((row) => String(row.human_user_id)));
      const fresh = [...people].filter(([id]) => !have.has(id)).map(([id, name]) => ({ workspace_id: workspaceId, human_user_id: id, human_name: name }));
      for (let offset = 0; offset < fresh.length; offset += 500) await db.from("human_user_links").insert(fresh.slice(offset, offset + 500));
      for (const [id, name] of people) if (name && have.has(id)) await db.from("human_user_links").update({ human_name: name }).eq("workspace_id", workspaceId).eq("human_user_id", id).is("human_name", null);
    }
    // Human ids no longer Sale/AM of any customer and never linked (e.g. AM rankings read as people by the first version): removed.
    if (!failed.length) {
      const { data: stale } = await db.from("human_user_links").select("human_user_id").eq("workspace_id", workspaceId).is("profile_id", null);
      const gone = (stale ?? []).map((row) => String(row.human_user_id)).filter((id) => !people.has(id));
      for (let offset = 0; offset < gone.length; offset += 100) await db.from("human_user_links").delete().eq("workspace_id", workspaceId).is("profile_id", null).in("human_user_id", gone.slice(offset, offset + 100));
    }
    await finish(!failed.length, rows.length, failed.length ? failed.join("; ").slice(0, 500) : null);
    // Tình trạng CV of the companies whose counts or status changed, in the background (one request per company).
    void refreshPartnerReports(workspaceId, [...partners.values()].map((partner) => ({ partnerId: partner.partner_id, fingerprint: reportFingerprint(partner.data) })))
      .catch((error) => console.error("[customers] CV reports failed", error instanceof Error ? error.message : error));
    if (failed.some((item) => item.includes("HUMAN_TOKEN_EXPIRED"))) return { ok: false, rows: rows.length, message: "Token Human đã hết hạn. Admin dán token mới trong \"Cài đặt API Human\"; dữ liệu cũ được giữ." };
    return failed.length
      ? { ok: false, rows: rows.length, message: `Cập nhật ${rows.length.toLocaleString("vi-VN")} khách; khối lỗi: ${failed.join(", ")}. Khách của khối lỗi giữ bản cũ.` }
      : { ok: true, rows: rows.length, message: `Đã cập nhật ${rows.length.toLocaleString("vi-VN")} khách hàng từ ${blockIds.length} khối.` };
  } catch (error) {
    await finish(false, 0, error instanceof Error ? error.message.slice(0, 200) : "FAILED");
    return { ok: false, rows: 0, message: "Chưa cập nhật được từ Human; dữ liệu cũ được giữ nguyên." };
  } finally { running.delete(workspaceId); }
}

/** Every 6 hours per workspace that has a token and enabled blocks (called by the alerts worker every 5 minutes). */
export async function runDueHumanPartnerSyncs() {
  const db = createPrivilegedClient();
  const { data: blocks } = await db.from("human_partner_blocks").select("workspace_id").eq("enabled", true);
  for (const workspaceId of new Set((blocks ?? []).map((row) => String(row.workspace_id)))) {
    const { data: last } = await db.from("human_partner_syncs").select("started_at").eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.started_at && Date.now() - Date.parse(String(last.started_at)) < SYNC_EVERY_MS) continue;
    if (!await readHumanApiToken(workspaceId).catch(() => null)) continue;
    await syncHumanPartners(workspaceId, "SCHEDULE", null);
  }
}
