import assert from "node:assert/strict";
import test from "node:test";
import {evaluateFacebookProfileRecipientEvidence} from "../src/modules/channels/core/facebook-profile-recipient-policy.ts";

const valid={conversationId:"conversation",providerConversationId:"thread-123",recipientExternalId:"thread-123",participantExternalId:"thread-123",latestInboundSenderExternalId:"thread-123",recipientIsConnectedAccount:false};

test("allows only an inbound-verified Messenger thread",()=>assert.deepEqual(evaluateFacebookProfileRecipientEvidence(valid),{allowed:true,safeErrorCode:""}));
test("blocks using another connected profile account ID as a recipient",()=>assert.deepEqual(evaluateFacebookProfileRecipientEvidence({...valid,recipientIsConnectedAccount:true}),{allowed:false,safeErrorCode:"FACEBOOK_PROFILE_ACCOUNT_ID_NOT_RECIPIENT"}));
test("blocks a profile ID that redirects to another Messenger thread",()=>assert.deepEqual(evaluateFacebookProfileRecipientEvidence({...valid,providerConversationId:"different-thread"}),{allowed:false,safeErrorCode:"FACEBOOK_PROFILE_THREAD_MISMATCH"}));
test("blocks synthetic conversations without inbound identity evidence",()=>assert.deepEqual(evaluateFacebookProfileRecipientEvidence({...valid,latestInboundSenderExternalId:null}),{allowed:false,safeErrorCode:"FACEBOOK_PROFILE_IDENTITY_UNVERIFIED"}));
test("blocks mismatched participant metadata",()=>assert.deepEqual(evaluateFacebookProfileRecipientEvidence({...valid,participantExternalId:"another-person"}),{allowed:false,safeErrorCode:"FACEBOOK_PROFILE_IDENTITY_UNVERIFIED"}));
