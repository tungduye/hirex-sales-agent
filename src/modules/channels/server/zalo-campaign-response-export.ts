import "server-only";

import ExcelJS from "exceljs";
import { requirePermission } from "@/modules/access/server/access-control";
import { sanitizeSpreadsheetCell } from "@/modules/campaigns/domain/sequence-rules";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

const CHAT_STATS_HEADERS = [
  "Tên ứng viên", "Social link", "Link Facebook", "link linkedin", "Ngôn ngữ chính",
  "Vị trí", "SkillTech", "Xếp hạng Zalo", "Xếp hạng Email", "Xếp hạng SDT",
  "Xếp hạng Linkedin", "Xếp hạng FaceBook", "Xếp hạng Combo UV", "Xếp hạng Am",
  "Xếp hạng Am 2", "Address", "Uuid FaceBook", "Owner Id", "SDT", "Email", "Website",
] as const;

const INTERACTED_ZALO_RANK = "200416 - Tương tác";
const DATA_SAMPLE_HEADERS = [
  "Ngôn ngữ chính - Mã", "Ngôn ngữ chính - Tên", "Ngôn ngữ chính - Hiển thị",
  "Vị trí - Mã", "Vị trí - Tên", "Vị trí - Hiển thị",
  "SkillTech - Mã", "SkillTech - Tên", "SkillTech - Hiển thị",
  "Xếp hạng Zalo - Mã", "Xếp hạng Zalo - Tên", "Xếp hạng Zalo - Hiển thị",
  "Xếp hạng Email - Mã", "Xếp hạng Email - Tên", "Xếp hạng Email - Hiển thị",
  "Xếp hạng SDT - Mã", "Xếp hạng SDT - Tên", "Xếp hạng SDT - Hiển thị",
  "Xếp hạng Linkedin - Mã", "Xếp hạng Linkedin - Tên", "Xếp hạng Linkedin - Hiển thị",
  "Xếp hạng FaceBook - Mã", "Xếp hạng FaceBook - Tên", "Xếp hạng FaceBook - Hiển thị",
  "Xếp hạng Combo UV - Mã", "Xếp hạng Combo UV - Tên", "Xếp hạng Combo UV - Hiển thị",
  "Xếp hạng Am - Mã", "Xếp hạng Am - Tên", "Xếp hạng Am - Hiển thị",
  "Xếp hạng Am 2 - Mã", "Xếp hạng Am 2 - Tên", "Xếp hạng Am 2 - Hiển thị",
  "Address - Mã", "Address - Tên", "Address - Hiển thị",
] as const;

type ContactChannel = {
  contact_id: string;
  channel_type: string;
  channel_value: string;
  is_primary: boolean;
  metadata?: unknown;
};

type ExportContact = {
  id: string;
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  language: string | null;
  companies: { website: string | null } | Array<{ website: string | null }> | null;
};

type ExportCampaign = {
  id: string;
  name: string;
  combo_uv: string | null;
  placement: string | null;
  channel_rank: string | null;
  owner_name: string | null;
  am_rank: string | null;
};

type ExportConversation = {
  contact_id: string | null;
  metadata: unknown;
};

function firstChannel(channels: ContactChannel[], type: string) {
  return channels
    .filter((channel) => channel.channel_type === type)
    .sort((left, right) => Number(right.is_primary) - Number(left.is_primary))[0]?.channel_value ?? "";
}

function firstChannelRow(channels: ContactChannel[], type: string) {
  return channels
    .filter((channel) => channel.channel_type === type)
    .sort((left, right) => Number(right.is_primary) - Number(left.is_primary))[0] ?? null;
}

function safeFilePart(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "chien_dich";
}

