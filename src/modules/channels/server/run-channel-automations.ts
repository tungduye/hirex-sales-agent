import "server-only";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { CHANNEL_TYPES, type ChannelType } from "../core/channel-contracts.ts";
import { evaluateAutomation } from "../core/evaluate-automation.ts";
import type { AutomationAction, AutomationDefinition, AutomationTriggerType } from "../core/automation-contracts.ts";

const triggers=new Set<AutomationTriggerType>(["MESSAGE_RECEIVED","KEYWORD_MATCHED","TAG_ADDED","CONVERSATION_ASSIGNED","SCHEDULED"]);
const actions=new Set(["ADD_TAG","REMOVE_TAG","ASSIGN_CONVERSATION","SET_CONVERSATION_STATUS","PROPOSE_MESSAGE","CREATE_TASK"]);
const conversationStatuses=new Set(["OPEN","PENDING","RESOLVED","SPAM"] as const);
const takeoverModes=new Set(["BOT_ALLOWED","HUMAN_TAKEOVER"] as const);
function object(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}
function mapDefinition(row:Record<string,unknown>):AutomationDefinition|null{
  if(typeof row.id!=="string"||typeof row.workspace_id!=="string"||typeof row.name!=="string"||typeof row.enabled!=="boolean"||!Number.isSafeInteger(row.version)||typeof row.trigger_type!=="string"||!triggers.has(row.trigger_type as AutomationTriggerType)||!object(row.trigger_config)||!Array.isArray(row.actions))return null;
  const channelTypes=Array.isArray(row.trigger_config.channelTypes)?row.trigger_config.channelTypes.filter((value):value is ChannelType=>typeof value==="string"&&CHANNEL_TYPES.includes(value as ChannelType)):[...CHANNEL_TYPES];
  const keywords=Array.isArray(row.trigger_config.keywords)?row.trigger_config.keywords.filter((value):value is string=>typeof value==="string"):[];const mapped:AutomationAction[]=[];
  for(const candidate of row.actions){if(!object(candidate)||typeof candidate.type!=="string"||!actions.has(candidate.type)||!object(candidate.configuration))return null;mapped.push({type:candidate.type as AutomationAction["type"],configuration:candidate.configuration})}
  return{id:row.id,workspaceId:row.workspace_id,name:row.name,enabled:row.enabled,version:row.version as number,trigger:{type:row.trigger_type as AutomationTriggerType,channelTypes,keywords},actions:mapped};
}

export async function runMessageReceivedAutomations(input:{workspaceId:string;conversationId:string;channelType:ChannelType;messageId:string;providerMessageId:string;senderExternalId:string;text:string|null}){
  const client=createPrivilegedClient();const normalizedSender=input.senderExternalId.trim().toLowerCase();const [{data:rows,error},{data:conversation,error:conversationError},{count:suppressionCount,error:suppressionError}]=await Promise.all([client.from("channel_automations").select("id,workspace_id,name,enabled,version,trigger_type,trigger_config,actions").eq("workspace_id",input.workspaceId).eq("enabled",true),client.from("omnichannel_conversations").select("status,takeover_mode,assigned_to").eq("id",input.conversationId).eq("workspace_id",input.workspaceId).maybeSingle(),client.from("channel_suppressions").select("id",{count:"exact",head:true}).eq("workspace_id",input.workspaceId).eq("channel_type",input.channelType).eq("normalized_recipient",normalizedSender)]);
  if(error||conversationError||suppressionError||!conversation||!conversationStatuses.has(conversation.status)||!takeoverModes.has(conversation.takeover_mode)||(conversation.assigned_to!==null&&typeof conversation.assigned_to!=="string"))return{evaluated:0,proposed:0};let evaluated=0,proposed=0;
  for(const raw of rows??[]){const definition=mapDefinition(raw);if(!definition)continue;evaluated+=1;const idempotencyKey=`message:${input.providerMessageId}:v${definition.version}`;const inserted=await client.from("channel_automation_runs").insert({workspace_id:input.workspaceId,automation_id:definition.id,conversation_id:input.conversationId,idempotency_key:idempotencyKey,status:"RUNNING",started_at:new Date().toISOString()}).select("id").maybeSingle();if(inserted.error||!inserted.data)continue;
    const result=evaluateAutomation({definition,event:{id:input.messageId,workspaceId:input.workspaceId,channelType:input.channelType,conversationId:input.conversationId,type:"MESSAGE_RECEIVED",text:input.text,tagId:null},conversationPolicy:{status:conversation.status,takeoverMode:conversation.takeover_mode,assignedTo:conversation.assigned_to,globallySuppressed:false,channelOptedOut:(suppressionCount??0)>0}});
    if(!result.matched){await client.from("channel_automation_runs").update({status:"SKIPPED",completed_at:new Date().toISOString()}).eq("id",inserted.data.id);continue}
    const runId=inserted.data.id;const proposals=result.proposedActions.map(action=>({workspace_id:input.workspaceId,automation_run_id:runId,conversation_id:input.conversationId,action_type:action.type,configuration:action.configuration}));const saved=await client.from("channel_automation_proposals").insert(proposals);await client.from("channel_automation_runs").update(saved.error?{status:"FAILED",safe_error_code:"PROPOSAL_PERSISTENCE_FAILED",completed_at:new Date().toISOString()}:{status:"COMPLETED",completed_at:new Date().toISOString()}).eq("id",runId);if(!saved.error)proposed+=proposals.length;
  }
  return{evaluated,proposed};
}
