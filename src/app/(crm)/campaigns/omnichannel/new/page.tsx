import { NewChannelCampaignForm } from "@/modules/channels/components/new-channel-campaign-form";
import { getChannelCampaignOptions } from "@/modules/channels/server/get-channel-campaign-data";

export default async function NewOmnichannelCampaignPage() {
  const options = await getChannelCampaignOptions();
  return <div className="mx-auto max-w-6xl space-y-5"><header><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Zalo Marketing</p><h1 className="mt-1 text-3xl font-bold">Tạo chiến dịch Zalo</h1><p className="mt-1 text-sm text-slate-500">Soạn nội dung, chọn người nhận và tài khoản gửi. Chiến dịch luôn được lưu nháp để anh kiểm tra trước khi chạy.</p></header><NewChannelCampaignForm contacts={options.contacts} senders={options.senders} /></div>;
}
