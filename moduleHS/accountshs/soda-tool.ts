// Soda (Trợ lý HireX) · định nghĩa công cụ "tai_nguyen" (thuần — không I/O). Chạy ở moduleHS/accountshs/server/soda.ts.
import { z } from "zod";
import type { AssistantToolDefinition } from "../../src/modules/assistant/core/assistant-tools.ts";

export function ACCOUNTS_TOOLS(): AssistantToolDefinition[] {
  return [{
    name: "tai_nguyen",
    permission: "accounts.view",
    label: "Tra cứu tài nguyên",
    description: "Đây là khả năng tra cứu của Cú vọ (trợ lý AI trong mục Tài nguyên) — dùng khi người dùng hỏi về tài khoản / nick / acc / mail / sđt / page / nhóm FB / bài đăng FB / proxy, hoặc nói \"trong cú vọ\", \"trong tài nguyên\". Hỏi mục Tài nguyên (AccountsHS: Facebook, Email, SĐT, Zalo, WhatsApp, LinkedIn, Telegram, FB Page, Bài đăng FB, Nhóm FB, Proxy) bằng một câu tiếng Việt, ví dụ \"có bao nhiêu facebook sống của REC\", \"tài khoản die của Hải\", \"email đã xác minh\", \"sđt New 1\", \"email không có mật khẩu\", \"đếm facebook theo owner\". Trả về số lượng, điều kiện đã hiểu, thống kê và tối đa 10 ví dụ. \"Đã xác minh / Chưa xác minh / New / New 1 / L1 / Cloud CEO chuyển\" là nhãn CRM cũ (cột CRM · …); \"Lâu dài / Tạm thời / Mất / Không xác định\" là Tình trạng sở hữu tính theo AccountsHS — hai thứ khác nhau. Mỗi câu hỏi một lần gọi; câu nối tiếp thì viết lại đủ ý (nêu lại nền tảng, owner…). Chỉ đọc.",
    parameters: { type: "object", additionalProperties: false, required: ["cau_hoi"], properties: { cau_hoi: { type: "string", description: "Câu hỏi đầy đủ về tài nguyên, giữ nguyên chữ người dùng (tên owner, bộ phận, nền tảng, trạng thái)." } } },
    args: z.object({ cau_hoi: z.string().trim().min(1).max(400) }).strict(),
  }];
}
