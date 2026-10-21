import "server-only";

import { createHash } from "node:crypto";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { metadataName } from "@/modules/assistant/core/assistant-tools";
import { companyAliases, matchGroup } from "../core/group-match";
import { cvStatusParts, reportFingerprint } from "../core/partner-parse";
import { partnerReport } from "./partner-reports";

// Soda pins each company's Tình trạng CV in the company's Zalo groups once a day (instead of the AM):
// groups are the Soda (Trợ lý) nick's groups, linked to companies by name and confirmed by an AM; only
// groups whose message changed since the last pin get a new one. The sending goes through the group
// broadcast runner (8:00–21:00, paced, first part pinned).

type Db = ReturnType<typeof createPrivilegedClient>;
type Row = Record<string, unknown>;
const vn = (now: number) => { const date = new Date(now + 7 * 3600_000); return { day: date.toISOString().slice(0, 10), hour: date.getUTCHours(), minute: date.getUTCMinutes(), label: `${date.toISOString().slice(8, 10)}/${date.toISOString().slice(5, 7)}` }; };

async function sodaNick(db: Db, workspaceId: string) {
  const { data } = await db.from("assistant_bot_settings").select("channel_account_id").eq("workspace_id", workspaceId).maybeSingle();
  if (typeof data?.channel_account_id !== "string") return null;
  const { data: account } = await db.from("channel_accounts").select("id,display_name,status,operator_enabled").eq("id", data.channel_account_id).maybeSingle();
  return account ? { id: String(account.id), name: String(account.display_name ?? "Soda"), connected: account.status === "CONNECTED" && account.operator_enabled !== false } : null;
}

/** The Soda nick's Zalo groups (with a name, taken from another nick's copy when Soda's has none). */
export async function sodaGroups(db: Db, workspaceId: string) {
  const nick = await sodaNick(db, workspaceId);
  if (!nick) return { nick: null, groups: [] as Array<{ groupId: string; conversationId: string; name: string; lastMessageAt: string | null }> };
  const rows: Row[] = [];
  for (let page = 0; page < 5; page++) {
    const { data } = await db.from("omnichannel_conversations").select("id,provider_conversation_id,metadata,subject,last_message_at").eq("workspace_id", workspaceId).eq("channel_type", "ZALO").eq("channel_account_id", nick.id)
      .or("metadata->>isGroup.eq.true,metadata->>conversationKind.eq.GROUP,metadata->>threadType.eq.GROUP,metadata->>groupName.not.is.null")
      .order("last_message_at", { ascending: false, nullsFirst: false }).range(page * 1000, page * 1000 + 999);
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) break;
  }
  const groups = rows.filter((row) => typeof row.provider_conversation_id === "string").map((row) => ({ groupId: String(row.provider_conversation_id), conversationId: String(row.id),
    name: metadataName(row.metadata) || (typeof row.subject === "string" ? row.subject : "") || "", lastMessageAt: typeof row.last_message_at === "string" ? row.last_message_at : null }));
  const unnamed = groups.filter((group) => !group.name).map((group) => group.groupId);
  for (let offset = 0; offset < unnamed.length; offset += 200) {
    const { data } = await db.from("omnichannel_conversations").select("provider_conversation_id,metadata,subject").eq("workspace_id", workspaceId).eq("channel_type", "ZALO").in("provider_conversation_id", unnamed.slice(offset, offset + 200));
    for (const row of (data ?? []) as Row[]) {
      const name = metadataName(row.metadata) || (typeof row.subject === "string" ? row.subject : "");
      const group = groups.find((item) => item.groupId === row.provider_conversation_id && !item.name);
      if (group && name) group.name = name;
    }
  }
  return { nick, groups: groups.map((group) => ({ ...group, name: group.name || "Nhóm Zalo" })) };
}

