import "server-only";

import { broadcastGroups, broadcastNicks, changeBroadcast, createBroadcast, currentZaloGroup } from "@/modules/broadcasts/server/broadcast-data";
import { MAX_TARGETS_PER_BROADCAST } from "@/modules/broadcasts/core/broadcast-plan";
import type { ActionContext, Built, Executed } from "@/modules/assistant/server/assistant-proposals";

// Trợ lý card for "Gửi hàng loạt Zalo". Many groups: it only prepares a DRAFT (chosen nicks and groups);
// nothing is sent until the member opens the page and presses "Bắt đầu gửi". The one group where the member
// is talking to the Trợ lý ("nhóm này"): confirming the card sends/pins there right away, from the Trợ lý nick.

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().trim();

export async function proposeBroadcast(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const text = String(args.noi_dung ?? "").trim();
  const sendMessage = args.gui_tin !== false, pinNote = args.ghim === true;
  if (!text) return { ok: false, error: "Cần nội dung tin." };
  if (!sendMessage && !pinNote) return { ok: false, error: "Chọn gửi tin, ghim, hoặc cả hai." };
  if (text.length > (pinNote ? 2000 : 4000)) return { ok: false, error: pinNote ? "Nội dung ghim tối đa 2.000 ký tự." : "Nội dung tối đa 4.000 ký tự." };
  if (args.nhom_hien_tai === true) {
    const current = context.zaloConversationId ? await currentZaloGroup(context, context.zaloConversationId) : null;
    if (!current) return { ok: false, error: "Chỉ dùng được khi sếp hỏi Soda ngay trong nhóm Zalo đó." };
    const name = String(args.ten ?? "").trim() || `${pinNote ? "Ghim" : "Gửi"} vào ${current.name}`;
    return {
      ok: true, kind: "CREATE_BROADCAST",
      params: { name: name.slice(0, 200), text, sendMessage, pinNote, accountIds: [current.accountId], groupIds: [current.groupId], currentGroup: current },
      preview: {
        title: pinNote && !sendMessage ? "Ghim lên đầu nhóm này" : pinNote ? "Gửi và ghim vào nhóm này" : "Gửi vào nhóm này",
        lines: [`Nhóm: ${current.name}`, `${sendMessage ? "Gửi tin" : ""}${sendMessage && pinNote ? " + " : ""}${pinNote ? "ghim ghi chú lên đầu nhóm" : ""} từ nick Soda`, "Xác nhận là thực hiện ngay (trong khoảng 20 giây)."],
        editableText: text, editableKind: "message", link: "/broadcasts",
      },
    };
  }
  const nicks = (await broadcastNicks(context)).filter((nick) => nick.status === "CONNECTED");
  const wantedNicks = Array.isArray(args.nick) ? (args.nick as string[]).map(fold).filter(Boolean) : [];
  const chosen = wantedNicks.length ? nicks.filter((nick) => wantedNicks.some((name) => fold(nick.name).includes(name))) : nicks;
  if (!chosen.length) return { ok: false, error: wantedNicks.length ? "Không tìm thấy nick đó trong các nick sếp được dùng (hoặc nick đang mất kết nối)." : "Sếp chưa có nick Zalo nào đang kết nối." };
  const keyword = typeof args.tu_khoa_nhom === "string" ? fold(args.tu_khoa_nhom) : "";
  const limit = typeof args.so_nhom_toi_da === "number" ? Math.min(args.so_nhom_toi_da, MAX_TARGETS_PER_BROADCAST) : MAX_TARGETS_PER_BROADCAST;
  const groups = (await broadcastGroups(context, chosen.map((nick) => nick.id))).filter((group) => !keyword || fold(group.name).includes(keyword)).slice(0, limit);
  if (!groups.length) return { ok: false, error: "Không có nhóm nào khớp với các nick và từ khoá này." };
  const name = String(args.ten ?? "").trim() || text.split("\n")[0].slice(0, 80);
  return {
    ok: true, kind: "CREATE_BROADCAST",
    params: { name, text, sendMessage, pinNote, accountIds: chosen.map((nick) => nick.id), groupIds: groups.map((group) => group.groupId) },
    preview: {
      title: "Chuẩn bị gửi nhóm Zalo (nháp)",
      lines: [
        `Tên: ${name}`, `${sendMessage ? "Gửi tin" : ""}${sendMessage && pinNote ? " + " : ""}${pinNote ? "ghim ghi chú" : ""} vào ${groups.length} nhóm`,
        `Nick: ${chosen.map((nick) => nick.name).join(", ")}`,
        `Ví dụ nhóm: ${groups.slice(0, 5).map((group) => group.name).join("; ")}${groups.length > 5 ? "…" : ""}`,
        "Chỉ tạo nháp. Sếp mở trang Gửi nhóm Zalo kiểm tra rồi bấm Bắt đầu gửi; mỗi nick tối đa 30 nhóm/ngày, cách 90–180 giây, 8:00–21:00.",
      ],
      editableText: text, editableKind: "message", link: "/broadcasts",
    },
  };
}

export async function executeBroadcast(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const currentGroup = params.currentGroup as { accountId: string; conversationId: string; groupId: string; name: string } | undefined;
  const result = await createBroadcast(context, {
    name: String(params.name), text: String(params.text), sendMessage: params.sendMessage !== false, pinNote: params.pinNote === true,
    accountIds: (params.accountIds as string[]) ?? [], groupIds: (params.groupIds as string[]) ?? [], source: "ASSISTANT", currentGroup,
  });
  // Only the group the member is talking in: their confirmation of the card is the start.
  if (result.ok && currentGroup) {
    const started = await changeBroadcast(context, result.id, "START");
    return started.ok ? { ok: true, message: params.pinNote === true ? "Em đang ghim vào nhóm này, khoảng 20 giây nữa sẽ hiện ở đầu nhóm." : "Em đang gửi vào nhóm này.", link: `/broadcasts/${result.id}` } : { ok: false, message: started.error };
  }
  return result.ok
    ? { ok: true, message: `Đã tạo nháp gửi ${result.groups} nhóm từ ${result.nicks} nick. Sếp mở trang để kiểm tra và bấm Bắt đầu gửi.`, link: `/broadcasts/${result.id}` }
    : { ok: false, message: result.error };
}
