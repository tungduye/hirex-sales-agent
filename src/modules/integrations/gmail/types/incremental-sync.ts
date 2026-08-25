export const INCREMENTAL_SYNC_STATUSES = ["RUNNING", "FAILED", "COMPLETED"] as const;
export type IncrementalSyncStatus = (typeof INCREMENTAL_SYNC_STATUSES)[number];

export type IncrementalSyncSafeErrorCode =
  | "HISTORY_ID_EXPIRED"
  | "REAUTH_REQUIRED"
  | "GMAIL_PERMISSION_DENIED"
  | "GMAIL_RATE_LIMITED"
  | "GMAIL_TEMPORARY_ERROR"
  | "MAILBOX_PERSISTENCE_ERROR"
  | "CURSOR_CHANGED"
  | "SYNC_BUSY";

export interface IncrementalSyncProgress {
  emailAccountId: string;
  status: IncrementalSyncStatus;
  processedHistoryRecords: number;
  affectedMessageCount: number;
  syncedMessageCount: number;
  deletedMessageCount: number;
  failedMessageCount: number;
  startedAt: string | null;
  completedAt: string | null;
  lastBatchAt: string | null;
  safeErrorCode: string | null;
}

export interface IncrementalSyncActionState {
  success: boolean;
  completed: boolean;
  message: string | null;
  progress?: IncrementalSyncProgress | null;
}

export const initialIncrementalSyncActionState: IncrementalSyncActionState = {
  success: false,
  completed: false,
  message: null,
};

interface GmailHistoryMessage { id?: string; threadId?: string }
interface GmailHistoryEvent { message?: GmailHistoryMessage }

export interface GmailHistoryRecord {
  id?: string;
  messagesAdded?: GmailHistoryEvent[];
  messagesDeleted?: GmailHistoryEvent[];
  labelsAdded?: GmailHistoryEvent[];
  labelsRemoved?: GmailHistoryEvent[];
}

export interface GmailHistoryPage {
  history?: GmailHistoryRecord[];
  historyId?: string;
  nextPageToken?: string | null;
}
