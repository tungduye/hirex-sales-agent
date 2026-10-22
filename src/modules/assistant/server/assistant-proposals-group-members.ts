import "server-only";

import { randomUUID } from "node:crypto";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { broadcastGroups, broadcastNicks, currentZaloGroup } from "@/modules/broadcasts/server/broadcast-data";
import { ZaloBridgeAdapter } from "@/modules/channels/adapters/zalo/zalo-bridge-adapter";
import { loadChannelAdapterByAccountId } from "@/modules/channels/server/load-channel-adapter";
import type { ActionContext, Built, Executed } from "@/modules/assistant/server/assistant-proposals";

// "Out toàn bộ nick Rec khỏi nhóm X": the Trợ lý (Soda) nick, which is a deputy (phó nhóm) of the groups, removes people
// from one Zalo group. Admins only, after confirming a card that names the group and every person. The owner and the
// other deputies are never on the list (Zalo does not let a deputy remove them). A removed person must be invited back.

type Row = Record<string, unknown>;
type Member = { id: string; name: string; role: number };
const MAX_REMOVALS = 50;
const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().replace(/\s+/gu, " ").trim();
const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];

async function botNick(workspaceId: string) {
  const db = createPrivilegedClient();
  const { data } = await db.from("assistant_bot_settings").select("channel_account_id,enabled,channel_accounts(display_name,external_account_id,status)").eq("workspace_id", workspaceId).maybeSingle();
  const account = (Array.isArray(data?.channel_accounts) ? data?.channel_accounts[0] : data?.channel_accounts) as Row | null | undefined;
  if (!data?.enabled || typeof data.channel_account_id !== "string" || !account) return null;
  return { id: data.channel_account_id, uid: String(account.external_account_id ?? ""), name: String(account.display_name ?? "Soda"), connected: account.status === "CONNECTED" };
}

