export const INITIAL_SYNC_STATUSES = ["NOT_STARTED", "RUNNING", "COMPLETED", "FAILED"] as const;
export type InitialSyncStatus = (typeof INITIAL_SYNC_STATUSES)[number];

export interface InitialSyncProgress {
  emailAccountId: string;
  status: InitialSyncStatus;
  processedMessages: number;
  syncedMessages: number;
  skippedMessages: number;
  failedMessages: number;
  startedAt: string | null;
  completedAt: string | null;
  lastBatchAt: string | null;
  safeErrorCode: string | null;
}

export interface InitialSyncActionState {
  success: boolean;
  completed: boolean;
  message: string | null;
  progress?: InitialSyncProgress | null;
}

export const initialSyncActionState: InitialSyncActionState = { success: false, completed: false, message: null };
