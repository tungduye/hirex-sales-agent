"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { hasPermission } from "@/modules/access/server/access-control";
import { botSettings, createLinkCode, forgetBotSettings } from "@/modules/assistant/server/zalo-bot";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { isGroupConversation, isZaloGroupThread } from "@/modules/assistant/core/assistant-tools";

export interface ZaloAssistantState {
  bot: { accountId: string; name: string; status: string; callNames: string[] } | null;
  links: Array<{ id: string; zaloName: string | null; createdAt: string }>;
  canManage: boolean;
  zaloAccounts: Array<{ id: string; name: string; status: string }>;
  /** Admins: the last questions the nick received and what happened to them. */
  recent: Array<{ at: string; status: string; error: string | null; group: boolean; who: string | null; text: string }>;
}

/** What the "Trợ lý trên Zalo" box shows: the nick, my linked Zalo accounts, and (admins) the nicks to pick from. */
export async function getZaloAssistantState(): Promise<ZaloAssistantState | null> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return null;
  const db = createPrivilegedClient();
  const canManage = await hasPermission("roles.manage");
  const [settings, { data: links }, { data: zalo }] = await Promise.all([
    botSettings(db, account.workspaceId),
    db.from("assistant_zalo_links").select("id,zalo_name,created_at").eq("workspace_id", account.workspaceId).eq("profile_id", account.userId).order("created_at"),
    canManage ? db.from("channel_accounts").select("id,display_name,status").eq("workspace_id", account.workspaceId).eq("channel_type", "ZALO").is("deleted_at", null).order("display_name") : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; status: string }> }),
  ]);
  let recent: ZaloAssistantState["recent"] = [];
  if (canManage && settings) {
    const { data: jobs } = await db.from("assistant_bot_jobs").select("created_at,status,safe_error_code,profile_id,kind,omnichannel_conversations(provider_conversation_id,metadata),omnichannel_messages(sender_external_id,text_content)").eq("workspace_id", account.workspaceId).order("created_at", { ascending: false }).limit(10);
    const ids = [...new Set((jobs ?? []).map((job) => job.profile_id).filter((id): id is string => typeof id === "string"))];
    const names = new Map(((ids.length ? (await db.from("profiles").select("id,full_name").in("id", ids)).data : []) ?? []).map((row) => [row.id as string, row.full_name as string]));
    recent = (jobs ?? []).map((job) => {
      const conversation = job.omnichannel_conversations as unknown as { provider_conversation_id: string; metadata: unknown } | null;
      const message = job.omnichannel_messages as unknown as { sender_external_id: string; text_content: string | null } | null;
      return { at: job.created_at as string, status: job.status as string, error: (job.safe_error_code as string | null) ?? null, group: isGroupConversation(conversation?.metadata) || isZaloGroupThread("ZALO", conversation?.provider_conversation_id, message?.sender_external_id), who: job.profile_id ? names.get(job.profile_id as string) ?? null : null, text: job.kind === "REMINDER" ? "⏰ Nhắc lịch" : (message?.text_content ?? "").slice(0, 80) };
    });
  }
  let status = "UNKNOWN";
  if (settings) status = String((await db.from("channel_accounts").select("status").eq("id", settings.channelAccountId).maybeSingle()).data?.status ?? "UNKNOWN");
  return {
    bot: settings ? { accountId: settings.channelAccountId, name: settings.name, status, callNames: settings.callNames } : null,
    links: (links ?? []).map((row) => ({ id: row.id as string, zaloName: (row.zalo_name as string | null) ?? null, createdAt: row.created_at as string })),
    canManage,
    recent,
    zaloAccounts: (zalo ?? []).map((row) => ({ id: row.id as string, name: (row.display_name as string | null) || "Nick Zalo", status: row.status as string })),
  };
}

export async function requestZaloLinkCode(): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; message: string }> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  const db = createPrivilegedClient();
  if (!await botSettings(db, account.workspaceId)) return { ok: false, message: "Trợ lý trên Zalo chưa được bật." };
  const code = await createLinkCode(db, account.workspaceId, account.userId);
  return code ? { ok: true, ...code } : { ok: false, message: "Chưa tạo được mã, thử lại sau." };
}

export async function unlinkMyZalo(linkId: string): Promise<boolean> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !z.uuid().safeParse(linkId).success) return false;
  const { error } = await createPrivilegedClient().from("assistant_zalo_links").delete().eq("id", linkId).eq("workspace_id", account.workspaceId).eq("profile_id", account.userId);
  return !error;
}

/** Admins list the names staff tag to call the Trợ lý in groups (e.g. after renaming the Zalo profile). */
export async function setZaloAssistantCallNames(raw: string): Promise<{ ok: boolean; message: string }> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !await hasPermission("roles.manage")) return { ok: false, message: "Chỉ quản trị viên được đổi tên gọi." };
  const names = [...new Set(raw.split(/[,\n]/u).map((item) => item.trim().replace(/^@+/u, "")).filter((item) => item.length >= 2 && item.length <= 60))].slice(0, 10);
  const { error } = await createPrivilegedClient().from("assistant_bot_settings").update({ call_names: names, updated_by: account.userId, updated_at: new Date().toISOString() }).eq("workspace_id", account.workspaceId);
  if (error) return { ok: false, message: "Chưa lưu được, thử lại sau." };
  forgetBotSettings(account.workspaceId);
  return { ok: true, message: names.length ? `Đã lưu: gọi bằng ${names.map((name) => `@${name}`).join(", ")} hoặc /tl.` : "Đã lưu." };
}

/** Admins pick (or switch off, with null) the Zalo nick that answers as Trợ lý. */
export async function setZaloAssistantAccount(channelAccountId: string | null): Promise<{ ok: boolean; message: string }> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !await hasPermission("roles.manage")) return { ok: false, message: "Chỉ quản trị viên được đổi nick Trợ lý." };
  const db = createPrivilegedClient();
  if (channelAccountId !== null) {
    if (!z.uuid().safeParse(channelAccountId).success) return { ok: false, message: "Nick không hợp lệ." };
    const { data: nick } = await db.from("channel_accounts").select("id").eq("id", channelAccountId).eq("workspace_id", account.workspaceId).eq("channel_type", "ZALO").is("deleted_at", null).maybeSingle();
    if (!nick) return { ok: false, message: "Không tìm thấy nick Zalo này." };
    // Two bots on one nick would both answer.
    const { count } = await db.from("ai_recruiter_channel_bindings").select("bot_id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("channel_account_id", channelAccountId).eq("enabled", true);
    if ((count ?? 0) > 0) return { ok: false, message: "Nick này đang gắn với AI Recruiter. Hãy gỡ AI Recruiter khỏi nick trước." };
  }
  const { error } = await db.from("assistant_bot_settings").upsert({ workspace_id: account.workspaceId, channel_account_id: channelAccountId, enabled: channelAccountId !== null, enabled_at: channelAccountId ? new Date().toISOString() : null, updated_by: account.userId, updated_at: new Date().toISOString() }, { onConflict: "workspace_id" });
  if (error) return { ok: false, message: "Chưa lưu được, thử lại sau." };
  forgetBotSettings(account.workspaceId);
  try { updateTag("inbox-metadata"); } catch { /* the inbox cache expires within a minute */ }
  return { ok: true, message: channelAccountId ? "Đã bật Trợ lý trên Zalo." : "Đã tắt Trợ lý trên Zalo." };
}