/** New suggestions for groups not linked yet (confirmed and rejected pairs are never touched). */
export async function suggestPartnerGroups(workspaceId: string) {
  const db = createPrivilegedClient();
  const { groups } = await sodaGroups(db, workspaceId);
  if (!groups.length) return 0;
  const companies: Array<{ id: number; name: string | null; website: string | null; aliases: string[] }> = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await db.from("human_partners").select("partner_id,name,website").eq("workspace_id", workspaceId).eq("active", true).range(from, from + 999);
    for (const row of (data ?? []) as Row[]) companies.push({ id: Number(row.partner_id), name: (row.name as string | null) ?? null, website: (row.website as string | null) ?? null, aliases: companyAliases((row.name as string | null) ?? null, (row.website as string | null) ?? null) });
    if ((data ?? []).length < 1000) break;
  }
  const { data: existing } = await db.from("human_partner_groups").select("group_id,partner_id,status").eq("workspace_id", workspaceId).limit(20000);
  const known = new Set(((existing ?? []) as Row[]).map((row) => `${row.group_id}:${row.partner_id}`));
  const settled = new Set(((existing ?? []) as Row[]).filter((row) => row.status === "CONFIRMED").map((row) => String(row.group_id)));
  const rows = groups.filter((group) => !settled.has(group.groupId)).flatMap((group) => matchGroup(group.name, companies)
    .filter((match) => !known.has(`${group.groupId}:${match.id}`))
    .map((match) => ({ workspace_id: workspaceId, group_id: group.groupId, partner_id: match.id, group_name: group.name.slice(0, 300), score: match.score, status: "SUGGESTED" })));
  for (let offset = 0; offset < rows.length; offset += 500) await db.from("human_partner_groups").insert(rows.slice(offset, offset + 500));
  return rows.length;
}

