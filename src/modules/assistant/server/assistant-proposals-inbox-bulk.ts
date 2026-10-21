import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import type { ActionContext, Built, Executed } from "@/modules/assistant/server/assistant-proposals";

// Trợ lý card for Suối Nguồn bulk actions (gắn / bỏ nhãn, đã đọc, vào Khác / về Chính, giao cho). The card shows how
// many conversations match; confirming runs it as the member (their permission and nicks), recorded with
// source ASSISTANT, and it can be undone for 10 minutes from Suối Nguồn.

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().replace(/\s+/gu, " ").trim();
const ACTIONS = { GAN_NHAN: "TAG_ADD", BO_NHAN: "TAG_REMOVE", DA_DOC: "MARK_READ", VAO_KHAC: "MOVE_OTHER", VE_CHINH: "MOVE_PRIMARY", GIAO: "ASSIGN" } as const;
const VIEWS: Record<string, string> = { TAT_CA: "all", CHUA_TRA_LOI: "waiting", GIAO_CHO_TOI: "mine", NHOM: "groups", KHAC: "other", MOI_LOAI: "any" };
const VIEW_NAMES: Record<string, string> = { all: "khách (không gồm nhóm, Khác)", waiting: "khách chưa trả lời", mine: "hội thoại giao cho sếp", groups: "nhóm", other: "mục Khác", any: "mọi hội thoại" };
const CHANNELS = ["ZALO", "FACEBOOK", "FACEBOOK_PROFILE", "EMAIL"];
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];

type Tag = { id: string; name: string };

async function resolve(args: Record<string, unknown>, context: ActionContext) {
  const db = createPrivilegedClient();
  const [{ data: tagRows }, { data: accountRows }, { data: profileRows }] = await Promise.all([
    db.from("conversation_tags").select("id,name").eq("workspace_id", context.workspaceId),
    db.from("channel_accounts").select("id,display_name").eq("workspace_id", context.workspaceId).is("deleted_at", null),
    db.from("profiles").select("id,full_name").eq("workspace_id", context.workspaceId),
  ]);
  const tags = ((tagRows ?? []) as Tag[]);
  const findTag = (name: string) => tags.find((tag) => fold(tag.name) === fold(name)) ?? null;
  const wantedTags = strings(args.nhan);
  const knownTags = wantedTags.flatMap((name) => { const tag = findTag(name); return tag ? [tag] : []; });
  const newTagNames = wantedTags.filter((name) => !findTag(name));
  const filterTagNames = strings(args.loc_theo_nhan);
  const filterTags = filterTagNames.flatMap((name) => { const tag = findTag(name); return tag ? [tag] : []; });
  const nickNames = strings(args.nick).map(fold);
  const accounts = ((accountRows ?? []) as Array<{ id: string; display_name: string | null }>).filter((row) => nickNames.some((name) => fold(row.display_name ?? "").includes(name)));
  const assigneeName = typeof args.giao_cho === "string" ? fold(args.giao_cho) : "";
  const people = assigneeName ? ((profileRows ?? []) as Array<{ id: string; full_name: string | null }>).filter((row) => fold(row.full_name ?? "").includes(assigneeName)) : [];
  return { tags, knownTags, newTagNames, filterTagNames, filterTags, nickNames, accounts, assigneeName, people };
}

