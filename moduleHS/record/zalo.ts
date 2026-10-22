import "server-only";

// Thông báo Zalo của Cuộc họp: dùng luôn nick Zalo đã kết nối trong HireX (không đăng nhập QR riêng như bản gốc).
// Gửi bằng đúng đường "Gửi hàng loạt Zalo" của HireX, chế độ "gửi ngay vào 1 nhóm" (currentGroup):
//   createBroadcast → changeBroadcast START (người duyệt = Quản trị viên đã cài đặt Zalo) → worker Zalo của HireX gửi
//   trong vòng ~20 giây (propose_zalo_broadcast_send_service + cầu Zalo).
// Không tự tạo channel_outbound_actions: cầu Zalo chỉ nhận tin tự động vào nhóm khi khoá do đường gửi nhóm tạo ra
// (trước đây tự tạo lệnh với khoá "hs-record:" nên bị từ chối DELIVERY_REJECTED). Mỗi lần gửi hiện trong mục Gửi hàng loạt.
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { broadcastGroups, broadcastNicks, changeBroadcast, createBroadcast, type BroadcastContext } from "@/modules/broadcasts/server/broadcast-data";
import { settings } from "./data";

const ERRORS: Record<string, string> = {
  ACCOUNT_UNAVAILABLE: "Nick Zalo đang mất kết nối", ACCOUNT_BUSY: "Nick Zalo đang bận", DELIVERY_UNKNOWN: "Chưa rõ đã gửi được chưa", UNKNOWN: "Chưa rõ đã gửi được chưa",
  NOT_ELIGIBLE: "Tin không đủ điều kiện gửi", UNAVAILABLE: "Hệ thống gửi Zalo đang bận", DELIVERY_REJECTED: "Zalo từ chối tin", RATE_LIMITED: "Zalo đang giới hạn tốc độ gửi",
  NOT_A_GROUP_OR_STOPPED: "Nhóm không còn hợp lệ", PERMISSION_DENIED: "Nick không có quyền gửi vào nhóm này",
};

export type ZaloResult = "SENT" | "QUEUED";

/** Gửi một tin vào nhóm đã chọn. title: tên đợt gửi (hiện trong Gửi hàng loạt). waitMs: chờ kết quả tối đa bao lâu. */
export async function zaloSend(text: string, title: string, waitMs = 0): Promise<ZaloResult> {
  const s = settings();
  if (!s.workspace_id || !s.account_id || !s.conversation_id || !s.by) throw new Error("Chưa chọn nơi nhận Zalo");
  const db = createPrivilegedClient();
  const { data: conv } = await db.from("omnichannel_conversations").select("id,provider_conversation_id")
    .eq("id", s.conversation_id).eq("workspace_id", s.workspace_id).eq("channel_account_id", s.account_id).eq("channel_type", "ZALO").maybeSingle();
  if (!conv?.provider_conversation_id) throw new Error("Không còn thấy nhóm Zalo đã chọn");
  // Quản trị viên đã chọn nơi nhận (zalo_config chỉ cho Quản trị viên) là người duyệt mọi thông báo gửi vào nhóm đó.
  const ctx: BroadcastContext = { workspaceId: s.workspace_id, userId: s.by, permissions: [], isAdmin: true };
  const made = await createBroadcast(ctx, {
    name: ("Cuộc họp · " + title).slice(0, 200), text: text.trim().slice(0, 4000), sendMessage: true, pinMessage: false, pinNote: false,
    accountIds: [s.account_id], groupIds: [],
    currentGroup: { accountId: s.account_id, conversationId: String(conv.id), groupId: String(conv.provider_conversation_id), name: s.group_name || "Nhóm Zalo" },
  });
  if (!made.ok) throw new Error(made.error);
  const started = await changeBroadcast(ctx, made.id, "START");
  if (!started.ok) throw new Error(started.error || "Chưa bắt đầu gửi được");
  const end = Date.now() + waitMs;
  for (;;) {
    const { data: t } = await db.from("zalo_broadcast_targets").select("status,error_code").eq("broadcast_id", made.id).limit(1).maybeSingle();
    const st = String(t?.status ?? "");
    if (st === "SENT") return "SENT";
    if (["FAILED", "SKIPPED", "UNKNOWN"].includes(st)) { const c = String(t?.error_code || st); throw new Error(ERRORS[c] || c); }
    if (Date.now() >= end) return "QUEUED";
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Nick Zalo người dùng được dùng, và các nhóm của nick đã chọn — nhóm có tin mới nhất đứng đầu (như Gửi hàng loạt). */
export async function zaloTargets(context: BroadcastContext, accountId: string) {
  const nicks = await broadcastNicks(context);
  const groups = accountId
    ? (await broadcastGroups(context, [accountId])).map((g) => ({ id: g.accounts.find((a) => a.accountId === accountId)?.conversationId || "", name: g.name, at: g.lastMessageAt })).filter((g) => g.id)
    : [];
  groups.sort((a, b) => (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0) || a.name.localeCompare(b.name, "vi"));
  return { nicks: nicks.map((n) => ({ id: n.id, name: n.name, connected: n.status === "CONNECTED" })), groups };
}
