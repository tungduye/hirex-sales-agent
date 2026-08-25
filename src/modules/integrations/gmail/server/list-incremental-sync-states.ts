import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { IncrementalSyncProgress, IncrementalSyncStatus } from "@/modules/integrations/gmail/types/incremental-sync";

interface Row {
  email_account_id: string;
  status: IncrementalSyncStatus;
  processed_history_records: number;
  affected_message_count: number;
  synced_message_count: number;
  deleted_message_count: number;
  failed_message_count: number;
  started_at: string | null;
  completed_at: string | null;
  last_batch_at: string | null;
  safe_error_code: string | null;
}

export async function listIncrementalSyncStates() {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) {
    return { states: [] as IncrementalSyncProgress[], error: "Incremental sync progress could not be loaded." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("email_incremental_sync_states")
    .select("email_account_id, status, processed_history_records, affected_message_count, synced_message_count, deleted_message_count, failed_message_count, started_at, completed_at, last_batch_at, safe_error_code");
  if (error) return { states: [] as IncrementalSyncProgress[], error: "Incremental sync progress could not be loaded." };
  return {
    states: (data as Row[]).map(mapProgress),
    error: null,
  };
}

function mapProgress(row: Row): IncrementalSyncProgress {
  return {
    emailAccountId: row.email_account_id,
    status: row.status,
    processedHistoryRecords: row.processed_history_records,
    affectedMessageCount: row.affected_message_count,
    syncedMessageCount: row.synced_message_count,
    deletedMessageCount: row.deleted_message_count,
    failedMessageCount: row.failed_message_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastBatchAt: row.last_batch_at,
    safeErrorCode: row.safe_error_code,
  };
}
