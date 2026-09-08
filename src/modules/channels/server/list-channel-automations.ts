import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { ChannelAutomationProposalSummary, ChannelAutomationSummary } from "../types/automation";

export async function listChannelAutomations(): Promise<{ automations: ChannelAutomationSummary[]; proposals:ChannelAutomationProposalSummary[]; error: string | null }> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return { automations: [], proposals:[], error: "Automations are unavailable." };
  const client = await createClient();
  const [{data,error},{data:proposalData,error:proposalError}]=await Promise.all([client.from("channel_automations").select("id,name,enabled,version,trigger_type,trigger_config,actions").eq("workspace_id", account.workspaceId).order("name"),client.from("channel_automation_proposals").select("id,action_type,configuration,created_at,channel_automation_runs!inner(channel_automations!inner(name))").eq("workspace_id",account.workspaceId).eq("status","PROPOSED").order("created_at",{ascending:false}).limit(100)]);
  if (error||proposalError) return { automations: [], proposals:[], error: "Automations are not available yet." };
  const automations = (data ?? []).flatMap((row) => typeof row.id === "string" && typeof row.name === "string" && typeof row.enabled === "boolean" && Number.isSafeInteger(row.version) && typeof row.trigger_type === "string" && row.trigger_config && typeof row.trigger_config === "object" && Array.isArray(row.actions) ? [{ id: row.id, name: row.name, enabled: row.enabled, version: row.version, triggerType: row.trigger_type, triggerConfig: row.trigger_config as Record<string, unknown>, actions: row.actions as Array<Record<string, unknown>> }] : []);
  const proposals=(proposalData??[]).flatMap((row)=>{const run=Array.isArray(row.channel_automation_runs)?row.channel_automation_runs[0]:row.channel_automation_runs;const auto=run&&typeof run==="object"&&"channel_automations" in run?(Array.isArray(run.channel_automations)?run.channel_automations[0]:run.channel_automations):null;return typeof row.id==="string"&&typeof row.action_type==="string"&&row.configuration&&typeof row.configuration==="object"&&!Array.isArray(row.configuration)&&typeof row.created_at==="string"&&auto&&typeof auto==="object"&&"name" in auto&&typeof auto.name==="string"?[{id:row.id,actionType:row.action_type,configuration:row.configuration as Record<string,unknown>,createdAt:row.created_at,automationName:auto.name}]:[]});
  return { automations, proposals, error: null };
}
