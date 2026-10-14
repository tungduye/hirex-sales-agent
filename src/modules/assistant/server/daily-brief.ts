import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { composeBrief, vietnamDate, WAIT_HOURS, type BriefInput, type DailyBrief } from "@/modules/assistant/core/daily-brief";
import { toolsFor } from "@/modules/assistant/core/assistant-tools";
import { listWaitingConversations, runReadTool, type ToolScope } from "@/modules/assistant/server/assistant-tool-runner";

// Builds "Bản tin hôm nay" from the same read-only helpers the assistant uses, with the member's own
// session and permissions, and caches one copy per member per Vietnam day. No AI call: it is fast,
// free and exact. The first visit of the day builds it; later visits reuse it for FRESH_MS.

const FRESH_MS = 30 * 60_000;
const MIN_REFRESH_MS = 60_000;

export type BriefResult = { ok: true; brief: DailyBrief; cached: boolean } | { ok: false; message: string };

type Row = Record<string, unknown>;
const rows = (value: unknown) => (Array.isArray(value) ? value : []) as Row[];
const str = (value: unknown) => (typeof value === "string" ? value : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const hasError = (value: unknown) => !value || typeof value !== "object" || "loi" in (value as Row);

/** Runs one section; a failure only marks that section as not loaded. */
async function section<T>(enabled: boolean, load: () => Promise<T | null>): Promise<T | null | undefined> {
  if (!enabled) return undefined;
  try { return await load(); } catch (error) { console.error("[brief] section failed", error instanceof Error ? error.message.slice(0, 80) : error); return null; }
}

async function gather(scope: ToolScope, allowed: Set<string>, now: Date): Promise<BriefInput> {
  const [inbox, channels, emailWorker, campaigns, tasks, aiRecruiter] = await Promise.all([
    section(allowed.has("hoi_thoai_cho_tra_loi"), async () => {
      const result = await listWaitingConversations(scope.workspaceId, WAIT_HOURS);
      if ("loi" in result) return null;
      return { waiting: result.rows.map((row) => ({ name: row.name, channel: row.channel, account: row.account, hours: row.hours, group: row.group, automated: row.automated, link: row.link })) };
    }),
    section(allowed.has("tinh_trang_kenh"), async () => {
      const data = await runReadTool("tinh_trang_kenh", {}, scope) as Row;
      if (hasError(data) || (data.tai_khoan_kenh as Row | undefined)?.loi) return null;
      return {
        problems: rows(data.kenh_can_xu_ly).map((row) => ({ channel: String(row.kenh), name: str(row.ten), reason: str(row.ly_do) ?? (row.trang_thai !== "CONNECTED" ? String(row.trang_thai) : row.bat_boi_nguoi_van_hanh === false ? "đang tắt" : null) })),
        gmailProblems: rows(data.gmail_can_xu_ly).map((row) => ({ email: String(row.email), status: String(row.trang_thai) })),
      };
    }),
    section(allowed.has("tinh_trang_bo_gui_email"), async () => {
      const data = await runReadTool("tinh_trang_bo_gui_email", {}, scope) as Row;
      return hasError(data) ? null : { state: String(data.trang_thai) };
    }),
    section(allowed.has("chien_dich"), async () => {
      const data = await runReadTool("chien_dich", { kenh: "TAT_CA", tu_khoa: null, trang_thai: "RUNNING" }, scope) as Row;
      const running: NonNullable<BriefInput["campaigns"]>["running"] = [];
      for (const [key, channel] of [["email", "EMAIL"], ["zalo", "ZALO"], ["facebook_ca_nhan", "FACEBOOK_PROFILE"]] as const) {
        const group = data[key] as Row | undefined;
        if (!group || "loi" in group) continue;
        for (const row of rows(group.chien_dich)) running.push({ name: String(row.ten), channel, sent: num(row.da_gui), failed: typeof row.loi === "number" ? row.loi : null, link: String(row.link) });
      }
      return { running };
    }),
    section(allowed.has("cong_viec"), async () => {
      const data = await runReadTool("cong_viec", { chi_cua_toi: true, bao_gom_da_xong: false }, scope) as Row;
      return hasError(data) ? null : { open: rows(data.cong_viec).map((row) => ({ title: String(row.tieu_de ?? ""), dueAt: str(row.han), link: String(row.link) })) };
    }),
    section(allowed.has("trang_thai_ai_recruiter"), async () => {
      const data = await runReadTool("trang_thai_ai_recruiter", {}, scope) as Row;
      return hasError(data) ? null : { errors: Object.fromEntries(Object.entries((data.ma_loi_24h ?? {}) as Row).map(([code, count]) => [code, num(count)])) };
    }),
  ]);
  return { now, inbox, channels, emailWorker, campaigns, tasks, aiRecruiter };
}

/** Today's brief for the signed-in member; rebuilt when older than 30 minutes or on refresh. */
export async function getDailyBrief({ refresh }: { refresh: boolean }): Promise<BriefResult> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  const workspaceId = account.workspaceId;
  const now = new Date();
  const date = vietnamDate(now);
  const db = createPrivilegedClient();
  const { data: cached } = await db.from("assistant_daily_briefs").select("content,generated_at")
    .eq("workspace_id", workspaceId).eq("user_id", account.userId).eq("brief_date", date).maybeSingle();
  if (cached) {
    const age = now.getTime() - Date.parse(cached.generated_at);
    if (age < (refresh ? MIN_REFRESH_MS : FRESH_MS)) return { ok: true, brief: cached.content as DailyBrief, cached: true };
  }

  const isAdmin = await isWorkspaceAdmin();
  const allowed = new Set(toolsFor(account.permissions, isAdmin).map((tool) => tool.name));
  const scope: ToolScope = { workspaceId, userId: account.userId, context: { workspaceId, userId: account.userId, permissions: account.permissions, isAdmin }, proposals: [] };
  const brief = composeBrief(await gather(scope, allowed, now));
  const { error } = await db.from("assistant_daily_briefs").upsert(
    { workspace_id: workspaceId, user_id: account.userId, brief_date: date, content: brief, generated_at: brief.generatedAt },
    { onConflict: "workspace_id,user_id,brief_date" },
  );
  if (error) console.error("[brief] cache write failed", error.code);
  return { ok: true, brief, cached: false };
}
