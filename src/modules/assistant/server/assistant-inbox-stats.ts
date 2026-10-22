import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";
import { broadcastGroups, broadcastNicks } from "@/modules/broadcasts/server/broadcast-data";
import type { ActionContext } from "@/modules/assistant/server/assistant-proposals";

// Soda, đợt 1, on Suối Nguồn (with the member's own session, so only the nicks they may use):
//  - dem_hoi_thoai: how many conversations, waiting for an answer, unread, per nick and channel; with Japanese people.
//  - nhom_zalo: how many Zalo groups each nick is in (as HireX knows them), optionally which.

type Scope = { workspaceId: string; userId: string; context: ActionContext; channel?: "WEB" | "ZALO" };
type TabRow = { id: string; channel_account_id: string; channel_type: string; sort_at: string; is_group: boolean; is_other: boolean; latest_direction: string | null; unread_count: number; assigned_to: string | null; mention_pending?: boolean };
type FactRow = TabRow & { is_important: boolean; mention_pending: boolean; tag_ids: string[] };
type JpRow = { id: string; channel_account_id: string; channel_type: string; sort_at: string; is_group: boolean; is_other: boolean; latest_direction: string | null; name: string | null; reason: string };
const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().trim();
const CHANNEL: Record<string, string> = { ZALO: "Zalo", FACEBOOK: "Facebook Page", FACEBOOK_PROFILE: "Facebook cá nhân", EMAIL: "Email" };
// Like the Chưa trả lời tab: one-to-one chats whose last message is the customer's, and Zalo groups where my nick was tagged and has not answered.
const waiting = (row: { is_group: boolean; is_other: boolean; latest_direction: string | null; mention_pending?: boolean }) => (!row.is_group && !row.is_other && row.latest_direction === "INBOUND") || (row.is_group && row.mention_pending === true);
const vnTime = (iso: string) => new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));

