import { KeyRound } from "lucide-react";
import { hasPermission, isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { AccountsApp } from "../../../../moduleHS/accountshs/components/accounts-app";

// "Tài khoản": AccountsHS (moduleHS/accountshs) chạy ngay trong HireX — trước đây là iframe tới server-ahs.hat11.io.vn.
// Quyền: "Tài khoản · Xem" (accounts.view) = xem + thêm/sửa/xoá/nhập; Tùy chỉnh / sao lưu / CRM = Quản trị viên.
export const metadata = { title: "Tài khoản" };

export default async function AccountsPage() {
  if (!await hasPermission("accounts.view")) {
    return <div className="m-6 rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
      <KeyRound className="mx-auto mb-3 size-8 text-slate-400"/>Tài khoản của bạn chưa được cấp quyền xem mục Tài khoản.
    </div>;
  }
  const manage = await isWorkspaceAdmin();
  return <div className="h-[calc(100dvh-4rem)] min-h-0 overflow-hidden bg-white"><AccountsApp canEdit canManage={manage} /></div>;
}
