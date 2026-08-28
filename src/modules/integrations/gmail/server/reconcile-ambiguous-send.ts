import "server-only";

import {
  orchestrateAmbiguousSendReconciliation,
  type ReconcileAmbiguousSendInput,
} from "@/modules/integrations/gmail/domain/orchestrate-ambiguous-send";
import { evaluateAmbiguousSendReconciliation } from "@/modules/integrations/gmail/server/evaluate-ambiguous-send-reconciliation";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import type { SendReconciliationOrchestrationResult } from "@/modules/integrations/gmail/types/send-reconciliation-orchestration";

/**
 * Reconciles exactly one explicitly scoped request. The evaluator is advisory;
 * migration 009 re-locks and revalidates all evidence before its final CAS.
 */
export async function reconcileAmbiguousSend(
  input: ReconcileAmbiguousSendInput,
): Promise<SendReconciliationOrchestrationResult> {
  return orchestrateAmbiguousSendReconciliation(input, {
    evaluate: evaluateAmbiguousSendReconciliation,
    finalize: async (finalizeInput) => {
      const supabase = createPrivilegedSupabaseClient();
      const { data, error } = await supabase.rpc(
        "finalize_reconciled_email_send_request",
        {
          p_request_id: finalizeInput.sendRequestId,
          p_workspace_id: finalizeInput.workspaceId,
          p_email_account_id: finalizeInput.emailAccountId,
          p_email_message_id: finalizeInput.emailMessageId,
        },
      );
      if (error || typeof data !== "boolean") {
        throw new Error("SEND_RECONCILIATION_FINALIZER_UNAVAILABLE");
      }
      return data;
    },
  });
}
