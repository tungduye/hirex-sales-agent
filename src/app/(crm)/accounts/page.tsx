import { KeyRound } from "lucide-react";
import { hasPermission } from "@/modules/access/server/access-control";

// "Tài nguyên": AccountsHS (moduleHS/accountshs) — giao diện gốc của v7.py do chính HireX phục vụ ở /api/hs/accountshs/ui
// (cùng đăng nhập, cùng Supabase, không còn server riêng). Quyền: "Tài khoản · Xem" (accounts.view) = xem + thêm/sửa/xoá/nhập;
// Tùy chỉnh / sao lưu / CRM = Quản trị viên (kiểm ở server).
export const metadata = { title: "Tài nguyên" };

const HX_BOOT = "(function(){try{if(window.__hxBoot)return;var q=function(u){var p=fetch(u,{credentials:'same-origin'});p.catch(function(){});return p};"
  + "window.__hxBoot={t:Date.now(),meta:q('/api/hs/accountshs/meta'),data:q('/api/hs/accountshs/data?lz=')};q('/api/hs/accountshs/ui')}catch(e){}})();";

export default async function AccountsPage() {
  if (!await hasPermission("accounts.view")) {
    return <div className="m-6 rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
      <KeyRound className="mx-auto mb-3 size-8 text-slate-400"/>Tài khoản của bạn chưa được cấp quyền xem mục Tài nguyên.
    </div>;
  }
  // Iframe AccountsHS do HsAccountsHost (moduleHS/accountshs/host.tsx, gắn trong app-shell) giữ sẵn ở nền và đặt khít vào ô này
  // → mở mục Tài nguyên là có ngay. Cao = màn hình trừ thanh trên cùng (thanh này chỉ hiện trên điện thoại).
  // Mở thẳng / F5 trang này: bắt đầu tải meta + dữ liệu ngay khi trình duyệt nhận HTML, song song với dựng trang HireX và tải iframe;
  // iframe dùng lại đúng kết quả đó (moduleHS/accountshs/ui/hirex-boot.js). Chuyển trang trong HireX thì script này không chạy (iframe đã nạp sẵn ở nền).
  return <>
    <style>{"#hs-acc-slot{height:calc(100dvh - 4rem)}@media (min-width:1024px){#hs-acc-slot{height:100dvh}}"}</style>
    <script dangerouslySetInnerHTML={{ __html: HX_BOOT }} />
    <div id="hs-acc-slot" className="w-full bg-white" />
  </>;
}
