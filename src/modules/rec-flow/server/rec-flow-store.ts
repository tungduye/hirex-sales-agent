import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { canAccessChannelAccount, hasPermission } from "@/modules/access/server/access-control";
import { EMPTY_FLOW, normalizeFlow, type RecFlowState } from "../core/rec-flow";

type Db = ReturnType<typeof createPrivilegedClient>;
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

function keyed(db: Db, conversation: FlowConversation) {
  const query = db.from("candidate_flow_states").select("id,step,facts,offered_job_ids,rejected_jobs,outcome").eq("workspace_id", conversation.workspaceId);
  return conversation.contactId ? query.eq("contact_id", conversation.contactId) : query.eq("conversation_id", conversation.id).is("contact_id", null);
}

export async function readFlow(db: Db, conversation: FlowConversation): Promise<{ id: string | null; state: RecFlowState }> {
  const { data } = await keyed(db, conversation).maybeSingle();
  if (!data) return { id: null, state: EMPTY_FLOW };
  return { id: data.id, state: normalizeFlow({ step: data.step, facts: data.facts, offeredJobIds: data.offered_job_ids, rejectedJobs: data.rejected_jobs, outcome: data.outcome }) };
}

export async function writeFlow(db: Db, conversation: FlowConversation, userId: string, state: RecFlowState): Promise<boolean> {
  const value = normalizeFlow(state);
  const row = { step: value.step, facts: value.facts, offered_job_ids: value.offeredJobIds, rejected_jobs: value.rejectedJobs, outcome: value.outcome, updated_by: userId };
  const existing = await readFlow(db, conversation);
  if (existing.id) {
    const { error } = await db.from("candidate_flow_states").update(row).eq("id", existing.id).eq("workspace_id", conversation.workspaceId);
    return !error;
  }
  const { error } = await db.from("candidate_flow_states").insert({ ...row, workspace_id: conversation.workspaceId,
    contact_id: conversation.contactId, conversation_id: conversation.contactId ? null : conversation.id });
  return !error;
}