export async function proposeInboxBulk(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const action = ACTIONS[String(args.hanh_dong) as keyof typeof ACTIONS];
  if (!action) return { ok: false, error: "Thao tác không hợp lệ." };
  const view = VIEWS[String(args.tab ?? "TAT_CA")] ?? "all";
  const search = typeof args.tu_khoa === "string" && args.tu_khoa.trim() ? args.tu_khoa.trim().slice(0, 100) : null;
  const channels = strings(args.kenh).map((value) => value.toUpperCase()).filter((value) => CHANNELS.includes(value));
  const found = await resolve(args, context);
  if ((action === "TAG_ADD" || action === "TAG_REMOVE") && found.knownTags.length + found.newTagNames.length === 0) return { ok: false, error: "Cần tên nhãn." };
  if (action === "TAG_REMOVE" && found.newTagNames.length) return { ok: false, error: `Chưa có nhãn: ${found.newTagNames.join(", ")}.` };
  if (action === "TAG_ADD" && found.newTagNames.length && args.tao_nhan_moi !== true) return { ok: false, error: `Chưa có nhãn: ${found.newTagNames.join(", ")}. Hỏi sếp có muốn tạo nhãn mới không (tao_nhan_moi = true).` };
  if (found.filterTagNames.length !== found.filterTags.length) return { ok: false, error: "Có nhãn lọc chưa tồn tại." };
  if (found.nickNames.length && !found.accounts.length) return { ok: false, error: "Không tìm thấy nick đó." };
  if (action === "ASSIGN" && found.assigneeName && found.people.length !== 1) return { ok: false, error: found.people.length ? `Có nhiều người tên như vậy: ${found.people.slice(0, 5).map((row) => row.full_name).join(", ")}.` : "Không tìm thấy người được giao." };
  const params = {
    action, view, search, channels, accountIds: found.accounts.map((row) => row.id), filterTagIds: found.filterTags.map((tag) => tag.id),
    tagIds: found.knownTags.map((tag) => tag.id), newTagNames: action === "TAG_ADD" ? found.newTagNames : [],
    assigneeId: action === "ASSIGN" ? found.people[0]?.id ?? null : null,
  };
  const { data, error } = await createPrivilegedClient().rpc("assistant_inbox_bulk", {
    p_actor: context.userId, p_account_ids: params.accountIds.length ? params.accountIds : null, p_channel_types: channels.length ? channels : null,
    p_filter_tag_ids: params.filterTagIds.length ? params.filterTagIds : null, p_view: view, p_search: search,
    p_action: action, p_tag_ids: null, p_assignee_id: null, p_dry_run: true,
  });
  if (error) return { ok: false, error: error.message.includes("FORBIDDEN") ? "Sếp chưa có quyền Suối Nguồn · Cập nhật." : "Chưa đếm được hội thoại." };
  const matched = Number((Array.isArray(data) ? data[0] : data)?.matched) || 0;
  if (matched === 0) return { ok: false, error: "Không có hội thoại nào khớp." };
  if (matched > 5000) return { ok: false, error: "Hơn 5.000 hội thoại khớp; hãy lọc hẹp hơn (theo nick, tab, nhãn hoặc từ khoá)." };
  const tagNames = [...found.knownTags.map((tag) => tag.name), ...params.newTagNames.map((name) => `${name} (nhãn mới)`)].map((name) => `“${name}”`).join(", ");
  const what = action === "TAG_ADD" ? `Gắn nhãn ${tagNames}` : action === "TAG_REMOVE" ? `Bỏ nhãn ${tagNames}` : action === "MARK_READ" ? "Đánh dấu đã đọc"
    : action === "MOVE_OTHER" ? "Chuyển vào Khác" : action === "MOVE_PRIMARY" ? "Chuyển về Chính" : params.assigneeId ? `Giao cho ${found.people[0]?.full_name}` : "Bỏ người được giao";
  const scope = [VIEW_NAMES[view], found.accounts.length ? `nick ${found.accounts.map((row) => row.display_name).join(", ")}` : "mọi nick sếp được dùng",
    channels.length ? `kênh ${channels.join(", ")}` : "", found.filterTags.length ? `đang có nhãn ${found.filterTags.map((tag) => tag.name).join(", ")}` : "", search ? `tìm “${search}”` : ""].filter(Boolean).join(" · ");
  return {
    ok: true, kind: "BULK_INBOX", params,
    preview: { title: `${what} cho ${matched.toLocaleString("vi-VN")} hội thoại`, lines: [`Phạm vi: ${scope}`, "Sau khi làm, sếp hoàn tác được trong 10 phút ở Suối Nguồn."], link: "/inbox/all" },
  };
}

export async function executeInboxBulk(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const db = createPrivilegedClient();
  const tagIds = [...((params.tagIds as string[]) ?? [])];
  for (const name of (params.newTagNames as string[]) ?? []) {
    const { data: existing } = await db.from("conversation_tags").select("id,name").eq("workspace_id", context.workspaceId);
    const same = ((existing ?? []) as Tag[]).find((tag) => fold(tag.name) === fold(name));
    if (same) { tagIds.push(same.id); continue; }
    const { data: created, error } = await db.from("conversation_tags").insert({ workspace_id: context.workspaceId, name: name.slice(0, 80), color: "#2563eb" }).select("id").single();
    if (error || !created) return { ok: false, message: `Chưa tạo được nhãn “${name}”.` };
    tagIds.push(created.id as string);
  }
  const action = String(params.action);
  const { data, error } = await db.rpc("assistant_inbox_bulk", {
    p_actor: context.userId, p_account_ids: (params.accountIds as string[])?.length ? params.accountIds : null,
    p_channel_types: (params.channels as string[])?.length ? params.channels : null, p_filter_tag_ids: (params.filterTagIds as string[])?.length ? params.filterTagIds : null,
    p_view: String(params.view ?? "all"), p_search: (params.search as string | null) ?? null, p_action: action,
    p_tag_ids: tagIds.length ? tagIds : null, p_assignee_id: (params.assigneeId as string | null) ?? null, p_dry_run: false,
  });
  if (error) {
    const message = error.message.includes("FORBIDDEN") ? "Sếp chưa có quyền Suối Nguồn · Cập nhật." : error.message.includes("TOO_MANY") ? "Hơn 5.000 hội thoại khớp; hãy lọc hẹp hơn."
      : error.message.includes("NOTHING_MATCHED") ? "Không còn hội thoại nào khớp." : "Chưa làm được, vui lòng thử lại.";
    return { ok: false, message };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { affected?: number; matched?: number } | null;
  return { ok: true, message: `Xong: ${row?.affected ?? 0}/${row?.matched ?? 0} hội thoại thay đổi. Sếp hoàn tác được trong 10 phút ở Suối Nguồn.`, link: "/inbox/all" };
}
