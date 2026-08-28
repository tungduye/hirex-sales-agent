import "server-only";

import { randomUUID } from "node:crypto";
import {
  executeReplySend,
  ReplyGmailAmbiguousError,
  ReplyGmailDefinitiveError,
  type ExecuteReplySendInput,
} from "@/modules/integrations/gmail/domain/execute-reply-send";
import { buildGmailReplyMime } from "@/modules/integrations/gmail/domain/build-gmail-reply-mime";
import { claimReplySendRequest } from "@/modules/integrations/gmail/server/claim-reply-send-request";
import {
  finalizeReplySendRequestFailed,
  finalizeReplySendRequestSent,
} from "@/modules/integrations/gmail/server/finalize-reply-send-request";
import {
  GmailSendAmbiguousError,
  GmailSendDefinitiveError,
  sendRawGmailMessage,
} from "@/modules/integrations/gmail/server/gmail-send-api";
import { prepareClaimedReplyExecution } from "@/modules/integrations/gmail/server/prepare-claimed-reply-execution";
import { loadGmailSendCredentials } from "@/modules/integrations/gmail/server/send-credentials";

export async function sendOneReplyMessage(input: ExecuteReplySendInput) {
  return executeReplySend(input, {
    loadCredentials: ({ emailAccountId, workspaceId }) => loadGmailSendCredentials(emailAccountId, workspaceId),
    generateLock: randomUUID,
    claim: claimReplySendRequest,
    prepare: prepareClaimedReplyExecution,
    buildMime: buildGmailReplyMime,
    sendGmail: async (accessToken, raw, providerThreadId) => {
      try { return await sendRawGmailMessage(accessToken, raw, providerThreadId); } catch (error) {
        if (error instanceof GmailSendDefinitiveError) throw new ReplyGmailDefinitiveError(error.safeCode);
        if (error instanceof GmailSendAmbiguousError) throw new ReplyGmailAmbiguousError();
        throw new ReplyGmailAmbiguousError();
      }
    },
    finalizeSent: finalizeReplySendRequestSent,
    finalizeFailed: finalizeReplySendRequestFailed,
  });
}
