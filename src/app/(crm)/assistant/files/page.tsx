import { Download, FileText } from "lucide-react";
import Link from "next/link";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { listGeneratedFiles } from "@/modules/documents-out/server/generated-files";

export const metadata = { title: "Tài liệu đã tạo" };
const KIND_LABEL: Record<string, string> = { FREE: "Tài liệu", JD: "JD" };
const when = (iso: string) => new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default async function GeneratedFilesPage() {
  const account = await getAccountContext();
  if (!account?.workspaceId) return null;
  const isAdmin = await isWorkspaceAdmin();
  const files = await listGeneratedFiles({ workspaceId: account.workspaceId, userId: account.userId, isAdmin });
  return <div className="space-y-5">
    <header>
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-950"><FileText className="size-6 text-blue-600"/>Tài liệu đã tạo</h1>
      <p className="mt-1 text-sm text-slate-500">File Word Trợ lý/Soda đã làm theo yêu cầu{isAdmin ? " (quản trị viên thấy của mọi người)" : " của sếp"}. Ví dụ: “@Soda làm JD job HCM_BRSE_03”, “@Soda soạn biên bản họp sáng nay thành file Word”. <Link href="/assistant" className="font-semibold text-blue-700 hover:underline">Mở Trợ lý</Link></p>
    </header>
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"><tr>
          <th className="px-3 py-2.5">Tài liệu</th><th className="px-3 py-2.5">Loại</th><th className="px-3 py-2.5">Tạo từ</th>{isAdmin ? <th className="px-3 py-2.5">Người tạo</th> : null}<th className="px-3 py-2.5">Lúc</th><th className="px-3 py-2.5"><span className="sr-only">Tải</span></th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {files.map((file) => <tr key={file.id}>
            <td className="px-3 py-2.5"><p className="font-semibold text-slate-900">{file.title}</p><p className="text-xs text-slate-400">{file.filename} · {size(file.sizeBytes)}</p></td>
            <td className="px-3 py-2.5 text-slate-700">{KIND_LABEL[file.kind] ?? file.kind}</td>
            <td className="px-3 py-2.5 text-slate-700">{file.source === "ZALO" ? "Zalo" : "Web"}</td>
            {isAdmin ? <td className="px-3 py-2.5 text-slate-700">{file.createdBy}</td> : null}
            <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">{when(file.createdAt)}</td>
            <td className="px-3 py-2.5 text-right"><a href={`/api/assistant/files/${file.id}`} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"><Download className="size-3.5"/>Tải Word</a></td>
          </tr>)}
        </tbody>
      </table>
      {files.length === 0 ? <p className="px-4 py-12 text-center text-sm text-slate-500">Chưa có tài liệu nào. Hỏi Trợ lý hoặc Soda để tạo file Word.</p> : null}
    </div>
  </div>;
}
