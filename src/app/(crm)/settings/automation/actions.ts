"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAdmin } from "@/modules/access/server/access-control";
import { requestN8n } from "@/modules/integrations/n8n/server/n8n-api";
import { HIREX_N8N_INSTANCES, type N8nInstanceId } from "@/modules/integrations/n8n/core/trusted-origin";

export type WorkflowActionState = { ok: boolean; message: string };
const workflowIdPattern = /^[A-Za-z0-9_-]{1,100}$/;

function instanceIdFrom(formData: FormData): N8nInstanceId | null {
  const value = String(formData.get("instanceId") ?? "");
  return value in HIREX_N8N_INSTANCES ? value as N8nInstanceId : null;
}

export async function changeWorkflowStatus(
  _previous: WorkflowActionState,
  formData: FormData,
): Promise<WorkflowActionState> {
  await requireWorkspaceAdmin();
  const workflowId = String(formData.get("workflowId") ?? "");
  const operation = String(formData.get("operation") ?? "");
  const instanceId = instanceIdFrom(formData);
  if (!instanceId || !workflowIdPattern.test(workflowId) || !["activate", "deactivate"].includes(operation)) {
    return { ok: false, message: "Yêu cầu không hợp lệ." };
  }

  try {
    const current = await requestN8n(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, {}, instanceId);
    if (!current || typeof current !== "object") return { ok: false, message: "Workflow không còn tồn tại hoặc không được phép thao tác." };
    const workflow = current as Record<string, unknown>;
    const alreadyInState = operation === "activate" ? workflow.active === true : workflow.active !== true;
    if (alreadyInState) return { ok: true, message: operation === "activate" ? "Workflow đã được bật." : "Workflow đã được tắt." };

    await requestN8n(`/api/v1/workflows/${encodeURIComponent(workflowId)}/${operation}`, { method: "POST" }, instanceId);
    revalidatePath("/settings/automation");
    return { ok: true, message: operation === "activate" ? "Đã bật workflow." : "Đã tắt workflow." };
  } catch {
    return { ok: false, message: "n8n chưa xác nhận thay đổi. Trạng thái không được tự thử lại." };
  }
}

export async function updateWorkflowName(
  _previous: WorkflowActionState,
  formData: FormData,
): Promise<WorkflowActionState> {
  await requireWorkspaceAdmin();
  const workflowId = String(formData.get("workflowId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const instanceId = instanceIdFrom(formData);
  if (!instanceId || !workflowIdPattern.test(workflowId) || !name || name.length > 160) return { ok: false, message: "Tên workflow không hợp lệ." };
  try {
    const current = await requestN8n(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, {}, instanceId);
    if (!current || typeof current !== "object") return { ok: false, message: "Không tìm thấy workflow." };
    const workflow = current as Record<string, unknown>;
    if (!Array.isArray(workflow.nodes) || !workflow.connections || typeof workflow.connections !== "object" || !workflow.settings || typeof workflow.settings !== "object") {
      return { ok: false, message: "Cấu trúc workflow không hợp lệ; không lưu thay đổi." };
    }
    if (workflow.name === name) return { ok: true, message: "Tên workflow không thay đổi." };
    await requestN8n(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
      method: "PUT",
      body: JSON.stringify({ name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings }),
    }, instanceId);
    revalidatePath("/settings/automation");
    revalidatePath(`/settings/automation/${workflowId}`);
    return { ok: true, message: "Đã cập nhật tên workflow." };
  } catch {
    return { ok: false, message: "n8n chưa xác nhận cập nhật. Không tự gửi lại." };
  }
}
