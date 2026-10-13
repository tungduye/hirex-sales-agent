// Read-only tools of "Trợ lý HireX" (phase 1). Each tool needs a workspace permission, so a
// member only gets the tools for data they can already open in the web app. Pure module:
// definitions, argument validation and permission filtering are unit-tested.
import { z } from "zod";

type JsonSchema = Record<string, unknown>;

export interface AssistantToolDefinition {
  name: string;
  /** Permission the signed-in member must hold. "workspace.admin" = system administrator role. */
  permission: string;
  description: string;
  parameters: JsonSchema;
  args: z.ZodType;
  /** Short Vietnamese label shown in the panel while the tool runs. */
  label: string;
}

const noArgs = { type: "object", additionalProperties: false, properties: {}, required: [] } as const;
const nullableString = (description: string) => ({ type: ["string", "null"], description });
const nullableInteger = (description: string) => ({ type: ["integer", "null"], description });

const text = (max: number) => z.string().trim().max(max);

export const ASSISTANT_TOOLS: AssistantToolDefinition[] = [
  {
    name: "tong_quan_crm",
    permission: "dashboard.view",
    label: "Xem tổng quan CRM",
    description: "Số liên hệ, công ty, lead mới (NEW), lead đủ điều kiện (QUALIFIED) và 5 liên hệ mới nhất.",
    parameters: noArgs,
    args: z.object({}).strict(),
  },
  {
    name: "tinh_trang_kenh",
    permission: "channels.view",
    label: "Kiểm tra tài khoản kết nối",
    description: "Tình trạng các tài khoản kênh (Zalo, Facebook Page, Facebook cá nhân, Email) và tài khoản Gmail mà người dùng được phép xem: tài khoản nào lỗi, mất kết nối, cần kết nối lại.",
    parameters: noArgs,
    args: z.object({}).strict(),
  },
  {
    name: "tinh_trang_bo_gui_email",
    permission: "campaigns.view",
    label: "Kiểm tra bộ gửi chiến dịch email",
    description: "Bộ lên lịch gửi chiến dịch email có đang chạy đều không: lần chạy thành công gần nhất, số lần lỗi gần đây.",
    parameters: noArgs,
    args: z.object({}).strict(),
  },
  {
    name: "trang_thai_ai_recruiter",
    permission: "workspace.admin",
    label: "Kiểm tra AI Recruiter",
    description: "Các bot AI Recruiter: bật/tắt, chế độ AUTO/DRAFT, số lượt xử lý 24 giờ qua theo trạng thái và các mã lỗi gần đây.",
    parameters: noArgs,
    args: z.object({}).strict(),
  },
  {
    name: "hoi_thoai_cho_tra_loi",
    permission: "inbox.view",
    label: "Tìm tin nhắn chưa trả lời",
    description: "Các hội thoại trong Hồ Chứa mà tin cuối cùng là của khách/ứng viên và đã chờ ít nhất N giờ (trong 7 ngày gần đây), mới nhất trước.",
    parameters: {
      type: "object", additionalProperties: false, required: ["gio_toi_thieu", "so_luong"],
      properties: {
        gio_toi_thieu: { type: ["number", "null"], description: "Số giờ chờ tối thiểu (mặc định 2, 0 = mọi tin chưa trả lời)." },
        so_luong: nullableInteger("Số hội thoại tối đa trả về (mặc định 15, tối đa 30)."),
      },
    },
    args: z.object({ gio_toi_thieu: z.number().min(0).max(168).nullable(), so_luong: z.number().int().min(1).max(30).nullable() }).strict(),
  },
  {
    name: "chi_tiet_hoi_thoai",
    permission: "inbox.view",
    label: "Đọc hội thoại",
    description: "Thông tin và tối đa 20 tin nhắn gần nhất của một hội thoại trong Hồ Chứa, theo id hội thoại (UUID).",
    parameters: {
      type: "object", additionalProperties: false, required: ["conversation_id"],
      properties: { conversation_id: { type: "string", description: "UUID của hội thoại." } },
    },
    args: z.object({ conversation_id: z.string().uuid() }).strict(),
  },
  {
    name: "chien_dich",
    permission: "campaigns.view",
    label: "Xem chiến dịch",
    description: "Danh sách chiến dịch (chưa lưu trữ) với số người nhận, đã gửi, phản hồi, lỗi, đang chờ. Lọc theo kênh, tên, trạng thái.",
    parameters: {
      type: "object", additionalProperties: false, required: ["kenh", "tu_khoa", "trang_thai"],
      properties: {
        kenh: { type: "string", enum: ["TAT_CA", "EMAIL", "ZALO", "FACEBOOK_PROFILE"], description: "Kênh của chiến dịch." },
        tu_khoa: nullableString("Một phần tên chiến dịch, hoặc null."),
        trang_thai: { type: ["string", "null"], enum: ["DRAFT", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED", null], description: "Trạng thái, hoặc null cho mọi trạng thái." },
      },
    },
    args: z.object({
      kenh: z.enum(["TAT_CA", "EMAIL", "ZALO", "FACEBOOK_PROFILE"]),
      tu_khoa: text(100).nullable(),
      trang_thai: z.enum(["DRAFT", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED"]).nullable(),
    }).strict(),
  },
  {
    name: "thong_ke_gui_tin",
    permission: "analytics.view",
    label: "Xem thống kê gửi tin",
    description: "Tổng số lệnh gửi đa kênh: đã gửi, đang chờ, thất bại, chưa xác định, theo từng kênh (như trang Phân tích).",
    parameters: noArgs,
    args: z.object({}).strict(),
  },
  {
    name: "tim_lien_he",
    permission: "contacts.view",
    label: "Tìm liên hệ",
    description: "Tìm liên hệ theo tên, email, số điện thoại, chức danh, quốc gia hoặc nguồn; có thể lọc trạng thái lead. Trả về tối đa 10 kết quả và tổng số khớp.",
    parameters: {
      type: "object", additionalProperties: false, required: ["tu_khoa", "trang_thai_lead"],
      properties: {
        tu_khoa: nullableString("Từ khóa tìm, hoặc null để lấy liên hệ mới nhất."),
        trang_thai_lead: { type: ["string", "null"], enum: ["NEW", "CONTACTED", "ENGAGED", "QUALIFIED", "OPPORTUNITY", "WON", "LOST", "DO_NOT_CONTACT", null] },
      },
    },
    args: z.object({
      tu_khoa: text(100).nullable(),
      trang_thai_lead: z.enum(["NEW", "CONTACTED", "ENGAGED", "QUALIFIED", "OPPORTUNITY", "WON", "LOST", "DO_NOT_CONTACT"]).nullable(),
    }).strict(),
  },
  {
    name: "tim_cong_ty",
    permission: "companies.view",
    label: "Tìm công ty",
    description: "Tìm công ty theo tên hoặc website; trả về tối đa 10 công ty kèm số liên hệ.",
    parameters: { type: "object", additionalProperties: false, required: ["tu_khoa"], properties: { tu_khoa: { type: "string", description: "Tên hoặc website." } } },
    args: z.object({ tu_khoa: text(100).min(1) }).strict(),
  },
  {
    name: "cong_viec",
    permission: "tasks.view",
    label: "Xem công việc",
    description: "Công việc trong mục Công việc: đang mở, quá hạn, sắp tới hạn; có thể chỉ lấy việc giao cho người đang hỏi.",
    parameters: {
      type: "object", additionalProperties: false, required: ["chi_cua_toi", "bao_gom_da_xong"],
      properties: { chi_cua_toi: { type: "boolean" }, bao_gom_da_xong: { type: "boolean" } },
    },
    args: z.object({ chi_cua_toi: z.boolean(), bao_gom_da_xong: z.boolean() }).strict(),
  },
  {
    name: "kho_content",
    permission: "content.view",
    label: "Xem Kho content",
    description: "Kho content: tổng số, các yêu cầu tạo content 7 ngày qua và kết quả, tìm content theo mã/tiêu đề/job.",
    parameters: { type: "object", additionalProperties: false, required: ["tu_khoa"], properties: { tu_khoa: nullableString("Mã (CT-000001), tiêu đề hoặc tên job; null để xem tổng quan.") } },
    args: z.object({ tu_khoa: text(100).nullable() }).strict(),
  },
];

export const ASSISTANT_TOOL_NAMES = ASSISTANT_TOOLS.map((tool) => tool.name);

/** Tools this member may use. */
export function toolsFor(permissions: readonly string[], isAdmin: boolean): AssistantToolDefinition[] {
  return ASSISTANT_TOOLS.filter((tool) => tool.permission === "workspace.admin" ? isAdmin : permissions.includes(tool.permission));
}

/** Tool list in OpenAI Responses API format. */
export function openAiToolSpecs(tools: AssistantToolDefinition[]) {
  return tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: true }));
}

export type ParsedToolCall = { ok: true; tool: AssistantToolDefinition; args: Record<string, unknown> } | { ok: false; error: string };

/** Validates a model's function call against the tools this member may use. */
export function parseToolCall(name: string, rawArguments: string, allowed: AssistantToolDefinition[]): ParsedToolCall {
  const tool = allowed.find((item) => item.name === name);
  if (!tool) return { ok: false, error: "Công cụ không tồn tại hoặc người dùng không có quyền." };
  let json: unknown;
  try { json = rawArguments ? JSON.parse(rawArguments) : {}; } catch { return { ok: false, error: "Tham số không phải JSON hợp lệ." }; }
  const parsed = tool.args.safeParse(json);
  if (!parsed.success) return { ok: false, error: "Tham số không hợp lệ." };
  return { ok: true, tool, args: parsed.data as Record<string, unknown> };
}
