import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/modules/access/server/access-control";
import { CampaignEmptyState, CampaignListHeader, CampaignMetricGrid, CampaignSelectionHint } from "@/modules/campaigns/components/campaign-list-shell";
import { DeleteSelectedCampaignsButton } from "@/modules/campaigns/components/delete-selected-campaigns-button";
import { CampaignAutoRefresh } from "@/modules/channels/components/campaign-auto-refresh";
import { SelectAllCampaignCheckbox } from "@/modules/channels/components/select-all-campaign-checkbox";
import { deleteSelectedChannelCampaigns } from "@/modules/channels/server/channel-campaign-actions";
import { listChannelCampaigns } from "@/modules/channels/server/get-channel-campaign-data";

const labels: Record<string,string> = { DRAFT:"Bản nháp", SCHEDULED:"Đã lên lịch", RUNNING:"Đang chạy", PAUSED:"Tạm dừng", COMPLETED:"Hoàn thành", CANCELLED:"Đã huỷ" };

export default async function OmnichannelCampaignsPage({searchParams}:{searchParams:Promise<{archived?:string;skipped?:string;archiveResult?:string}>}) {
  const {archived,skipped,archiveResult}=await searchParams;
  const [rows, canExport, canDelete] = await Promise.all([listChannelCampaigns(), hasPermission("campaigns.export"), hasPermission("campaigns.delete")]);
  const replyCount = rows.reduce((total,row) => total + row.replies, 0);
  return <form id="zalo-campaign-list" action="/api/campaigns/omnichannel/export" method="get" className="space-y-6">
    <input type="hidden" name="returnTo" value="zalo" />
    <CampaignAutoRefresh />
    <CampaignListHeader title="Zalo Marketing" description="Tạo, gửi và tổng hợp hiệu quả toàn bộ chiến dịch Zalo." actions={<>
      {canDelete && rows.length ? <DeleteSelectedCampaignsButton action={deleteSelectedChannelCampaigns} /> : null}
      {canExport ? <Button type="submit" variant="outline" disabled={replyCount === 0}><Download className="size-4" />{replyCount ? "Xuất chiến dịch đã chọn" : "Chưa có phản hồi để xuất"}</Button> : null}
      <Button asChild><Link href="/campaigns/omnichannel/new"><Plus className="size-4" />Tạo chiến dịch</Link></Button>
    </>} />
    {archiveResult==="error"?<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Không thể lưu trữ các chiến dịch đã chọn. Vui lòng thử lại.</div>:archiveResult==="none"?<div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Chưa có chiến dịch nào được chọn.</div>:archived!==undefined?<div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Đã đưa {Number(archived)||0} chiến dịch Zalo vào Lưu trữ{Number(skipped)?`; giữ lại ${Number(skipped)} chiến dịch đang chạy, lên lịch hoặc tạm dừng`:""}.</div>:null}
    <CampaignMetricGrid items={[{label:"Chiến dịch",value:rows.length},{label:"Đang chạy",value:rows.filter(row=>row.status==="RUNNING").length},{label:"Đã gửi",value:rows.reduce((sum,row)=>sum+row.sent,0)},{label:"Phản hồi",value:replyCount}]} />
    <CampaignSelectionHint />
    {rows.length ? <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm"><table className="w-full min-w-[1640px] text-sm"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-4 py-3"><SelectAllCampaignCheckbox /></th>{["Tên chiến dịch","Loại chiến dịch","Ngày bắt đầu","Số lượng","Combo UV","Vị trí","Xếp hạng kênh","Owner","Zalo gửi đi","Trạng thái","Đã gửi","Phản hồi","Cập nhật"].map(column=><th key={column} className="whitespace-nowrap px-4 py-3">{column}</th>)}</tr></thead><tbody className="divide-y">{rows.map(row=><tr key={row.id} className="hover:bg-slate-50"><td className="px-4 py-4"><input type="checkbox" name="campaignId" value={row.id} aria-label={`Chọn chiến dịch ${row.name}`} className="size-4 accent-blue-600" /></td><td className="px-4 py-4"><Link href={`/campaigns/omnichannel/${row.id}`} className="font-semibold text-blue-700 hover:underline">{row.name}</Link></td><td><span className="rounded-full px-2 py-1 text-xs font-semibold" style={{backgroundColor:`${row.campaignTypeColor}18`,color:row.campaignTypeColor}}>{row.campaignType}</span></td><td className="whitespace-nowrap">{row.startedAt?new Date(row.startedAt).toLocaleString("vi-VN"):"—"}</td><td>{row.quantity}</td><td>{row.comboUv??"—"}</td><td>{row.placement??"—"}</td><td>{row.channelRank??"—"}</td><td>{row.ownerName??"—"}</td><td className="max-w-72"><span className="block truncate" title={row.senderNames.join(", ")}>{row.senderNames.join(", ")||"—"}</span></td><td><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{labels[row.status]??row.status}</span></td><td>{row.sent}</td><td>{row.replies}</td><td className="whitespace-nowrap">{new Date(row.updatedAt).toLocaleDateString("vi-VN")}</td></tr>)}</tbody></table></div> : <CampaignEmptyState title="Chưa có chiến dịch Zalo" description="Tạo bản nháp đầu tiên để bắt đầu." />}
  </form>;
}
