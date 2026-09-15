export const PROVIDER_HEALTH_STATUSES = ["HEALTHY", "DEGRADED", "DISCONNECTED", "AUTH_REQUIRED", "UNKNOWN"] as const;
export type ProviderHealthStatus = (typeof PROVIDER_HEALTH_STATUSES)[number];
export const ZALO_PROVIDER_HEALTH_MAX_AGE_MS = 5 * 60 * 1000;

export type ProviderHealthEvidence = { operatorEnabled: boolean; status: ProviderHealthStatus; checkedAt: string | null };
export type ProviderHealthIneligibility = "CHANNEL_DISABLED"|"PROVIDER_DEGRADED"|"PROVIDER_DISCONNECTED"|"PROVIDER_AUTH_REQUIRED"|"PROVIDER_HEALTH_UNKNOWN"|"PROVIDER_HEALTH_STALE";

export function evaluateZaloProviderHealth(evidence: ProviderHealthEvidence, now: Date): {allowed:true}|{allowed:false;reason:ProviderHealthIneligibility} {
  if (!evidence.operatorEnabled) return { allowed:false, reason:"CHANNEL_DISABLED" };
  if (evidence.status === "DEGRADED") return { allowed:false, reason:"PROVIDER_DEGRADED" };
  if (evidence.status === "DISCONNECTED") return { allowed:false, reason:"PROVIDER_DISCONNECTED" };
  if (evidence.status === "AUTH_REQUIRED") return { allowed:false, reason:"PROVIDER_AUTH_REQUIRED" };
  if (evidence.status !== "HEALTHY") return { allowed:false, reason:"PROVIDER_HEALTH_UNKNOWN" };
  const checked=Date.parse(evidence.checkedAt??"");
  if (!Number.isFinite(checked) || !Number.isFinite(now.getTime()) || checked>now.getTime()+30_000 || now.getTime()-checked>ZALO_PROVIDER_HEALTH_MAX_AGE_MS) return {allowed:false,reason:"PROVIDER_HEALTH_STALE"};
  return {allowed:true};
}
