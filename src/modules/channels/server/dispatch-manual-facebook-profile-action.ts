import "server-only";
import {createClient} from "@/lib/supabase/server";
import {getAccountContext} from "@/modules/identity/server/get-account-context";
import {ChannelAdapterRegistry} from "../core/channel-adapter-registry";
import {executeChannelOutboundAction} from "./execute-channel-outbound-action";
import {loadChannelAdapterByAccountId} from "./load-channel-adapter";

export type ManualFacebookProfileDispatchResult="SENT"|"FAILED"|"DELIVERY_UNKNOWN"|"BLOCKED"|"NOT_ELIGIBLE"|"UNAVAILABLE";
export async function dispatchManualFacebookProfileAction(actionId:string):Promise<ManualFacebookProfileDispatchResult>{
  const account=await getAccountContext();if(!account?.configurationComplete||!account.workspaceId)return"UNAVAILABLE";
  const client=await createClient();const{data:action,error}=await client.from("channel_outbound_actions").select("id,workspace_id,channel_account_id,conversation_id,channel_type,status,attempt_count,dispatch_source").eq("id",actionId).eq("workspace_id",account.workspaceId).maybeSingle();
  if(error||!action)return"UNAVAILABLE";
  if(action.channel_type!=="FACEBOOK_PROFILE"||action.dispatch_source!=="HUMAN_MANUAL"||action.status!=="APPROVED"||action.attempt_count!==0||typeof action.channel_account_id!=="string"||typeof action.conversation_id!=="string")return"NOT_ELIGIBLE";
  try{const loaded=await loadChannelAdapterByAccountId(action.channel_account_id);if(loaded.adapter.channelType!=="FACEBOOK_PROFILE")return"UNAVAILABLE";const registry=new ChannelAdapterRegistry();registry.register(loaded.adapter);const result=await executeChannelOutboundAction(actionId,registry);return result.status==="DEFERRED"?"UNAVAILABLE":result.status}catch{return"UNAVAILABLE"}
}
