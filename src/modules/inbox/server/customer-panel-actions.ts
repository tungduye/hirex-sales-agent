"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import type { PermissionKey } from "@/modules/access/core/permission-catalog";
import { canAccessChannelAccount, hasPermission } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { LEAD_STATUSES, type CustomerPanelResult } from "../types/customer-panel";

const uuid = z.string().uuid();
const denied: CustomerPanelResult = { ok: false, message: "Anh/chị chưa có quyền làm việc này." };

/** The conversation, when the caller may see it and holds every listed permission. */
async function conversationFor(conversationId: unknown, permissions: PermissionKey[], anyOf = false) {
  const id = uuid.safeParse(conversationId);
  const account = await getAccountContext();
  if (!id.success || !account?.workspaceId) return null;
  const granted = await Promise.all(permissions.map((key) => hasPermission(key)));
  if (anyOf ? !granted.some(Boolean) : !granted.every(Boolean)) return null;
  const { data } = await createPrivilegedClient().from("omnichannel_conversations").select("id,channel_account_id,contact_id").eq("workspace_id", account.workspaceId).eq("id", id.data).maybeSingle();
  if (!data || typeof data.channel_account_id !== "string" || !await canAccessChannelAccount(data.channel_account_id)) return null;
  return { workspaceId: account.workspaceId, userId: account.userId, id: id.data, contactId: typeof data.contact_id === "string" ? data.contact_id : null };
}

export async function setCustomerLeadStatus(conversationId: string, status: string): Promise<CustomerPanelResult> {
  if (!LEAD_STATUSES.some((item) => item.value === status)) return { ok: false, message: "Trạng thái không hợp lệ." };
  const conversation = await conversationFor(conversationId, ["contacts.update"]);
  if (!conversation) return denied;
  if (!conversation.contactId) return { ok: false, message: "Hội thoại chưa gắn với liên hệ." };
  const { error } = await createPrivilegedClient().from("contacts").update({ lead_status: status }).eq("workspace_id", conversation.workspaceId).eq("id", conversation.contactId);
  if (error) return { ok: false, message: "Chưa đổi được trạng thái, thử lại sau." };
  revalidatePath("/contacts");
  return { ok: true, message: `Đã đổi sang “${LEAD_STATUSES.find((item) => item.value === status)?.label}”.` };
}

/** Creates a contact named after the conversation and links the conversation to it. */
export async function createContactForConversation(conversationId: string, fullName: string, phone: string): Promise<CustomerPanelResult> {
  const name = z.string().trim().min(1).max(200).safeParse(fullName);
  const phoneValue = z.string().trim().max(40).safeParse(phone);
  if (!name.success || !phoneValue.success) return { ok: false, message: "Tên hoặc số điện thoại chưa hợp lệ." };
  const conversation = await conversationFor(conversationId, ["contacts.create", "inbox.update"]);
  if (!conversation) return denied;
  if (conversation.contactId) return { ok: false, message: "Hội thoại đã có liên hệ." };
  const db = createPrivilegedClient();
  const { data: created, error } = await db.from("contacts").insert({ workspace_id: conversation.workspaceId, full_name: name.data, phone: phoneValue.data || null, source: "Hồ Chứa", lead_status: "CONTACTED" }).select("id").single();
  if (error || !created) return { ok: false, message: "Chưa tạo được liên hệ, thử lại sau." };
  // Only link when nobody linked it in the meantime.
  const { data: linked } = await db.from("omnichannel_conversations").update({ contact_id: created.id }).eq("workspace_id", conversation.workspaceId).eq("id", conversation.id).is("contact_id", null).select("id");
  if (!linked?.length) { await db.from("contacts").delete().eq("workspace_id", conversation.workspaceId).eq("id", created.id); return { ok: false, message: "Hội thoại vừa được gắn liên hệ khác, hãy tải lại." }; }
  revalidatePath("/contacts");
  return { ok: true, message: `Đã tạo liên hệ ${name.data}.` };
}

export async function createConversationTask(conversationId: string, title: string, dueAt: string | null): Promise<CustomerPanelResult> {
  const titleValue = z.string().trim().min(1).max(240).safeParse(title);
  const dueTime = dueAt ? Date.parse(dueAt) : null;
  if (!titleValue.success || (dueTime !== null && !Number.isFinite(dueTime))) return { ok: false, message: "Tên công việc hoặc hạn chưa hợp lệ." };
  const conversation = await conversationFor(conversationId, ["tasks.create"]);
  if (!conversation) return denied;
  const { error } = await createPrivilegedClient().from("channel_tasks").insert({ workspace_id: conversation.workspaceId, conversation_id: conversation.id, title: titleValue.data, status: "OPEN", assigned_to: conversation.userId, due_at: dueTime !== null ? new Date(dueTime).toISOString() : null, created_by: conversation.userId });
  if (error) return { ok: false, message: "Chưa tạo được công việc, thử lại sau." };
  revalidatePath("/tasks");
  return { ok: true, message: "Đã tạo công việc." };
}

export async function setConversationTaskDone(conversationId: string, taskId: string, done: boolean): Promise<CustomerPanelResult> {
  const task = uuid.safeParse(taskId);
  const conversation = await conversationFor(conversationId, ["tasks.update"]);
  if (!task.success || !conversation) return denied;
  const { data, error } = await createPrivilegedClient().from("channel_tasks").update({ status: done ? "COMPLETED" : "OPEN" }).eq("workspace_id", conversation.workspaceId).eq("conversation_id", conversation.id).eq("id", task.data).select("id");
  if (error || !data?.length) return { ok: false, message: "Chưa cập nhật được công việc." };
  revalidatePath("/tasks");
  return { ok: true, message: done ? "Đã hoàn thành." : "Đã mở lại công việc." };
}

export async function addCustomerNote(conversationId: string, content: string): Promise<CustomerPanelResult> {
  const text = z.string().trim().min(1).max(5000).safeParse(content);
  if (!text.success) return { ok: false, message: "Ghi chú trống hoặc quá dài." };
  const conversation = await conversationFor(conversationId, ["contacts.update", "inbox.update"], true);
  if (!conversation) return denied;
  if (!conversation.contactId) return { ok: false, message: "Hãy tạo liên hệ cho khách trước khi ghi chú." };
  const { error } = await createPrivilegedClient().from("notes").insert({ workspace_id: conversation.workspaceId, contact_id: conversation.contactId, content: text.data, created_by: conversation.userId });
  if (error) return { ok: false, message: "Chưa lưu được ghi chú, thử lại sau." };
  return { ok: true, message: "Đã lưu ghi chú." };
}
