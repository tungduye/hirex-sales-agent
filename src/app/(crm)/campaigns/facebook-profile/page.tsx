import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/modules/access/server/access-control";
import { CampaignEmptyState, CampaignListHeader, CampaignMetricGrid, CampaignSelectionHint } from "@/modules/campaigns/components/campaign-list-shell";
import { DeleteSelectedCampaignsButton } from "@/modules/campaigns/components/delete-selected-campaigns-button";
import { CampaignAutoRefresh } from "@/modules/channels/components/campaign-auto-refresh";
import { SelectAllCampaignCheckbox } from "@/modules/channels/components/select-all-campaign-checkbox";
import { deleteSelectedChannelCampaigns } from "@/modules/channels/server/channel-campaign-actions";
import { listFacebookProfileCampaigns } from "@/modules/channels/server/get-channel-campaign-data";

const badge: Record<string,string> = { DRAFT:"bg-slate-100 text-slate-700", RUNNING:"bg-blue-100 text-blue-700", COMPLETED:"bg-emerald-100 text-emerald-700", PAUSED:"bg-amber-100 text-amber-700", CANCELLED:"bg-red-100 text-red-700" };

export default async function FacebookProfileCampaignsPage({searchParams}:{searchParams:Promise<{archived?:string;skipped?:string;archiveResult?:string}>}) {
  const {archived,skipped,archiveResult}=await searchParams;
  const [campaigns, canExport, canDelete] = await Promise.all([listFacebookProfileCampaigns(), hasPermission("campaigns.export"), hasPermission("campaigns.delete")]);
  const replyCount = campaigns.reduce((sum,item) => sum + item.replies, 0);
  return <form id="facebook-campaign-list" action="/api/campaigns/facebook-profile/export" method="get" className="space-y-6">
    <input type="hidden" name="returnTo" value="facebook" />
    <CampaignAutoRefresh />
    <CampaignListHeader title="Facebook cá nhân Marketing" description="Tạo, gửi và tổng hợp hiệu quả toàn bộ chiến dịch Facebook cá nhân." actions={<>
      {canDelete && campaigns.length ? <DeleteSelectedCampaignsButton action={deleteSelectedChannelCampaigns} /> : null}
      {canExport ? <Button type="submit" variant="outline" disabled={replyCount === 0}><Download className="size-4" />{replyCount ? "Xuất chiến dịch đã chọn" : "Chưa có phản hồi để xuất"}</Button> : null}
      <Button asChild><Link href="/campaigns/facebook-profile/new"><Plus className="size-4" />Tạo chiến dịch</Link></Button>
    </>} />
    {archiveResult==="error"?<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Không thể lưu trữ các chiến dịch đã chọn. Vui lòng thử lại.</div>:archiveResult==="none"?<div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Chưa có chiến dịch nào được chọn.</div>:archived!==undefined?<div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Đã đưa {Number(archived)||0} chiến dịch Facebook vào Lưu trữ{Number(skipped)?`; giữ lại ${Number(skipped)} chiến dịch đang chạy, lên lịch hoặc tạm dừng`:""}.</div>:null}
    <CampaignMetricGrid items={[{label:"Chiến dịch",value:campaigns.length},{label:"Đang chạy",value:campaigns.filter(item=>item.status==="RUNNING").length},{label:"Đã gửi",value:campaigns.reduce((sum,item)=>sum+item.sent,0)},{label:"Phản hồi",value:replyCount}]} />
    <CampaignSelectionHint />
    {campaigns.length ? <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm"><table className="w-full min-w-[1020px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3"><SelectAllCampaignCheckbox /></th>{["Tên chiến dịch","Người nhận","Tài khoản gửi","Đã gửi","Phản hồi","Trạng thái","Cập nhật"].map(label=><th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y">{campaigns.map(item=><tr key={item.id} className="hover:bg-slate-50"><td className="px-4 py-4"><input type="checkbox" name="campaignId" value={item.id} aria-label={`Chọn chiến dịch ${item.name}`} className="size-4 accent-blue-600" /></td><td className="px-4 py-4"><Link href={`/campaigns/facebook-profile/${item.id}`} className="font-bold text-blue-700 hover:underline">{item.name}</Link></td><td>{item.quantity}</td><td>{item.senderNames.join(", ")||"—"}</td><td>{item.sent}</td><td>{item.replies}</td><td><span className={`rounded-full px-2 py-1 text-xs font-semibold ${badge[item.status]??badge.DRAFT}`}>{item.status}</span></td><td>{new Date(item.updatedAt).toLocaleString("vi-VN")}</td></tr>)}</tbody></table></div> : <CampaignEmptyState title="Chưa có chiến dịch Facebook cá nhân" description="Tạo bản nháp đầu tiên để bắt đầu." />}
  </form>;
}
