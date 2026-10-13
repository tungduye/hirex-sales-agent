import Link from "next/link";
import { connectionSummary } from "@/modules/human-documents/server/connection";
import { HumanConnectionForm } from "@/modules/human-documents/components/connection-form";

export const runtime = "nodejs";
export default async function HumanSettingsPage() {
  const connection = await connectionSummary();
  return <section className="rounded-xl border bg-white p-6">
    <h1 className="text-2xl font-bold">Kết nối Human</h1>
    <p className="mt-2 text-slate-600">Chỉ dành cho admin HireX. Phạm vi: tên, thư mục và nội dung status của toàn bộ màn Tài liệu. Không đọc file đính kèm, không sửa dữ liệu Human.</p>
    {connection.loadError && <p role="alert" className="mt-3 text-red-700">Không đọc được cấu hình đã lưu. Cần kiểm tra khóa mã hóa và quyền truy cập thư mục runtime.</p>}
    <p className="mt-3 text-sm">{connection.verifiedAt ? `Lần xác thực thành công: ${connection.verifiedAt}` : "Chưa có kết nối được xác thực cho địa chỉ hiện tại."}</p>
    <HumanConnectionForm endpoint={connection.endpoint} username={connection.username} />
    <Link href="/documents" className="mt-4 inline-block text-blue-600">Mở màn Tài liệu →</Link>
  </section>;
}
