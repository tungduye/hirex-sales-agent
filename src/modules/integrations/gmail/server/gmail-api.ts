import "server-only";

import type { GmailMessageResource } from "@/modules/integrations/gmail/types/gmail-message";
import type { GmailHistoryPage } from "@/modules/integrations/gmail/types/incremental-sync";

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

export async function listMessagePage(accessToken: string, pageToken?: string | null) {
  const query = new URLSearchParams({ maxResults: "50", includeSpamTrash: "false" });
  if (pageToken) query.set("pageToken", pageToken);
  const response = await request(`${BASE_URL}/messages?${query.toString()}`, accessToken);
  const body = await response.json() as { messages?: Array<{ id?: string }>; nextPageToken?: string };
  return {
    messageIds: (body.messages ?? []).flatMap((item) => item.id ? [item.id] : []).slice(0, 50),
    nextPageToken: body.nextPageToken ?? null,
  };
}

export async function getFullMessage(accessToken: string, messageId: string) {
  const response = await request(`${BASE_URL}/messages/${encodeURIComponent(messageId)}?format=full`, accessToken);
  return response.json() as Promise<GmailMessageResource>;
}

export async function listHistoryPage(
  accessToken: string,
  input: { startHistoryId: string; pageToken?: string | null; maxResults: number },
): Promise<GmailHistoryPage> {
  const query = new URLSearchParams({
    startHistoryId: input.startHistoryId,
    maxResults: String(input.maxResults),
  });
  if (input.pageToken) query.set("pageToken", input.pageToken);
  const response = await request(`${BASE_URL}/history?${query.toString()}`, accessToken);
  const body = await response.json() as GmailHistoryPage;
  return {
    history: body.history ?? [],
    historyId: body.historyId,
    nextPageToken: body.nextPageToken ?? null,
  };
}

async function request(url: string, accessToken: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!response.ok) {
    throw new GmailApiError(response.status === 401 ? "AUTHENTICATION" : "API", response.status);
  }
  return response;
}
