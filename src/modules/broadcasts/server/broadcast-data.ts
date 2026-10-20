import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";
import { metadataName } from "@/modules/assistant/core/assistant-tools";
import { assignNicks, BROADCAST_DEFAULTS, MAX_TARGETS_PER_BROADCAST } from "../core/broadcast-plan";

// Gửi hàng loạt vào nhóm Zalo, server side. Tables are service-role only; every read and write here
// checks "Gửi hàng loạt Zalo" (broadcasts.view / broadcasts.manage) and the member's nick scope: a member
// only uses, and only sees, nicks they may access; starting, pausing and cancelling is for the creator or
// an administrator.

export interface BroadcastContext { workspaceId: string; userId: string; permissions: readonly string[]; isAdmin: boolean }
type Row = Record<string, unknown>;
type Db = ReturnType<typeof createPrivilegedClient>;
const can = (context: BroadcastContext, action: "view" | "manage") => context.isAdmin || context.permissions.includes(`broadcasts.${action}`);

export interface GroupOption { groupId: string; name: string; lastMessageAt: string | null; accounts: Array<{ accountId: string; conversationId: string }> }
export interface NickOption { id: string; name: string; status: string }

/** Zalo nicks the member may use (connected ones first). */
export async function broadcastNicks(context: BroadcastContext): Promise<NickOption[]> {
  const db = createPrivilegedClient();
  const accessible = await getAccessibleChannelAccountIds();
  let query = db.from("channel_accounts").select("id,display_name,status").eq("workspace_id", context.workspaceId).eq("channel_type", "ZALO").is("deleted_at", null);
  if (accessible) query = query.in("id", accessible.length ? accessible : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await query.order("display_name");
  return ((data ?? []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.display_name ?? "Nick Zalo"), status: String(row.status) }))
    .sort((a, b) => Number(b.status === "CONNECTED") - Number(a.status === "CONNECTED") || a.name.localeCompare(b.name, "vi"));
}

/** Zalo groups the given nicks are in (as HireX knows them), merged across nicks. */
export async function broadcastGroups(context: BroadcastContext, accountIds: string[]): Promise<GroupOption[]> {
  const allowed = new Set((await broadcastNicks(context)).map((nick) => nick.id));
  const ids = accountIds.filter((id) => allowed.has(id));
  if (!ids.length) return [];
  const db = createPrivilegedClient();
  const rows: Row[] = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await db.from("omnichannel_conversations").select("id,channel_account_id,provider_conversation_id,metadata,last_message_at")
      .eq("workspace_id", context.workspaceId).eq("channel_type", "ZALO").in("channel_account_id", ids)
      .or("metadata->>isGroup.eq.true,metadata->>conversationKind.eq.GROUP,metadata->>threadType.eq.GROUP,metadata->>groupName.not.is.null")
      .order("last_message_at", { ascending: false, nullsFirst: false }).range(page * 1000, page * 1000 + 999);
    if (error) break;
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) break;
  }
  const groups = new Map<string, GroupOption>();
  for (const row of rows) {
    const groupId = String(row.provider_conversation_id ?? "");
    if (!groupId || (row.metadata as Row | null)?.hidden === "true") continue;
    const group = groups.get(groupId) ?? { groupId, name: metadataName(row.metadata) || "Nhóm Zalo", lastMessageAt: typeof row.last_message_at === "string" ? row.last_message_at : null, accounts: [] };
    group.accounts.push({ accountId: String(row.channel_account_id), conversationId: String(row.id) });
    groups.set(groupId, group);
  }
  return [...groups.values()];
}

export interface BroadcastSummary {
  id: string; name: string; status: string; sendMessage: boolean; pinNote: boolean; createdAt: string; createdBy: string; approvedAt: string | null;
  total: number; sent: number; failed: number; waiting: number; pinned: number; canManage: boolean; textContent: string; dailyCapPerNick: number;
}

async function visibleBroadcastIds(db: Db, context: BroadcastContext): Promise<string[] | null> {
  if (context.isAdmin) return null;
  const accessible = await getAccessibleChannelAccountIds();
  const [own, used] = await Promise.all([
    db.from("zalo_broadcasts").select("id").eq("workspace_id", context.workspaceId).eq("created_by", context.userId).limit(500),
    accessible === null ? Promise.resolve({ data: null }) : accessible.length ? db.from("zalo_broadcast_targets").select("broadcast_id").eq("workspace_id", context.workspaceId).in("channel_account_id", accessible).limit(5000) : Promise.resolve({ data: [] }),
  ]);
  if (used.data === null) return null;
  return [...new Set([...((own.data ?? []) as Row[]).map((row) => String(row.id)), ...((used.data ?? []) as Row[]).map((row) => String(row.broadcast_id))])];
}

