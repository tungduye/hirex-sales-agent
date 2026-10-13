"use client";

import { useActionState, type ComponentType } from "react";
import { ChevronDown, Mail, MessageCircle, MessageSquareMore, PanelsTopLeft, ShieldCheck } from "lucide-react";
import { checkFacebookProfileBridgeHealth, checkZaloBridgeHealth, deleteChannelAccount, disconnectChannelAccount, setChannelAccountOperatorEnabled } from "../server/connect-channel-actions";
import type { ChannelAccountsResult, ChannelAccountSummary } from "../types/channel-account";
import type { ChannelActionState } from "../types/channel-action-state";

const initial: ChannelActionState = { status: "idle", message: null };
const channelGroups: Array<{ key: ChannelAccountSummary["channelType"]; label: string; description: string; icon: ComponentType<{ className?: string }> }> = [
  { key: "EMAIL", label: "Email", description: "Các hộp thư Gmail và email đã kết nối", icon: Mail },
  { key: "FACEBOOK", label: "Facebook Page", description: "Các Trang Facebook được quản lý qua Meta", icon: PanelsTopLeft },
  { key: "FACEBOOK_PROFILE", label: "Facebook cá nhân", description: "Các tài khoản Messenger cá nhân", icon: MessageCircle },
  { key: "ZALO", label: "Zalo", description: "Các tài khoản Zalo được kết nối qua bridge", icon: MessageSquareMore },
];

