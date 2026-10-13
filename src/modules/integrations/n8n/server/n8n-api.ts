import "server-only";
import { HIREX_N8N_INSTANCES, type N8nInstanceId } from "@/modules/integrations/n8n/core/trusted-origin";

// The n8n workflow collection includes node definitions even when HireX only
// projects id/name/status. The trusted instance currently returns ~3 MB for
// 36 workflows, so keep a bounded ceiling that still rejects abnormal bodies.
const MAX_RESPONSE_BYTES = 5_000_000;

export function getN8nConfig(instanceId: N8nInstanceId): { origin: string; apiKey: string } | null {
  const instance = HIREX_N8N_INSTANCES[instanceId];
  const apiKey = instanceId === "hirex-1"
    ? process.env.HIREX_N8N_INSTANCE_1_API_KEY?.trim()
    : process.env.HIREX_N8N_INSTANCE_2_API_KEY?.trim() || process.env.HIREX_N8N_API_KEY?.trim();
  return apiKey ? { origin: instance.origin, apiKey } : null;
}

export async function requestN8n(path: string, init: RequestInit = {}, instanceId: N8nInstanceId): Promise<unknown> {
  const config = getN8nConfig(instanceId);
  if (!config) throw new Error("N8N_NOT_CONFIGURED");
  if (!path.startsWith("/api/v1/")) throw new Error("N8N_PATH_REJECTED");

  const response = await fetch(`${config.origin}${path}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": config.apiKey,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
    redirect: "manual",
    // Some self-hosted instances need longer to project their workflow inventory.
    // Keep a hard timeout and never retry, so an uncertain mutation is not repeated.
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || response.status >= 300) throw new Error(`N8N_HTTP_${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) throw new Error("N8N_RESPONSE_TOO_LARGE");
  if (!body) return null;
  if (!contentType.includes("application/json")) throw new Error("N8N_RESPONSE_UNAVAILABLE");
  return JSON.parse(body) as unknown;
}
