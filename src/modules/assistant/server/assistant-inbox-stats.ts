import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";
import { broadcastGroups, broadcastNicks } from "@/modules/broadcasts/server/broadcast-data";
import type { ActionContext } from "@/modules/assistant/server/assistant-proposals";

// Soda, đợt 1, on Suối Nguồn (with the member's own session, so only the nicks they may use):
//  - dem_hoi_thoai: how many conversations, waiting for an answer, unread, per nick and channel; with Japanese people.
//  - nhom_zalo: how many Zalo groups each nick is in (as HireX knows them), optionally which.

type Scope = { workspaceId: string; userId: string; context: ActionContext; channel?: "WEB" | "ZALO" };
type TabRow = { id: string; channel_account_id: string; channel_type: string; sort_at: string; is_group: boolean; is_other: boolean; latest_direction: string | null; unread_count: number; assigned_to: string | null };
type JpRow = { id: string; channel_account_id: string; channel_type: string; sort_at: string; is_group: boolean; is_other: boolean; latest_direction: string | null; name: string | null; reason: string };
const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().trim();
const CHANNEL: Record<string, string> = { ZALO: "Zalo", FACEBOOK: "Facebook Page", FACEBOOK_PROFILE: "Facebook cá nhân", EMAIL: "Email" };
const waiting = (row: { is_group: boolean; is_other: boolean; latest_direction: string | null }) => !row.is_group && !row.is_other && row.latest_direction === "INBOUND";
const vnTime = (iso: string) => new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));

