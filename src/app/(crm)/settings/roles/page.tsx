import { redirect } from "next/navigation";
import { ChevronDown, KeyRound, Plus, RadioTower, ShieldCheck, UserPlus, Users } from "lucide-react";
import { AccountPicker } from "@/modules/access/components/account-picker";
import { CreateAccountForm } from "@/modules/access/components/create-account-form";
import { permissionGroups } from "@/modules/access/core/permission-catalog";
import { assignProfileAccess, createRole, updateRole } from "@/modules/access/server/role-actions";
import { getRoleManagementData } from "@/modules/access/server/role-data";

export default async function RolesPage() {
  let data: Awaited<ReturnType<typeof getRoleManagementData>>;
  try { data = await getRoleManagementData(); } catch { redirect("/settings"); }

  const permissionMap = new Map<string, Set<string>>();
  for (const item of data.permissions) { const set = permissionMap.get(item.role_id) ?? new Set<string>(); set.add(item.permission_key); permissionMap.set(item.role_id, set); }
  const grantMap = new Map<string, Set<string>>();
  for (const item of data.grants) { const set = grantMap.get(item.profile_id) ?? new Set<string>(); set.add(item.channel_account_id); grantMap.set(item.profile_id, set); }
  const nameOf = new Map(data.profiles.map((profile) => [profile.id, profile.full_name]));
  const reportsOf = new Map<string, string[]>();
  for (const profile of data.profiles) if (profile.manager_id) reportsOf.set(profile.manager_id, [...(reportsOf.get(profile.manager_id) ?? []), profile.id]);
  const below = (id: string) => { const seen = new Set<string>(); const queue = [...(reportsOf.get(id) ?? [])]; while (queue.length) { const next = queue.shift()!; if (seen.has(next)) continue; seen.add(next); queue.push(...(reportsOf.get(next) ?? [])); } return seen; };

  return <div className="space-y-7 pb-10">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Bảo mật không gian làm việc</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Vai trò và phân quyền</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">Quản lý quyền sử dụng chức năng và phạm vi tài khoản kênh của từng thành viên.</p></div>
      <div className="flex flex-wrap gap-2"><a href="#roles" className="rounded-lg border bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">Quản lý vai trò</a><a href="#members" className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">Phân quyền thành viên</a></div>
    </header>

    <section className="grid gap-4 md:grid-cols-3"><Summary icon={ShieldCheck} value={data.roles.length} label="Vai trò" text="Mỗi vai trò có một bộ quyền riêng"/><Summary icon={Users} value={data.profiles.length} label="Thành viên" text="Mỗi thành viên thuộc một vai trò"/><Summary icon={RadioTower} value={data.accounts.length} label="Tài khoản kênh" text="Có thể giới hạn quyền truy cập theo kênh"/></section>

    <section className="grid gap-4 xl:grid-cols-2">
      <QuickAction icon={UserPlus} title="Tạo tài khoản mới" description="Thêm thành viên, đặt vai trò và chọn các tài khoản kênh được phép truy cập."><CreateAccountForm roles={data.roles} accounts={data.accounts} ready={data.accountCreationReady}/></QuickAction>
      <QuickAction icon={Plus} title="Tạo vai trò mới" description="Tạo một bộ quyền phù hợp với trách nhiệm của nhóm người dùng."><RoleForm action={createRole}/></QuickAction>
    </section>

    <section id="roles" className="scroll-mt-24 space-y-4">
      <SectionHeading title="Danh sách vai trò" description="Mở một vai trò để xem và chỉnh sửa quyền. Các thay đổi áp dụng cho mọi thành viên đang giữ vai trò đó." count={`${data.roles.length} vai trò`}/>
      <div className="grid items-start gap-4 xl:grid-cols-2">{data.roles.map((role) => {
        const selected = permissionMap.get(role.id);
        const memberCount = data.profiles.filter((profile) => profile.role_id === role.id).length;
        return <details key={role.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 marker:content-none">
            <div className="flex min-w-0 items-center gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><ShieldCheck className="size-5"/></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-950">{role.name}</h3>{role.is_system ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">Hệ thống</span> : null}</div><p className="truncate text-sm text-slate-500">{role.description || "Chưa có mô tả"}</p></div></div>
            <div className="flex shrink-0 items-center gap-2"><span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 sm:inline">{memberCount} người</span><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{selected?.size ?? 0} quyền</span><ChevronDown className="size-5 text-slate-400 transition-transform group-open:rotate-180"/></div>
          </summary>
          <div className="border-t border-slate-200 bg-slate-50/50 p-5"><RoleForm action={updateRole} role={role} selected={selected}/></div>
        </details>;
      })}</div>
    </section>

    <section id="members" className="scroll-mt-24 space-y-4">
      <SectionHeading title="Phân quyền thành viên" description="Chọn vai trò và giới hạn những Email, Facebook hoặc Zalo mà từng người được phép sử dụng." count={`${data.profiles.length} thành viên`}/>
      <div className="space-y-3">{data.profiles.map((profile) => {
        const roleName = data.roles.find((role) => role.id === profile.role_id)?.name ?? "Chưa có vai trò";
        const grantedCount = profile.all_channel_accounts ? data.accounts.length : grantMap.get(profile.id)?.size ?? 0;
        const primaryCount = data.accounts.filter((item) => item.primary_profile_id === profile.id).length;
        const reports = reportsOf.get(profile.id) ?? [];
        const blocked = below(profile.id);
        const managerName = profile.manager_id ? nameOf.get(profile.manager_id) : null;
        const pickerAccounts = data.accounts.map((item) => ({ id: item.id, channel: item.channel_type, name: item.display_name || item.external_account_id, owner: item.primary_profile_id && item.primary_profile_id !== profile.id ? nameOf.get(item.primary_profile_id) ?? null : null, free: !item.primary_profile_id }));
        const primaryIds = data.accounts.filter((item) => item.primary_profile_id === profile.id).map((item) => item.id);
        return <details key={profile.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 sm:p-5 marker:content-none">
            <div className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">{initials(profile.full_name)}</span><div className="min-w-0"><p className="truncate font-bold text-slate-950">{profile.full_name}</p><p className="truncate text-sm text-slate-500">{profile.email || profile.id}{managerName ? <span className="text-slate-400"> · Quản lý: {managerName}</span> : null}{reports.length ? <span className="text-slate-400"> · Quản lý {reports.length} người</span> : null}</p></div></div>
            <div className="flex shrink-0 items-center gap-2"><span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 sm:inline">{roleName}</span><span className="hidden rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 sm:inline">{primaryCount} tài khoản chính</span><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{profile.all_channel_accounts ? "Tất cả kênh" : `${grantedCount} kênh`}</span><ChevronDown className="size-5 text-slate-400 transition-transform group-open:rotate-180"/></div>
          </summary>
          <form action={assignProfileAccess} className="border-t border-slate-200 bg-slate-50/50 p-5"><input type="hidden" name="profileId" value={profile.id}/><div className="grid gap-5 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,2fr)]">
            <div className="space-y-4"><label className="block text-sm font-semibold text-slate-700">Vai trò<select name="roleId" defaultValue={profile.role_id} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">{data.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label className="block text-sm font-semibold text-slate-700">Quản lý trực tiếp<select name="managerId" defaultValue={profile.manager_id ?? ""} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="">— Không có —</option>{data.profiles.filter((other) => other.id !== profile.id && !blocked.has(other.id)).map((other) => <option key={other.id} value={other.id}>{other.full_name}</option>)}</select><span className="mt-1.5 block text-xs font-normal text-slate-500">Người quản lý thấy tài khoản chính của thành viên này ở mục “Team” trong Suối Nguồn.</span></label></div>
            <div><label className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 font-semibold text-blue-900"><input type="checkbox" name="allAccounts" defaultChecked={profile.all_channel_accounts} className="size-4 accent-blue-600"/> Cho phép truy cập tất cả tài khoản kết nối</label><p className="mt-2 text-xs text-slate-500">Nếu bỏ chọn, thành viên chỉ được sử dụng những tài khoản đánh dấu bên dưới.</p><AccountPicker name="channelAccountId" accounts={pickerAccounts} selected={[...(grantMap.get(profile.id) ?? [])]}/></div>
          </div><div className="mt-5 border-t border-slate-200 pt-5"><p className="text-sm font-bold text-slate-800">Tài khoản chính</p><p className="mt-1 text-xs text-slate-500">Những tài khoản người này trực tiếp dùng để nhắn tin — hiện ở mục “Của tôi” trong Suối Nguồn. Mỗi tài khoản chỉ có một người dùng chính; chọn ở đây sẽ chuyển từ người cũ sang. Tài khoản chính luôn được cấp quyền truy cập.</p><AccountPicker name="primaryAccountId" accounts={pickerAccounts} selected={primaryIds} ownerNote/></div><div className="mt-5 flex justify-end"><button className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700">Lưu phân quyền</button></div></form>
        </details>;
      })}</div>
    </section>
  </div>;
}

function QuickAction({ icon: Icon, title, description, children }: { icon: typeof UserPlus; title: string; description: string; children: React.ReactNode }) { return <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 marker:content-none"><div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Icon className="size-5"/></span><div><h2 className="font-bold text-slate-950">{title}</h2><p className="text-sm text-slate-500">{description}</p></div></div><ChevronDown className="size-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180"/></summary><div className="border-t border-slate-200 p-5">{children}</div></details>; }
function SectionHeading({ title, description, count }: { title: string; description: string; count: string }) { return <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-bold text-slate-950">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div><span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{count}</span></div>; }

function RoleForm({ action, role, selected }: { action: (data: FormData) => Promise<void>; role?: { id: string; name: string; description: string | null }; selected?: Set<string> }) { return <form action={action} className="space-y-5">{role ? <input type="hidden" name="roleId" value={role.id}/> : null}<div className="grid gap-4 md:grid-cols-2"><Field label="Tên vai trò"><input name="name" required minLength={2} maxLength={80} defaultValue={role?.name} placeholder="Ví dụ: Chăm sóc khách hàng" className={inputClass}/></Field><Field label="Mô tả"><input name="description" maxLength={300} defaultValue={role?.description ?? ""} placeholder="Phạm vi trách nhiệm của vai trò" className={inputClass}/></Field></div><div><div className="mb-3 flex items-center gap-2"><KeyRound className="size-4 text-blue-600"/><p className="text-sm font-bold text-slate-800">Quyền chức năng</p></div><PermissionMatrix selected={selected}/></div><div className="flex justify-end"><button className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-slate-800">{role ? "Lưu thay đổi" : "Tạo vai trò"}</button></div></form>; }
function PermissionMatrix({ selected }: { selected?: Set<string> }) { return <div className="grid gap-3 md:grid-cols-2">{permissionGroups.map((group) => <fieldset key={group.key} className="rounded-xl border border-slate-200 bg-white p-4"><legend className="px-1 text-sm font-bold text-slate-900">{group.label}</legend><div className="mt-2 flex flex-wrap gap-2">{group.actions.map(([key, label]) => { const value = `${group.key}.${key}`; return <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:border-blue-300 hover:bg-blue-50"><input type="checkbox" name="permission" value={value} defaultChecked={selected?.has(value)} className="size-4 accent-blue-600"/>{label}</label>; })}</div></fieldset>)}</div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm font-semibold text-slate-700">{label}{children}</label>; }
function Summary({ icon: Icon, value, label, text }: { icon: typeof ShieldCheck; value: number; label: string; text: string }) { return <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Icon className="size-5"/></span><div><p className="text-2xl font-black text-slate-950">{value}</p><p className="text-sm font-bold text-slate-800">{label}</p><p className="text-xs text-slate-500">{text}</p></div></div>; }
function initials(value: string) { const parts = value.trim().split(/\s+/u).filter(Boolean); return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}` : value.slice(0, 2)).toLocaleUpperCase("vi-VN"); }
const inputClass = "mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
