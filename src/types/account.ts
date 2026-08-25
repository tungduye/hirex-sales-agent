export interface AccountContext {
  userId: string;
  email: string;
  fullName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  configurationComplete: boolean;
}
