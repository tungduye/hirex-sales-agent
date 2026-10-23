import "server-only";

import { updateTag } from "next/cache";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { canAccessChannelAccount, hasPermission } from "@/modules/access/server/access-control";
import { careTaskTitle, EMPTY_FLOW, normalizeFlow, OUTCOME_TAGS, type RecFlowState, type RecOutcome } from "../core/rec-flow";

export type Db = ReturnType<typeof createPrivilegedClient>;
export interface FlowConversation { id: string; workspaceId: string; contactId: string | null; channelType: string; channelAccountId: string }

const FLOW_CHANNELS = ["ZALO", "FACEBOOK", "FACEBOOK_PROFILE"];

/** The conversation, if the member may reply in it and it can use the Rec flow (Zalo/Facebook one-to-one chat). */
export async function flowConversation(conversationId: string, permission: "inbox.view" | "inbox.reply" = "inbox.reply"): Promise<{ db: Db; conversation: FlowConversation; userId: string } | null> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete || !await hasPermission(permission)) return null;
  const db = createPrivilegedClient();
  const { data } = await db.from("omnichannel_conversations").select("id,contact_id,channel_type,channel_account_id")
    .eq("id", conversationId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (!data || typeof data.channel_account_id !== "string" || !FLOW_CHANNELS.includes(String(data.channel_type)) || !await canAccessChannelAccount(data.channel_account_id)) return null;
  if (data.channel_type === "ZALO") {
    const { data: group, error } = await db.rpc("is_zalo_group_conversation", { p_conversation_id: conversationId });
    if (error || group !== false) return null;
  }
  return { db, userId: account.userId, conversation: { id: data.id, workspaceId: account.workspaceId, contactId: typeof data.contact_id === "string" ? data.contact_id : null,
    channelType: String(data.channel_type), channelAccountId: data.channel_account_id } };
}

export function keyed(db: Db, conversation: FlowConversation) {
  const query = db.from("candidate_flow_states").select("id,step,facts,offered_job_ids,rejected_jobs,outcome").eq("workspace_id", conversation.workspaceId);
  return conversation.contactId ? query.eq("contact_id", conversation.contactId) : query.eq("conversation_id", conversation.id).is("contact_id", null);
}

export async function readFlow(db: Db, conversation: FlowConversation): Promise<{ id: string | null; state: RecFlowState }> {
  const { data } = await keyed(db, conversation).maybeSingle();
  if (!data) return { id: null, state: EMPTY_FLOW };
  return { id: data.id, state: normalizeFlow({ step: data.step, facts: data.facts, offeredJobIds: data.offered_job_ids, rejectedJobs: data.rejected_jobs, outcome: data.outcome }) };
}

export async function writeFlow(db: Db, conversation: FlowConversation, userId: string | null, state: RecFlowState): Promise<boolean> {
  const value = normalizeFlow(state);
  const row = { step: value.step, facts: value.facts, offered_job_ids: value.offeredJobIds, rejected_jobs: value.rejectedJobs, outcome: value.outcome, updated_by: userId };
  const existing = await readFlow(db, conversation);
  const { error } = existing.id
    ? await db.from("candidate_flow_states").update(row).eq("id", existing.id).eq("workspace_id", conversation.workspaceId)
    : await db.from("candidate_flow_states").insert({ ...row, workspace_id: conversation.workspaceId,
      contact_id: conversation.contactId, conversation_id: conversation.contactId ? null : conversation.id });
  if (error) return false;
  if (value.outcome !== existing.state.outcome && userId) {
    // The flow is saved either way; a failed follow-up (tag, assignment, task) is logged, not shown as a failed save.
    await applyOutcome(db, conversation, userId, existing.state.outcome, value.outcome).catch((cause) =>
      console.error("[rec-flow] outcome follow-up failed", cause instanceof Error ? cause.message.slice(0, 80) : "UNKNOWN"));
  }
  return true;
}

async function tagId(db: Db, workspaceId: string, tag: { name: string; color: string }) {
  const { data } = await db.from("conversation_tags").select("id,name").eq("workspace_id", workspaceId).ilike("name", tag.name).limit(1);
  if (data?.[0]?.id) return String(data[0].id);
  const { data: created, error } = await db.from("conversation_tags").insert({ workspace_id: workspaceId, name: tag.name, color: tag.color }).select("id").single();
  if (error || !created) throw new Error("TAG_CREATE_FAILED");
  // The inbox caches the workspace's tag list; refresh it so the new tag shows on the chat right away.
  try { updateTag("inbox-metadata"); } catch { /* outside a server action: the cache expires within a minute */ }
  return String(created.id);
}

/**
 * Follow-ups when the candidate's outcome changes: tag the chat; on a CV, hand the chat to the member who
 * works this nick ("Chờ REC care") and open a care task for them unless one is already open.
 */
async function applyOutcome(db: Db, conversation: FlowConversation, userId: string, before: RecOutcome | null, after: RecOutcome | null) {
  const workspaceId = conversation.workspaceId;
  const keep = new Set((after ? OUTCOME_TAGS[after] : []).map((tag) => tag.name));
  const drop = (before ? OUTCOME_TAGS[before] : []).filter((tag) => !keep.has(tag.name) && tag.name !== "Đã có CV");
  for (const tag of drop) {
    const { data } = await db.from("conversation_tags").select("id").eq("workspace_id", workspaceId).ilike("name", tag.name);
    const ids = (data ?? []).map((item) => String(item.id));
    if (ids.length) await db.from("conversation_tag_links").delete().eq("workspace_id", workspaceId).eq("conversation_id", conversation.id).in("tag_id", ids);
  }
  if (!after) return;
  for (const tag of OUTCOME_TAGS[after]) {
    const id = await tagId(db, workspaceId, tag);
    const { error } = await db.from("conversation_tag_links").upsert({ workspace_id: workspaceId, conversation_id: conversation.id, tag_id: id }, { onConflict: "conversation_id,tag_id", ignoreDuplicates: true });
    if (error) throw new Error("TAG_LINK_FAILED");
  }
  if (after !== "CV_RECEIVED") return;
  const { error: assignError } = await db.from("omnichannel_conversations").update({ assigned_to: userId }).eq("id", conversation.id).eq("workspace_id", workspaceId);
  if (assignError) throw new Error("ASSIGN_FAILED");
  const { data: open } = await db.from("channel_tasks").select("id").eq("workspace_id", workspaceId).eq("conversation_id", conversation.id)
    .in("status", ["OPEN", "IN_PROGRESS"]).like("title", "Care CV:%").limit(1);
  if (!open?.length) {
    const { data: contact } = conversation.contactId
      ? await db.from("contacts").select("full_name").eq("workspace_id", workspaceId).eq("id", conversation.contactId).maybeSingle()
      : { data: null };
    const { error: taskError } = await db.from("channel_tasks").insert({ workspace_id: workspaceId, conversation_id: conversation.id,
      title: careTaskTitle(typeof contact?.full_name === "string" ? contact.full_name : null), status: "OPEN", assigned_to: userId, created_by: userId });
    if (taskError) throw new Error("TASK_CREATE_FAILED");
  }
  await db.from("audit_logs").insert({ workspace_id: workspaceId, actor_id: userId, action: "REC_FLOW_CV_RECEIVED", entity_type: "OMNICHANNEL_CONVERSATION",
    entity_id: conversation.id, metadata: { assignedTo: userId } });
}
