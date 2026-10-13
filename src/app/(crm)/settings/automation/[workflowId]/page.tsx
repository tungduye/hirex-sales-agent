import Link from "next/link";
import { ArrowLeft, Boxes, CircleAlert, Clock3 } from "lucide-react";
import { notFound } from "next/navigation";
import { getN8nFailures, getN8nWorkflowDetail } from "@/modules/integrations/n8n/server/get-n8n-workflow-detail";
import { HIREX_N8N_INSTANCES, parseN8nInstanceId } from "@/modules/integrations/n8n/core/trusted-origin";
import { AutomationAutoRefresh } from "../automation-auto-refresh";
import { WorkflowNameForm } from "../workflow-name-form";
import { WorkflowStatusControl } from "../workflow-status-control";

export default async function WorkflowDetailPage({ params, searchParams }: { params: Promise<{ workflowId: string }>; searchParams: Promise<{ instance?: string }> }) {
  const { workflowId } = await params;
  const instanceId = parseN8nInstanceId((await searchParams).instance);
  const instance = HIREX_N8N_INSTANCES[instanceId];
  const [workflow, failures] = await Promise.all([getN8nWorkflowDetail(workflowId, instanceId), getN8nFailures(instanceId, workflowId)]);
  if (!workflow) notFound();
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><Link href={`/settings/automation?instance=${instanceId}`} className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft className="size-4"/>Tất cả workflow</Link><h1 className="mt-2 text-3xl font-bold text-slate-950">{workflow.name}</h1><p className="mt-1 text-sm text-slate-500">{instance.label} · ID: {workflow.id}</p></div>
      <div className="flex items-center gap-2"><AutomationAutoRefresh/><a href={`${instance.origin}/workflow/${encodeURIComponent(workflow.id)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold">Mở trình sửa n8n</a></div>
    </header>

    <section className="grid gap-4 md:grid-cols-3">
      <Card icon={workflow.active ? Clock3 : CircleAlert} label="Trạng thái"><div className="mt-2 flex items-center justify-between gap-3"><strong>{workflow.active ? "Đang bật" : "Đã tắt"}</strong><WorkflowStatusControl workflowId={workflow.id} active={workflow.active} instanceId={instanceId}/></div></Card>
      <Card icon={Boxes} label="Số node"><p className="mt-2 text-2xl font-bold">{workflow.nodeCount}</p></Card>
      <Card icon={Clock3} label="Cập nhật gần nhất"><p className="mt-2 text-sm font-semibold">{workflow.updatedAt ? new Date(workflow.updatedAt).toLocaleString("vi-VN") : "Chưa rõ"}</p></Card>
    </section>

    <section className="rounded-2xl border bg-white p-5 shadow-sm"><WorkflowNameForm workflowId={workflow.id} name={workflow.name} instanceId={instanceId}/></section>

    <section className="rounded-2xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-bold">Các node trong workflow</h2><p className="mt-1 text-sm text-slate-500">Chỉ hiển thị tên, loại và trạng thái; credentials và tham số node không được đưa ra trình duyệt.</p></div><div className="divide-y">{workflow.nodes.map((node, index) => <div key={`${node.name}-${index}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><div className="min-w-0"><p className="truncate font-semibold">{node.name}</p><p className="truncate text-xs text-slate-500">{node.type}</p></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${node.disabled ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{node.disabled ? "Đã tắt" : "Hoạt động"}</span></div>)}</div></section>

    <section className={`rounded-2xl border shadow-sm ${failures.length ? "border-red-200 bg-red-50" : "bg-white"}`}><div className="border-b p-5"><h2 className="font-bold">Lỗi gần đây</h2><p className="mt-1 text-sm text-slate-500">Tự cập nhật mỗi 15 giây, không hiển thị payload hoặc thông tin đăng nhập.</p></div>{failures.length ? <div className="divide-y divide-red-200">{failures.map(item => <div key={item.id} className="px-5 py-4"><p className="text-sm font-semibold text-red-950">{item.nodeName ?? "Workflow"}</p><p className="mt-1 text-sm text-red-800">{item.message}</p><p className="mt-1 text-xs text-red-700">{item.startedAt ? new Date(item.startedAt).toLocaleString("vi-VN") : "Chưa rõ thời điểm"}</p></div>)}</div> : <p className="p-5 text-sm text-emerald-700">Không có lỗi trong các lần chạy gần đây.</p>}</section>
  </div>;
}

function Card({ icon: Icon, label, children }: { icon: typeof Boxes; label: string; children: React.ReactNode }) {
  return <div className="rounded-2xl border bg-white p-5 shadow-sm"><Icon className="size-5 text-blue-600"/><p className="mt-3 text-sm text-slate-500">{label}</p>{children}</div>;
}
