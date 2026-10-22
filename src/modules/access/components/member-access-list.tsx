"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AccountPicker, type PickerAccount } from "./account-picker";

// "Phân quyền thành viên": one row per member; the editing form (two account checklists of every channel account)
// is built only when the row is opened, so the page stays light however many members and accounts there are.

type Profile = { id: string; full_name: string; email: string; role_id: string; manager_id: string | null; all_channel_accounts: boolean; department?: string | null; avatar_url?: string | null };
type Account = { id: string; channel_type: string; display_name: string | null; external_account_id: string; primary_profile_id: string | null };

function initials(value: string) { const parts = value.trim().split(/\s+/u).filter(Boolean); return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}` : value.slice(0, 2)).toLocaleUpperCase("vi-VN"); }

export function MemberAccessList({ profiles, roles, accounts, grants, action }: {
  profiles: Profile[]; roles: Array<{ id: string; name: string }>; accounts: Account[]; grants: Record<string, string[]>; action: (data: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const nameOf = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile.full_name])), [profiles]);
  const reportsOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const profile of profiles) if (profile.manager_id) map.set(profile.manager_id, [...(map.get(profile.manager_id) ?? []), profile.id]);
    return map;
  }, [profiles]);
  const below = (id: string) => { const seen = new Set<string>(); const queue = [...(reportsOf.get(id) ?? [])]; while (queue.length) { const next = queue.shift()!; if (seen.has(next)) continue; seen.add(next); queue.push(...(reportsOf.get(next) ?? [])); } return seen; };
  return <div className="space-y-3">{profiles.map((profile) => {
    const roleName = roles.find((role) => role.id === profile.role_id)?.name ?? "Chưa có vai trò";
    const granted = grants[profile.id] ?? [];
    const primaryCount = accounts.filter((item) => item.primary_profile_id === profile.id).length;
    const reports = reportsOf.get(profile.id) ?? [];
    const managerName = profile.manager_id ? nameOf.get(profile.manager_id) : null;
    const isOpen = open.has(profile.id);
    return <details key={profile.id} open={isOpen} onToggle={(event) => { const now = (event.currentTarget as HTMLDetailsElement).open; setOpen((current) => { if (current.has(profile.id) === now) return current; const next = new Set(current); if (now) next.add(profile.id); else next.delete(profile.id); return next; }); }}
      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 sm:p-5 marker:content-none">
        <div className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">{initials(profile.full_name)}</span><div className="min-w-0"><p className="truncate font-bold text-slate-950">{profile.full_name}</p><p className="truncate text-sm text-slate-500">{profile.email || profile.id}{managerName ? <span className="text-slate-400"> · Quản lý: {managerName}</span> : null}{reports.length ? <span className="text-slate-400"> · Quản lý {reports.length} người</span> : null}</p></div></div>
        <div className="flex shrink-0 items-center gap-2">{profile.department ? <span className="hidden rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 sm:inline">{profile.department}</span> : null}<span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 sm:inline">{roleName}</span><span className="hidden rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 sm:inline">{primaryCount} tài khoản chính</span><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{profile.all_channel_accounts ? "Tất cả kênh" : `${granted.length} kênh`}</span><ChevronDown className="size-5 text-slate-400 transition-transform group-open:rotate-180"/></div>
      </summary>
      {isOpen ? <MemberForm profile={profile} profiles={profiles} roles={roles} accounts={accounts} granted={granted} blocked={below(profile.id)} nameOf={nameOf} action={action}/> : null}
    </details>;
  })}</div>;
}

function MemberForm({ profile, profiles, roles, accounts, granted, blocked, nameOf, action }: {
  profile: Profile; profiles: Profile[]; roles: Array<{ id: string; name: string }>; accounts: Account[]; granted: string[]; blocked: Set<string>; nameOf: Map<string, string>; action: (data: FormData) => void | Promise<void>;
}) {
  const pickerAccounts: PickerAccount[] = accounts.map((item) => ({ id: item.id, channel: item.channel_type, name: item.display_name || item.external_account_id, owner: item.primary_profile_id && item.primary_profile_id !== profile.id ? nameOf.get(item.primary_profile_id) ?? null : null, free: !item.primary_profile_id }));
  const primaryIds = accounts.filter((item) => item.primary_profile_id === profile.id).map((item) => item.id);
  const select = "mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  return <form action={action} className="border-t border-slate-200 bg-slate-50/50 p-5"><input type="hidden" name="profileId" value={profile.id}/><div className="grid gap-5 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,2fr)]">
    <div className="space-y-4">
      <label className="block text-sm font-semibold text-slate-700">Vai trò<select name="roleId" defaultValue={profile.role_id} className={select}>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
      <label className="block text-sm font-semibold text-slate-700">Bộ phận<input name="department" defaultValue={profile.department ?? ""} list="member-departments" maxLength={60} placeholder="Ví dụ: Sale, Rec" className={select}/><datalist id="member-departments">{[...new Set(["Sale", "Rec", ...profiles.map((other) => other.department ?? "").filter(Boolean)])].map((value) => <option key={value} value={value}/>)}</datalist><span className="mt-1.5 block text-xs font-normal text-slate-500">Soda dùng để đếm theo bộ phận (“bộ phận Sale có bao nhiêu người chưa trả lời”).</span></label>
      <label className="block text-sm font-semibold text-slate-700">Ảnh đại diện<span className="mt-2 flex items-center gap-2">{profile.avatar_url ? <img src={profile.avatar_url} alt="" className="size-11 shrink-0 rounded-full border border-slate-200 object-cover"/> : <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">{profile.full_name.split(/\s+/u).filter(Boolean).slice(-2).map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "?"}</span>}<input name="avatarUrl" type="url" defaultValue={profile.avatar_url ?? ""} maxLength={1000} placeholder="https://… (link ảnh, để trống = chữ cái tên)" className={select.replace("mt-2 ", "")}/></span><span className="mt-1.5 block text-xs font-normal text-slate-500">Hiện trên bản đồ văn phòng ở Tổng quan. Chưa có ảnh thì hiện chữ cái đầu của tên.</span></label>
      <label className="block text-sm font-semibold text-slate-700">Quản lý trực tiếp<select name="managerId" defaultValue={profile.manager_id ?? ""} className={select}><option value="">— Không có —</option>{profiles.filter((other) => other.id !== profile.id && !blocked.has(other.id)).map((other) => <option key={other.id} value={other.id}>{other.full_name}</option>)}</select><span className="mt-1.5 block text-xs font-normal text-slate-500">Người quản lý thấy tài khoản chính của thành viên này ở mục “Team” trong Suối Nguồn.</span></label>
    </div>
    <div><label className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 font-semibold text-blue-900"><input type="checkbox" name="allAccounts" defaultChecked={profile.all_channel_accounts} className="size-4 accent-blue-600"/> Cho phép truy cập tất cả tài khoản kết nối</label><p className="mt-2 text-xs text-slate-500">Nếu bỏ chọn, thành viên chỉ được sử dụng những tài khoản đánh dấu bên dưới.</p><AccountPicker name="channelAccountId" accounts={pickerAccounts} selected={granted}/></div>
  </div><div className="mt-5 border-t border-slate-200 pt-5"><p className="text-sm font-bold text-slate-800">Tài khoản chính</p><p className="mt-1 text-xs text-slate-500">Những tài khoản người này trực tiếp dùng để nhắn tin — hiện ở mục “Cá nhân” trong Suối Nguồn. Mỗi tài khoản chỉ có một người dùng chính; chọn ở đây sẽ chuyển từ người cũ sang. Tài khoản chính luôn được cấp quyền truy cập.</p><AccountPicker name="primaryAccountId" accounts={pickerAccounts} selected={primaryIds} ownerNote/></div><div className="mt-5 flex justify-end"><button className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700">Lưu phân quyền</button></div></form>;
}
