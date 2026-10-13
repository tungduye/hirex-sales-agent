import Link from "next/link";
import { ArrowRight, FileScan, Globe2, ScanSearch } from "lucide-react";
import { hasPermission } from "@/modules/access/server/access-control";

const tools = [
  { href: "/scan/cv", permission: "scan.cv" as const, icon: FileScan, title: "Scan CV", description: "Gom nhiều tệp CV, tạo PR ứng viên và bản dịch tiếng Việt.", color: "bg-blue-50 text-blue-600" },
  { href: "/scan/website", permission: "scan.website" as const, icon: Globe2, title: "Scan Website", description: "Thu thập contact và đánh giá tiềm năng sử dụng dịch vụ headhunt.", color: "bg-violet-50 text-violet-600" },
];

export default async function ScanPage() {
  const access = await Promise.all(tools.map(async (tool) => ({ tool, allowed: await hasPermission(tool.permission) })));
  const available = access.filter((item) => item.allowed).map((item) => item.tool);
  return <div className="space-y-7"><header><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Bộ công cụ nghiên cứu</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Scan</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Chọn công cụ phù hợp với dữ liệu cần xử lý. Mỗi công cụ có phiên làm việc và kết quả riêng.</p></header>{available.length?<div className="grid gap-5 lg:grid-cols-2">{available.map((tool)=><Link key={tool.href} href={tool.href} className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg"><div className="flex items-start justify-between gap-4"><span className={`flex size-12 items-center justify-center rounded-2xl ${tool.color}`}><tool.icon className="size-6"/></span><ArrowRight className="size-5 text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-600"/></div><h2 className="mt-5 text-xl font-bold text-slate-950">{tool.title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{tool.description}</p><span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-blue-600"><ScanSearch className="size-4"/>Mở công cụ</span></Link>)}</div>:<div className="rounded-2xl border border-dashed bg-white p-10 text-center text-sm text-slate-500">Vai trò hiện tại chưa được cấp quyền chạy công cụ Scan.</div>}</div>;
}
