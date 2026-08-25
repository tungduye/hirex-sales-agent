export interface GmailSyncState {
  success: boolean;
  message: string | null;
  syncedCount: number;
  skippedCount: number;
  failedCount: number;
}

export const initialGmailSyncState: GmailSyncState = { success: false, message: null, syncedCount: 0, skippedCount: 0, failedCount: 0 };
