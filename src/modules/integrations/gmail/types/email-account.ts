export const EMAIL_ACCOUNT_STATUSES = [
  "CONNECTED",
  "REAUTH_REQUIRED",
  "DISCONNECTED",
  "ERROR",
] as const;

export type EmailAccountStatus = (typeof EMAIL_ACCOUNT_STATUSES)[number];

export interface EmailAccountMetadata {
  id: string;
  provider: "GMAIL";
  emailAddress: string;
  displayName: string | null;
  status: EmailAccountStatus;
  scopes: string[];
  lastSyncAt: string | null;
  createdAt: string;
}
