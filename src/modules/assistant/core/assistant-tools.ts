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
  /** Phase 2: the tool only creates a confirmation card; nothing changes until the member confirms. */
  proposal?: boolean;
}

const noArgs = { type: "object", additionalProperties: false, properties: {}, required: [] } as const;
const nullableString = (description: string) => ({ type: ["string", "null"], description });
const nullableInteger = (description: string) => ({ type: ["integer", "null"], description });

const text = (max: number) => z.string().trim().max(max);
const uuidArg = (description: string) => ({ type: "string", description });
const LEAD_STATUSES = ["NEW", "CONTACTED", "ENGAGED", "QUALIFIED", "OPPORTUNITY", "WON", "LOST", "DO_NOT_CONTACT"] as const;

// Phase 2 — proposals. Each creates a confirmation card only; the member presses "Xác nhận".
function PROPOSAL_TOOLS(): AssistantToolDefinition[] {
  return [
    {
      name: "de_xuat_tao_cong_viec",
      permission: "tasks.create",
      label: "Đề xuất tạo công việc",
      proposal: true,
      description: "ĐỀ XUẤT tạo một công việc (chỉ tạo thẻ xác nhận). Có thể gắn với một hội thoại và giao cho một thành viên theo tên.",
      parameters: {
        type: "object", additionalProperties: false, required: ["tieu_de", "han", "giao_cho", "conversation_id"],
        properties: {
          tieu_de: { type: "string", description: "Nội dung công việc, tối đa 240 ký tự." },
          han: { type: ["string", "null"], description: "Hạn theo giờ Việt Nam, dạng YYYY-MM-DD hoặc YYYY-MM-DD HH:mm; null nếu không có hạn." },
          giao_cho: { type: ["string", "null"], description: "Tên thành viên được giao; null = người đang hỏi." },
          conversation_id: { type: ["string", "null"], description: "UUID hội thoại liên quan, hoặc null." },
        },
      },
      args: z.object({ tieu_de: text(240).min(1), han: text(20).nullable(), giao_cho: text(100).nullable(), conversation_id: z.string().uuid().nullable() }).strict(),
    },
    {
      name: "de_xuat_doi_trang_thai_lead",
      permission: "contacts.update",
      label: "Đề xuất đổi trạng thái lead",
      proposal: true,
      description: "ĐỀ XUẤT đổi trạng thái lead của một liên hệ (lấy contact_id từ công cụ tim_lien_he hoặc trang đang mở).",
      parameters: {
        type: "object", additionalProperties: false, required: ["contact_id", "trang_thai_moi"],
        properties: { contact_id: uuidArg("UUID liên hệ."), trang_thai_moi: { type: "string", enum: [...LEAD_STATUSES] } },
      },
      args: z.object({ contact_id: z.string().uuid(), trang_thai_moi: z.enum(LEAD_STATUSES) }).strict(),
    },
    {
      name: "de_xuat_dieu_khien_chien_dich",
      permission: "campaigns.launch",
      label: "Đề xuất tạm dừng/tiếp tục chiến dịch",
      proposal: true,
      description: "ĐỀ XUẤT tạm dừng một chiến dịch đang chạy hoặc tiếp tục một chiến dịch đang tạm dừng (lấy id từ công cụ chien_dich). Không khởi chạy chiến dịch mới.",
      parameters: {
        type: "object", additionalProperties: false, required: ["kenh", "campaign_id", "hanh_dong"],
        properties: {
          kenh: { type: "string", enum: ["EMAIL", "ZALO", "FACEBOOK_PROFILE"] },
          campaign_id: uuidArg("UUID chiến dịch."),
          hanh_dong: { type: "string", enum: ["TAM_DUNG", "TIEP_TUC"] },
        },
      },
      args: z.object({ kenh: z.enum(["EMAIL", "ZALO", "FACEBOOK_PROFILE"]), campaign_id: z.string().uuid(), hanh_dong: z.enum(["TAM_DUNG", "TIEP_TUC"]) }).strict(),
    },
    {
      name: "de_xuat_tao_content",
      permission: "content.create",
      label: "Đề xuất tạo content",
      proposal: true,
      description: "ĐỀ XUẤT tạo content vào Kho content (như popup Tạo content). Dữ kiện chỉ lấy từ lời người dùng hoặc dữ liệu đã tra; trường không có thì để null.",
      parameters: {
        type: "object", additionalProperties: false,
        required: ["bo_phan", "ten_job", "vi_tri", "dia_diem", "ngoai_ngu", "ky_nang", "luong", "diem_noi_bat", "mo_ta_jd", "tu_khoa_cam", "ngon_ngu", "dinh_dang", "so_luong", "ma_mau"],
        properties: {
          bo_phan: { type: "string", enum: ["REC", "HR", "SALE", "CTV"] },
          ten_job: { type: "string" },
          vi_tri: { type: ["string", "null"] }, dia_diem: { type: ["string", "null"] }, ngoai_ngu: { type: ["string", "null"] },
          ky_nang: { type: ["string", "null"] }, luong: { type: ["string", "null"] }, diem_noi_bat: { type: ["string", "null"] },
          mo_ta_jd: { type: ["string", "null"] }, tu_khoa_cam: { type: ["string", "null"] },
          ngon_ngu: { type: "string", enum: ["VI", "EN", "VI_EN", "VI_JA", "EN_JA"] },
          dinh_dang: { type: "string", enum: ["POST", "EMAIL", "ESSAY_100", "SUMMARY_50", "STORY"] },
          so_luong: { type: "integer", description: "1–10." },
          ma_mau: { type: "array", items: { type: "string" }, description: "Mã mẫu trong Kho mẫu (tối đa 5), [] để hệ thống tự chọn." },
        },
      },
      args: z.object({
        bo_phan: z.enum(["REC", "HR", "SALE", "CTV"]), ten_job: text(200).min(1),
        vi_tri: text(200).nullable(), dia_diem: text(200).nullable(), ngoai_ngu: text(200).nullable(), ky_nang: text(1000).nullable(),
        luong: text(200).nullable(), diem_noi_bat: text(2000).nullable(), mo_ta_jd: text(8000).nullable(), tu_khoa_cam: text(1000).nullable(),
        ngon_ngu: z.enum(["VI", "EN", "VI_EN", "VI_JA", "EN_JA"]), dinh_dang: z.enum(["POST", "EMAIL", "ESSAY_100", "SUMMARY_50", "STORY"]),
        so_luong: z.number().int().min(1).max(10), ma_mau: z.array(text(60)).max(5),
      }).strict(),
    },
    {
      name: "de_xuat_dung_ai_recruiter",
      permission: "workspace.admin",
      label: "Đề xuất dừng AI Recruiter",
      proposal: true,
      description: "ĐỀ XUẤT đưa AI Recruiter về chế độ an toàn: chuyển một bot hoặc một hội thoại sang DRAFT (AI không tự gửi), hoặc dừng khẩn cấp một bot. Không bao giờ bật AUTO.",
      parameters: {
        type: "object", additionalProperties: false, required: ["doi_tuong", "id", "hanh_dong"],
        properties: {
          doi_tuong: { type: "string", enum: ["BOT", "HOI_THOAI"] },
          id: uuidArg("UUID bot (từ trang_thai_ai_recruiter) hoặc hội thoại."),
          hanh_dong: { type: "string", enum: ["CHUYEN_DRAFT", "DUNG_KHAN_CAP"], description: "DUNG_KHAN_CAP chỉ dùng cho BOT." },
        },
      },
      args: z.object({ doi_tuong: z.enum(["BOT", "HOI_THOAI"]), id: z.string().uuid(), hanh_dong: z.enum(["CHUYEN_DRAFT", "DUNG_KHAN_CAP"]) }).strict()
        .refine((value) => !(value.doi_tuong === "HOI_THOAI" && value.hanh_dong === "DUNG_KHAN_CAP")),
    },
  ];
}