function formatTimestampForFile(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}_${value.hour}${value.minute}`;
}

function styleChatStatsSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "U1" };
  sheet.getRow(1).height = 24;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  const widths = [28, 24, 24, 24, 20, 24, 24, 22, 20, 20, 22, 22, 24, 22, 22, 24, 22, 18, 18, 28, 26];
  sheet.columns.forEach((column, index) => { column.width = widths[index] ?? 20; });
  sheet.getColumn(19).numFmt = "@";
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
  });
}

async function buildCampaignResponseExportForScope(channelType: "ZALO" | "FACEBOOK_PROFILE", campaignId?: string, selectedCampaignIds?: string[]) {
  const account = await requirePermission("campaigns.export");
  const db = createPrivilegedSupabaseClient();
  let stepQuery = db.from("channel_campaign_steps").select("campaign_id")
    .eq("workspace_id", account.workspaceId).contains("allowed_channels", [channelType]);
  if (campaignId) stepQuery = stepQuery.eq("campaign_id", campaignId);
  else if (selectedCampaignIds?.length) stepQuery = stepQuery.in("campaign_id", selectedCampaignIds);
  const { data: zaloSteps, error: stepError } = await stepQuery;
  if (stepError) throw stepError;
  const campaignIds = [...new Set((zaloSteps ?? []).map((step) => step.campaign_id))];
  if (campaignIds.length === 0) return campaignId ? null : { body: null, filename: null, count: 0, campaignName: channelType === "ZALO" ? "Tất cả chiến dịch Zalo" : "Tất cả chiến dịch Facebook cá nhân" };

  const { data: campaigns, error: campaignError } = await db.from("channel_campaigns")
    .select("id,name,combo_uv,placement,channel_rank,owner_name,am_rank")
    .eq("workspace_id", account.workspaceId).in("id", campaignIds).order("created_at", { ascending: false });
  if (campaignError) throw campaignError;
  if (campaignId && !(campaigns ?? []).some((campaign) => campaign.id === campaignId)) return null;
  const campaignById = new Map(((campaigns ?? []) as ExportCampaign[]).map((campaign) => [campaign.id, campaign]));

  const { data: recipients, error: recipientError } = await db.from("channel_campaign_recipients")
    .select("campaign_id,contact_id,source_message_id,replied_at")
    .eq("workspace_id", account.workspaceId).in("campaign_id", [...campaignById.keys()])
    .eq("status", "REPLIED").not("source_message_id", "is", null).not("replied_at", "is", null)
    .order("replied_at", { ascending: true });
  if (recipientError) throw recipientError;
  const sourceMessageIds = (recipients ?? []).flatMap((row) => row.source_message_id ? [row.source_message_id] : []);
  const channelLabel = channelType === "ZALO" ? "Zalo" : "Facebook cá nhân";
  const scopeName = campaignId ? campaignById.get(campaignId)?.name ?? `Chiến dịch ${channelLabel}` : selectedCampaignIds?.length ? `${campaignById.size} chiến dịch ${channelLabel} đã chọn` : `Tất cả chiến dịch ${channelLabel}`;
  if (sourceMessageIds.length === 0) return { body: null, filename: null, count: 0, campaignName: scopeName };

  const { data: messages, error: messageError } = await db.from("omnichannel_messages")
    .select("id").eq("workspace_id", account.workspaceId).eq("channel_type", channelType)
    .eq("direction", "INBOUND").in("id", sourceMessageIds);
  if (messageError) throw messageError;
  const validMessageIds = new Set((messages ?? []).map((message) => message.id));
  const validRecipients = (recipients ?? []).filter((recipient) => recipient.source_message_id && validMessageIds.has(recipient.source_message_id));
  const contactIds = [...new Set(validRecipients.map((recipient) => recipient.contact_id))];
  if (contactIds.length === 0) return { body: null, filename: null, count: 0, campaignName: scopeName };

  const [{ data: contacts, error: contactError }, { data: channels, error: channelError }, { data: conversations, error: conversationError }] = await Promise.all([
    db.from("contacts").select("id,full_name,job_title,email,phone,country,language,companies(website)")
      .eq("workspace_id", account.workspaceId).in("id", contactIds),
    db.from("contact_channels").select("contact_id,channel_type,channel_value,is_primary,metadata")
      .eq("workspace_id", account.workspaceId).in("contact_id", contactIds)
      .in("channel_type", ["FACEBOOK", "FACEBOOK_PROFILE", "LINKEDIN", "PHONE", "EMAIL"]),
    db.from("omnichannel_conversations").select("contact_id,metadata,last_message_at")
      .eq("workspace_id", account.workspaceId).eq("channel_type", channelType)
      .in("contact_id", contactIds).order("last_message_at", { ascending: false }),
  ]);
  if (contactError) throw contactError;
  if (channelError) throw channelError;
  if (conversationError) throw conversationError;
  const channelsByContact = new Map<string, ContactChannel[]>();
  for (const channel of (channels ?? []) as ContactChannel[]) {
    channelsByContact.set(channel.contact_id, [...(channelsByContact.get(channel.contact_id) ?? []), channel]);
  }
  const displayNameByContact = new Map<string, string>();
  for (const conversation of (conversations ?? []) as ExportConversation[]) {
    if (!conversation.contact_id || displayNameByContact.has(conversation.contact_id) || !conversation.metadata || typeof conversation.metadata !== "object" || Array.isArray(conversation.metadata)) continue;
    const displayName = (conversation.metadata as Record<string, unknown>).participantDisplayName;
    if (typeof displayName === "string" && displayName.trim() && !/^(?:đang hoạt động|active now)$/iu.test(displayName.trim())) displayNameByContact.set(conversation.contact_id, displayName.trim());
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HireX Sales Agent";
  workbook.created = new Date();
  const chatStats = workbook.addWorksheet("chat_stats");
  chatStats.addRow([...CHAT_STATS_HEADERS]);
  const contactById = new Map(((contacts ?? []) as unknown as ExportContact[]).map((contact) => [contact.id, contact]));
  for (const recipient of validRecipients) {
    const contact = contactById.get(recipient.contact_id);
    const campaign = campaignById.get(recipient.campaign_id);
    if (!contact || !campaign) continue;
    const contactChannels = channelsByContact.get(contact.id) ?? [];
    const facebookProfile = firstChannelRow(contactChannels, "FACEBOOK_PROFILE");
    const facebookUid = facebookProfile?.channel_value ?? "";
    const facebook = facebookUid ? `https://www.facebook.com/${facebookUid}` : firstChannel(contactChannels, "FACEBOOK");
    const linkedin = firstChannel(contactChannels, "LINKEDIN");
    const phone = contact.phone || firstChannel(contactChannels, "PHONE");
    const email = contact.email || firstChannel(contactChannels, "EMAIL");
    const company = Array.isArray(contact.companies) ? contact.companies[0] : contact.companies;
    const website = company?.website ?? "";
    const channelRank = campaign.channel_rank || INTERACTED_ZALO_RANK;
    const values = [
      displayNameByContact.get(contact.id) || contact.full_name, "", facebook, linkedin, contact.language ?? "", campaign.placement || contact.job_title || "", "",
      channelType === "ZALO" ? channelRank : "", "", "", "", channelType === "FACEBOOK_PROFILE" ? channelRank : "", campaign.combo_uv ?? "", campaign.am_rank ?? "", "", contact.country ?? "", facebookUid, campaign.owner_name ?? "",
      phone, email, website,
    ].map(sanitizeSpreadsheetCell);
    const row = chatStats.addRow(values);
    row.getCell(19).value = phone ? String(sanitizeSpreadsheetCell(phone)) : "";
    row.getCell(19).numFmt = "@";
  }
  styleChatStatsSheet(chatStats);
  const validationColumn = channelType === "ZALO" ? "H" : "L";

  const dataSample = workbook.addWorksheet("data_sample");
  dataSample.addRow([...DATA_SAMPLE_HEADERS]);
  const interactedRow = Array.from({ length: DATA_SAMPLE_HEADERS.length }, () => "");
  const sampleOffset = channelType === "ZALO" ? 9 : 21;
  interactedRow[sampleOffset] = "200416";
  interactedRow[sampleOffset + 1] = "Tương tác";
  interactedRow[sampleOffset + 2] = INTERACTED_ZALO_RANK;
  dataSample.addRow(interactedRow);
  dataSample.getRow(1).font = { bold: true };
  dataSample.views = [{ state: "frozen", ySplit: 1 }];
  dataSample.autoFilter = { from: "A1", to: "AJ1" };
  dataSample.columns.forEach((column, index) => { column.width = index % 3 === 2 ? 32 : 24; });
  const validationDisplayColumn = channelType === "ZALO" ? "L" : "X";
  for (let row = 2; row <= Math.max(1000, chatStats.rowCount); row += 1) {
    chatStats.getCell(`${validationColumn}${row}`).dataValidation = {
      type: "list", allowBlank: true, formulae: [`'data_sample'!$${validationDisplayColumn}$2:$${validationDisplayColumn}$2`],
    };
  }

  const body = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    body,
    filename: campaignId
      ? `TT_${channelType === "ZALO" ? "ZALO" : "FACEBOOK"}_${safeFilePart(scopeName)}_${formatTimestampForFile()}.xlsx`
      : `TT_${channelType === "ZALO" ? "ZALO" : "FACEBOOK"}_${selectedCampaignIds?.length ? "CAC_CHIEN_DICH_DA_CHON" : "TAT_CA_CHIEN_DICH"}_${formatTimestampForFile()}.xlsx`,
    count: chatStats.rowCount - 1,
    campaignName: scopeName,
  };
}

export async function buildZaloCampaignResponseExport(campaignId: string) {
  return buildCampaignResponseExportForScope("ZALO", campaignId);
}

export async function buildAllZaloCampaignResponsesExport() {
  return buildCampaignResponseExportForScope("ZALO");
}

export async function buildSelectedZaloCampaignResponsesExport(campaignIds:string[]) {
  return buildCampaignResponseExportForScope("ZALO",undefined,[...new Set(campaignIds)].slice(0,100));
}

export async function buildAllFacebookProfileCampaignResponsesExport() {
  return buildCampaignResponseExportForScope("FACEBOOK_PROFILE");
}

export async function buildSelectedFacebookProfileCampaignResponsesExport(campaignIds:string[]) {
  return buildCampaignResponseExportForScope("FACEBOOK_PROFILE",undefined,[...new Set(campaignIds)].slice(0,100));
}
