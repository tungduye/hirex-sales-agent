import Link from "next/link";
import { Download, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/modules/access/server/access-control";
import { CampaignEmptyState, CampaignListHeader, CampaignMetricGrid, CampaignSelectionHint } from "@/modules/campaigns/components/campaign-list-shell";
import { DeleteSelectedCampaignsButton } from "@/modules/campaigns/components/delete-selected-campaigns-button";
import { deleteSelectedEmailCampaigns } from "@/modules/campaigns/server/campaign-actions";
import { listCampaigns } from "@/modules/campaigns/server/campaign-data";
import { SelectAllCampaignCheckbox } from "@/modules/channels/components/select-all-campaign-checkbox";

const statuses = ["DRAFT", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED", "ARCHIVED"];
const badge: Record<string, string> = { DRAFT:"bg-slate-100 text-slate-700", SCHEDULED:"bg-violet-100 text-violet-700", RUNNING:"bg-emerald-100 text-emerald-700", PAUSED:"bg-amber-100 text-amber-700", COMPLETED:"bg-blue-100 text-blue-700", CANCELLED:"bg-rose-100 text-rose-700" };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; archived?:string; skipped?:string; deleteResult?:string }> }) {
  const { q = "", status = "", archived, skipped, deleteResult } = await searchParams;
  const [{ campaigns, error }, canExport, canDelete] = await Promise.all([listCampaigns(), hasPermission("campaigns.export"), hasPermission("campaigns.delete")]);
  const normalized = q.trim().toLowerCase();
  const visible = campaigns.filter((campaign) => (!normalized || campaign.name.toLowerCase().includes(normalized)) && (status === "ARCHIVED" ? Boolean(campaign.archivedAt) : (!statuses.includes(status) || campaign.status === status) && !campaign.archivedAt));
  const active = campaigns.filter((campaign) => !campaign.archivedAt);
  const running = active.filter((campaign) => campaign.status === "RUNNING").length;
  const sent = active.reduce((sum, campaign) => sum + campaign.sent, 0);
  const replies = active.reduce((sum, campaign) => sum + campaign.replies, 0);

  return <div className="space-y-6">
    <CampaignListHeader title="Email Marketing" description="Tạo, gửi và tổng hợp hiệu quả toàn bộ chiến dịch Email." actions={<>
      {canDelete && visible.length ? <DeleteSelectedCampaignsButton formId="email-campaign-list" action={deleteSelectedEmailCampaigns} /> : null}
      {canExport && visible.length ? <Button form="email-campaign-list" type="submit" variant="outline"><Download className="size-4" />Xuất chiến dịch đã chọn</Button> : null}
      <Button asChild><Link href="/campaigns/new"><Plus className="size-4" />Tạo chiến dịch</Link></Button>
    </>} />
    {deleteResult==="error"?<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Không thể xử lý các chiến dịch đã chọn. Vui lòng thử lại.</div>:deleteResult==="none"?<div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Chưa có chiến dịch nào được chọn.</div>:archived!==undefined?<div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Đã đưa {Number(archived)||0} chiến dịch vào Lưu trữ{Number(skipped)?`; giữ lại ${Number(skipped)} chiến dịch đang chạy, lên lịch hoặc tạm dừng`:""}.</div>:null}
    <CampaignMetricGrid items={[{ label:"Chiến dịch", value:active.length }, { label:"Đang chạy", value:running }, { label:"Đã gửi", value:sent }, { label:"Phản hồi", value:replies }]} />
    <form className="flex flex-col gap-2 rounded-xl border bg-white p-3 sm:flex-row">
      <label className="flex h-10 flex-1 items-center gap-2 rounded-lg border px-3"><Search className="size-4 text-slate-400" /><input name="q" defaultValue={q} placeholder="Tìm chiến dịch" className="w-full outline-none" /></label>
      <select name="status" defaultValue={status} className="h-10 rounded-lg border px-3"><option value="">Tất cả trạng thái</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select>
      <button className="rounded-lg border px-5 text-sm font-medium">Áp dụng</button>
    </form>
    {error ? <div className="rounded-xl border bg-white p-8 text-sm text-rose-600">{error}</div> : visible.length === 0 ? <CampaignEmptyState title={campaigns.length ? "Không có chiến dịch phù hợp" : "Chưa có chiến dịch Email"} description={campaigns.length ? "Thử thay đổi từ khóa hoặc trạng thái lọc." : "Tạo bản nháp đầu tiên để bắt đầu."} /> :
      <form id="email-campaign-list" action="/api/campaigns/export" method="get" className="space-y-3">
        <input type="hidden" name="format" value="xlsx" />{q ? <input type="hidden" name="q" value={q} /> : null}{status ? <input type="hidden" name="status" value={status} /> : null}<CampaignSelectionHint />
        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm"><table className="w-full min-w-[1730px] text-sm"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-4 py-3"><SelectAllCampaignCheckbox /></th>{["Tên chiến dịch","Loại chiến dịch","Ngày bắt đầu","Số lượng","Combo UV","Vị trí","Xếp hạng kênh","Owner","Email gửi đi","Trạng thái","Phản hồi","Cập nhật"].map((item) => <th className="whitespace-nowrap px-4 py-3" key={item}>{item}</th>)}</tr></thead><tbody className="divide-y">{visible.map((campaign) => <tr className="hover:bg-slate-50" key={campaign.id}><td className="px-4 py-4"><input type="checkbox" name="campaignId" value={campaign.id} aria-label={`Chọn chiến dịch ${campaign.name}`} className="size-4 accent-blue-600" /></td><td className="px-4 py-4 font-semibold"><Link className="text-blue-700 hover:underline" href={`/campaigns/${campaign.id}`}>{campaign.name}</Link></td><td><span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ backgroundColor:`${campaign.campaignTypeColor}18`, color:campaign.campaignTypeColor }}>{campaign.campaignType}</span></td><td className="whitespace-nowrap">{campaign.startedAt ? new Date(campaign.startedAt).toLocaleString("vi-VN") : "—"}</td><td>{campaign.sent}</td><td>{campaign.comboUv || "—"}</td><td>{campaign.placement || "—"}</td><td>{campaign.channelRank || "—"}</td><td>{campaign.ownerName || "—"}</td><td className="max-w-72"><span className="block truncate" title={campaign.senderEmails.join(", ")}>{campaign.senderEmails.join(", ") || "—"}</span></td><td><span className={`rounded-full px-2 py-1 text-xs font-semibold ${campaign.archivedAt ? "bg-slate-200 text-slate-700" : badge[campaign.status] ?? badge.DRAFT}`}>{campaign.archivedAt ? "ARCHIVED" : campaign.status}</span></td><td>{campaign.replies}</td><td className="whitespace-nowrap">{new Date(campaign.updatedAt).toLocaleDateString("vi-VN")}</td></tr>)}</tbody></table></div>
      </form>}
  </div>;
}
