import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { canAccessChannelAccount, getAccessibleChannelAccountIds, hasPermission } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { CustomerPanelData } from "../types/customer-panel";

const str = (value: unknown) => typeof value === "string" && value.trim() ? value : null;

/**
 * Everything the "Thông tin khách" panel shows for one conversation. The caller must be able to see the
 * conversation's channel account; each edit is allowed only with its own permission (flags below).
 */
export async function getCustomerPanel(conversationId: string): Promise<CustomerPanelData | null> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !await hasPermission("inbox.view")) return null;
  const workspaceId = account.workspaceId;
  const db = createPrivilegedClient();
  const { data: conversation } = await db.from("omnichannel_conversations").select("id,channel_account_id,contact_id").eq("workspace_id", workspaceId).eq("id", conversationId).maybeSingle();
  if (!conversation || typeof conversation.channel_account_id !== "string" || !await canAccessChannelAccount(conversation.channel_account_id)) return null;
  const contactId = str(conversation.contact_id);

  const [permissions, contactResult, taskResult, noteResult, otherResult, accessible] = await Promise.all([
    Promise.all((["contacts.update", "contacts.create", "inbox.update", "tasks.create", "tasks.update"] as const).map((key) => hasPermission(key))),
    contactId ? db.from("contacts").select("id,full_name,job_title,email,phone,lead_status,company_id").eq("workspace_id", workspaceId).eq("id", contactId).maybeSingle() : Promise.resolve({ data: null }),
    db.from("channel_tasks").select("id,title,status,due_at,assigned_to,created_at").eq("workspace_id", workspaceId).eq("conversation_id", conversationId).in("status", ["OPEN", "IN_PROGRESS", "COMPLETED"]).order("created_at", { ascending: false }).limit(20),
    contactId ? db.from("notes").select("id,content,created_by,created_at").eq("workspace_id", workspaceId).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
    contactId ? db.from("omnichannel_conversations").select("id,channel_type,channel_account_id,subject,last_message_at").eq("workspace_id", workspaceId).eq("contact_id", contactId).neq("id", conversationId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(10) : Promise.resolve({ data: [] }),
    getAccessibleChannelAccountIds(),
  ]);
  const [canEditContact, canCreateContact, canUpdateConversation, canCreateTask, canUpdateTask] = permissions;
  const contactRow = contactResult.data as Record<string, unknown> | null;
  const tasks = (taskResult.data ?? []) as Array<Record<string, unknown>>;
  const notes = (noteResult.data ?? []) as Array<Record<string, unknown>>;
  const others = ((otherResult.data ?? []) as Array<Record<string, unknown>>).filter((row) => accessible === null || accessible.includes(String(row.channel_account_id)));

  // Names for people and the company, in one round trip each.
  const profileIds = [...new Set([...tasks.map((task) => task.assigned_to), ...notes.map((note) => note.created_by)].filter((id): id is string => typeof id === "string"))];
  const accountIds = [...new Set(others.map((row) => String(row.channel_account_id)))];
  const [profileResult, companyResult, accountResult] = await Promise.all([
    profileIds.length ? db.from("profiles").select("id,full_name").eq("workspace_id", workspaceId).in("id", profileIds) : Promise.resolve({ data: [] }),
    contactRow && typeof contactRow.company_id === "string" ? db.from("companies").select("name").eq("workspace_id", workspaceId).eq("id", contactRow.company_id).maybeSingle() : Promise.resolve({ data: null }),
    accountIds.length ? db.from("channel_accounts").select("id,display_name").eq("workspace_id", workspaceId).in("id", accountIds) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map(((profileResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), String(row.full_name ?? "")]));
  const accountNames = new Map(((accountResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), String(row.display_name ?? "")]));

  return {
    conversationId,
    contact: contactRow ? {
      id: String(contactRow.id), fullName: String(contactRow.full_name ?? ""), jobTitle: str(contactRow.job_title), email: str(contactRow.email), phone: str(contactRow.phone),
      leadStatus: String(contactRow.lead_status ?? "NEW"), companyName: str((companyResult.data as Record<string, unknown> | null)?.name),
    } : null,
    tasks: tasks.map((task) => ({ id: String(task.id), title: String(task.title ?? ""), status: String(task.status), dueAt: str(task.due_at), assigneeName: typeof task.assigned_to === "string" ? names.get(task.assigned_to) ?? null : null }))
      .sort((a, b) => Number(a.status === "COMPLETED") - Number(b.status === "COMPLETED")).slice(0, 8),
    notes: notes.map((note) => ({ id: String(note.id), content: String(note.content ?? ""), authorName: names.get(String(note.created_by)) ?? null, createdAt: String(note.created_at) })),
    otherConversations: others.map((row) => ({ id: String(row.id), channelType: String(row.channel_type), accountName: accountNames.get(String(row.channel_account_id)) ?? null, subject: str(row.subject), lastMessageAt: str(row.last_message_at) })),
    can: { editLead: canEditContact, createContact: canCreateContact && canUpdateConversation, createTask: canCreateTask, updateTask: canUpdateTask, addNote: canEditContact || canUpdateConversation },
  };
}
