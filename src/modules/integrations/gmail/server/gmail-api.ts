import "server-only";

import type { GmailMessageResource } from "@/modules/integrations/gmail/types/gmail-message";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailApiError extends Error {
  constructor(
    readonly category: "AUTHENTICATION" | "API",
    readonly status: number,
  ) {
    super("Gmail API request failed.");
  }
}

export async function listLatestMessageIds(accessToken: string) {
  const url = `${BASE_URL}/messages?maxResults=10&includeSpamTrash=false`;
  const response = await request(url, accessToken);
  const body = await response.json() as { messages?: Array<{ id?: string }> };
  return (body.messages ?? []).flatMap((item) => item.id ? [item.id] : []).slice(0, 10);
}

export async function getFullMessage(accessToken: string, messageId: string) {
  const response = await request(`${BASE_URL}/messages/${encodeURIComponent(messageId)}?format=full`, accessToken);
  return response.json() as Promise<GmailMessageResource>;
}

async function request(url: string, accessToken: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!response.ok) {
    throw new GmailApiError(response.status === 401 ? "AUTHENTICATION" : "API", response.status);
  }
  return response;
}