async function nicksFor(scope: Scope, wanted: string | null) {
  const supabase = await createClient();
  const accessible = await getAccessibleChannelAccountIds();
  let query = supabase.from("channel_accounts").select("id,display_name,external_account_id,channel_type").eq("workspace_id", scope.workspaceId).is("deleted_at", null);
  if (accessible) query = query.in("id", accessible.length ? accessible : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await query;
  const all = (data ?? []).map((row) => ({ id: String(row.id), name: String(row.display_name ?? row.external_account_id ?? "Nick"), channel: String(row.channel_type) }));
  return { supabase, nicks: wanted ? all.filter((nick) => fold(nick.name).includes(fold(wanted))) : all };
}

export const inboxStatTools: Record<string, (args: Record<string, unknown>, scope: Scope) => Promise<unknown>> = {
  async dem_hoi_thoai(args, scope) {
    if (!scope.context.isAdmin && !scope.context.permissions.includes("inbox.view")) return { loi: "Sếp chưa có quyền Suối Nguồn · Xem." };
    const wantedNick = typeof args.nick === "string" && args.nick.trim() ? args.nick.trim() : null;
    const { supabase, nicks } = await nicksFor(scope, wantedNick);
    if (!nicks.length) return { loi: wantedNick ? `Không có nick "${wantedNick}" trong các nick sếp được xem.` : "Sếp chưa được cấp nick nào." };
    const days = Math.min(Math.max(Number(args.so_ngay) || 30, 1), 90);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const channels = typeof args.kenh === "string" ? [args.kenh] : null;
    const ids = nicks.map((nick) => nick.id);
    const name = new Map(nicks.map((nick) => [nick.id, nick.name]));
    const japanese = args.nguoi_nhat === true;
    if (japanese) {
      const { data, error } = await supabase.rpc("inbox_japanese_conversations", { p_account_ids: ids, p_channel_types: channels, p_since: since });
      if (error) return { loi: "Chưa đếm được hội thoại người Nhật, thử lại sau." };
      const rows = ((data ?? []) as JpRow[]).filter((row) => !row.is_group);
      const limit = Math.min(Math.max(Number(args.so_luong) || 15, 1), 40);
      const byChannel = new Map<string, { tong: number; cho_tra_loi: number }>();
      for (const row of rows) { const key = CHANNEL[row.channel_type] ?? row.channel_type; const entry = byChannel.get(key) ?? { tong: 0, cho_tra_loi: 0 }; entry.tong += 1; if (waiting(row)) entry.cho_tra_loi += 1; byChannel.set(key, entry); }
      return {
        trong: `${days} ngày gần đây`, nick: wantedNick ?? "mọi nick sếp được xem",
        ghi_chu: "Người Nhật = nhắn bằng chữ kana tiếng Nhật, email đuôi .jp, hoặc liên hệ ghi quốc gia Nhật Bản / tiếng Nhật. Không tính nhóm chat.",
        tong: rows.length, cho_tra_loi: rows.filter(waiting).length,
        theo_kenh: [...byChannel].map(([kenh, entry]) => ({ kenh, ...entry })),
        danh_sach: rows.sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || b.sort_at.localeCompare(a.sort_at)).slice(0, limit).map((row) => ({
          khach_viet_ten: row.name, kenh: CHANNEL[row.channel_type] ?? row.channel_type, nick: name.get(row.channel_account_id), ly_do: row.reason,
          cho_tra_loi: waiting(row), tin_cuoi: vnTime(row.sort_at), link: `/inbox/all/${row.id}`,
        })),
      };
    }
    const { data, error } = await supabase.rpc("inbox_conversation_tabs", { p_account_ids: ids, p_channel_types: channels, p_since: since });
    if (error) return { loi: "Chưa đếm được Suối Nguồn, thử lại sau." };
    const rows = (data ?? []) as TabRow[];
    const per = new Map<string, { nick: string; kenh: string; hoi_thoai: number; cho_tra_loi: number; chua_doc: number; nhom: number }>();
    for (const row of rows) {
      const key = `${row.channel_account_id}`;
      const entry = per.get(key) ?? { nick: name.get(row.channel_account_id) ?? "Nick", kenh: CHANNEL[row.channel_type] ?? row.channel_type, hoi_thoai: 0, cho_tra_loi: 0, chua_doc: 0, nhom: 0 };
      if (row.is_group) entry.nhom += 1; else if (!row.is_other) entry.hoi_thoai += 1;
      if (waiting(row)) entry.cho_tra_loi += 1;
      if (!row.is_group && !row.is_other && row.unread_count > 0) entry.chua_doc += 1;
      per.set(key, entry);
    }
    const list = [...per.values()].sort((a, b) => b.cho_tra_loi - a.cho_tra_loi);
    return {
      trong: `${days} ngày gần đây (hội thoại có tin trong khoảng này)`, kenh: channels ? CHANNEL[channels[0]] ?? channels[0] : "mọi kênh",
      ghi_chu: "cho_tra_loi = tin cuối là của khách và chưa ai trả lời (giống tab Chưa trả lời; không tính nhóm, mục Khác, email tự động).",
      tong: { hoi_thoai: list.reduce((sum, entry) => sum + entry.hoi_thoai, 0), cho_tra_loi: list.reduce((sum, entry) => sum + entry.cho_tra_loi, 0), chua_doc: list.reduce((sum, entry) => sum + entry.chua_doc, 0) },
      theo_nick: list.slice(0, 40),
      link: "/inbox/all",
    };
  },

  async nhom_zalo(args, scope) {
    if (!scope.context.isAdmin && !scope.context.permissions.includes("inbox.view")) return { loi: "Sếp chưa có quyền Suối Nguồn · Xem." };
    const nicks = await broadcastNicks(scope.context);
    const wantedNick = typeof args.nick === "string" && args.nick.trim() ? fold(args.nick) : null;
    const chosen = wantedNick ? nicks.filter((nick) => fold(nick.name).includes(wantedNick)) : nicks;
    if (!chosen.length) return { loi: wantedNick ? "Không có nick đó trong các nick Zalo sếp được xem." : "Sếp chưa được cấp nick Zalo nào." };
    const groups = await broadcastGroups(scope.context, chosen.map((nick) => nick.id));
    const keyword = typeof args.tu_khoa === "string" && args.tu_khoa.trim() ? fold(args.tu_khoa) : null;
    const matched = keyword ? groups.filter((group) => fold(group.name).includes(keyword)) : groups;
    const perNick = chosen.map((nick) => ({ nick: nick.name, trang_thai: nick.status === "CONNECTED" ? "Đang kết nối" : nick.status, so_nhom: matched.filter((group) => group.accounts.some((account) => account.accountId === nick.id)).length }))
      .filter((entry) => entry.so_nhom > 0 || wantedNick).sort((a, b) => b.so_nhom - a.so_nhom);
    const limit = Math.min(Math.max(Number(args.so_luong) || 0, 0), 100);
    return {
      ghi_chu: "Nhóm HireX đã thấy có tin nhắn (đã đồng bộ); một nhóm nhiều nick cùng ở chỉ tính một lần trong tong_nhom.",
      ...(keyword ? { tu_khoa: args.tu_khoa } : {}), tong_nhom: matched.length, theo_nick: perNick,
      ...(limit ? { danh_sach: matched.slice(0, limit).map((group) => ({ ten: group.name, so_nick: group.accounts.length })) } : {}),
      link: "/broadcasts/new",
    };
  },
};