/** Builds today's pins: one broadcast, each confirmed group with its company's message (only when it changed). */
export async function runCvPins(workspaceId: string, now = Date.now()): Promise<{ ok: boolean; message: string; broadcastId?: string }> {
  const db = createPrivilegedClient();
  const { data: settings } = await db.from("human_cv_pin_settings").select("enabled,enabled_by").eq("workspace_id", workspaceId).maybeSingle();
  const approver = typeof settings?.enabled_by === "string" ? settings.enabled_by : null;
  const finish = async (result: { ok: boolean; message: string; broadcastId?: string }) => {
    await db.from("human_cv_pin_settings").update({ last_run_date: vn(now).day, last_run_at: new Date(now).toISOString(), last_result: result.message.slice(0, 300) }).eq("workspace_id", workspaceId);
    return result;
  };
  if (!approver) return finish({ ok: false, message: "Chưa có người bật lịch ghim (người bật sẽ là người duyệt gửi)." });
  const { nick, groups } = await sodaGroups(db, workspaceId);
  if (!nick) return finish({ ok: false, message: "Chưa cài nick Soda (Trợ lý Zalo)." });
  if (!nick.connected) return finish({ ok: false, message: `Nick ${nick.name} đang mất kết nối.` });
  const { data: links } = await db.from("human_partner_groups").select("group_id,partner_id,group_name").eq("workspace_id", workspaceId).eq("status", "CONFIRMED").limit(5000);
  const byGroup = new Map<string, { partnerId: number; name: string }>();
  for (const row of (links ?? []) as Row[]) if (!byGroup.has(String(row.group_id))) byGroup.set(String(row.group_id), { partnerId: Number(row.partner_id), name: String(row.group_name ?? "") });
  const targets = groups.filter((group) => byGroup.has(group.groupId));
  if (!targets.length) return finish({ ok: true, message: "Chưa có nhóm nào được duyệt ghép với công ty." });
  // The last message pinned in each group, to skip groups where nothing changed.
  const { data: previous } = await db.from("zalo_broadcast_targets").select("group_id,content_hash,done_at").eq("workspace_id", workspaceId).not("content_hash", "is", null).eq("status", "SENT")
    .order("done_at", { ascending: false }).limit(10000);
  const lastHash = new Map<string, string>();
  for (const row of (previous ?? []) as Row[]) if (!lastHash.has(String(row.group_id))) lastHash.set(String(row.group_id), String(row.content_hash));
  const { data: codeRows } = await db.from("human_master_codes").select("master_id,name").eq("workspace_id", workspaceId).lt("master_id", 1000);
  const codes = Object.fromEntries(((codeRows ?? []) as Row[]).map((row) => [String(row.master_id), String(row.name)]));
  const partnerIds = [...new Set(targets.map((group) => byGroup.get(group.groupId)!.partnerId))];
  const { data: partners } = await db.from("human_partners").select("partner_id,name,data").eq("workspace_id", workspaceId).in("partner_id", partnerIds);
  const partnerById = new Map(((partners ?? []) as Row[]).map((row) => [Number(row.partner_id), row]));
  const messages = new Map<number, { parts: string[]; hash: string } | null>();
  let failed = 0;
  for (const partnerId of partnerIds) {
    const partner = partnerById.get(partnerId);
    if (!partner) { messages.set(partnerId, null); continue; }
    const report = await partnerReport(workspaceId, partnerId, reportFingerprint((partner.data ?? {}) as Record<string, unknown>)).catch(() => null);
    if (!report?.data || report.error) { failed += 1; messages.set(partnerId, null); continue; }
    const parts = cvStatusParts(report.data, codes);
    messages.set(partnerId, { parts, hash: createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32) });
  }
  const rows = targets.flatMap((group, position) => {
    const link = byGroup.get(group.groupId)!;
    const message = messages.get(link.partnerId);
    if (!message || lastHash.get(group.groupId) === message.hash) return [];
    return [{ workspace_id: workspaceId, conversation_id: group.conversationId, channel_account_id: nick.id, group_id: group.groupId, group_name: (group.name || link.name).slice(0, 300), position,
      pin_status: "NONE", message_pin_status: "PENDING", text_parts: message.parts, partner_id: link.partnerId, content_hash: message.hash }];
  });
  if (!rows.length) return finish({ ok: true, message: `Không nhóm nào có thay đổi (${targets.length} nhóm đã ghép)${failed ? `; ${failed} công ty chưa lấy được Tình trạng CV` : ""}.` });
  const { data: broadcast, error } = await db.from("zalo_broadcasts").insert({ workspace_id: workspaceId, name: `Tình trạng CV ${vn(now).label}`, text_content: "Tình trạng CV của từng công ty (mỗi nhóm một nội dung).",
    send_message: true, pin_message: true, pin_note: false, status: "RUNNING", daily_cap_per_nick: 100, min_gap_seconds: 30, max_gap_seconds: 60, window_start_hour: 8, window_end_hour: 21,
    created_by: approver, approved_by: approver, approved_at: new Date(now).toISOString(), source: "SCHEDULE", kind: "CV_STATUS" }).select("id").single();
  if (error || !broadcast) return finish({ ok: false, message: "Chưa tạo được đợt ghim." });
  const inserted = await db.from("zalo_broadcast_targets").insert(rows.map((row) => ({ ...row, broadcast_id: broadcast.id })));
  if (inserted.error) { await db.from("zalo_broadcasts").delete().eq("id", broadcast.id); return finish({ ok: false, message: "Chưa lưu được danh sách nhóm." }); }
  return finish({ ok: true, broadcastId: String(broadcast.id), message: `Đang ghim Tình trạng CV vào ${rows.length} nhóm (${targets.length - rows.length} nhóm không đổi${failed ? `, ${failed} công ty chưa lấy được` : ""}).` });
}

/** Every 5 minutes (alerts worker): today's run at the chosen time, and new group suggestions. */
export async function runDueCvPins(now = Date.now()) {
  const db = createPrivilegedClient();
  const { data } = await db.from("human_cv_pin_settings").select("workspace_id,run_hour,run_minute,last_run_date").eq("enabled", true);
  const time = vn(now);
  for (const row of (data ?? []) as Row[]) {
    const workspaceId = String(row.workspace_id);
    if (row.last_run_date === time.day || time.hour * 60 + time.minute < Number(row.run_hour) * 60 + Number(row.run_minute) || time.hour >= 21) continue;
    await suggestPartnerGroups(workspaceId).catch(() => 0);
    await runCvPins(workspaceId, now);
  }
}
