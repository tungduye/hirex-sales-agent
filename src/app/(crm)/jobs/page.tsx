import { BriefcaseBusiness } from "lucide-react";
import { JobsView } from "@/modules/jobs/components/jobs-view";
import { listJobs } from "@/modules/jobs/server/jobs-data";
import { hasPermission } from "@/modules/access/server/access-control";

export const metadata = { title: "Job" };

export default async function JobsPage() {
  const [result, canCreateContent] = await Promise.all([listJobs(), hasPermission("content.create")]);
  if (result.status === "forbidden") return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600"><BriefcaseBusiness className="mx-auto mb-3 size-8 text-slate-400"/>Tài khoản của bạn chưa được cấp quyền xem Job.</div>;
  if (result.status === "error") return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">Chưa tải được danh sách job, thử tải lại trang.</div>;
  return <JobsView jobs={result.jobs} canManage={result.canManage} members={result.members} canCreateContent={canCreateContent}/>;
}
