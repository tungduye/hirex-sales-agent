/** Why a running campaign is not sending, for the warning under its status. */
export type CampaignHealth = { tone: "rose" | "amber"; text: string; title: string } | null;

export function campaignHealth(campaign: { status: string; archivedAt: string | null; canSend: boolean; senderIssues: string[]; startedAt: string | null; lastSentAt: string | null; sent: number; recipients: number }, now: number): CampaignHealth {
  if (campaign.archivedAt || campaign.status !== "RUNNING") return null;
  if (!campaign.canSend) return { tone: "rose", text: "Hộp gửi cần kết nối lại", title: `Cần kết nối lại: ${campaign.senderIssues.join(", ") || "hộp gửi"}. Không gửi tiếp và không nhận được phản hồi cho đến khi kết nối lại.` };
  const started = campaign.startedAt ? Date.parse(campaign.startedAt) : now;
  const last = campaign.lastSentAt ? Date.parse(campaign.lastSentAt) : null;
  if (campaign.sent < campaign.recipients && now - started > 3 * 3600_000 && (last === null || now - last > 24 * 3600_000))
    return { tone: "amber", text: last === null ? "Chưa gửi được thư nào" : "24 giờ qua chưa gửi thêm", title: "Chiến dịch đang chạy nhưng không gửi thêm thư. Kiểm tra giới hạn gửi trong ngày hoặc hộp gửi." };
  return null;
}