export async function proposeRemoveGroupMembers(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const bot = await botNick(context.workspaceId);
  if (!bot) return { ok: false, error: "Chưa bật nick Trợ lý (Soda) trên Zalo nên chưa xoá thành viên nhóm được." };
  const db = createPrivilegedClient();
  // The group: the one named, or (asked inside a Zalo group) this group.
  const wanted = typeof args.nhom === "string" && args.nhom.trim() ? args.nhom.trim() : null;
  let group: { groupId: string; name: string } | null = null;
  if (!wanted) {
    const current = context.zaloConversationId ? await currentZaloGroup(context, context.zaloConversationId) : null;
    if (!current) return { ok: false, error: "Sếp cho em tên nhóm cần xoá thành viên." };
    group = { groupId: current.groupId, name: current.name };
  } else {
    const nicks = await broadcastNicks(context);
    const groups = (await broadcastGroups(context, nicks.map((nick) => nick.id))).filter((item) => item.accounts.some((account) => account.accountId === bot.id));
    const key = fold(wanted);
    const exact = groups.filter((item) => fold(item.name) === key);
    const found = exact.length ? exact : groups.filter((item) => fold(item.name).includes(key));
    if (!found.length) return { ok: false, error: `Không thấy nhóm "${wanted}" mà ${bot.name} đang ở trong.` };
    if (found.length > 1) return { ok: false, error: `Có ${found.length} nhóm khớp "${wanted}": ${found.slice(0, 8).map((item) => `“${item.name}”`).join(", ")}${found.length > 8 ? "…" : ""}. Sếp nói rõ tên nhóm giúp em.` };
    group = { groupId: found[0]!.groupId, name: found[0]!.name };
  }
  const { data: memberRows } = await db.from("zalo_group_members").select("member_id,display_name,role").eq("workspace_id", context.workspaceId).eq("channel_account_id", bot.id).eq("group_id", group.groupId).limit(5000);
  const members: Member[] = ((memberRows ?? []) as Row[]).map((row) => ({ id: String(row.member_id), name: String(row.display_name ?? ""), role: Number(row.role ?? 0) }));
  if (!members.length) return { ok: false, error: `HireX chưa có danh sách thành viên nhóm “${group.name}” (chờ lần đồng bộ thành viên tới).` };
  const byId = new Map(members.map((member) => [member.id, member]));

  // Who: our nicks by Bộ phận of their main user, our nicks by name, and/or people by their name in the group.
  const departments = list(args.bo_phan).map(fold);
  const nickNames = list(args.nick).map(fold);
  const people = list(args.thanh_vien);
  if (!departments.length && !nickNames.length && !people.length) return { ok: false, error: "Sếp cho em biết xoá ai: bộ phận (ví dụ Rec), tên nick, hoặc tên thành viên." };
  const chosen = new Map<string, Member & { why: string }>();
  const notInGroup: string[] = [];
  if (departments.length || nickNames.length) {
    const [{ data: accounts }, { data: profiles }] = await Promise.all([
      db.from("channel_accounts").select("id,display_name,external_account_id,primary_profile_id").eq("workspace_id", context.workspaceId).eq("channel_type", "ZALO").is("deleted_at", null),
      db.from("profiles").select("id,full_name,department").eq("workspace_id", context.workspaceId),
    ]);
    const departmentOf = new Map(((profiles ?? []) as Row[]).map((row) => [String(row.id), typeof row.department === "string" ? row.department : ""]));
    for (const account of (accounts ?? []) as Row[]) {
      const uid = String(account.external_account_id ?? ""), name = String(account.display_name ?? uid);
      if (!uid || uid === bot.uid) continue;
      const department = account.primary_profile_id ? departmentOf.get(String(account.primary_profile_id)) ?? "" : "";
      const byDepartment = departments.length > 0 && department !== "" && departments.includes(fold(department));
      const byName = nickNames.some((wantedName) => fold(name).includes(wantedName));
      if (!byDepartment && !byName) continue;
      const member = byId.get(uid);
      if (member) chosen.set(uid, { ...member, name: member.name || name, why: byDepartment ? `nick ${department}` : "nick" });
      else if (byName) notInGroup.push(name);
    }
  }
  const missingPeople: string[] = [];
  for (const person of people) {
    const key = fold(person);
    const exact = members.filter((member) => fold(member.name) === key);
    const found = exact.length ? exact : members.filter((member) => fold(member.name).includes(key));
    if (found.length === 1) chosen.set(found[0]!.id, { ...found[0]!, why: "thành viên" });
    else if (found.length > 1) return { ok: false, error: `Trong nhóm có ${found.length} người tên giống "${person}": ${found.slice(0, 6).map((member) => member.name).join(", ")}. Sếp nói rõ hơn giúp em.` };
    else missingPeople.push(person);
  }
  chosen.delete(bot.uid);
  // Zalo lets a deputy remove members only: the owner (role 1) and deputies (role 2) stay.
  const protectedPeople = [...chosen.values()].filter((member) => member.role === 1 || member.role === 2);
  for (const member of protectedPeople) chosen.delete(member.id);
  const targets = [...chosen.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  if (!targets.length) return { ok: false, error: `Không có ai cần xoá trong nhóm “${group.name}”${protectedPeople.length ? ` (${protectedPeople.map((member) => member.name).join(", ")} là trưởng/phó nhóm, ${bot.name} không xoá được)` : ""}${missingPeople.length ? `; không thấy: ${missingPeople.join(", ")}` : ""}.` };
  if (targets.length > MAX_REMOVALS) return { ok: false, error: `Danh sách có ${targets.length} người, mỗi lần xoá tối đa ${MAX_REMOVALS}. Sếp chia nhỏ giúp em.` };
  const notes = [
    protectedPeople.length ? `Giữ lại (trưởng/phó nhóm, không xoá được): ${protectedPeople.map((member) => member.name).join(", ")}.` : "",
    notInGroup.length ? `Không có trong nhóm: ${notInGroup.join(", ")}.` : "",
    missingPeople.length ? `Không thấy trong nhóm: ${missingPeople.join(", ")}.` : "",
  ].filter(Boolean);
  return {
    ok: true, kind: "REMOVE_GROUP_MEMBERS",
    params: { accountId: bot.id, groupId: group.groupId, groupName: group.name, members: targets.map((member) => ({ id: member.id, name: member.name })) },
    preview: {
      title: `Xoá ${targets.length} người khỏi nhóm Zalo`,
      lines: [`Nhóm: ${group.name}`, `Người xoá: ${bot.name} (phó nhóm)`, ...targets.slice(0, 30).map((member) => `• ${member.name || member.id} (${member.why})`), ...(targets.length > 30 ? [`… và ${targets.length - 30} người nữa`] : []), ...notes],
      warning: `Người bị xoá phải được mời lại mới vào nhóm được.${bot.connected ? "" : ` Nick ${bot.name} đang mất kết nối nên có thể không chạy được.`}`,
      link: null,
    },
  };
}

export async function executeRemoveGroupMembers(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  if (!context.isAdmin) return { ok: false, message: "Chỉ quản trị viên được xoá thành viên khỏi nhóm." };
  const bot = await botNick(context.workspaceId);
  const groupId = typeof params.groupId === "string" ? params.groupId : "";
  const groupName = typeof params.groupName === "string" ? params.groupName : "nhóm";
  const members = (Array.isArray(params.members) ? params.members : []).flatMap((item) => item && typeof item === "object" && typeof (item as Row).id === "string" ? [{ id: String((item as Row).id), name: String((item as Row).name ?? "") }] : []);
  if (!bot || bot.id !== params.accountId || !groupId || !members.length || members.length > MAX_REMOVALS) return { ok: false, message: "Đề xuất không còn hợp lệ, sếp hỏi lại em giúp." };
  let result: Awaited<ReturnType<ZaloBridgeAdapter["removeGroupMembers"]>>;
  try {
    const loaded = await loadChannelAdapterByAccountId(bot.id);
    if (!(loaded.adapter instanceof ZaloBridgeAdapter)) return { ok: false, message: "Nick Trợ lý không phải nick Zalo." };
    result = await loaded.adapter.removeGroupMembers({ groupId, memberIds: members.map((member) => member.id) }, `group-remove:${randomUUID()}`);
  } catch {
    return { ok: false, message: `Chưa xoá được: ${bot.name} đang mất kết nối hoặc Deplao chưa sẵn sàng. Sếp thử lại sau giúp em.` };
  }
  if (result.status !== "REMOVED") return { ok: false, message: result.errorCode === "NOT_GROUP_ADMIN" ? `Zalo từ chối: ${bot.name} chưa phải trưởng/phó nhóm “${groupName}”.` : `Zalo chưa xoá được ai khỏi nhóm “${groupName}”. Sếp thử lại sau giúp em.` };
  const failed = new Set(result.failedMemberIds);
  const removed = members.filter((member) => !failed.has(member.id));
  // HireX's member list follows at once (the next sync confirms it).
  if (removed.length) await createPrivilegedClient().from("zalo_group_members").delete().eq("workspace_id", context.workspaceId).eq("group_id", groupId).in("member_id", removed.map((member) => member.id));
  const failedNames = members.filter((member) => failed.has(member.id)).map((member) => member.name || member.id);
  return { ok: removed.length > 0, message: `Đã xoá ${removed.length}/${members.length} người khỏi nhóm “${groupName}”.${failedNames.length ? ` Chưa xoá được: ${failedNames.join(", ")}.` : ""}`, link: null };
}
