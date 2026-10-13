import Link from "next/link";
import { Activity, ArrowUpRight, Bot, CircleCheck, CircleHelp, CircleX, Pencil, Workflow } from "lucide-react";
import { getN8nOverview } from "@/modules/integrations/n8n/server/get-n8n-overview";
import { HIREX_N8N_INSTANCES, parseN8nInstanceId } from "@/modules/integrations/n8n/core/trusted-origin";
import { WorkflowStatusControl } from "./workflow-status-control";
import { AutomationAutoRefresh } from "./automation-auto-refresh";
import { getN8nFailures } from "@/modules/integrations/n8n/server/get-n8n-workflow-detail";

const stateLabel = {
  NOT_CONFIGURED: "Chưa cấu hình",
  INVALID_CONFIG: "Cấu hình không hợp lệ",
  UNAVAILABLE: "Không kết nối được",
  CONNECTED: "Đã kết nối",
} as const;

export default async function AutomationPage({ searchParams }: { searchParams: Promise<{ instance?: string }> }) {
  const instanceId = parseN8nInstanceId((await searchParams).instance);
  const instance = HIREX_N8N_INSTANCES[instanceId];
  const overview = await getN8nOverview(instanceId);
  const failures = overview.state === "CONNECTED" ? await getN8nFailures(instanceId) : [];
  const connected = overview.state === "CONNECTED";

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
      <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Cài đặt · Nội bộ HireX</p>
      <h1 className="mt-1 text-3xl font-bold text-slate-950">Tự động hoá</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">Khu vực dành riêng cho quản trị viên HireX để theo dõi và bật/tắt workflow n8n.</p>
      </div><AutomationAutoRefresh/>
    </header>

    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">Instance n8n đã chọn</h2><p className="mt-1 text-sm font-semibold text-blue-700">{instance.label}</p><p className="mt-1 break-all text-sm text-slate-600">{instance.origin}</p></div>
      <a href={instance.origin} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Mở n8n <ArrowUpRight className="size-4"/></a></div>
      <nav aria-label="Chọn instance n8n" className="mt-4 flex flex-wrap gap-2">{Object.values(HIREX_N8N_INSTANCES).map(item => <Link key={item.id} href={`/settings/automation?instance=${item.id}`} className={`rounded-lg px-3 py-2 text-sm font-bold ${item.id === instanceId ? "bg-blue-600 text-white" : "border bg-white text-slate-700 hover:bg-slate-50"}`}>{item.label}</Link>)}</nav>
    </section>

    <section className="grid gap-4 md:grid-cols-3">
      <Summary icon={connected ? CircleCheck : CircleHelp} label="Kết nối n8n" value={stateLabel[overview.state]} detail={connected ? "API bảo mật qua máy chủ HireX" : "Chưa có thao tác chạy workflow"}/>
      <Summary icon={Workflow} label="Workflow" value={connected ? String(overview.workflows.length) : "—"} detail={`Tối đa ${instanceId === "hirex-1" ? 25 : 50} workflow gần nhất`}/>
      <Summary icon={Activity} label="Lần chạy gần đây" value={overview.executionsAvailable ? String(overview.executions.length) : "—"} detail="Tối đa 20 lần chạy gần nhất"/>
    </section>

    {!connected && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
      <div className="flex items-start gap-3"><CircleX className="mt-0.5 size-5 shrink-0"/><div>
        <h2 className="font-bold">{stateLabel[overview.state]}</h2>
        <p className="mt-1">{overview.state === "NOT_CONFIGURED" ? "Chưa cấu hình API key phía máy chủ cho instance này." : overview.state === "INVALID_CONFIG" ? "Cấu hình instance không hợp lệ. HireX sẽ không gửi API key tới địa chỉ khác." : "Instance n8n hoặc API chưa phản hồi hợp lệ. Không tự thử lại hay chạy workflow."}</p>
      </div></div>
    </section>}

    <section className="grid gap-4 md:grid-cols-2">
      <Link href="/settings/channels/automations" className="rounded-2xl border bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"><div className="flex items-center justify-between"><Bot className="size-6 text-blue-600"/><ArrowUpRight className="size-4 text-slate-400"/></div><h2 className="mt-4 font-bold">Quy trình hội thoại HireX</h2><p className="mt-1 text-sm text-slate-600">Xem quy trình nội bộ và các đề xuất cần người duyệt.</p></Link>
      <Link href="/settings/email-automation" className="rounded-2xl border bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"><div className="flex items-center justify-between"><Activity className="size-6 text-blue-600"/><ArrowUpRight className="size-4 text-slate-400"/></div><h2 className="mt-4 font-bold">Tự động hoá Email</h2><p className="mt-1 text-sm text-slate-600">Theo dõi worker, lần chạy và lỗi giao hàng.</p></Link>
    </section>

    {connected && failures.length > 0 && <section className="rounded-2xl border border-red-200 bg-red-50 shadow-sm"><div className="border-b border-red-200 p-5"><h2 className="font-bold text-red-950">Lỗi n8n gần đây</h2><p className="mt-1 text-sm text-red-800">Thông báo được làm sạch payload và tự cập nhật mỗi 15 giây.</p></div><div className="divide-y divide-red-200">{failures.map(item => <Link key={item.id} href={`/settings/automation/${item.workflowId}?instance=${instanceId}`} className="block px-5 py-4 hover:bg-red-100/60"><p className="text-sm font-semibold text-red-950">{overview.workflows.find(workflow => workflow.id === item.workflowId)?.name ?? `Workflow ${item.workflowId}`}</p><p className="mt-1 text-sm text-red-800">{item.nodeName ? `${item.nodeName}: ` : ""}{item.message}</p><p className="mt-1 text-xs text-red-700">{item.startedAt ? new Date(item.startedAt).toLocaleString("vi-VN") : "Chưa rõ thời điểm"}</p></Link>)}</div></section>}

    {connected && <section className="rounded-2xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-bold">Workflow n8n</h2><p className="mt-1 text-sm text-slate-500">Bấm Chỉnh sửa để xem node, đổi tên, theo dõi lịch sử và lỗi chi tiết.</p></div>{overview.workflows.length ? <div className="divide-y">{overview.workflows.map(item => <div key={item.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 text-sm"><div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-900">{item.name}</p><span className={`mt-1 block w-fit rounded-full px-2 py-1 text-xs font-semibold ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{item.active ? "Đang bật" : "Đã tắt"}</span></div><div className="flex items-start gap-2"><Link href={`/settings/automation/${item.id}?instance=${instanceId}`} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"><Pencil className="size-3.5"/>Chỉnh sửa</Link><WorkflowStatusControl workflowId={item.id} active={item.active} instanceId={instanceId}/></div></div>)}</div> : <p className="p-5 text-sm text-slate-500">Chưa có workflow nào được trả về.</p>}</section>}

    {connected && <section className="rounded-2xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-bold">Lịch sử chạy n8n</h2><p className="mt-1 text-sm text-slate-500">Chỉ hiển thị trạng thái và thời điểm, không hiển thị payload hoặc thông tin đăng nhập.</p></div>{!overview.executionsAvailable ? <p className="p-5 text-sm text-amber-800">Không đọc được lịch sử chạy với quyền API hiện tại.</p> : overview.executions.length ? <div className="divide-y">{overview.executions.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"><span className="text-slate-700">Workflow {overview.workflows.find(workflow => workflow.id === item.workflowId)?.name ?? item.workflowId}</span><span className="text-slate-500">{item.status} · {item.startedAt ? new Date(item.startedAt).toLocaleString("vi-VN") : "Chưa rõ thời điểm"}</span></div>)}</div> : <p className="p-5 text-sm text-slate-500">Chưa có lần chạy nào.</p>}</section>}
  </div>;
}

function Summary({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border bg-white p-5 shadow-sm"><Icon className="size-5 text-blue-600"/><p className="mt-3 text-sm text-slate-500">{label}</p><p className="mt-1 text-lg font-bold">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}
