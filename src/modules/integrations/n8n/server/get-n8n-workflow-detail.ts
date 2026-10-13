import "server-only";
import { requireWorkspaceAdmin } from "@/modules/access/server/access-control";
import { requestN8n } from "@/modules/integrations/n8n/server/n8n-api";
import type { N8nInstanceId } from "@/modules/integrations/n8n/core/trusted-origin";

const workflowIdPattern = /^[A-Za-z0-9_-]{1,100}$/;

type UnknownRecord = Record<string, unknown>;
export type N8nWorkflowDetail = {
  id: string;
  name: string;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  nodeCount: number;
  nodes: { name: string; type: string; disabled: boolean }[];
};

export type N8nFailure = {
  id: string;
  workflowId: string;
  startedAt: string | null;
  stoppedAt: string | null;
  message: string;
  nodeName: string | null;
};

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? value as UnknownRecord : null;
}

function text(value: unknown, limit: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

function safeErrorMessage(value: unknown): string | null {
  const message = text(value, 2_000);
  if (!message) return null;
  if (message.startsWith("{") || message.startsWith("[")) return "Node trả lỗi dữ liệu có cấu trúc. Mở n8n để xem chi tiết an toàn.";
  return message
    .replace(/\b(?:eyJ|Bearer\s+)[A-Za-z0-9._~-]{20,}\b/gi, "[đã ẩn thông tin xác thực]")
    .replace(/([?&](?:token|key|secret|signature)=)[^&\s]+/gi, "$1[đã ẩn]")
    .replace(/\b[A-Za-z0-9_-]{80,}\b/g, "[đã ẩn dữ liệu dài]")
    .slice(0, 500);
}

function dataItems(value: unknown): UnknownRecord[] {
  const root = record(value);
  return root && Array.isArray(root.data) ? root.data.filter((item): item is UnknownRecord => Boolean(record(item))) : [];
}

function extractExecutionError(value: unknown): { message: string; nodeName: string | null } {
  const root = record(value);
  const data = record(root?.data);
  const resultData = record(data?.resultData);
  const error = record(resultData?.error);
  return {
    message: safeErrorMessage(error?.message) ?? "Workflow thất bại nhưng n8n không cung cấp thông báo lỗi.",
    nodeName: text(resultData?.lastNodeExecuted, 160),
  };
}

export async function getN8nWorkflowDetail(workflowId: string, instanceId: N8nInstanceId): Promise<N8nWorkflowDetail | null> {
  await requireWorkspaceAdmin();
  if (!workflowIdPattern.test(workflowId)) return null;
  try {
    const item = record(await requestN8n(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, {}, instanceId));
    if (!item || typeof item.id !== "string" || typeof item.name !== "string") return null;
    const rawNodes = Array.isArray(item.nodes) ? item.nodes : [];
    const nodes = rawNodes.flatMap((value) => {
      const node = record(value);
      const name = text(node?.name, 160);
      const type = text(node?.type, 160);
      return name && type ? [{ name, type, disabled: node?.disabled === true }] : [];
    });
    return {
      id: item.id,
      name: item.name.slice(0, 160),
      active: item.active === true,
      createdAt: text(item.createdAt, 80),
      updatedAt: text(item.updatedAt, 80),
      nodeCount: nodes.length,
      nodes,
    };
  } catch {
    return null;
  }
}

export async function getN8nFailures(instanceId: N8nInstanceId, workflowId?: string): Promise<N8nFailure[]> {
  await requireWorkspaceAdmin();
  if (workflowId && !workflowIdPattern.test(workflowId)) return [];
  try {
    const query = new URLSearchParams({ limit: "20", status: "error" });
    if (workflowId) query.set("workflowId", workflowId);
    const failures = dataItems(await requestN8n(`/api/v1/executions?${query.toString()}`, {}, instanceId)).slice(0, 5);
    const loaders: Promise<N8nFailure>[] = [];
    for (const item of failures) {
      if (typeof item.id !== "string" || typeof item.workflowId !== "string") continue;
      const executionId = item.id;
      const executionWorkflowId = item.workflowId;
      loaders.push((async () => {
            let detail = { message: "Workflow thất bại.", nodeName: null as string | null };
            try { detail = extractExecutionError(await requestN8n(`/api/v1/executions/${encodeURIComponent(executionId)}?includeData=true`, {}, instanceId)); } catch { /* Keep the safe fallback. */ }
            return {
              id: executionId.slice(0, 100),
              workflowId: executionWorkflowId.slice(0, 100),
              startedAt: text(item.startedAt, 80),
              stoppedAt: text(item.stoppedAt, 80),
              ...detail,
            };
          })());
    }
    return await Promise.all(loaders);
  } catch {
    return [];
  }
}
