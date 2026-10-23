"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

// "Nick tuyển dụng": the Zalo/Facebook nicks whose one-to-one chats are read for Thông tin ứng viên (migration 141).
const CHANNELS = ["ZALO", "FACEBOOK", "FACEBOOK_PROFILE"];

export type CandidateFactNick = { id: string; channelType: string; name: string; owner: string | null; ownerDepartment: string | null; enabled: boolean };

async function manager() {
  const account = await getAccountContext();
  return account?.workspaceId && account.permissions.includes("channels.manage") ? { ...account, workspaceId: account.workspaceId } : null;
}

export async function listCandidateFactNicks(): Promise<CandidateFactNick[] | null> {
  const account = await manager();
  if (!account) return null;
  const db = createPrivilegedClient();
  const [{ data: nicks }, { data: people }] = await Promise.all([
    db.from("channel_accounts").select("id,channel_type,display_name,external_account_id,primary_profile_id,candidate_facts_enabled").eq("workspace_id", account.workspaceId).is("deleted_at", null).in("channel_type", CHANNELS),
    db.from("profiles").select("id,full_name,department").eq("workspace_id", account.workspaceId),
  ]);
  const byId = new Map((people ?? []).map((person) => [String(person.id), person]));
  return (nicks ?? []).map((nick) => {
    const owner = nick.primary_profile_id ? byId.get(String(nick.primary_profile_id)) : null;
    return { id: String(nick.id), channelType: String(nick.channel_type), name: String(nick.display_name || nick.external_account_id || "Nick"), owner: owner ? String(owner.full_name ?? "") : null,
      ownerDepartment: owner && typeof owner.department === "string" ? owner.department : null, enabled: nick.candidate_facts_enabled === true };
  }).sort((a, b) => a.channelType.localeCompare(b.channelType) || a.name.localeCompare(b.name, "vi"));
}

/** Saves which nicks are nick tuyển dụng; a nick just turned on gets its last 30 days of chats read once. */
export async function saveCandidateFactNicks(enabledIds: string[]): Promise<{ ok: boolean; queued: number; message: string }> {
  const account = await manager();
  const parsed = z.array(z.string().uuid()).max(1000).safeParse(enabledIds);
  if (!account || !parsed.success) return { ok: false, queued: 0, message: "Bạn không có quyền đổi nick tuyển dụng." };
  const db = createPrivilegedClient();
  const { data: nicks } = await db.from("channel_accounts").select("id,candidate_facts_enabled").eq("workspace_id", account.workspaceId).is("deleted_at", null).in("channel_type", CHANNELS);
  const wanted = new Set(parsed.data);
  const turnOn = (nicks ?? []).filter((nick) => wanted.has(String(nick.id)) && !nick.candidate_facts_enabled).map((nick) => String(nick.id));
  const turnOff = (nicks ?? []).filter((nick) => !wanted.has(String(nick.id)) && nick.candidate_facts_enabled).map((nick) => String(nick.id));
  if (turnOn.length) { const { error } = await db.from("channel_accounts").update({ candidate_facts_enabled: true }).eq("workspace_id", account.workspaceId).in("id", turnOn); if (error) return { ok: false, queued: 0, message: "Chưa lưu được." }; }
  if (turnOff.length) { const { error } = await db.from("channel_accounts").update({ candidate_facts_enabled: false }).eq("workspace_id", account.workspaceId).in("id", turnOff); if (error) return { ok: false, queued: 0, message: "Chưa lưu được." }; }
  let queued = 0;
  if (turnOn.length) { const { data } = await db.rpc("queue_candidate_facts_backfill", { p_account_ids: turnOn, p_days: 30 }); queued = Number(data) || 0; }
  await db.from("audit_logs").insert({ workspace_id: account.workspaceId, actor_id: account.userId, action: "CANDIDATE_FACT_NICKS_UPDATED", entity_type: "CHANNEL_ACCOUNT", entity_id: null, metadata: { on: turnOn.length, off: turnOff.length, queued } });
  revalidatePath("/settings/channels");
  return { ok: true, queued, message: `Đã lưu: bật ${turnOn.length}, tắt ${turnOff.length} nick${queued ? ` · đang đọc lại ${queued} hội thoại 30 ngày gần nhất` : ""}.` };
}
