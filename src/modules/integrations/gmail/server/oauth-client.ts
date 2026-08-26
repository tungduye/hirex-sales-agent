import "server-only";

import { OAuth2Client } from "google-auth-library";
import { getGmailServerConfig } from "@/modules/integrations/gmail/server/config";

export const GMAIL_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
] as const;

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export const GMAIL_SEND_UPGRADE_SCOPES = [
  ...GMAIL_OAUTH_SCOPES,
  GMAIL_SEND_SCOPE,
] as const;

export function createGoogleOAuthClient() {
  const config = getGmailServerConfig();
  return new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret,
    config.redirectUri,
  );
}
