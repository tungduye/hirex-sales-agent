"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { ChannelActionState } from "../types/channel-action-state";
import { randomUUID } from "node:crypto";
import { dispatchManualFacebookAction } from "./dispatch-manual-facebook-action";

const uuid = z.string().uuid();
const conversationControlSchema = z.object({
  conversationId: uuid,
  status: z.enum(["OPEN", "PENDING", "RESOLVED", "SPAM"]),
  takeoverMode: z.enum(["BOT_ALLOWED", "HUMAN_TAKEOVER"]),
  assignedTo: z.union([uuid, z.literal("")]),
});
const tagSchema = z.object({ name: z.string().trim().min(1).max(80), color: z.union([z.string().regex(/^#[0-9A-Fa-f]{6}$/), z.literal("")]) });
const tagLinkSchema = z.object({ conversationId: uuid, tagId: uuid, enabled: z.enum(["true", "false"]) });
const quickReplySchema = z.object({
  id: z.union([uuid, z.literal("")]), name: z.string().trim().min(1).max(100), shortcut: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,40}$/),
  textContent: z.string().trim().min(1).max(100_000), channelTypes: z.array(z.enum(["EMAIL","FACEBOOK","ZALO","WHATSAPP","VIBER","TELEGRAM","OTHER"])).max(7),
});
const automationSchema = z.object({
  id: z.union([uuid, z.literal("")]), name: z.string().trim().min(1).max(120), enabled: z.enum(["true", "false"]),
  triggerType: z.enum(["MESSAGE_RECEIVED","KEYWORD_MATCHED","TAG_ADDED","CONVERSATION_ASSIGNED","SCHEDULED"]),
  keywords: z.string().max(2000), actionType: z.enum(["ADD_TAG","REMOVE_TAG","ASSIGN_CONVERSATION","SET_CONVERSATION_STATUS","PROPOSE_MESSAGE","CREATE_TASK"]),
  actionConfiguration: z.string().max(10000),
});
const suppressionSchema = z.object({ channelType: z.enum(["EMAIL","FACEBOOK","ZALO","WHATSAPP","VIBER","TELEGRAM","OTHER"]), recipient: z.string().trim().min(1).max(512).refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value)) });

async function authenticatedClient() {
  const account = await getAccountContext();
  if (!account?.configurationComplete || !account.workspaceId) return null;
  return createClient();
}

export async function updateConversationControls(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = conversationControlSchema.safeParse(Object.fromEntries(formData));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Conversation update is unavailable." };
  const { data, error } = await supabase.rpc("set_omnichannel_conversation_controls", { p_conversation_id: parsed.data.conversationId, p_status: parsed.data.status, p_takeover_mode: parsed.data.takeoverMode, p_assigned_to: parsed.data.assignedTo || null });
  if (error || data !== true) return { status: "error", message: "Conversation could not be updated." };
  revalidatePath("/inbox/all");
  return { status: "success", message: "Conversation updated." };
}

export async function createConversationTag(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = tagSchema.safeParse(Object.fromEntries(formData));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Tag could not be created." };
  const { data, error } = await supabase.rpc("create_conversation_tag", { p_name: parsed.data.name, p_color: parsed.data.color || null });
  if (error || typeof data !== "string") return { status: "error", message: "Tag could not be created." };
  revalidatePath("/inbox/all");
  return { status: "success", message: "Tag created." };
}

export async function setConversationTag(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = tagLinkSchema.safeParse(Object.fromEntries(formData));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Tag could not be changed." };
  const { data, error } = await supabase.rpc("set_conversation_tag", { p_conversation_id: parsed.data.conversationId, p_tag_id: parsed.data.tagId, p_enabled: parsed.data.enabled === "true" });
  if (error || data !== true) return { status: "error", message: "Tag could not be changed." };
  revalidatePath("/inbox/all");
  return { status: "success", message: "Tag updated." };
}

export async function saveQuickReply(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = quickReplySchema.safeParse({ ...Object.fromEntries(formData), channelTypes: formData.getAll("channelTypes") });
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Quick reply could not be saved." };
  const { data, error } = await supabase.rpc("save_quick_reply_template", { p_id: parsed.data.id || null, p_name: parsed.data.name, p_shortcut: parsed.data.shortcut, p_text_content: parsed.data.textContent, p_channel_types: parsed.data.channelTypes });
  if (error || typeof data !== "string") return { status: "error", message: "Quick reply could not be saved." };
  revalidatePath("/settings/channels");
  return { status: "success", message: "Quick reply saved." };
}

export async function deleteQuickReply(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = uuid.safeParse(formData.get("id"));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Quick reply could not be deleted." };
  const { data, error } = await supabase.rpc("delete_quick_reply_template", { p_id: parsed.data });
  if (error || data !== true) return { status: "error", message: "Quick reply could not be deleted." };
  revalidatePath("/settings/channels");
  return { status: "success", message: "Quick reply deleted." };
}

export async function saveChannelAutomation(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = automationSchema.safeParse(Object.fromEntries(formData));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Automation could not be saved." };
  let configuration: unknown;
  try { configuration = JSON.parse(parsed.data.actionConfiguration || "{}"); } catch { return { status: "error", message: "Action configuration must be valid JSON." }; }
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return { status: "error", message: "Action configuration must be an object." };
  const keywords = [...new Set(parsed.data.keywords.split(/[;,\n]/u).map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (parsed.data.triggerType === "KEYWORD_MATCHED" && keywords.length === 0) return { status: "error", message: "At least one keyword is required." };
  const triggerConfig = parsed.data.triggerType === "KEYWORD_MATCHED" ? { keywords } : {};
  const { data, error } = await supabase.rpc("save_channel_automation", { p_id: parsed.data.id || null, p_name: parsed.data.name, p_enabled: parsed.data.enabled === "true", p_trigger_type: parsed.data.triggerType, p_trigger_config: triggerConfig, p_actions: [{ type: parsed.data.actionType, configuration }] });
  if (error || typeof data !== "string") return { status: "error", message: "Automation could not be saved." };
  revalidatePath("/settings/channels/automations");
  return { status: "success", message: "Automation saved." };
}

export async function createManualChannelSuppression(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = suppressionSchema.safeParse(Object.fromEntries(formData));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Suppression could not be created." };
  const { data, error } = await supabase.rpc("save_manual_channel_suppression", { p_channel_type: parsed.data.channelType, p_normalized_recipient: parsed.data.recipient.toLowerCase() });
  if (error || typeof data !== "string") return { status: "error", message: "Recipient is already suppressed or unavailable." };
  revalidatePath("/settings/channels/suppressions");
  return { status: "success", message: "Recipient suppressed." };
}

export async function deleteManualChannelSuppression(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = uuid.safeParse(formData.get("id"));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Suppression could not be removed." };
  const { data, error } = await supabase.rpc("delete_manual_channel_suppression", { p_id: parsed.data });
  if (error || data !== true) return { status: "error", message: "Only operator-created manual suppressions can be removed." };
  revalidatePath("/settings/channels/suppressions");
  return { status: "success", message: "Manual suppression removed." };
}

export async function proposeChannelMessage(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = z.object({ conversationId: uuid, text: z.string().trim().min(1).max(100000).refine((value) => !value.includes("\u0000")), proposedBy: z.enum(["HUMAN","AI_ASSIST"]).default("HUMAN") }).safeParse(Object.fromEntries(formData));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Message could not be proposed." };
  const { data, error } = await supabase.rpc("propose_channel_message", { p_conversation_id: parsed.data.conversationId, p_text_content: parsed.data.text, p_idempotency_key: randomUUID(), p_proposed_by: parsed.data.proposedBy });
  if (error || typeof data !== "string") return { status: "error", message: "Policy blocked this message or the channel is unavailable." };
  revalidatePath("/inbox/all");
  return { status: "success", message: "Draft proposed. Review and approve it before delivery." };
}

export async function approveChannelMessage(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = uuid.safeParse(formData.get("actionId"));
  const account = await getAccountContext();
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase || !account?.workspaceId) return { status: "error", message: "Message could not be approved." };
  const { data: action, error: actionError } = await supabase.from("channel_outbound_actions")
    .select("id,channel_type,status,attempt_count")
    .eq("id", parsed.data).eq("workspace_id", account.workspaceId).maybeSingle();
  if (actionError || !action || action.status !== "PROPOSED") return { status: "error", message: "This draft is no longer available for approval. Refresh the inbox." };
  const { data, error } = await supabase.rpc("approve_channel_outbound_action", { p_action_id: parsed.data });
  if (error || data !== true) return { status: "error", message: "Message approval failed its current policy check." };
  if (action.channel_type === "FACEBOOK") {
    const result = await dispatchManualFacebookAction(parsed.data);
    revalidatePath("/inbox/all");
    if (result === "SENT") return { status: "success", message: "Facebook message sent once." };
    if (result === "DELIVERY_UNKNOWN") return { status: "error", message: "Delivery is uncertain. Do not approve or send this message again; inspect the action state." };
    if (result === "RESPONSE_WINDOW_EXPIRED") return { status: "error", message: "The Facebook reply window has expired. No message was sent." };
    if (result === "FAILED") return { status: "error", message: "Facebook rejected this message. Inspect the safe action error before creating a new draft." };
    return { status: "error", message: "Draft approved, but no confirmed send occurred. Refresh and inspect the action state before retrying." };
  }
  revalidatePath("/inbox/all");
  return { status: "success", message: "Message approved and ready for the channel worker." };
}

export async function reviewAutomationProposal(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const parsed=z.object({proposalId:uuid,approved:z.enum(["true","false"])}).safeParse(Object.fromEntries(formData));const supabase=await authenticatedClient();if(!parsed.success||!supabase)return{status:"error",message:"Automation proposal could not be reviewed."};const{data,error}=await supabase.rpc("review_channel_automation_proposal",{p_proposal_id:parsed.data.proposalId,p_approved:parsed.data.approved==="true"});if(error||data!==true)return{status:"error",message:"Automation proposal failed its safety checks."};revalidatePath("/settings/channels/automations");revalidatePath("/inbox/all");revalidatePath("/tasks");return{status:"success",message:parsed.data.approved==="true"?"Automation proposal applied.":"Automation proposal rejected."}
}