export function ChannelAccountsView({ result }: { result: ChannelAccountsResult }) {
  const knownTypes = new Set(channelGroups.map((group) => group.key));
  const groups = channelGroups.map((group) => ({ ...group, accounts: result.accounts.filter((account) => account.channelType === group.key) })).filter((group) => group.accounts.length > 0);
  const otherAccounts = result.accounts.filter((account) => !knownTypes.has(account.channelType));
  return <div className="space-y-6">
    <div><p className="text-sm font-semibold text-blue-600">OMNICHANNEL</p><h1 className="text-2xl font-semibold text-slate-950">Tài khoản kênh</h1><p className="mt-1 text-sm text-slate-500">Quản lý tài khoản theo từng kênh kết nối.</p></div>
    {result.error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">{result.error} Hãy áp dụng và kiểm tra các migration kênh cần thiết trước khi kết nối.</div> : null}
    {!result.error && result.accounts.length === 0 ? <div className="rounded-xl border border-dashed bg-white p-10 text-center"><MessageSquareMore className="mx-auto text-slate-400"/><h2 className="mt-3 font-semibold">Chưa có tài khoản kênh</h2></div> : null}
    <div className="space-y-4">{groups.map((group) => <ChannelGroup key={group.key} label={group.label} description={group.description} icon={group.icon} accounts={group.accounts}/>)}{otherAccounts.length > 0 ? <ChannelGroup label="Kênh khác" description="Các tài khoản thuộc những kênh mở rộng" icon={MessageSquareMore} accounts={otherAccounts}/> : null}</div>
  </div>;
}

function ChannelGroup({ label, description, icon: Icon, accounts }: { label: string; description: string; icon: ComponentType<{ className?: string }>; accounts: ChannelAccountSummary[] }) {
  return <details open className="group overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 shadow-sm">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 bg-white px-5 py-4 marker:content-none">
      <div className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Icon className="size-5"/></span><div className="min-w-0"><h2 className="font-bold text-slate-950">{label}</h2><p className="truncate text-sm text-slate-500">{description}</p></div></div>
      <div className="flex shrink-0 items-center gap-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{accounts.length} tài khoản</span><ChevronDown className="size-5 text-slate-400 transition-transform group-open:rotate-180"/></div>
    </summary>
    <div className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-3">{accounts.map((account) => <AccountCard key={account.id} account={account}/>)}</div>
  </details>;
}

function AccountCard({ account }: { account: ChannelAccountSummary }) {
  return <article className="flex min-h-44 flex-col rounded-xl border border-slate-200 bg-white p-5">
    <div className="flex items-center justify-between gap-3"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold">{channelLabel(account.channelType)}</span><span className="text-xs text-slate-500">{statusLabel(account.status)}</span></div>
    <h3 className="mt-4 truncate font-semibold" title={account.displayName ?? undefined}>{account.displayName ?? `${channelLabel(account.channelType)} account`}</h3><p className="text-sm text-slate-500">{account.provider}</p>
    {account.channelType === "FACEBOOK_PROFILE" ? <div className="mt-3 space-y-1 text-xs text-slate-600"><p>Trạng thái vận hành: {account.operatorEnabled ? "Đang bật" : "Đang tắt"}</p><p>Sức khỏe kết nối: {account.providerHealthStatus.replaceAll("_", " ")}</p><p>Kiểm tra gần nhất: {account.providerHealthCheckedAt ? new Date(account.providerHealthCheckedAt).toLocaleString("vi-VN") : "Chưa kiểm tra"}</p><div className="flex gap-4"><OperatorToggle id={account.id} enabled={account.operatorEnabled}/><FacebookProfileHealthCheck id={account.id}/></div></div> : null}
    {account.channelType === "ZALO" ? <div className="mt-3 space-y-1 text-xs text-slate-600"><p>Trạng thái vận hành: {account.operatorEnabled ? "Đang bật" : "Đang tắt"}</p><p>Sức khỏe kết nối: {account.providerHealthStatus.replaceAll("_", " ")}</p><p>Kiểm tra gần nhất: {account.providerHealthCheckedAt ? new Date(account.providerHealthCheckedAt).toLocaleString("vi-VN") : "Chưa kiểm tra"}</p><div className="flex gap-4"><OperatorToggle id={account.id} enabled={account.operatorEnabled}/><ZaloHealthCheck id={account.id}/></div></div> : null}
    <div className="mt-auto flex items-end justify-between gap-2 pt-4 text-xs text-slate-500"><span className="inline-flex items-center gap-2"><ShieldCheck size={14}/>Thông tin xác thực được bảo mật</span>{account.channelType !== "EMAIL" ? <AccountActions id={account.id} canDisconnect={account.status !== "DISCONNECTED"}/> : null}</div>
  </article>;
}

function channelLabel(value: string) { return value === "FACEBOOK" ? "Facebook Page" : value === "FACEBOOK_PROFILE" ? "Facebook cá nhân" : value === "ZALO" ? "Zalo" : value === "EMAIL" ? "Email" : value; }
function statusLabel(value: string) { return value === "CONNECTED" ? "Đã kết nối" : value === "DISCONNECTED" ? "Mất kết nối" : value === "REAUTH_REQUIRED" ? "Cần kết nối lại" : value; }
function ZaloHealthCheck({ id }: { id: string }) { const [state, action, pending] = useActionState(checkZaloBridgeHealth, initial); return <form action={action}><input type="hidden" name="id" value={id}/><button disabled={pending} className="font-semibold text-blue-700">Kiểm tra kết nối</button>{state.message ? <span role="status" className="sr-only">{state.message}</span> : null}</form>; }
function FacebookProfileHealthCheck({ id }: { id: string }) { const [state, action, pending] = useActionState(checkFacebookProfileBridgeHealth, initial); return <form action={action}><input type="hidden" name="id" value={id}/><button disabled={pending} className="font-semibold text-blue-700">{pending?"Đang kiểm tra…":"Kiểm tra kết nối"}</button>{state.message ? <span role="status" className="sr-only">{state.message}</span> : null}</form>; }
function AccountActions({ id, canDisconnect }: { id: string; canDisconnect: boolean }) { return <div className="flex shrink-0 items-center gap-3">{canDisconnect ? <Disconnect id={id}/> : null}<DeleteAccount id={id}/></div>; }
function Disconnect({ id }: { id: string }) { const [state, action, pending] = useActionState(disconnectChannelAccount, initial); return <form action={action}><input type="hidden" name="id" value={id}/><button disabled={pending} className="font-semibold text-amber-700">Ngắt kết nối</button>{state.message ? <span className="sr-only">{state.message}</span> : null}</form>; }
function DeleteAccount({ id }: { id: string }) { const [state, action, pending] = useActionState(deleteChannelAccount, initial); return <form action={action} onSubmit={(event) => { if (!window.confirm("Xóa tài khoản kênh này? Credential sẽ bị xóa và tài khoản sẽ biến mất khỏi danh sách. Lịch sử hội thoại, chiến dịch và báo cáo vẫn được giữ.")) event.preventDefault(); }}><input type="hidden" name="id" value={id}/><button disabled={pending} className="font-semibold text-rose-600">{pending ? "Đang xóa…" : "Xóa tài khoản"}</button>{state.message ? <span role="status" className="sr-only">{state.message}</span> : null}</form>; }
function OperatorToggle({ id, enabled }: { id: string; enabled: boolean }) { const [state, action, pending] = useActionState(setChannelAccountOperatorEnabled, initial); return <form action={action}><input type="hidden" name="id" value={id}/><input type="hidden" name="enabled" value={enabled ? "false" : "true"}/><button disabled={pending} className="font-semibold text-blue-700">{enabled ? "Tắt vận hành" : "Bật vận hành"}</button>{state.message ? <span className="sr-only">{state.message}</span> : null}</form>; }
