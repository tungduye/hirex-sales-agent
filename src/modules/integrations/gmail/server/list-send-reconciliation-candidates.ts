import "server-only";

import { discoverSendReconciliationCandidates } from "@/modules/integrations/gmail/domain/discover-send-reconciliation-candidates";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import type {
  SendReconciliationCandidateDiscoveryInput,
  SendReconciliationCandidateDiscoveryResult,
} from "@/modules/integrations/gmail/types/send-reconciliation-candidate";

export async function listSendReconciliationCandidates(
  input: SendReconciliationCandidateDiscoveryInput,
): Promise<SendReconciliationCandidateDiscoveryResult> {
  return discoverSendReconciliationCandidates(input, {
    read: async (normalized) => {
      const supabase = createPrivilegedSupabaseClient();
      let query = supabase
        .from("email_send_requests")
        .select(
          "id, workspace_id, email_account_id, send_lock_at, attempt_count, email_accounts!inner(id, workspace_id, provider, status)",
        )
        .eq("workspace_id", normalized.workspaceId)
        .eq("send_type", "NEW")
        .eq("status", "SENDING")
        .not("send_lock_id", "is", null)
        .not("send_lock_at", "is", null)
        .eq("email_accounts.workspace_id", normalized.workspaceId)
        .eq("email_accounts.provider", "GMAIL")
        .eq("email_accounts.status", "CONNECTED")
        .order("send_lock_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(normalized.limit);

      if (normalized.emailAccountId !== null) {
        query = query.eq("email_account_id", normalized.emailAccountId)
          .eq("email_accounts.id", normalized.emailAccountId);
      }

      const { data, error } = await query;
      if (error) throw new Error("SEND_RECONCILIATION_DISCOVERY_UNAVAILABLE");
      return data ?? [];
    },
  });
}
