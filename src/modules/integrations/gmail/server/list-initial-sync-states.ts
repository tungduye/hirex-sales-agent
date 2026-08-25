import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { InitialSyncProgress, InitialSyncStatus } from "@/modules/integrations/gmail/types/initial-sync";

interface Row {
  email_account_id: string; status: InitialSyncStatus; processed_messages: number; synced_messages: number;
  skipped_messages: number; failed_messages: number; started_at: string | null; completed_at: string | null;
  last_batch_at: string | null; safe_error_code: string | null;
}

export async function listInitialSyncStates() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("email_sync_states")
    .select("email_account_id, status, processed_messages, synced_messages, skipped_messages, failed_messages, started_at, completed_at, last_batch_at, safe_error_code")
    .eq("sync_type", "INITIAL");
  if (error) return { states: [] as InitialSyncProgress[], error: "Initial sync progress could not be loaded." };
  return { states: (data as Row[]).map((row) => ({
    emailAccountId: row.email_account_id, status: row.status, processedMessages: row.processed_messages,
    syncedMessages: row.synced_messages, skippedMessages: row.skipped_messages, failedMessages: row.failed_messages,
    startedAt: row.started_at, completedAt: row.completed_at, lastBatchAt: row.last_batch_at,
    safeErrorCode: row.safe_error_code,
  })), error: null };
}