export async function listBroadcasts(context: BroadcastContext, onlyId?: string): Promise<BroadcastSummary[]> {
  if (!can(context, "view")) return [];
  const db = createPrivilegedClient();
  const visible = await visibleBroadcastIds(db, context);
  let query = db.from("zalo_broadcasts").select("id,name,status,send_message,pin_note,created_at,created_by,approved_at,text_content,daily_cap_per_nick").eq("workspace_id", context.workspaceId).order("created_at", { ascending: false }).limit(100);
  if (onlyId) query = query.eq("id", onlyId);
  if (visible) query = query.in("id", visible.length ? visible : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await query;
  const rows = (data ?? []) as Row[];
  if (!rows.length) return [];
  const [{ data: targets }, { data: people }] = await Promise.all([
    db.from("zalo_broadcast_targets").select("broadcast_id,status,pin_status").eq("workspace_id", context.workspaceId).in("broadcast_id", rows.map((row) => String(row.id))).limit(50_000),
    db.from("profiles").select("id,full_name").eq("workspace_id", context.workspaceId).in("id", [...new Set(rows.map((row) => String(row.created_by)))]),
  ]);
  const names = new Map(((people ?? []) as Row[]).map((row) => [String(row.id), String(row.full_name ?? "")]));
  return rows.map((row) => {
    const mine = ((targets ?? []) as Row[]).filter((target) => target.broadcast_id === row.id);
    return {
      id: String(row.id), name: String(row.name), status: String(row.status), sendMessage: row.send_message === true, pinNote: row.pin_note === true,
      createdAt: String(row.created_at), createdBy: names.get(String(row.created_by)) ?? "", approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
      total: mine.length, sent: mine.filter((target) => target.status === "SENT").length, failed: mine.filter((target) => ["FAILED", "UNKNOWN"].includes(String(target.status))).length,
      waiting: mine.filter((target) => target.status === "PENDING").length, pinned: mine.filter((target) => target.pin_status === "PINNED").length,
      canManage: can(context, "manage") && (row.created_by === context.userId || context.isAdmin), textContent: String(row.text_content), dailyCapPerNick: Number(row.daily_cap_per_nick),
    };
  });
}

export async function broadcastTargets(context: BroadcastContext, broadcastId: string) {
  if (!(await listBroadcasts(context, broadcastId)).length) return [];
  const db = createPrivilegedClient();
  const { data } = await db.from("zalo_broadcast_targets").select("id,group_name,group_id,channel_account_id,status,pin_status,attempts,done_at,error_code,position,channel_accounts(display_name)")
    .eq("workspace_id", context.workspaceId).eq("broadcast_id", broadcastId).order("position").limit(MAX_TARGETS_PER_BROADCAST);
  return ((data ?? []) as Row[]).map((row) => ({
    id: String(row.id), groupName: String(row.group_name ?? row.group_id), nick: String((row.channel_accounts as Row | null)?.display_name ?? ""), status: String(row.status),
    pinStatus: String(row.pin_status), attempts: Number(row.attempts), doneAt: typeof row.done_at === "string" ? row.done_at : null, error: typeof row.error_code === "string" ? row.error_code : null,
  }));
}

export interface BroadcastInput { name: string; text: string; sendMessage: boolean; pinNote: boolean; accountIds: string[]; groupIds: string[]; dailyCapPerNick?: number; source?: "WEB" | "ASSISTANT" }

/** A draft: nothing is sent until the member starts it. Each group goes to one of the chosen nicks in it. */
export async function createBroadcast(context: BroadcastContext, input: BroadcastInput) {
  if (!can(context, "manage")) return { ok: false as const, error: "Tài khoản chưa có quyền Gửi hàng loạt Zalo." };
  const name = input.name.trim().slice(0, 200), text = input.text.trim();
  if (!name || !text) return { ok: false as const, error: "Cần tên và nội dung." };
  if (text.length > (input.pinNote ? 2000 : 4000)) return { ok: false as const, error: input.pinNote ? "Nội dung ghim tối đa 2.000 ký tự." : "Nội dung tối đa 4.000 ký tự." };
  if (!input.sendMessage && !input.pinNote) return { ok: false as const, error: "Chọn gửi tin, ghim, hoặc cả hai." };
  const wanted = new Set(input.groupIds);
  if (!wanted.size) return { ok: false as const, error: "Chưa chọn nhóm nào." };
  if (wanted.size > MAX_TARGETS_PER_BROADCAST) return { ok: false as const, error: `Tối đa ${MAX_TARGETS_PER_BROADCAST} nhóm mỗi lần gửi.` };
  const groups = (await broadcastGroups(context, input.accountIds)).filter((group) => wanted.has(group.groupId));
  if (!groups.length) return { ok: false as const, error: "Các nick đã chọn không ở trong nhóm nào đã chọn." };
  const plan = assignNicks(groups.map((group) => ({ groupId: group.groupId, accounts: group.accounts.map((item) => item.accountId) })), input.accountIds);
  const db = createPrivilegedClient();
  const cap = Math.min(100, Math.max(1, Math.round(input.dailyCapPerNick ?? BROADCAST_DEFAULTS.dailyCapPerNick)));
  const { data, error } = await db.from("zalo_broadcasts").insert({ workspace_id: context.workspaceId, name, text_content: text, send_message: input.sendMessage, pin_note: input.pinNote,
    daily_cap_per_nick: cap, created_by: context.userId, source: input.source ?? "WEB" }).select("id").single();
  if (error || !data) return { ok: false as const, error: "Chưa lưu được." };
  const rows = groups.flatMap((group, position) => {
    const accountId = plan.get(group.groupId);
    const conversation = group.accounts.find((item) => item.accountId === accountId);
    return accountId && conversation ? [{ workspace_id: context.workspaceId, broadcast_id: data.id, conversation_id: conversation.conversationId, channel_account_id: accountId,
      group_id: group.groupId, group_name: group.name.slice(0, 300), position, pin_status: input.pinNote ? "PENDING" : "NONE" }] : [];
  });
  const inserted = await db.from("zalo_broadcast_targets").insert(rows);
  if (inserted.error) { await db.from("zalo_broadcasts").delete().eq("id", data.id); return { ok: false as const, error: "Chưa lưu được danh sách nhóm." }; }
  return { ok: true as const, id: String(data.id), groups: rows.length, nicks: new Set(rows.map((row) => row.channel_account_id)).size };
}

/** Start (approve), pause, resume or cancel. Creator or administrator, with "Tạo và gửi". */
export async function changeBroadcast(context: BroadcastContext, id: string, action: "START" | "PAUSE" | "CANCEL") {
  if (!can(context, "manage")) return { ok: false as const, error: "Tài khoản chưa có quyền Gửi hàng loạt Zalo." };
  const db = createPrivilegedClient();
  const { data: row } = await db.from("zalo_broadcasts").select("id,status,created_by").eq("workspace_id", context.workspaceId).eq("id", id).maybeSingle();
  if (!row) return { ok: false as const, error: "Không tìm thấy đợt gửi." };
  if (row.created_by !== context.userId && !context.isAdmin) return { ok: false as const, error: "Chỉ người tạo hoặc quản trị viên." };
  const now = new Date().toISOString();
  if (action === "START") {
    if (!["DRAFT", "PAUSED"].includes(String(row.status))) return { ok: false as const, error: "Đợt gửi này không bắt đầu được nữa." };
    const update = row.status === "DRAFT" ? { status: "RUNNING", approved_by: context.userId, approved_at: now } : { status: "RUNNING" };
    const { error } = await db.from("zalo_broadcasts").update(update).eq("id", id).eq("status", row.status);
    return error ? { ok: false as const, error: "Chưa bắt đầu được." } : { ok: true as const };
  }
  if (action === "PAUSE") {
    if (row.status !== "RUNNING") return { ok: false as const, error: "Đợt gửi không đang chạy." };
    await db.from("zalo_broadcasts").update({ status: "PAUSED" }).eq("id", id).eq("status", "RUNNING");
    return { ok: true as const };
  }
  if (["DONE", "CANCELLED"].includes(String(row.status))) return { ok: false as const, error: "Đợt gửi đã kết thúc." };
  await db.from("zalo_broadcasts").update({ status: "CANCELLED", finished_at: now }).eq("id", id);
  await db.from("zalo_broadcast_targets").update({ status: "CANCELLED", pin_status: "NONE" }).eq("broadcast_id", id).eq("status", "PENDING");
  return { ok: true as const };
}
