import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";
import { kpiRange, type KpiPeriod } from "@/modules/assistant/core/kpi-range";
import {
  answerDelay, daysLeft, hasCv, INTEREST_LABEL, interestOf, keepRow, matchesText, ownerLabel, progressHints, tally,
  type InteractionFilter, type InteractionRow, type NickInfo, type ProgressRow,
} from "@/modules/campaigns/core/interactions";
import { classifyCampaignReplies } from "@/modules/campaigns/server/reply-insights";
import { conversionTable, isGenericCampaignWord, type ConversionBy, type ConversionRow } from "@/modules/campaigns/core/cv-conversions";
import type { ActionContext } from "@/modules/assistant/server/assistant-proposals";

// Tương tác chiến dịch Zalo / Facebook cá nhân for Soda:
//  - tuong_tac_chien_dich: candidates who replied, per owner: did the owner's nick answer, interested or not
//    (Luồng Rec, CV file, else the AI reading), how many became CVs; with a filtered list of candidates.
//  - tien_do_chien_dich: per sending nick, reached / total candidates, pace, and suggestions.
// Totals follow "Chiến dịch · Xem" (like the campaign pages); candidate names, messages and links only for
// nicks the member may use in Suối Nguồn.

type Scope = { workspaceId: string; userId: string; context: ActionContext; channel?: "WEB" | "ZALO" };
type Db = ReturnType<typeof createPrivilegedClient>;
const str = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const vnTime = (iso: string | null) => iso ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso)) : null;
const ACCOUNT_STATUS: Record<string, string> = { CONNECTED: "Đang kết nối", DISCONNECTED: "Mất kết nối", ERROR: "Lỗi", REAUTH_REQUIRED: "Cần đăng nhập lại" };

async function nickMap(db: Db, workspaceId: string) {
  const { data } = await db.from("channel_accounts").select("id,display_name,external_account_id,channel_type,status").eq("workspace_id", workspaceId);
  return new Map((data ?? []).map((row) => [String(row.id), { name: String(row.display_name ?? row.external_account_id ?? "Nick"), status: row.status ? String(row.status) : null, channel: String(row.channel_type) }]));
}

/** Owner code (Human user id) → name: the HireX member linked in Khách hàng, else the name Human gave. */
async function ownerNames(db: Db, workspaceId: string) {
  const [{ data: links }, { data: people }] = await Promise.all([
    db.from("human_user_links").select("human_user_id,human_name,profile_id").eq("workspace_id", workspaceId),
    db.from("profiles").select("id,full_name").eq("workspace_id", workspaceId),
  ]);
  const profileName = new Map((people ?? []).map((row) => [String(row.id), String(row.full_name ?? "")]));
  const names = new Map<string, string>();
  for (const link of links ?? []) {
    const name = (link.profile_id ? profileName.get(String(link.profile_id)) : null) || (link.human_name ? String(link.human_name) : "");
    if (name) names.set(String(link.human_user_id), name);
  }
  return names;
}

async function interactionRows(db: Db, workspaceId: string, from: Date | null, to: Date | null) {
  const { data, error } = await db.rpc("campaign_interaction_rows", { p_workspace_id: workspaceId, p_from: from?.toISOString() ?? null, p_to: to?.toISOString() ?? null });
  if (error) throw new Error("INTERACTIONS_UNAVAILABLE");
  return (data ?? []) as InteractionRow[];
}

const FILTERS = new Set(["TAT_CA", "QUAN_TAM", "KHONG_QUAN_TAM", "CHUA_RO", "CHUA_DOC", "DA_CO_CV", "OWNER_CHUA_TRA_LOI", "OWNER_DA_TRA_LOI"]);

