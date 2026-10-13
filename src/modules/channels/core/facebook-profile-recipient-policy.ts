export interface FacebookProfileRecipientEvidence {
  conversationId: string | null;
  providerConversationId: string | null;
  recipientExternalId: string;
  participantExternalId: string | null;
  latestInboundSenderExternalId: string | null;
  recipientIsConnectedAccount: boolean;
}

export function evaluateFacebookProfileRecipientEvidence(input: FacebookProfileRecipientEvidence) {
  if (!input.conversationId || !input.providerConversationId) return { allowed: false, safeErrorCode: "FACEBOOK_PROFILE_CONVERSATION_REQUIRED" };
  if (input.recipientIsConnectedAccount) return { allowed: false, safeErrorCode: "FACEBOOK_PROFILE_ACCOUNT_ID_NOT_RECIPIENT" };
  if (input.providerConversationId !== input.recipientExternalId) return { allowed: false, safeErrorCode: "FACEBOOK_PROFILE_THREAD_MISMATCH" };
  if (!input.participantExternalId || input.participantExternalId !== input.recipientExternalId) return { allowed: false, safeErrorCode: "FACEBOOK_PROFILE_IDENTITY_UNVERIFIED" };
  if (!input.latestInboundSenderExternalId || input.latestInboundSenderExternalId !== input.recipientExternalId) return { allowed: false, safeErrorCode: "FACEBOOK_PROFILE_IDENTITY_UNVERIFIED" };
  return { allowed: true, safeErrorCode: "" };
}
