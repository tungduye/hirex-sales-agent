import { KeyRound } from "lucide-react";
import { hasPermission } from "@/modules/access/server/access-control";

// "Tài nguyên": AccountsHS (moduleHS/accountshs) — giao diện gốc của v7.py do chính HireX phục vụ ở /api/hs/accountshs/ui
// (cùng đăng nhập, cùng Supabase, không còn server riêng). Quyền: "Tài khoản · Xem" (accounts.view) = xem + thêm/sửa/xoá/nhập;
// Tùy chỉnh / sao lưu / CRM = Quản trị viên (kiểm ở server).
export const metadata = { title: "Tài nguyên" };

export default async function AccountsPage() {
  if (!await hasPermission("accounts.view")) {
    return <div className="m-6 rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
      <KeyRound className="mx-auto mb-3 size-8 text-slate-400"/>Tài khoản của bạn chưa được cấp quyền xem mục Tài nguyên.
    </div>;
  }
  return <iframe src="/api/hs/accountshs/ui" title="Tài nguyên" className="block h-[calc(100dvh-4rem)] w-full border-0 bg-white lg:h-dvh" />;
}