/**
 * "2026-10-15" or "2026-10-15 17:30" in Vietnam time → ISO timestamp. A date alone means 17:30.
 * Null when the text is not a valid date.
 */
export function parseVietnamDue(textValue: string | null): string | null {
  if (!textValue) return null;
  const match = textValue.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  if (!match) return null;
  const [year, month, day, hour, minute] = [match[1], match[2], match[3], match[4] ?? "17", match[5] ?? "30"].map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute)).toISOString();
}

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
    name: "kho_mau_content",
    permission: "content.view",
    label: "Xem Kho mẫu",
    description: "Danh sách mẫu content đang dùng (mã mẫu, bộ phận, nhóm, ngôn ngữ, đoạn đầu) để chọn mẫu khi tạo content.",
    parameters: { type: "object", additionalProperties: false, required: ["bo_phan"], properties: { bo_phan: { type: ["string", "null"], enum: ["REC", "HR", "SALE", "CTV", null], description: "Lọc theo bộ phận, hoặc null." } } },
    args: z.object({ bo_phan: z.enum(["REC", "HR", "SALE", "CTV"]).nullable() }).strict(),
  },
  {
    name: "kho_content",
    permission: "content.view",
    label: "Xem Kho content",
    description: "Kho content: tổng số, các yêu cầu tạo content 7 ngày qua và kết quả, tìm content theo mã/tiêu đề/job.",
    parameters: { type: "object", additionalProperties: false, required: ["tu_khoa"], properties: { tu_khoa: nullableString("Mã (CT-000001), tiêu đề hoặc tên job; null để xem tổng quan.") } },
    args: z.object({ tu_khoa: text(100).nullable() }).strict(),
  },
 ...PROPOSAL_TOOLS(),
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
