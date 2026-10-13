import {evaluateFacebookProfileRecipientEvidence} from "../src/modules/channels/core/facebook-profile-recipient-policy.ts";

const baseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??process.env["\uFEFFNEXT_PUBLIC_SUPABASE_URL"];
const key=process.env.SUPABASE_SECRET_KEY;
const conversationId=process.argv[2];
if(!baseUrl||!key||!conversationId)throw new Error("Usage: node --env-file=.env.local --experimental-strip-types scripts/validate-facebook-profile-recipient-guard.mjs <conversationId>");
const headers={apikey:key,Authorization:`Bearer ${key}`};
async function get(path){const response=await fetch(`${baseUrl}/rest/v1/${path}`,{headers});if(!response.ok)throw new Error(`READ_FAILED_${response.status}`);return response.json()}

const conversations=await get(`omnichannel_conversations?id=eq.${encodeURIComponent(conversationId)}&select=id,workspace_id,channel_account_id,provider_conversation_id,metadata`);
const conversation=conversations[0];
if(!conversation)throw new Error("CONVERSATION_NOT_FOUND");
const participantExternalId=typeof conversation.metadata?.participantExternalId==="string"?conversation.metadata.participantExternalId:null;
const [inboundRows,accountRows]=await Promise.all([
  get(`omnichannel_messages?workspace_id=eq.${conversation.workspace_id}&conversation_id=eq.${conversation.id}&channel_account_id=eq.${conversation.channel_account_id}&channel_type=eq.FACEBOOK_PROFILE&direction=eq.INBOUND&select=sender_external_id&order=received_at.desc&limit=1`),
  participantExternalId?get(`channel_accounts?workspace_id=eq.${conversation.workspace_id}&channel_type=eq.FACEBOOK_PROFILE&external_account_id=eq.${encodeURIComponent(participantExternalId)}&deleted_at=is.null&select=id`):Promise.resolve([]),
]);
const result=evaluateFacebookProfileRecipientEvidence({conversationId:conversation.id,providerConversationId:conversation.provider_conversation_id,recipientExternalId:participantExternalId??"",participantExternalId,latestInboundSenderExternalId:inboundRows[0]?.sender_external_id??null,recipientIsConnectedAccount:accountRows.length>0});
console.log(JSON.stringify({conversationId:conversation.id,hasInboundIdentity:inboundRows.length>0,recipientIsConnectedAccount:accountRows.length>0,...result},null,2));
if(result.allowed)process.exitCode=2;
