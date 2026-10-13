import "server-only";
import { requireWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getN8nConfig, requestN8n } from "@/modules/integrations/n8n/server/n8n-api";
import type { N8nInstanceId } from "@/modules/integrations/n8n/core/trusted-origin";

export type N8nWorkflow = { id: string; name: string; active: boolean };
export type N8nExecution = { id: string; workflowId: string; status: string; startedAt: string | null };
export type N8nOverview = {
  state: "NOT_CONFIGURED" | "INVALID_CONFIG" | "UNAVAILABLE" | "CONNECTED";
  workflows: N8nWorkflow[];
  executions: N8nExecution[];
  executionsAvailable: boolean;
};

function items(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || !("data" in value) || !Array.isArray(value.data)) throw new Error("N8N_RESPONSE_INVALID");
  return value.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

export async function getN8nOverview(instanceId: N8nInstanceId): Promise<N8nOverview> {
  await requireWorkspaceAdmin();
  const empty = { workflows: [], executions: [], executionsAvailable: false };
  if (!getN8nConfig(instanceId)) return { state: "NOT_CONFIGURED", ...empty };

  try {
    // Instance 1 has substantially larger workflow definitions. Keep its
    // inventory below the shared 5 MB response ceiling; details remain lazy.
    const workflowLimit = instanceId === "hirex-1" ? 25 : 50;
    const workflowResponse = await requestN8n(`/api/v1/workflows?limit=${workflowLimit}`, {}, instanceId);
    const workflows = items(workflowResponse).flatMap((item) =>
      typeof item.id === "string" && typeof item.name === "string"
        ? [{ id: item.id.slice(0, 100), name: item.name.slice(0, 160), active: item.active === true }]
        : [],
    );
    let executions: N8nExecution[] = [];
    let executionsAvailable = false;
    try {
      const executionResponse = await requestN8n("/api/v1/executions?limit=20", {}, instanceId);
      executions = items(executionResponse).flatMap((item) =>
        typeof item.id === "string" && typeof item.workflowId === "string" && typeof item.status === "string"
          ? [{ id: item.id.slice(0, 100), workflowId: item.workflowId.slice(0, 100), status: item.status.slice(0, 40), startedAt: typeof item.startedAt === "string" ? item.startedAt : null }]
          : [],
      );
      executionsAvailable = true;
    } catch { /* Workflow inventory can still be shown if execution access is restricted. */ }
    return { state: "CONNECTED", workflows, executions, executionsAvailable };
  } catch { return { state: "UNAVAILABLE", ...empty }; }
}
