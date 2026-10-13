import "server-only";

const SUBSCRIBED_FIELDS = ["messages", "messaging_postbacks", "message_deliveries", "message_reads"];

export type FacebookPageSubscriptionResult =
  | { ok: true }
  | { ok: false; reason: "TOKEN_REJECTED" | "META_UNAVAILABLE" | "SUBSCRIPTION_REJECTED" };

/** Register the Page with this Meta app so Messenger events reach our webhook. */
export async function subscribeFacebookPage(input: {
  pageId: string;
  pageAccessToken: string;
  graphApiVersion: string;
}): Promise<FacebookPageSubscriptionResult> {
  const endpoint = new URL(
    `https://graph.facebook.com/${encodeURIComponent(input.graphApiVersion)}/${encodeURIComponent(input.pageId)}/subscribed_apps`,
  );
  endpoint.searchParams.set("subscribed_fields", SUBSCRIBED_FIELDS.join(","));
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${input.pageAccessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { success?: unknown } | null;
      return body?.success === true ? { ok: true } : { ok: false, reason: "SUBSCRIPTION_REJECTED" };
    }
    if (response.status === 401 || response.status === 403) return { ok: false, reason: "TOKEN_REJECTED" };
    return { ok: false, reason: response.status >= 500 ? "META_UNAVAILABLE" : "SUBSCRIPTION_REJECTED" };
  } catch {
    return { ok: false, reason: "META_UNAVAILABLE" };
  }
}
