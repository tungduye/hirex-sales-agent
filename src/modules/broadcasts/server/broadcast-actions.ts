"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { broadcastGroups, changeBroadcast, createBroadcast, type BroadcastContext, type GroupOption } from "./broadcast-data";

async function context(): Promise<BroadcastContext | null> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return null;
  return { workspaceId: account.workspaceId, userId: account.userId, permissions: account.permissions, isAdmin: await isWorkspaceAdmin() };
}
const ids = z.array(z.string().uuid()).max(100);

/** Groups the chosen nicks are in (only nicks the member may use). */
export async function loadBroadcastGroupsAction(accountIds: string[]): Promise<GroupOption[]> {
  const member = await context();
  const parsed = ids.safeParse(accountIds);
  if (!member || !parsed.success) return [];
  return broadcastGroups(member, parsed.data);
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(4000), sendMessage: z.boolean(), pinNote: z.boolean(),
  accountIds: ids.min(1), groupIds: z.array(z.string().min(1).max(512)).min(1).max(500), dailyCapPerNick: z.number().int().min(1).max(100),
}).strict();

export async function createBroadcastAction(input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const member = await context();
  if (!member) return { ok: false, error: "Phiên đăng nhập đã hết hạn." };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Thông tin chưa hợp lệ." };
  const result = await createBroadcast(member, parsed.data);
  if (!result.ok) return result;
  revalidatePath("/broadcasts");
  return { ok: true, id: result.id };
}

export async function changeBroadcastAction(id: string, action: "START" | "PAUSE" | "CANCEL"): Promise<{ ok: boolean; error?: string }> {
  const member = await context();
  if (!member || !z.string().uuid().safeParse(id).success || !["START", "PAUSE", "CANCEL"].includes(action)) return { ok: false, error: "Không tìm thấy đợt gửi." };
  const result = await changeBroadcast(member, id, action);
  revalidatePath("/broadcasts");
  revalidatePath(`/broadcasts/${id}`);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
