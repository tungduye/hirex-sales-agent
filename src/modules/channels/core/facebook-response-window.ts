export const FACEBOOK_RESPONSE_WINDOW_MS = 23 * 60 * 60 * 1000;

export interface FacebookResponseWindowEvidence {
  status: unknown;
  latestInboundAt: unknown;
}

export function isFacebookResponseWindowOpen(evidence: FacebookResponseWindowEvidence, now: Date): boolean {
  if (!Number.isFinite(now.getTime()) || !["OPEN", "PENDING"].includes(String(evidence.status)) || typeof evidence.latestInboundAt !== "string") return false;
  const inboundAt = Date.parse(evidence.latestInboundAt);
  return Number.isFinite(inboundAt) && inboundAt <= now.getTime() && inboundAt > now.getTime() - FACEBOOK_RESPONSE_WINDOW_MS;
}