export const campaignTools: Record<string, (args: Record<string, unknown>, scope: Scope) => Promise<unknown>> = {
  async tuong_tac_chien_dich(args, scope) {
    if (!scope.context.isAdmin && !scope.context.permissions.includes("campaigns.view")) return { loi: "Sếp chưa có quyền Chiến dịch · Xem." };
    const period = str(args.ky);
    let from: Date | null = null, to: Date | null = null, label = "toàn bộ chiến dịch";
    if (period && period !== "TAT_CA" || str(args.tu_ngay) || str(args.den_ngay)) {
      const range = kpiRange(period && period !== "TAT_CA" ? period as KpiPeriod : null, str(args.tu_ngay), str(args.den_ngay));
      if ("error" in range) return { loi: range.error };
      ({ from, to, label } = range);
    }
    const db = createPrivilegedClient();
    let rows: InteractionRow[];
    try { rows = await interactionRows(db, scope.workspaceId, from, to); } catch { return { loi: "Chưa tải được dữ liệu tương tác, thử lại sau ít phút." }; }
    const [nicks, names] = await Promise.all([nickMap(db, scope.workspaceId), ownerNames(db, scope.workspaceId)]);
    const owner = str(args.owner), nick = str(args.nick), campaign = isGenericCampaignWord(str(args.chien_dich)) ? null : str(args.chien_dich);
    const all = rows;
    rows = rows.filter((row) => {
      const who = ownerLabel(row.owner_name, row.campaign_name, names);
      return (!owner || matchesText(who.label, owner) || matchesText(row.owner_name, owner) || matchesText(row.campaign_name, owner))
        && matchesText(nicks.get(row.channel_account_id)?.name, nick) && matchesText(row.campaign_name, campaign);
    });
    // A name that matches nothing is said so (not "0 tương tác"), with the names that exist.
    if (!rows.length && all.length && (campaign || owner || nick)) {
      return { loi: `Không có tương tác nào khớp ${[campaign && `chiến dịch "${campaign}"`, owner && `owner "${owner}"`, nick && `nick "${nick}"`].filter(Boolean).join(", ")} trong ${label}.`,
        cac_chien_dich_co_tuong_tac: [...new Set(all.map((row) => row.campaign_name))].slice(0, 20), goi_y: "\"MKT Zalo\" = mọi chiến dịch: hỏi lại không lọc tên chiến dịch." };
    }
    // Replies the AI has not read yet: read a few now (in the background) so the next answer is complete.
    const unread = rows.filter((row) => interestOf(row) === null).length;
    if (unread) void classifyCampaignReplies(48).catch(() => {});

    const groups = new Map<string, { label: string; rows: InteractionRow[] }>();
    for (const row of rows) {
      const who = ownerLabel(row.owner_name, row.campaign_name, names);
      const group = groups.get(who.key) ?? { label: who.label, rows: [] };
      group.rows.push(row);
      groups.set(who.key, group);
    }
    const byOwner = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length).map((group) => ({
      owner: group.label,
      chien_dich: [...new Set(group.rows.map((row) => row.campaign_name))].slice(0, 6),
      nick: [...new Set(group.rows.map((row) => nicks.get(row.channel_account_id)?.name ?? "?"))].slice(0, 6),
      ...tally(group.rows),
    }));

    // The candidate list: only on nicks this member may use, and only with "Suối Nguồn · Xem".
    const filter = (str(args.loc) ?? "TAT_CA") as InteractionFilter;
    const canSeePeople = scope.context.isAdmin || scope.context.permissions.includes("inbox.view");
    const accessible = canSeePeople ? await getAccessibleChannelAccountIds() : [];
    const visible = rows.filter((row) => accessible === null || accessible.includes(row.channel_account_id));
    const picked = visible.filter((row) => keepRow(row, FILTERS.has(filter) ? filter : "TAT_CA")).sort((a, b) => Date.parse(b.replied_at) - Date.parse(a.replied_at));
    const limit = typeof args.so_luong === "number" ? Math.min(Math.max(1, args.so_luong), 50) : 15;
    return {
      khoang_thoi_gian: label,
      ghi_chu: "owner_da_tra_loi = nick đã nhắn lại sau khi UV phản hồi. Quan tâm/Không quan tâm: theo Luồng Rec và file CV trước, còn lại do AI đọc tin UV. co_cv = UV gửi file PDF/Word/tên CV hoặc Luồng Rec \"Đã có CV\".",
      tong: tally(rows),
      ...(unread ? { ai_dang_doc: `${unread} phản hồi AI chưa đọc xong (đang đọc tiếp, hỏi lại sau ít phút sẽ đủ).` } : {}),
      theo_owner: byOwner.slice(0, 30),
      danh_sach: !canSeePeople ? { loi: "Cần quyền Suối Nguồn · Xem để xem tên ứng viên." } : {
        loc: filter, tong_khop: picked.length, an_do_khong_co_quyen_nick: rows.length - visible.length || undefined,
        ung_vien: picked.slice(0, limit).map((row) => {
          const interest = interestOf(row);
          return {
            khach_viet_ten: row.candidate_name ?? "Ứng viên",
            owner: ownerLabel(row.owner_name, row.campaign_name, names).label, chien_dich: row.campaign_name, nick: nicks.get(row.channel_account_id)?.name ?? null,
            phan_hoi_luc: vnTime(row.replied_at), khach_viet_tin_phan_hoi: row.first_reply,
            owner_tra_loi: row.owner_replied_at ? `Đã trả lời ${answerDelay(row.replied_at, row.owner_replied_at)} (${row.owner_messages} tin)` : "Chưa trả lời",
            muc_do: interest ? INTEREST_LABEL[interest] : "AI chưa đọc", ly_do: row.interest_reason,
            cv: row.cv_file ? `Đã gửi file ${row.cv_file}` : row.rec_outcome === "CV_RECEIVED" ? "Luồng Rec: Đã có CV" : hasCv(row) ? "Có" : "Chưa",
            khach_viet_tin_cuoi: row.last_inbound_text && row.last_inbound_text !== row.first_reply ? row.last_inbound_text : undefined,
            link: `/inbox/all/${row.conversation_id}`,
          };
        }),
      },
    };
  },

  // CV chuyển hóa (migration 145): CVs candidates sent in Zalo / Facebook chats, on the nicks this member may see.
  async cv_chuyen_hoa(args, scope) {
    if (!scope.context.isAdmin && !scope.context.permissions.includes("inbox.view")) return { loi: "Sếp chưa có quyền Suối Nguồn · Xem." };
    const period = str(args.ky) ?? (str(args.tu_ngay) || str(args.den_ngay) ? null : "THANG_NAY");
    let from: Date | null = null, to: Date | null = null, label = "toàn bộ";
    if (period !== "TAT_CA") {
      const range = kpiRange(period as KpiPeriod | null, str(args.tu_ngay), str(args.den_ngay));
      if ("error" in range) return { loi: range.error };
      ({ from, to, label } = range);
    }
    const db = createPrivilegedClient();
    const accessible = await getAccessibleChannelAccountIds();
    let query = db.from("chat_cv_conversions").select("conversation_id,channel_account_id,file_name,first_cv_at,campaign_name,source").eq("workspace_id", scope.workspaceId).order("first_cv_at", { ascending: false }).limit(5000);
    if (from) query = query.gte("first_cv_at", from.toISOString());
    if (to) query = query.lt("first_cv_at", to.toISOString());
    if (accessible) query = query.in("channel_account_id", accessible.length ? accessible : ["00000000-0000-0000-0000-000000000000"]);
    const [{ data, error }, nicks, { data: accounts }, { data: people }] = await Promise.all([
      query, nickMap(db, scope.workspaceId),
      db.from("channel_accounts").select("id,primary_profile_id").eq("workspace_id", scope.workspaceId),
      db.from("profiles").select("id,full_name,department").eq("workspace_id", scope.workspaceId),
    ]);
    if (error) return { loi: "Chưa tải được CV chuyển hóa, thử lại sau ít phút." };
    const ownerOf = new Map((accounts ?? []).map((row) => [String(row.id), row.primary_profile_id ? String(row.primary_profile_id) : null]));
    const person = new Map((people ?? []).map((row) => [String(row.id), { name: String(row.full_name ?? ""), department: row.department ? String(row.department) : null }]));
    let rows: ConversionRow[] = (data ?? []).map((row) => {
      const owner = ownerOf.get(String(row.channel_account_id)) ?? null;
      return { conversation: String(row.conversation_id), nick: String(row.channel_account_id), nickName: nicks.get(String(row.channel_account_id))?.name ?? "Nick",
        owner: owner ? person.get(owner)?.name ?? null : null, department: owner ? person.get(owner)?.department ?? null : null,
        file: String(row.file_name ?? "CV"), at: Date.parse(String(row.first_cv_at)), campaign: row.campaign_name ? String(row.campaign_name) : null, source: row.source === "REC_FLOW" ? "REC_FLOW" : "FILE" };
    });
    const all = rows;
    const campaign = isGenericCampaignWord(str(args.chien_dich)) ? null : str(args.chien_dich);
    const source = str(args.nguon) ?? (str(args.chien_dich) && !campaign ? "MKT_ZALO" : null);
    rows = rows.filter((row) => matchesText(row.owner, str(args.nguoi)) && matchesText(row.department, str(args.bo_phan)) && matchesText(row.nickName, str(args.nick))
      && (!campaign || matchesText(row.campaign, campaign)) && (source !== "MKT_ZALO" || row.campaign) && (source !== "CHAT_KHAC" || !row.campaign));
    const by = (str(args.chia_theo) ?? "NGUOI") as ConversionBy;
    const limit = typeof args.so_luong === "number" ? Math.min(Math.max(1, args.so_luong), 50) : 15;
    const listed = rows.slice(0, limit);
    const { data: chats } = listed.length ? await db.from("omnichannel_conversations").select("id,metadata,contacts(full_name)").in("id", listed.map((row) => row.conversation)) : { data: [] };
    const nameOf = new Map(((chats ?? []) as Array<{ id: unknown; metadata: unknown; contacts: unknown }>).map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const contact = (Array.isArray(row.contacts) ? row.contacts[0] : row.contacts) as { full_name?: unknown } | null;
      return [String(row.id), String(meta.participantDisplayName ?? meta.conversationDisplayName ?? contact?.full_name ?? "Ứng viên")];
    }));
    return {
      khoang_thoi_gian: label,
      dinh_nghia: "CV chuyển hóa = ứng viên gửi file CV trong chat 1-1 Zalo/Facebook (nick tuyển dụng hoặc sau khi phản hồi chiến dịch) hoặc Luồng Rec \"Đã có CV\"; mỗi ứng viên 1 lần; tu_mkt_zalo = ứng viên đã phản hồi chiến dịch trước khi gửi CV. Nhận ra CV theo tên file (không đọc file).",
      tong: rows.length, tu_mkt_zalo: rows.filter((row) => row.campaign).length, tu_chat_khac: rows.filter((row) => !row.campaign).length,
      ...(rows.length === 0 && all.length ? { ghi_chu: `Không có CV khớp bộ lọc; cả kỳ có ${all.length} CV chuyển hóa.` } : {}),
      bang: conversionTable(rows, by).slice(0, 40),
      danh_sach: listed.map((row) => ({ ung_vien: nameOf.get(row.conversation) ?? "Ứng viên", file: row.source === "REC_FLOW" ? "(Luồng Rec: Đã có CV)" : row.file, luc: vnTime(new Date(row.at).toISOString()),
        nick: row.nickName, nguoi: row.owner, nguon: row.campaign ? `MKT Zalo · ${row.campaign}` : "Chat khác", link: `/inbox/all/${row.conversation}` })),
    };
  },

  async tien_do_chien_dich(args, scope) {
    if (!scope.context.isAdmin && !scope.context.permissions.includes("campaigns.view")) return { loi: "Sếp chưa có quyền Chiến dịch · Xem." };
    const db = createPrivilegedClient();
    const { data, error } = await db.rpc("campaign_account_progress", { p_workspace_id: scope.workspaceId });
    if (error) return { loi: "Chưa tải được tiến độ chiến dịch, thử lại sau ít phút." };
    const [nickInfo, names] = await Promise.all([nickMap(db, scope.workspaceId), ownerNames(db, scope.workspaceId)]);
    const kenh = str(args.kenh), nick = str(args.nick), onlyRunning = args.chi_dang_chay !== false;
    let rows = ((data ?? []) as ProgressRow[]).filter((row) => {
      const info = row.channel_account_id ? nickInfo.get(row.channel_account_id) : undefined;
      return (!onlyRunning || ["RUNNING", "PAUSED", "SCHEDULED"].includes(row.campaign_status))
        && (!kenh || kenh === "TAT_CA" || info?.channel === kenh) && matchesText(info?.name, nick) && matchesText(row.campaign_name, str(args.chien_dich));
    });
    rows = rows.sort((a, b) => b.recipients - a.recipients);
    // Replies nobody answered yet, per nick (last 30 days), for the reminders.
    const unanswered = new Map<string, number>();
    try {
      const recent = await interactionRows(db, scope.workspaceId, new Date(Date.now() - 30 * 86_400_000), null);
      for (const row of recent) if (!row.owner_replied_at && rows.some((item) => item.channel_account_id === row.channel_account_id)) unanswered.set(row.channel_account_id, (unanswered.get(row.channel_account_id) ?? 0) + 1);
    } catch { /* reminders are optional */ }
    const nicks = new Map<string, NickInfo>([...nickInfo].map(([id, info]) => [id, { name: info.name, status: info.status }]));
    const byNick = new Map<string, ProgressRow[]>();
    for (const row of rows) byNick.set(row.channel_account_id ?? "?", [...(byNick.get(row.channel_account_id ?? "?") ?? []), row]);
    const pct = (part: number, whole: number) => whole ? `${(part / whole * 100).toFixed(1)}%` : null;
    return {
      ghi_chu: "da_chay = số UV đã nhận ít nhất 1 tin; tong = số UV trong chiến dịch; con_cho = UV chưa gửi; du_kien_ngay = số ngày còn lại theo tốc độ 7 ngày qua. goi_y là gợi ý tính sẵn từ số liệu, dùng làm cơ sở đề xuất.",
      theo_nick: [...byNick].map(([id, list]) => {
        const info = nickInfo.get(id);
        const sum = (key: keyof ProgressRow) => list.reduce((total, row) => total + Number(row[key] ?? 0), 0);
        return {
          nick: info?.name ?? "Chưa gán nick", kenh: info?.channel ?? null, trang_thai_nick: info?.status ? ACCOUNT_STATUS[info.status] ?? info.status : null,
          tong_cong: { da_chay: sum("reached"), tong: sum("recipients"), ty_le_da_chay: pct(sum("reached"), sum("recipients")), con_cho: sum("waiting"), phan_hoi: sum("replied"), ty_le_phan_hoi: pct(sum("replied"), sum("reached")), gui_24h: sum("sent_24h"), gui_7_ngay: sum("sent_7d"), uv_chua_duoc_tra_loi: unanswered.get(id) ?? 0 },
          chien_dich: list.map((row) => ({
            ten: row.campaign_name, owner: ownerLabel(row.owner_name, row.campaign_name, names).label, trang_thai: row.campaign_status,
            da_chay: row.reached, tong: row.recipients, hien_thi: `${row.reached}/${row.recipients}`, con_cho: row.waiting,
            phan_hoi: row.replied, ty_le_phan_hoi: pct(row.replied, row.reached), loi: row.failed + row.unknown || undefined, dung_gui: row.stopped || undefined,
            tin_da_gui: row.messages_sent, gui_24h: row.sent_24h, gui_7_ngay: row.sent_7d, gioi_han_ngay: row.daily_limit,
            du_kien_ngay: daysLeft(row), lan_gui_cuoi: vnTime(row.last_sent_at), link: `/campaigns/${info?.channel === "FACEBOOK_PROFILE" ? "facebook-profile" : "omnichannel"}/${row.campaign_id}`,
          })),
        };
      }),
      goi_y: progressHints(rows, nicks, unanswered),
    };
  },
};
