"use client";

import { useActionState } from "react";
import { createWorkspaceAccount, type CreateAccountState } from "@/modules/access/server/create-workspace-account";
import { AccountPicker, toPickerAccounts } from "./account-picker";

type Role={id:string;name:string};
type Account={id:string;channel_type:string;display_name:string|null;external_account_id:string;status?:string|null};

export function CreateAccountForm({roles,accounts,ready}:{roles:Role[];accounts:Account[];ready:boolean}){
  const initialCreateAccountState:CreateAccountState={status:"idle",message:""};
  const [state,action,pending]=useActionState(createWorkspaceAccount,initialCreateAccountState);
  return <form action={action} className="mt-4 space-y-5">
    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm font-medium">Tên hiển thị<input name="fullName" required minLength={2} maxLength={120} autoComplete="off" className="mt-1 h-10 w-full rounded-lg border px-3"/></label>
      <label className="text-sm font-medium">Email đăng nhập<input name="email" type="email" required maxLength={254} autoComplete="off" className="mt-1 h-10 w-full rounded-lg border px-3"/></label>
      <label className="text-sm font-medium">Mật khẩu khởi tạo<input name="password" type="password" required minLength={6} maxLength={128} autoComplete="new-password" className="mt-1 h-10 w-full rounded-lg border px-3"/><span className="mt-1 block text-xs font-normal text-slate-500">Ít nhất 6 ký tự. Không gửi mật khẩu qua chat; dùng kênh riêng an toàn.</span></label>
      <label className="text-sm font-medium">Vai trò<select name="roleId" required defaultValue={roles.find(role=>role.name==="Nhân viên")?.id??roles[0]?.id} className="mt-1 h-10 w-full rounded-lg border px-3">{roles.map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
    </div>
    <div><p className="text-sm font-semibold">Chỉ cấp các tài khoản kết nối sau</p><p className="text-xs text-slate-500">Mặc định không thấy Email, Facebook Page hoặc Zalo nào. Có thể sửa lại sau ở bên dưới.</p><AccountPicker name="channelAccountId" accounts={toPickerAccounts(accounts)} selected={[]}/></div>
    {!ready&&<p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Đang khóa tạo tài khoản mới cho đến khi hoàn tất migration 030 bảo vệ phạm vi dữ liệu.</p>}
    {state.status!=="idle"&&<p role="status" className={`rounded-lg p-3 text-sm ${state.status==="success"?"bg-emerald-50 text-emerald-800":"bg-rose-50 text-rose-800"}`}>{state.message}</p>}
    <div className="flex justify-end"><button disabled={!ready||pending||roles.length===0} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{pending?"Đang tạo...":"Tạo tài khoản"}</button></div>
  </form>
}
