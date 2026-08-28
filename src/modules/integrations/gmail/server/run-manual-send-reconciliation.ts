import "server-only";

import { executeManualSendReconciliation } from "@/modules/integrations/gmail/domain/manual-send-reconciliation";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import { reconcileAmbiguousSend as runReviewedReconciliation } from "@/modules/integrations/gmail/server/reconcile-ambiguous-send";
import type {
  ManualSendReconciliationInput,
  ManualSendReconciliationResult,
} from "@/modules/integrations/gmail/types/manual-send-reconciliation";

export async function runManualSendReconciliation(
  input: ManualSendReconciliationInput,
): Promise<ManualSendReconciliationResult> {
  return executeManualSendReconciliation(input, {
    preflight: async (exactInput) => {
      const supabase = createPrivilegedSupabaseClient();
      const { data, error } = await supabase
        .from("email_send_requests")
        .select(
          "id, workspace_id, email_account_id, send_lock_at, email_accounts!inner(id, workspace_id, provider, status)",
        )
        .eq("id", exactInput.sendRequestId)
        .eq("workspace_id", exactInput.workspaceId)
        .eq("email_account_id", exactInput.emailAccountId)
        .eq("send_type", "NEW")
        .eq("status", "SENDING")
        .not("send_lock_id", "is", null)
        .not("send_lock_at", "is", null)
        .eq("email_accounts.id", exactInput.emailAccountId)
        .eq("email_accounts.workspace_id", exactInput.workspaceId)
        .eq("email_accounts.provider", "GMAIL")
        .eq("email_accounts.status", "CONNECTED")
        .maybeSingle();
      if (error) throw new Error("MANUAL_RECONCILIATION_PREFLIGHT_UNAVAILABLE");
      return data;
    },
    reconcile: runReviewedReconciliation,
  });
}