async function nicksFor(scope: Scope, wanted: string | null) {
  const supabase = await createClient();
  const accessible = await getAccessibleChannelAccountIds();
  // The nick list is read by the server (members cannot read channel_accounts directly); the counts below use the member's session.
  let query = createPrivilegedClient().from("channel_accounts").select("id,display_name,external_account_id,channel_type").eq("workspace_id", scope.workspaceId).is("deleted_at", null);
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
    const { data, error } = await supabase.rpc("inbox_conversation_facts", { p_account_ids: ids, p_channel_types: channels, p_since: since });
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
      ghi_chu: "cho_tra_loi = giống tab Chưa trả lời: tin cuối là của khách và chưa ai trả lời, cộng nhóm Zalo có tag nick mình mà chưa trả lời (không tính email tự động).",
      tong: { hoi_thoai: list.reduce((sum, entry) => sum + entry.hoi_thoai, 0), cho_tra_loi: list.reduce((sum, entry) => sum + entry.cho_tra_loi, 0), chua_doc: list.reduce((sum, entry) => sum + entry.chua_doc, 0) },
      theo_nick: list.slice(0, 40),
      link: "/inbox/all",
    };
  },

  async dem_suoi_nguon(args, scope) {
    if (!scope.context.isAdmin && !scope.context.permissions.includes("inbox.view")) return { loi: "Sếp chưa có quyền Suối Nguồn · Xem." };
    const db = createPrivilegedClient();
    const accessible = await getAccessibleChannelAccountIds();
    let accountQuery = db.from("channel_accounts").select("id,display_name,external_account_id,channel_type,primary_profile_id").eq("workspace_id", scope.workspaceId).is("deleted_at", null);
    if (accessible) accountQuery = accountQuery.in("id", accessible.length ? accessible : ["00000000-0000-0000-0000-000000000000"]);
    const [{ data: accountRows }, { data: profileRows }, { data: tagRows }] = await Promise.all([
      accountQuery,
      db.from("profiles").select("id,full_name,department").eq("workspace_id", scope.workspaceId),
      db.from("conversation_tags").select("id,name,group_name").eq("workspace_id", scope.workspaceId),
    ]);
    const accounts = new Map((accountRows ?? []).map((row) => [String(row.id), { name: String(row.display_name ?? row.external_account_id ?? "Nick"), owner: typeof row.primary_profile_id === "string" ? row.primary_profile_id : null }]));
    if (!accounts.size) return { loi: "Sếp chưa được cấp nick nào." };
    const people = new Map((profileRows ?? []).map((row) => [String(row.id), { name: String(row.full_name ?? ""), department: typeof row.department === "string" ? row.department : null }]));
    const tags = (tagRows ?? []).map((row) => ({ id: String(row.id), name: String(row.name), group: typeof row.group_name === "string" ? row.group_name : null }));
    const tagName = new Map(tags.map((tag) => [tag.id, tag.name]));
    const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
    // A tag by name: same name (marks and case ignored) first, otherwise names that contain it.
    const findTags = (wanted: string, pool = tags) => { const key = fold(wanted); const exact = pool.filter((tag) => fold(tag.name) === key); return exact.length ? exact : pool.filter((tag) => fold(tag.name).includes(key)); };
    const marketGroup = (group: string | null) => group !== null && fold(group).includes("thi truong");
    const wantedTags = list(args.the).map((name) => ({ name, ids: findTags(name).map((tag) => tag.id) }));
    const missingTag = wantedTags.find((tag) => !tag.ids.length);
    if (missingTag) return { loi: `Không có nhãn "${missingTag.name}" trong Suối Nguồn.`, cac_nhan_dang_co: tags.map((tag) => tag.name).slice(0, 60) };
    const markets = tags.filter((tag) => marketGroup(tag.group));
    const wantedMarkets = list(args.thi_truong).map((name) => ({ name, ids: findTags(name, markets.length ? markets : tags).map((tag) => tag.id) }));
    const missingMarket = wantedMarkets.find((market) => !market.ids.length);
    if (missingMarket) return { loi: `Không có thị trường "${missingMarket.name}".`, cac_thi_truong: markets.map((tag) => tag.name), ghi_chu: markets.length ? undefined : "Chưa nhãn nào được xếp vào nhóm thẻ \"Thị trường\" (trang Suối Nguồn → Nhãn → Nhóm thẻ)." };
    const ownerNames = list(args.owner).map(fold);
    const departments = list(args.bo_phan).map(fold);
    const states = list(args.trang_thai);
    const channels = list(args.kenh);
    const by = typeof args.chia_theo === "string" ? args.chia_theo : "TONG";
    const groupName = typeof args.ten_nhom_the === "string" && args.ten_nhom_the.trim() ? args.ten_nhom_the.trim() : null;
    const groupTags = by === "THI_TRUONG" ? markets : by === "NHOM_THE" && groupName ? tags.filter((tag) => tag.group && fold(tag.group) === fold(groupName)) : [];
    if (by === "NHOM_THE" && !groupTags.length) return { loi: groupName ? `Chưa có nhãn nào trong nhóm thẻ "${groupName}".` : "Cần ten_nhom_the khi chia theo nhóm thẻ.", cac_nhom_the: [...new Set(tags.map((tag) => tag.group).filter(Boolean))] };
    // Questions about tags read only the conversations carrying them (all time); the rest: the last 30 days, like the tab numbers.
    const tagScope = wantedTags.length ? wantedTags.flatMap((tag) => tag.ids) : wantedMarkets.length ? wantedMarkets.flatMap((market) => market.ids)
      : by === "THE" ? tags.map((tag) => tag.id) : by === "THI_TRUONG" || by === "NHOM_THE" ? groupTags.map((tag) => tag.id) : [];
    if ((by === "THE" || by === "THI_TRUONG") && !tagScope.length) return { loi: by === "THE" ? "Suối Nguồn chưa có nhãn nào." : "Chưa nhãn nào được xếp vào nhóm thẻ \"Thị trường\" (Suối Nguồn → Nhãn → Nhóm thẻ)." };
    const byTag = tagScope.length > 0;
    const days = Number(args.so_ngay) > 0 ? Math.min(Number(args.so_ngay), 365) : byTag ? null : 30;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("inbox_conversation_facts", { p_account_ids: [...accounts.keys()], p_channel_types: channels.length ? channels : null, p_since: days ? new Date(Date.now() - days * 86_400_000).toISOString() : null, p_tag_ids: byTag ? [...new Set(tagScope)] : null });
    if (error) return { loi: "Chưa đếm được Suối Nguồn, thử lại sau." };
    const facts = ((data ?? []) as FactRow[]).filter((row) => !row.is_other);
    // Owner: the person the conversation is given to; not given = the main user of the nick.
    const ownerOf = (row: FactRow) => row.assigned_to ?? accounts.get(row.channel_account_id)?.owner ?? null;
    const matchesState = (row: FactRow) => !states.length || states.some((state) => state === "CHUA_TRA_LOI" ? waiting(row) : state === "QUAN_TRONG" ? row.is_important
      : state === "NHOM" ? row.is_group : state === "CA_NHAN" ? !row.is_group : state === "CHUA_DOC" ? row.unread_count > 0 : false);
    const rows = facts.filter((row) => {
      if (!matchesState(row)) return false;
      const owner = ownerOf(row); const person = owner ? people.get(owner) : null;
      if (ownerNames.length && !(person && ownerNames.some((name) => fold(person.name).includes(name)))) return false;
      if (departments.length && !(person?.department && departments.includes(fold(person.department)))) return false;
      if (wantedTags.some((tag) => !tag.ids.some((id) => row.tag_ids.includes(id)))) return false;
      if (wantedMarkets.length && !wantedMarkets.some((market) => market.ids.some((id) => row.tag_ids.includes(id)))) return false;
      return true;
    });
    if (ownerNames.length && !rows.length && ![...people.values()].some((person) => ownerNames.some((name) => fold(person.name).includes(name))))
      return { loi: `Không có người tên "${list(args.owner).join(", ")}".` };
    const keysOf = (row: FactRow): string[] => {
      const owner = ownerOf(row); const person = owner ? people.get(owner) : null;
      if (by === "OWNER") return [person?.name || "(chưa có owner)"];
      if (by === "BO_PHAN") return [person?.department || "(chưa có bộ phận)"];
      if (by === "KENH") return [CHANNEL[row.channel_type] ?? row.channel_type];
      if (by === "NICK") return [accounts.get(row.channel_account_id)?.name ?? "Nick"];
      if (by === "THE") { const names = row.tag_ids.map((id) => tagName.get(id)).filter((name): name is string => Boolean(name)); return names.length ? names : ["(chưa gắn nhãn)"]; }
      if (by === "THI_TRUONG" || by === "NHOM_THE") { const names = groupTags.filter((tag) => row.tag_ids.includes(tag.id)).map((tag) => tag.name); return names.length ? names : [by === "THI_TRUONG" ? "(chưa gắn thị trường)" : "(chưa gắn nhãn nhóm này)"]; }
      return ["Tổng"];
    };
    const buckets = new Map<string, { nhom: string; hoi_thoai: number; chua_tra_loi: number; quan_trong: number; nhom_zalo: number }>();
    for (const row of rows) for (const key of keysOf(row)) {
      const entry = buckets.get(key) ?? { nhom: key, hoi_thoai: 0, chua_tra_loi: 0, quan_trong: 0, nhom_zalo: 0 };
      entry.hoi_thoai += 1; if (waiting(row)) entry.chua_tra_loi += 1; if (row.is_important) entry.quan_trong += 1; if (row.is_group) entry.nhom_zalo += 1;
      buckets.set(key, entry);
    }
    return {
      pham_vi: `${days ? `hội thoại có tin trong ${days} ngày gần đây${Number(args.so_ngay) > 0 ? "" : " (mặc định, giống số trên các tab)"}` : "mọi thời gian, chỉ các hội thoại có nhãn được hỏi"} trên ${accounts.size} nick sếp được xem`,
      dieu_kien: { trang_thai: states.length ? states.join(" hoặc ") : "tất cả", owner: list(args.owner), bo_phan: list(args.bo_phan), nhan: wantedTags.map((tag) => tag.name), thi_truong: wantedMarkets.map((market) => market.name), kenh: channels.map((channel) => CHANNEL[channel] ?? channel) },
      tong: { hoi_thoai: rows.length, chua_tra_loi: rows.filter(waiting).length, quan_trong: rows.filter((row) => row.is_important).length, nhom_zalo: rows.filter((row) => row.is_group).length },
      ...(by !== "TONG" ? { chia_theo: by, bang: [...buckets.values()].sort((a, b) => b.hoi_thoai - a.hoi_thoai).slice(0, 50) } : {}),
      ghi_chu: "Owner = người được giao hội thoại; chưa giao thì là người dùng chính của nick. chua_tra_loi giống tab Chưa trả lời (gồm nhóm Zalo tag nick mình chưa trả lời). Không tính email tự động. Khi chia theo nhãn/thị trường, một hội thoại nhiều nhãn được tính ở mỗi nhãn. Nhóm Zalo có nhiều nick của mình tính theo từng nick.",
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
