// Read-only tools of "Trợ lý HireX" (phase 1). Each tool needs a workspace permission, so a
// member only gets the tools for data they can already open in the web app. Pure module:
// definitions, argument validation and permission filtering are unit-tested.
import { z } from "zod";
import { PAGE_KEYS } from "./page-links.ts";

type JsonSchema = Record<string, unknown>;

export interface AssistantToolDefinition {
  name: string;
  /** Permission the signed-in member must hold. "workspace.admin" = system administrator role; "*" = every member. */
  permission: string;
  description: string;
  parameters: JsonSchema;
  args: z.ZodType;
  /** Short Vietnamese label shown in the panel while the tool runs. */
  label: string;
  /** Phase 2: the tool only creates a confirmation card; nothing changes until the member confirms. */
  proposal?: boolean;
  /** Reads the document library: only offered when the admin switched on "Tài liệu" in the panel. */
  documents?: boolean;
  /** Longer output than MAX_TOOL_OUTPUT_CHARS (document passages). */
  maxOutputChars?: number;
}

const noArgs = { type: "object", additionalProperties: false, properties: {}, required: [] } as const;
const nullableString = (description: string) => ({ type: ["string", "null"], description });
const nullableInteger = (description: string) => ({ type: ["integer", "null"], description });

const text = (max: number) => z.string().trim().max(max);
const uuidArg = (description: string) => ({ type: "string", description });
const LEAD_STATUSES = ["NEW", "CONTACTED", "ENGAGED", "QUALIFIED", "OPPORTUNITY", "WON", "LOST", "DO_NOT_CONTACT"] as const;

// Phase 3 — proposals for Liên hệ, Công ty, Công việc (assistant-proposals-crm.ts). For "sửa" tools a
// field of null keeps the current value and "" clears it.
const keepOrSet = (description: string) => ({ type: ["string", "null"], description: `${description} null = giữ nguyên, "" = xoá.` });
function CRM_PROPOSAL_TOOLS(): AssistantToolDefinition[] {
  const leadStatus = { type: ["string", "null"], enum: [...LEAD_STATUSES, null] };
  return [
    {
      name: "de_xuat_tao_lien_he",
      permission: "contacts.create",
      label: "Đề xuất tạo liên hệ",
      proposal: true,
      description: "ĐỀ XUẤT tạo một liên hệ mới (chỉ tạo thẻ xác nhận). Hệ thống từ chối nếu email đã có ở liên hệ khác và cảnh báo khi trùng SĐT. cong_ty là tên một công ty đã có.",
      parameters: {
        type: "object", additionalProperties: false, required: ["ho_ten", "chuc_danh", "email", "sdt", "cong_ty", "quoc_gia", "nguon", "trang_thai_lead"],
        properties: {
          ho_ten: { type: "string" }, chuc_danh: nullableString("Chức danh, hoặc null."), email: nullableString("Email, hoặc null."), sdt: nullableString("Số điện thoại, hoặc null."),
          cong_ty: nullableString("Tên công ty đã có trong hệ thống, hoặc null."), quoc_gia: nullableString("Quốc gia, hoặc null."),
          nguon: nullableString("Nguồn (ví dụ LinkedIn, giới thiệu), hoặc null."), trang_thai_lead: { ...leadStatus, description: "Mặc định NEW." },
        },
      },
      args: z.object({
        ho_ten: text(200).min(1), chuc_danh: text(200).nullable(), email: text(320).nullable(), sdt: text(50).nullable(), cong_ty: text(200).nullable(),
        quoc_gia: text(120).nullable(), nguon: text(120).nullable(), trang_thai_lead: z.enum(LEAD_STATUSES).nullable(),
      }).strict(),
    },
    {
      name: "de_xuat_sua_lien_he",
      permission: "contacts.update",
      label: "Đề xuất sửa liên hệ",
      proposal: true,
      description: "ĐỀ XUẤT sửa thông tin một liên hệ (chỉ tạo thẻ xác nhận, hiện giá trị cũ → mới). Đổi trạng thái lead dùng de_xuat_doi_trang_thai_lead.",
      parameters: {
        type: "object", additionalProperties: false, required: ["contact_id", "ho_ten", "chuc_danh", "email", "sdt", "quoc_gia", "ngon_ngu", "nguon", "cong_ty", "diem_lead"],
        properties: {
          contact_id: uuidArg("UUID liên hệ."),
          ho_ten: { type: ["string", "null"], description: "Họ tên mới, null = giữ nguyên." }, chuc_danh: keepOrSet("Chức danh."), email: keepOrSet("Email."), sdt: keepOrSet("SĐT."),
          quoc_gia: keepOrSet("Quốc gia."), ngon_ngu: keepOrSet("Ngôn ngữ."), nguon: keepOrSet("Nguồn."),
          cong_ty: nullableString("Tên công ty mới (đã có trong hệ thống), null = giữ nguyên."), diem_lead: nullableInteger("Điểm lead 0–100, null = giữ nguyên."),
        },
      },
      args: z.object({
        contact_id: z.string().uuid(), ho_ten: text(200).nullable(), chuc_danh: text(200).nullable(), email: text(320).nullable(), sdt: text(50).nullable(),
        quoc_gia: text(120).nullable(), ngon_ngu: text(80).nullable(), nguon: text(120).nullable(), cong_ty: text(200).nullable(), diem_lead: z.number().int().min(0).max(100).nullable(),
      }).strict(),
    },
    {
      name: "de_xuat_ghi_chu_lien_he",
      permission: "contacts.update",
      label: "Đề xuất thêm ghi chú",
      proposal: true,
      description: "ĐỀ XUẤT thêm một ghi chú nội bộ vào liên hệ (chỉ tạo thẻ; người dùng sửa được nội dung trên thẻ trước khi lưu).",
      parameters: { type: "object", additionalProperties: false, required: ["contact_id", "noi_dung"], properties: { contact_id: uuidArg("UUID liên hệ."), noi_dung: { type: "string", description: "Nội dung ghi chú, tối đa 5000 ký tự." } } },
      args: z.object({ contact_id: z.string().uuid(), noi_dung: text(5000).min(1) }).strict(),
    },
    {
      name: "de_xuat_tao_cong_ty",
      permission: "companies.create",
      label: "Đề xuất tạo công ty",
      proposal: true,
      description: "ĐỀ XUẤT tạo công ty mới (chỉ tạo thẻ xác nhận). Hệ thống từ chối khi đã có công ty cùng tên hoặc cùng website.",
      parameters: {
        type: "object", additionalProperties: false, required: ["ten", "website", "nganh", "quoc_gia", "trang_thai"],
        properties: {
          ten: { type: "string" }, website: nullableString("Website, hoặc null."), nganh: nullableString("Ngành, hoặc null."), quoc_gia: nullableString("Quốc gia, hoặc null."),
          trang_thai: { type: ["string", "null"], enum: ["ACTIVE", "PROSPECT", "INACTIVE", null], description: "ACTIVE = đang hợp tác, PROSPECT = tiềm năng (mặc định), INACTIVE = ngừng." },
        },
      },
      args: z.object({ ten: text(200).min(1), website: text(500).nullable(), nganh: text(120).nullable(), quoc_gia: text(120).nullable(), trang_thai: z.enum(["ACTIVE", "PROSPECT", "INACTIVE"]).nullable() }).strict(),
    },
    {
      name: "de_xuat_sua_cong_ty",
      permission: "companies.update",
      label: "Đề xuất sửa công ty",
      proposal: true,
      description: "ĐỀ XUẤT sửa thông tin một công ty (id từ tim_cong_ty; chỉ tạo thẻ, hiện cũ → mới).",
      parameters: {
        type: "object", additionalProperties: false, required: ["company_id", "ten", "website", "nganh", "quoc_gia", "trang_thai"],
        properties: {
          company_id: uuidArg("UUID công ty."), ten: { type: ["string", "null"], description: "Tên mới, null = giữ nguyên." }, website: keepOrSet("Website."), nganh: keepOrSet("Ngành."), quoc_gia: keepOrSet("Quốc gia."),
          trang_thai: { type: ["string", "null"], enum: ["ACTIVE", "PROSPECT", "INACTIVE", null] },
        },
      },
      args: z.object({ company_id: z.string().uuid(), ten: text(200).nullable(), website: text(500).nullable(), nganh: text(120).nullable(), quoc_gia: text(120).nullable(), trang_thai: z.enum(["ACTIVE", "PROSPECT", "INACTIVE"]).nullable() }).strict(),
    },
    {
      name: "de_xuat_cap_nhat_cong_viec",
      permission: "tasks.update",
      label: "Đề xuất cập nhật công việc",
      proposal: true,
      description: "ĐỀ XUẤT cập nhật một công việc (id từ cong_viec): đổi trạng thái (hoàn thành, đang làm, mở lại, huỷ), hạn, người được giao hoặc tiêu đề. Chỉ tạo thẻ xác nhận.",
      parameters: {
        type: "object", additionalProperties: false, required: ["task_id", "trang_thai", "han", "giao_cho", "tieu_de"],
        properties: {
          task_id: uuidArg("UUID công việc."),
          trang_thai: { type: ["string", "null"], enum: ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED", null] },
          han: { type: ["string", "null"], description: "Hạn mới (giờ Việt Nam) YYYY-MM-DD hoặc YYYY-MM-DD HH:mm; \"\" = bỏ hạn; null = giữ nguyên." },
          giao_cho: nullableString("Tên thành viên được giao mới, hoặc null."),
          tieu_de: nullableString("Tiêu đề mới, hoặc null."),
        },
      },
      args: z.object({ task_id: z.string().uuid(), trang_thai: z.enum(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).nullable(), han: text(20).nullable(), giao_cho: text(100).nullable(), tieu_de: text(240).nullable() }).strict(),
    },
  ];
}

// Phase 3b — one attached recipient file → N draft email campaigns (assistant-proposals-campaigns.ts).
function CAMPAIGN_PROPOSAL_TOOLS(): AssistantToolDefinition[] {
  return [{
    name: "de_xuat_tao_chien_dich_email",
    permission: "campaigns.create",
    label: "Đề xuất tạo chiến dịch Email (bản nháp)",
    proposal: true,
    description: "ĐỀ XUẤT tạo 1–10 chiến dịch Email dạng BẢN NHÁP từ file danh sách người dùng đã đính kèm (upload_id trong ngữ cảnh). File được chia đều theo thứ tự; hộp Gmail của thành viên hop_mail_cua được chia riêng cho từng chiến dịch (không hộp nào dùng cho 2 chiến dịch); mỗi chiến dịch lấy 1 content dạng Mail chưa dùng trong Kho (hoặc theo ma_content). Chỉ tạo 1 thẻ xác nhận cho tất cả; không gửi email nào.",
    parameters: {
      type: "object", additionalProperties: false, required: ["upload_id", "so_chien_dich", "ten_chien_dich", "hop_mail_cua", "nguoi_phu_trach", "ma_content", "bo_phan", "ngon_ngu"],
      properties: {
        upload_id: uuidArg("Id file đính kèm (từ ngữ cảnh)."),
        so_chien_dich: { type: "integer", description: "Số chiến dịch cần chia (1–10)." },
        ten_chien_dich: nullableString("Tên chung; hệ thống thêm \"— Phần i/N\". null = theo tên file."),
        hop_mail_cua: { type: "string", description: "Tên thành viên có các hộp Gmail dùng để gửi." },
        nguoi_phu_trach: nullableString("Tên người phụ trách; null = chính thành viên hop_mail_cua."),
        ma_content: { type: "array", items: { type: "string" }, description: "Mã content Mail (CT-…) theo thứ tự chiến dịch, đúng bằng số chiến dịch; [] = tự lấy content Mail chưa dùng mới nhất." },
        bo_phan: { type: ["string", "null"], enum: ["SALE", "HR", "REC", "MEDIA", "NOTICE", "CTV", null], description: "Lọc content tự lấy theo bộ phận, hoặc null." },
        ngon_ngu: { type: ["string", "null"], enum: ["VI", "EN", "JA", "VI_EN", "VI_JA", "EN_JA", null], description: "Lọc content tự lấy theo ngôn ngữ, hoặc null." },
      },
    },
    args: z.object({
      upload_id: z.string().uuid(), so_chien_dich: z.number().int().min(1).max(10), ten_chien_dich: text(180).nullable(), hop_mail_cua: text(100).min(1),
      nguoi_phu_trach: text(100).nullable(), ma_content: z.array(text(20)).max(10), bo_phan: z.enum(["SALE", "HR", "REC", "MEDIA", "NOTICE", "CTV"]).nullable(),
      ngon_ngu: z.enum(["VI", "EN", "JA", "VI_EN", "VI_JA", "EN_JA"]).nullable(),
    }).strict(),
  }];
}

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
          bo_phan: { type: "string", enum: ["SALE", "HR", "REC", "MEDIA", "NOTICE", "CTV"], description: "SALE = Sale, HR = Tuyển nội bộ, REC = Tuyển dự án, MEDIA = Truyền thông, NOTICE = Thông báo, CTV = Cộng tác viên." },
          ten_job: { type: "string" },
          vi_tri: { type: ["string", "null"] }, dia_diem: { type: ["string", "null"] }, ngoai_ngu: { type: ["string", "null"] },
          ky_nang: { type: ["string", "null"] }, luong: { type: ["string", "null"] }, diem_noi_bat: { type: ["string", "null"] },
          mo_ta_jd: { type: ["string", "null"] }, tu_khoa_cam: { type: ["string", "null"] },
          ngon_ngu: { type: "string", enum: ["VI", "EN", "JA", "VI_EN", "VI_JA", "EN_JA"] },
          dinh_dang: { type: "string", enum: ["EMAIL", "POST_LONG", "POST_MEDIUM", "POST_SHORT", "COMMENT"], description: "EMAIL = Mail, POST_LONG = Đăng chi tiết, POST_MEDIUM = Đăng trung bình, POST_SHORT = Đăng vắn, COMMENT = Comment." },
          so_luong: { type: "integer", description: "1–10." },
          ma_mau: { type: "array", items: { type: "string" }, description: "Mã mẫu trong Kho mẫu (tối đa 5), [] để hệ thống tự chọn." },
        },
      },
      args: z.object({
        bo_phan: z.enum(["SALE", "HR", "REC", "MEDIA", "NOTICE", "CTV"]), ten_job: text(200).min(1),
        vi_tri: text(200).nullable(), dia_diem: text(200).nullable(), ngoai_ngu: text(200).nullable(), ky_nang: text(1000).nullable(),
        luong: text(200).nullable(), diem_noi_bat: text(2000).nullable(), mo_ta_jd: text(8000).nullable(), tu_khoa_cam: text(1000).nullable(),
        ngon_ngu: z.enum(["VI", "EN", "JA", "VI_EN", "VI_JA", "EN_JA"]), dinh_dang: z.enum(["EMAIL", "POST_LONG", "POST_MEDIUM", "POST_SHORT", "COMMENT"]),
        so_luong: z.number().int().min(1).max(10), ma_mau: z.array(text(60)).max(5),
      }).strict(),
    },
    {
      name: "de_xuat_tra_loi_hoi_thoai",
      permission: "inbox.reply",
      label: "Đề xuất gửi trả lời",
      proposal: true,
      description: "ĐỀ XUẤT gửi MỘT tin trả lời trong một hội thoại Zalo / Facebook Page / Facebook cá nhân (chỉ tạo thẻ xác nhận; người dùng có thể sửa nội dung trên thẻ trước khi bấm Xác nhận). Lấy conversation_id từ trang đang mở, tim_hoi_thoai, hoi_thoai_cho_tra_loi hoặc chi_tiet_hoi_thoai. Chỉ dùng khi người dùng yêu cầu rõ việc trả lời/gửi tin.",
      parameters: {
        type: "object", additionalProperties: false, required: ["conversation_id", "noi_dung"],
        properties: {
          conversation_id: uuidArg("UUID hội thoại."),
          noi_dung: { type: "string", description: "Nội dung tin sẽ gửi, đúng như sẽ hiện với khách. Không có ký hiệu Markdown, tối đa 2000 ký tự." },
        },
      },
      args: z.object({ conversation_id: z.string().uuid(), noi_dung: text(2000).min(1) }).strict(),
    },
    {
      name: "de_xuat_tao_quy_tac",
      permission: "dashboard.view",
      label: "Đề xuất tạo quy tắc tự động",
      proposal: true,
      description: "ĐỀ XUẤT tạo một quy tắc tự động (chỉ tạo thẻ xác nhận). Hệ thống kiểm tra 5 phút một lần; quy tắc chỉ gửi thông báo vào chuông hoặc kèm đề xuất tạo công việc mà người nhận phải bấm Xác nhận. Điều kiện hỗ trợ: CUSTOMER_WAITING (khách nhắn riêng chờ trả lời quá so_gio giờ, lọc theo kenh), TASK_OVERDUE (công việc quá hạn hơn so_gio giờ, chỉ NOTIFY), LEAD_STALE (lead trạng thái Mới tạo quá so_ngay ngày). gui_cho: OWNER = người đang hỏi; RESPONSIBLE = người phụ trách; ADMINS = quản trị viên (RESPONSIBLE/ADMINS chỉ quản trị viên được chọn).",
      parameters: {
        type: "object", additionalProperties: false, required: ["ten", "dieu_kien", "so_gio", "so_ngay", "kenh", "hanh_dong", "gui_cho", "han_cong_viec_gio"],
        properties: {
          ten: { type: "string", description: "Tên ngắn của quy tắc, tối đa 120 ký tự." },
          dieu_kien: { type: "string", enum: ["CUSTOMER_WAITING", "TASK_OVERDUE", "LEAD_STALE"] },
          so_gio: { type: ["number", "null"], description: "Số giờ (CUSTOMER_WAITING 1–72, TASK_OVERDUE 0–168), null nếu không dùng." },
          so_ngay: { type: ["integer", "null"], description: "Số ngày cho LEAD_STALE (1–60), null nếu không dùng." },
          kenh: { type: "array", items: { type: "string", enum: ["ZALO", "FACEBOOK", "FACEBOOK_PROFILE", "EMAIL"] }, description: "Chỉ áp dụng các kênh này (CUSTOMER_WAITING); [] = mọi kênh." },
          hanh_dong: { type: "string", enum: ["NOTIFY", "PROPOSE_TASK"] },
          gui_cho: { type: "string", enum: ["OWNER", "RESPONSIBLE", "ADMINS"] },
          han_cong_viec_gio: { type: ["integer", "null"], description: "Hạn của công việc được đề xuất, tính bằng giờ (0–72); null = mặc định." },
        },
      },
      args: z.object({
        ten: text(120).min(1), dieu_kien: z.enum(["CUSTOMER_WAITING", "TASK_OVERDUE", "LEAD_STALE"]),
        so_gio: z.number().min(0).max(168).nullable(), so_ngay: z.number().int().min(1).max(60).nullable(),
        kenh: z.array(z.enum(["ZALO", "FACEBOOK", "FACEBOOK_PROFILE", "EMAIL"])).max(4),
        hanh_dong: z.enum(["NOTIFY", "PROPOSE_TASK"]), gui_cho: z.enum(["OWNER", "RESPONSIBLE", "ADMINS"]), han_cong_viec_gio: z.number().int().min(0).max(72).nullable(),
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

// Phase 2 — read tools for the rest of the app (details behind the list tools, and links to pages).
const FORMATS = ["EMAIL", "POST_LONG", "POST_MEDIUM", "POST_SHORT", "COMMENT"] as const;
const DEPARTMENTS = ["SALE", "HR", "REC", "MEDIA", "NOTICE", "CTV"] as const;
const LANGUAGES = ["VI", "EN", "JA", "VI_EN", "VI_JA", "EN_JA"] as const;
function READ_TOOLS_2(): AssistantToolDefinition[] {
  return [
    {
      name: "mo_trang",
      permission: "*",
      label: "Mở trang",
      description: "Lấy link tới một trang của hệ thống (có thể lọc sẵn) để người dùng bấm mở. Chỉ trả link khi người dùng có quyền mở trang đó. Lọc được: LIEN_HE (tu_khoa, trang_thai = trạng thái lead), CHIEN_DICH_EMAIL (tu_khoa, trang_thai), HO_CHUA (kenh), KHO_CONTENT (tu_khoa, dinh_dang, bo_phan, ngon_ngu), TAI_LIEU (tu_khoa). Trang khác chỉ mở trang.",
      parameters: {
        type: "object", additionalProperties: false, required: ["trang", "tu_khoa", "trang_thai", "kenh", "dinh_dang", "bo_phan", "ngon_ngu"],
        properties: {
          trang: { type: "string", enum: [...PAGE_KEYS] },
          tu_khoa: nullableString("Từ khóa lọc, hoặc null."),
          trang_thai: nullableString("Trạng thái lead (NEW, QUALIFIED…) hoặc trạng thái chiến dịch (RUNNING, PAUSED…), hoặc null."),
          kenh: { type: ["string", "null"], enum: ["ZALO", "FACEBOOK", "FACEBOOK_PROFILE", "EMAIL", null] },
          dinh_dang: { type: ["string", "null"], enum: [...FORMATS, null] },
          bo_phan: { type: ["string", "null"], enum: [...DEPARTMENTS, null] },
          ngon_ngu: { type: ["string", "null"], enum: [...LANGUAGES, null] },
        },
      },
      args: z.object({
        trang: z.enum(PAGE_KEYS as [string, ...string[]]), tu_khoa: text(100).nullable(), trang_thai: text(30).nullable(),
        kenh: z.enum(["ZALO", "FACEBOOK", "FACEBOOK_PROFILE", "EMAIL"]).nullable(), dinh_dang: z.enum(FORMATS).nullable(), bo_phan: z.enum(DEPARTMENTS).nullable(), ngon_ngu: z.enum(LANGUAGES).nullable(),
      }).strict(),
    },
    {
      name: "chi_tiet_lien_he",
      permission: "contacts.view",
      label: "Xem chi tiết liên hệ",
      description: "Chi tiết một liên hệ (id từ tim_lien_he hoặc trang đang mở): thông tin, công ty, các kênh liên lạc và đồng ý nhận marketing, ghi chú gần đây, hội thoại trong Suối Nguồn, công việc liên quan, chiến dịch đã nhận (phần nào người dùng không có quyền xem thì bỏ qua).",
      parameters: { type: "object", additionalProperties: false, required: ["contact_id"], properties: { contact_id: uuidArg("UUID liên hệ.") } },
      args: z.object({ contact_id: z.string().uuid() }).strict(),
    },
    {
      name: "chi_tiet_cong_ty",
      permission: "companies.view",
      label: "Xem chi tiết công ty",
      description: "Chi tiết một công ty (id từ tim_cong_ty): thông tin, ghi chú, số liên hệ theo trạng thái lead và tối đa 15 liên hệ mới nhất (nếu được xem liên hệ).",
      parameters: { type: "object", additionalProperties: false, required: ["company_id"], properties: { company_id: uuidArg("UUID công ty.") } },
      args: z.object({ company_id: z.string().uuid() }).strict(),
    },
    {
      name: "chi_tiet_chien_dich",
      permission: "campaigns.view",
      label: "Xem chi tiết chiến dịch",
      description: "Chi tiết một chiến dịch (id từ chien_dich hoặc trang đang mở): trạng thái, mốc thời gian, các bước gửi và nội dung (rút gọn), số người nhận theo trạng thái, lỗi thường gặp, tài khoản gửi, content đã lấy từ Kho. kenh null = tự dò.",
      parameters: {
        type: "object", additionalProperties: false, required: ["campaign_id", "kenh"],
        properties: { campaign_id: uuidArg("UUID chiến dịch."), kenh: { type: ["string", "null"], enum: ["EMAIL", "ZALO", "FACEBOOK_PROFILE", null] } },
      },
      args: z.object({ campaign_id: z.string().uuid(), kenh: z.enum(["EMAIL", "ZALO", "FACEBOOK_PROFILE"]).nullable() }).strict(),
    },
    {
      name: "doc_content",
      permission: "content.view",
      label: "Đọc content",
      description: "Đọc đầy đủ một content trong Kho content theo mã (CT-000123): tiêu đề, nội dung, định dạng, bộ phận, phân loại, ngôn ngữ, job, đã dùng cho chiến dịch nào chưa.",
      parameters: { type: "object", additionalProperties: false, required: ["ma"], properties: { ma: { type: "string", description: "Mã content, ví dụ CT-000123." } } },
      args: z.object({ ma: text(40).min(1) }).strict(),
    },
    {
      name: "content_chua_dung",
      permission: "content.view",
      label: "Tìm content chưa dùng",
      description: "Content trong Kho chưa dùng cho chiến dịch nào (mỗi content chỉ dùng cho 1 chiến dịch), lọc theo định dạng, bộ phận, ngôn ngữ; mới nhất trước.",
      parameters: {
        type: "object", additionalProperties: false, required: ["dinh_dang", "bo_phan", "ngon_ngu", "so_luong"],
        properties: {
          dinh_dang: { type: ["string", "null"], enum: [...FORMATS, null] },
          bo_phan: { type: ["string", "null"], enum: [...DEPARTMENTS, null] },
          ngon_ngu: { type: ["string", "null"], enum: [...LANGUAGES, null] },
          so_luong: nullableInteger("Số content tối đa (mặc định 10, tối đa 30)."),
        },
      },
      args: z.object({ dinh_dang: z.enum(FORMATS).nullable(), bo_phan: z.enum(DEPARTMENTS).nullable(), ngon_ngu: z.enum(LANGUAGES).nullable(), so_luong: z.number().int().min(1).max(30).nullable() }).strict(),
    },
    {
      name: "thanh_vien_vai_tro",
      permission: "roles.view",
      label: "Xem thành viên và vai trò",
      description: "Thành viên trong không gian làm việc, vai trò của từng người, phạm vi tài khoản kết nối được cấp, và danh sách vai trò với các quyền.",
      parameters: noArgs,
      args: z.object({}).strict(),
    },
  ];
}

// Document library ("Tài liệu", imported from Human): administrators only. Reading only; the text
// goes to OpenAI, so the admin switches it on in the panel first.
function DOCUMENT_TOOLS(): AssistantToolDefinition[] {
  return [
    {
      name: "tim_tai_lieu",
      permission: "documents.view",
      documents: true,
      label: "Tìm tài liệu",
      description: "Tìm trong Thư viện tài liệu theo tên, nhóm/thư mục và nội dung; trả về tối đa 15 tài liệu khớp nhất (id, tên, nhóm, thư mục, đoạn khớp, link) và tổng số khớp. Không có từ khóa = tổng quan thư viện (số tài liệu, các nhóm và số tài liệu mỗi nhóm).",
      parameters: {
        type: "object", additionalProperties: false, required: ["tu_khoa", "nhom"],
        properties: {
          tu_khoa: nullableString("Từ khóa hoặc tên tài liệu (tiếng Việt có/không dấu), hoặc null."),
          nhom: nullableString("Một phần tên nhóm/thư mục để lọc, hoặc null."),
        },
      },
      args: z.object({ tu_khoa: text(200).nullable(), nhom: text(200).nullable() }).strict(),
      maxOutputChars: 16_000,
    },
    {
      name: "doc_tai_lieu",
      permission: "documents.view",
      documents: true,
      label: "Đọc tài liệu",
      description: "Đọc nội dung một tài liệu theo id (lấy từ tim_tai_lieu). Có tu_khoa: trả về tối đa 4 đoạn liên quan nhất trong tài liệu. Không có tu_khoa: đọc theo phần, mỗi phần 6.000 ký tự (phan = 1, 2, …).",
      parameters: {
        type: "object", additionalProperties: false, required: ["document_id", "tu_khoa", "phan"],
        properties: {
          document_id: { type: "integer", description: "Id tài liệu (số)." },
          tu_khoa: nullableString("Điều cần tìm trong tài liệu, hoặc null để đọc theo phần."),
          phan: nullableInteger("Phần cần đọc (mặc định 1)."),
        },
      },
      args: z.object({ document_id: z.number().int().positive(), tu_khoa: text(300).nullable(), phan: z.number().int().min(1).max(500).nullable() }).strict(),
      maxOutputChars: 14_000,
    },
    {
      name: "hoi_tai_lieu",
      permission: "documents.view",
      documents: true,
      label: "Hỏi tài liệu (có kiểm tra trích dẫn)",
      description: "Hỏi đáp/tổng hợp trên Thư viện tài liệu bằng bộ hỏi đáp riêng có kiểm tra trích dẫn nguyên văn (chậm hơn, 10–90 giây). Dùng cho câu cần tổng hợp nhiều tài liệu, \"tổng hợp/tóm tắt <thư mục hoặc nhóm>\", hoặc khi cần câu trả lời có trích dẫn đã kiểm tra. Có thể giới hạn trong một tài liệu bằng document_id.",
      parameters: {
        type: "object", additionalProperties: false, required: ["cau_hoi", "document_id"],
        properties: {
          cau_hoi: { type: "string", description: "Câu hỏi đầy đủ, tiếng Việt. Muốn tổng hợp thư mục thì bắt đầu bằng \"Tổng hợp <tên thư mục>\"." },
          document_id: nullableInteger("Chỉ hỏi trong tài liệu này, hoặc null."),
        },
      },
      args: z.object({ cau_hoi: text(1200).min(3), document_id: z.number().int().positive().nullable() }).strict(),
    },
  ];
}

// Round A for Soda (Zalo): job board, Luồng Rec candidates and KPI. Read only.
const KPI_SCOPES = ["TOI", "TEAM", "CONG_TY", "NGUOI"] as const;
const KPI_PERIODS = ["HOM_NAY", "HOM_QUA", "TUAN_NAY", "TUAN_TRUOC", "THANG_NAY", "THANG_TRUOC", "7_NGAY", "30_NGAY"] as const;
const JOB_STATUS_ARGS = ["OPEN", "PAUSED", "CLOSED", "TAT_CA"] as const;
const REC_RESULTS = ["DANG_TU_VAN", "CV_RECEIVED", "NEED_OTHER_JOB", "NOT_INTERESTED"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
function CRM_READ_TOOLS(): AssistantToolDefinition[] {
  return [
    {
      name: "bang_job",
      permission: "jobs.view",
      label: "Xem bảng job",
      description: "Bảng job tuyển dụng: mã job, vị trí, hướng nghề, công ty (và có được nói tên công ty với ứng viên không), địa điểm, hình thức, tiếng Nhật, kinh nghiệm, lương, điểm mạnh, yêu cầu, quy trình phỏng vấn, link JD, ưu tiên, người phụ trách. Mặc định chỉ job đang mở. Có job_code: trả chi tiết đầy đủ một job.",
      parameters: {
        type: "object", additionalProperties: false, required: ["tu_khoa", "trang_thai", "job_code", "so_luong"],
        properties: {
          tu_khoa: nullableString("Từ khoá: vị trí, hướng nghề (BrSE, PM, Dev…), công ty, địa điểm (Hà Nội, HCM, Nhật…), tiếng Nhật (N2…); hoặc null."),
          trang_thai: { type: ["string", "null"], enum: [...JOB_STATUS_ARGS, null], description: "OPEN (mặc định), PAUSED, CLOSED hoặc TAT_CA." },
          job_code: nullableString("Mã job để xem chi tiết một job, hoặc null."),
          so_luong: nullableInteger("Số job tối đa (mặc định 20, tối đa 50)."),
        },
      },
      args: z.object({ tu_khoa: text(120).nullable(), trang_thai: z.enum(JOB_STATUS_ARGS).nullable(), job_code: text(40).nullable(), so_luong: z.number().int().min(1).max(50).nullable() }).strict(),
      maxOutputChars: 14_000,
    },
    {
      name: "ung_vien_rec",
      permission: "inbox.view",
      label: "Xem ứng viên Luồng Rec",
      description: "Ứng viên đang đi theo Luồng Rec 8 bước (1 Chào … 7 Xin CV, 8 Nhận CV) trên các nick người dùng được xem: bước hiện tại, thông tin ứng viên đã nói (hướng nghề, khu vực, tiếng Nhật, kinh nghiệm, lương mong muốn…), job đã giới thiệu/từ chối, kết quả (Đã có CV / Cần job khác / Không quan tâm), người cập nhật, link hội thoại; kèm thống kê theo bước và kết quả.",
      parameters: {
        type: "object", additionalProperties: false, required: ["tu_khoa", "buoc", "ket_qua", "so_ngay", "chi_cua_toi"],
        properties: {
          tu_khoa: nullableString("Tên ứng viên hoặc thông tin (BrSE, N2, Hà Nội…), hoặc null."),
          buoc: nullableInteger("Chỉ ứng viên đang ở bước này (1–8), hoặc null."),
          ket_qua: { type: ["string", "null"], enum: [...REC_RESULTS, null], description: "DANG_TU_VAN (chưa có kết quả), CV_RECEIVED, NEED_OTHER_JOB, NOT_INTERESTED, hoặc null = tất cả." },
          so_ngay: nullableInteger("Cập nhật trong bao nhiêu ngày gần đây (mặc định 30, tối đa 180)."),
          chi_cua_toi: { type: ["boolean", "null"], description: "true = chỉ ứng viên do chính người hỏi cập nhật." },
        },
      },
      args: z.object({ tu_khoa: text(120).nullable(), buoc: z.number().int().min(1).max(8).nullable(), ket_qua: z.enum(REC_RESULTS).nullable(), so_ngay: z.number().int().min(1).max(180).nullable(), chi_cua_toi: z.boolean().nullable() }).strict(),
      maxOutputChars: 14_000,
    },
    {
      name: "kpi",
      permission: "*",
      label: "Tổng hợp KPI",
      description: "Tổng hợp KPI theo người trong một khoảng thời gian: tin nhắn đến/đi và hội thoại trên các nick người đó phụ trách, hội thoại mới, đang chưa đọc, tin tự tay gửi, ứng viên Rec mới và số CV nhận, email chiến dịch đã gửi/phản hồi, content đã tạo, công việc đang mở/quá hạn/đã xong. pham_vi: TOI (mặc định), TEAM (người hỏi và cấp dưới; có ten_nguoi = người đó và cấp dưới của họ, ví dụ \"team Hải\"), CONG_TY (cả công ty, cần quyền xem vai trò), NGUOI (một người theo tên).",
      parameters: {
        type: "object", additionalProperties: false, required: ["pham_vi", "ten_nguoi", "ky", "tu_ngay", "den_ngay"],
        properties: {
          pham_vi: { type: ["string", "null"], enum: [...KPI_SCOPES, null], description: "TOI, TEAM, CONG_TY hoặc NGUOI; null = TOI." },
          ten_nguoi: nullableString("Tên người khi pham_vi = NGUOI, hoặc trưởng nhóm khi pham_vi = TEAM; chỉ ghi tên (\"team Hải\" → \"Hải\"); null nếu không có."),
          ky: { type: ["string", "null"], enum: [...KPI_PERIODS, null], description: "Kỳ có sẵn; null = 7_NGAY (trừ khi có tu_ngay)." },
          tu_ngay: nullableString("Từ ngày YYYY-MM-DD (giờ Việt Nam), hoặc null."),
          den_ngay: nullableString("Đến hết ngày YYYY-MM-DD, hoặc null = hôm nay."),
        },
      },
      args: z.object({ pham_vi: z.enum(KPI_SCOPES).nullable(), ten_nguoi: text(120).nullable(), ky: z.enum(KPI_PERIODS).nullable(), tu_ngay: isoDate.nullable(), den_ngay: isoDate.nullable() }).strict(),
      maxOutputChars: 16_000,
    },
  ];
}

// Lịch hẹn (round B). Every member has a calendar; reading follows the KPI rule (own, team, all for
// administrators), changes are cards the member confirms.
const EVENT_KIND_ARGS = ["HOP", "PHONG_VAN", "GAP_KHACH", "CA_NHAN", "KHAC"] as const;
const RECURRENCE_ARGS = ["NONE", "DAILY", "WEEKLY", "MONTHLY"] as const;
const CALENDAR_PERIOD_ARGS = ["HOM_NAY", "NGAY_MAI", "TUAN_NAY", "TUAN_SAU", "7_NGAY_TOI"] as const;
const nullableStringArray = (description: string) => ({ type: ["array", "null"], items: { type: "string" }, description });
function CALENDAR_TOOLS(): AssistantToolDefinition[] {
  return [
    {
      name: "lich_hen",
      permission: "*",
      label: "Xem lịch hẹn",
      description: "Lịch hẹn trong HireX (họp, phỏng vấn, gặp khách, cá nhân) trong một khoảng ngày: id, tiêu đề, loại, thời gian, lặp lại, địa điểm, người tạo, người tham gia, người hỏi có tham gia không và được nhắc trước bao lâu. pham_vi: TOI (mặc định: lịch mình tạo hoặc được mời), TEAM (cả cấp dưới), CONG_TY (cần quyền xem vai trò), NGUOI (lịch của một người theo tên). Mặc định 7 ngày tới.",
      parameters: {
        type: "object", additionalProperties: false, required: ["pham_vi", "ten_nguoi", "ky", "tu_ngay", "den_ngay"],
        properties: {
          pham_vi: { type: ["string", "null"], enum: ["TOI", "TEAM", "CONG_TY", "NGUOI", null], description: "null = TOI." },
          ten_nguoi: nullableString("Tên người khi pham_vi = NGUOI, hoặc null."),
          ky: { type: ["string", "null"], enum: [...CALENDAR_PERIOD_ARGS, null], description: "Kỳ có sẵn; null = 7 ngày tới (trừ khi có tu_ngay)." },
          tu_ngay: nullableString("Từ ngày YYYY-MM-DD, hoặc null."),
          den_ngay: nullableString("Đến hết ngày YYYY-MM-DD, hoặc null (= tu_ngay)."),
        },
      },
      args: z.object({ pham_vi: z.enum(["TOI", "TEAM", "CONG_TY", "NGUOI"]).nullable(), ten_nguoi: text(120).nullable(), ky: z.enum(CALENDAR_PERIOD_ARGS).nullable(), tu_ngay: isoDate.nullable(), den_ngay: isoDate.nullable() }).strict(),
      maxOutputChars: 14_000,
    },
    {
      name: "de_xuat_tao_lich_hen",
      permission: "*",
      proposal: true,
      label: "Đề xuất tạo lịch hẹn",
      description: "Tạo thẻ xác nhận cho một lịch hẹn mới (một lần hoặc lặp lại). Người hỏi luôn là người tạo và có trong lịch; nguoi_tham_gia là tên thành viên khác (tên trong HireX hoặc tên Zalo đã liên kết, kể cả tên được @ trong nhóm). Phỏng vấn ứng viên: gắn conversation_id của hội thoại với ứng viên nếu có. Mỗi người tham gia được Soda nhắc qua Zalo riêng theo giờ nhắc của họ.",
      parameters: {
        type: "object", additionalProperties: false,
        required: ["tieu_de", "loai", "bat_dau", "thoi_luong_phut", "nguoi_tham_gia", "dia_diem", "ghi_chu", "lap_lai", "thu_trong_tuan", "lap_den", "nhac_toi_truoc_phut", "conversation_id"],
        properties: {
          tieu_de: { type: "string", description: "Tiêu đề ngắn, ví dụ \"Họp team Rec\", \"Phỏng vấn Nguyễn An – BrSE\"." },
          loai: { type: ["string", "null"], enum: [...EVENT_KIND_ARGS, null], description: "HOP, PHONG_VAN, GAP_KHACH, CA_NHAN, KHAC; null = HOP." },
          bat_dau: { type: "string", description: "Lần đầu, giờ Việt Nam: \"YYYY-MM-DD HH:mm\". Lịch lặp hằng tuần thì là buổi gần nhất sắp tới." },
          thoi_luong_phut: nullableInteger("Thời lượng (phút), mặc định 60."),
          nguoi_tham_gia: nullableStringArray("Tên các thành viên khác được mời, hoặc null."),
          dia_diem: nullableString("Địa điểm hoặc link họp, hoặc null."),
          ghi_chu: nullableString("Ghi chú, hoặc null."),
          lap_lai: { type: ["string", "null"], enum: [...RECURRENCE_ARGS, null], description: "NONE (mặc định), DAILY, WEEKLY, MONTHLY." },
          thu_trong_tuan: { type: ["array", "null"], items: { type: "integer" }, description: "Với WEEKLY: các thứ 1 = Thứ Hai … 7 = Chủ nhật; null = theo ngày bắt đầu." },
          lap_den: nullableString("Lặp đến hết ngày YYYY-MM-DD, hoặc null (không giới hạn)."),
          nhac_toi_truoc_phut: nullableInteger("Chỉ khi người hỏi nói muốn được nhắc trước bao lâu cho lịch này; null = theo mặc định của họ."),
          conversation_id: nullableString("Hội thoại liên quan (phỏng vấn/gặp khách), hoặc null."),
        },
      },
      args: z.object({
        tieu_de: text(200).min(1), loai: z.enum(EVENT_KIND_ARGS).nullable(), bat_dau: text(20).min(10), thoi_luong_phut: z.number().int().min(5).max(1440).nullable(),
        nguoi_tham_gia: z.array(text(120)).max(30).nullable(), dia_diem: text(300).nullable(), ghi_chu: text(2000).nullable(), lap_lai: z.enum(RECURRENCE_ARGS).nullable(),
        thu_trong_tuan: z.array(z.number().int().min(1).max(7)).max(7).nullable(), lap_den: isoDate.nullable(), nhac_toi_truoc_phut: z.number().int().min(0).max(10080).nullable(),
        conversation_id: z.string().uuid().nullable(),
      }).strict(),
    },
    {
      name: "de_xuat_huy_lich_hen",
      permission: "*",
      proposal: true,
      label: "Đề xuất huỷ lịch hẹn",
      description: "Tạo thẻ xác nhận huỷ một lịch hẹn (cả chuỗi nếu là lịch lặp). Chỉ người tạo lịch hoặc quản trị viên. Lấy event_id từ lich_hen.",
      parameters: { type: "object", additionalProperties: false, required: ["event_id"], properties: { event_id: uuidArg("Id lịch (từ lich_hen).") } },
      args: z.object({ event_id: z.string().uuid() }).strict(),
    },
    {
      name: "de_xuat_cai_nhac_lich",
      permission: "*",
      proposal: true,
      label: "Đề xuất đổi giờ nhắc lịch",
      description: "Tạo thẻ xác nhận đổi giờ Soda nhắc người hỏi qua Zalo: cho một lịch (event_id) hoặc mặc định cho mọi lịch (event_id null). Cũng dùng để báo không tham gia một lịch, hoặc tắt/bật nhắc qua Zalo.",
      parameters: {
        type: "object", additionalProperties: false, required: ["event_id", "nhac_truoc_phut", "nhan_qua_zalo", "khong_tham_gia"],
        properties: {
          event_id: nullableString("Id lịch (từ lich_hen), hoặc null = mặc định cho mọi lịch."),
          nhac_truoc_phut: nullableInteger("Nhắc trước bao nhiêu phút (0 = đúng giờ); null = giữ nguyên."),
          nhan_qua_zalo: { type: ["boolean", "null"], description: "Chỉ với mặc định: false = tắt nhắc qua Zalo, true = bật; null = giữ nguyên." },
          khong_tham_gia: { type: ["boolean", "null"], description: "Chỉ với một lịch: true = báo không tham gia (không nhắc nữa), false = tham gia lại; null = giữ nguyên." },
        },
      },
      args: z.object({ event_id: z.string().uuid().nullable(), nhac_truoc_phut: z.number().int().min(0).max(10080).nullable(), nhan_qua_zalo: z.boolean().nullable(), khong_tham_gia: z.boolean().nullable() }).strict(),
    },
  ];
}

// Word files (round C): a free document written from the member's request, or a JD from the job board.
function FILE_TOOLS(): AssistantToolDefinition[] {
  return [{
    name: "tao_file_word",
    permission: "*",
    label: "Tạo file Word",
    description: "Tạo một file Word (.docx) có đầu trang Intalent Việt Nam và gửi cho người hỏi (trên Zalo: Soda gửi file vào chat; trên web: link tải). loai = JD: JD của một job trong bảng job (cần job_code, chỉ dùng thông tin job đã lưu). loai = TU_DO: tài liệu bất kỳ (quy trình, biên bản họp, kế hoạch, báo cáo, thư, đề xuất…) do bộ soạn thảo viết theo yeu_cau; số liệu cần đưa vào (KPI, danh sách job, lịch…) thì tra bằng công cụ khác trước rồi chép vào du_lieu. Tối đa 3 file mỗi câu hỏi.",
    parameters: {
      type: "object", additionalProperties: false, required: ["loai", "tieu_de", "yeu_cau", "du_lieu", "job_code", "an_ten_cong_ty"],
      properties: {
        loai: { type: "string", enum: ["TU_DO", "JD"], description: "TU_DO hoặc JD." },
        tieu_de: { type: "string", description: "Tiêu đề tài liệu (cũng là tên file)." },
        yeu_cau: { type: "string", description: "Với TU_DO: mô tả đầy đủ tài liệu cần viết (mục đích, người đọc, các mục, độ dài, giọng văn, ngôn ngữ). Với JD: ghi chú thêm hoặc \"\"." },
        du_lieu: nullableString("Số liệu/thông tin đã tra được để đưa vào tài liệu (nguyên văn, ngắn gọn), hoặc null."),
        job_code: nullableString("Mã job khi loai = JD, hoặc null."),
        an_ten_cong_ty: { type: ["boolean", "null"], description: "JD: true = không ghi tên công ty, false = ghi; null = theo cài đặt của job." },
      },
    },
    args: z.object({ loai: z.enum(["TU_DO", "JD"]), tieu_de: text(160).min(2), yeu_cau: text(4000), du_lieu: text(12000).nullable(), job_code: text(40).nullable(), an_ten_cong_ty: z.boolean().nullable() }).strict(),
  }];
}

// Gửi hàng loạt vào nhóm Zalo (round D): the Trợ lý only prepares a draft; the member starts it on the page.
function BROADCAST_TOOLS(): AssistantToolDefinition[] {
  return [{
    name: "de_xuat_nhap_gui_nhom",
    permission: "broadcasts.manage",
    proposal: true,
    label: "Đề xuất gửi nhóm Zalo (nháp)",
    description: "Gửi một tin vào nhóm Zalo (có thể ghim tin đó lên đầu nhóm), và/hoặc thêm ghi chú ở bảng tin nhóm, cho nhiều nhóm từ các nick người dùng được dùng. Nhiều nhóm: chỉ tạo NHÁP sau khi người dùng xác nhận thẻ; việc gửi chỉ bắt đầu khi họ bấm \"Bắt đầu gửi\" trên trang Gửi nhóm Zalo. Riêng nhóm đang chat với Soda (nhom_hien_tai): xác nhận thẻ là gửi/ghim ngay vào nhóm đó. Mỗi nick tối đa 30 nhóm/ngày, cách 90–180 giây, 8:00–21:00.",
    parameters: {
      type: "object", additionalProperties: false, required: ["ten", "noi_dung", "gui_tin", "ghim", "ghi_chu", "nhom_hien_tai", "nick", "tu_khoa_nhom", "so_nhom_toi_da", "nhan_nhom", "hang_cong_ty", "khoi_cong_ty"],
      properties: {
        ten: nullableString("Tên đợt gửi, hoặc null (lấy dòng đầu nội dung)."),
        noi_dung: { type: "string", description: "Nội dung tin/ghi chú đúng như người dùng đưa hoặc đã duyệt (tối đa 4.000 ký tự; ghi chú tối đa 2.000)." },
        gui_tin: { type: ["boolean", "null"], description: "Gửi tin vào nhóm (mặc định true)." },
        ghim: { type: ["boolean", "null"], description: "\"Ghim\": gửi tin rồi ghim chính tin đó lên đầu nhóm (Tin ghim). Mặc định false." },
        ghi_chu: { type: ["boolean", "null"], description: "\"Ghi chú\": thêm một ghi chú (ghim ở bảng tin nhóm), khác với ghim tin. Mặc định false. Chỉ ghi chú, không gửi tin: gui_tin = false." },
        nhom_hien_tai: { type: ["boolean", "null"], description: "true = chỉ nhóm Zalo người dùng đang hỏi Soda (\"nhóm này\"); khi đó bỏ qua nick/tu_khoa_nhom. Xác nhận thẻ là gửi/ghim ngay vào nhóm đó." },
        nick: { type: ["array", "null"], items: { type: "string" }, description: "Tên các nick gửi; null = mọi nick người dùng được dùng đang kết nối." },
        tu_khoa_nhom: nullableString("Chỉ các nhóm có tên chứa từ khoá này (ví dụ \"BrSE\", \"IT HCM\"), hoặc null = mọi nhóm của các nick đó."),
        so_nhom_toi_da: nullableInteger("Giới hạn số nhóm (tối đa 500), hoặc null."),
        nhan_nhom: { type: ["array", "null"], items: { type: "string" }, description: "\"Thẻ\": chỉ nhóm có một trong các nhãn Suối Nguồn này, hoặc null." },
        hang_cong_ty: nullableString("Chỉ nhóm đã duyệt ghép với công ty có xếp hạng chứa chữ này (\"Hạng 1\", \"Dự án ưu tiên\", \"Hot Do\"…), hoặc null."),
        khoi_cong_ty: nullableString("Chỉ nhóm đã duyệt ghép với công ty thuộc khối này (\"Hot Do IT\", \"IT\"…), hoặc null."),
      },
    },
    args: z.object({ ten: text(200).nullable(), noi_dung: text(4000).min(1), gui_tin: z.boolean().nullable(), ghim: z.boolean().nullable(), ghi_chu: z.boolean().nullable(), nhom_hien_tai: z.boolean().nullable(), nick: z.array(text(120)).max(30).nullable(), tu_khoa_nhom: text(120).nullable(), so_nhom_toi_da: z.number().int().min(1).max(500).nullable(), nhan_nhom: z.array(text(80)).max(10).nullable(), hang_cong_ty: text(120).nullable(), khoi_cong_ty: text(80).nullable() }).strict(),
  }];
}

// Khách hàng (copied from Human): within the member's rights (all customers, or the ones they are Sale/AM of).
function CUSTOMER_TOOLS(): AssistantToolDefinition[] {
  return [{
    name: "khach_hang",
    permission: "customers.view",
    label: "Tra cứu khách hàng",
    description: "Tra cứu màn Khách hàng (công ty khách lấy từ Human): tên, địa điểm, website, xếp hạng dự án, hạng, xếp hạng AM, Sale, AM, số CV (tổng/đã gửi/đang xử lý/offer/xong), ghi chú mới nhất, khối; tổng số khớp và tối đa 30 khách. Người không có quyền xem tất cả chỉ thấy khách mình là Sale/AM.",
    parameters: {
      type: "object", additionalProperties: false, required: ["tu_khoa", "trang_thai", "khoi", "chi_cua_toi", "chua_gui_email", "so_luong"],
      properties: {
        tu_khoa: nullableString("Tên công ty, email, SĐT, website, địa chỉ hoặc mã khách (có/không dấu), hoặc null."),
        trang_thai: nullableString("Một phần xếp hạng dự án / hạng / xếp hạng AM (ví dụ \"Chờ nhiệm thu\", \"Hạng 1\", \"Doing\"), hoặc null."),
        khoi: nullableString("Tên khối (ví dụ \"Hot Do IT\", \"HĐ Khối Nhật\"; \"IT\" = mọi khối IT, \"Hot Do\" = mọi khối Hot Do) hoặc mã khối, hoặc null."),
        chi_cua_toi: { type: ["boolean", "null"], description: "true = chỉ khách người hỏi là Sale/AM." },
        chua_gui_email: { type: ["boolean", "null"], description: "true = chỉ khách chưa được gửi CV nào." },
        so_luong: nullableInteger("Số khách trả về (mặc định 10, tối đa 30)."),
      },
    },
    args: z.object({ tu_khoa: text(120).nullable(), trang_thai: text(120).nullable(), khoi: text(80).nullable(), chi_cua_toi: z.boolean().nullable(), chua_gui_email: z.boolean().nullable(), so_luong: z.number().int().min(1).max(30).nullable() }).strict(),
  }, {
    name: "tinh_trang_cv",
    permission: "customers.view",
    label: "Lấy Tình trạng CV",
    description: "Tình trạng CV của MỘT công ty khách (lấy mới từ Human nếu cũ hơn 1 giờ), soạn sẵn đúng mẫu tin AM ghim trong nhóm Zalo của công ty: \"I. CV chờ gửi / II. CV đã gửi / III. Phỏng vấn / IV. Offer / V. Onboard / VI. Failed\", mỗi CV một dòng \"[mã RE] - ngày - vị trí - kỹ năng -tên(các công ty đã gửi) -địa điểm- xếp loại - trạng thái----\". Tin dài được chia nhiều phần (cac_tin). Khi trả lời, đưa NGUYÊN VĂN nội dung, không tóm tắt, trừ khi người dùng chỉ hỏi số lượng.",
    parameters: {
      type: "object", additionalProperties: false, required: ["cong_ty"],
      properties: { cong_ty: { type: "string", description: "Tên công ty (như trên màn Khách hàng / tên nhóm Zalo, ví dụ \"Brisasoft\") hoặc mã khách." } },
    },
    args: z.object({ cong_ty: text(120).min(1) }).strict(),
    maxOutputChars: 16_000,
  }];
}

// Soda đợt 1: counts on Khách hàng and on the stored Tình trạng CV of many companies; Suối Nguồn counts; Zalo groups.
const GROUP_BY = ["HANG", "XEP_HANG_DU_AN", "XEP_HANG_AM", "KHOI", "DIA_DIEM", "SALE", "AM"] as const;
const CV_KINDS = ["PHONG_VAN", "CHO_GUI", "DA_GUI", "OFFER", "ONBOARD", "FAIL", "TONG_QUAN"] as const;
function ROUND_ONE_TOOLS(): AssistantToolDefinition[] {
  const dateArgs = {
    ky: { type: ["string", "null"], enum: [...KPI_PERIODS, "TAT_CA", null], description: "Khoảng thời gian; null/TAT_CA = không lọc ngày." },
    tu_ngay: nullableString("YYYY-MM-DD, hoặc null."),
    den_ngay: nullableString("YYYY-MM-DD, hoặc null."),
  };
  const dateZod = { ky: z.enum([...KPI_PERIODS, "TAT_CA"]).nullable(), tu_ngay: isoDate.nullable(), den_ngay: isoDate.nullable() };
  return [{
    name: "thong_ke_khach_hang",
    permission: "customers.view",
    label: "Thống kê khách hàng",
    description: "Đếm công ty khách (màn Khách hàng, lấy từ Human) theo Hạng (Hạng 1…8), Xếp hạng dự án, Xếp hạng AM, khối, địa điểm, Sale hoặc AM, kèm tổng CV; lọc theo khối (tên: \"IT\", \"Hot Do\", \"Hot Do IT\", \"HĐ Khối Nhật\"…) và chữ trong xếp hạng. Có ky/tu_ngay/den_ngay: chỉ công ty MỚI VÀO khối trong khoảng đó, kèm danh sách — dùng cho \"tuần này có bao nhiêu Hot Do mới\", \"Hot Do lên trong tháng 10\". Dùng cho \"bao nhiêu công ty hạng 1, hạng 2 ngành IT\".",
    parameters: {
      type: "object", additionalProperties: false, required: ["khoi", "nhom_theo", "loc", "ky", "tu_ngay", "den_ngay", "chi_cua_toi", "so_luong"],
      properties: {
        khoi: nullableString("Tên hoặc mã khối; \"IT\" = mọi khối IT, \"Hot Do\" = mọi khối Hot Do; null = mọi khối."),
        nhom_theo: { type: ["string", "null"], enum: [...GROUP_BY, null], description: "Đếm theo: HANG (mặc định), XEP_HANG_DU_AN, XEP_HANG_AM, KHOI, DIA_DIEM, SALE, AM." },
        loc: nullableString("Chỉ công ty có xếp hạng chứa chữ này (ví dụ \"Hạng 1\", \"Dự án ưu tiên\", \"Hot Do\"), hoặc null."),
        ...dateArgs,
        chi_cua_toi: { type: ["boolean", "null"], description: "true = chỉ khách người hỏi là Sale/AM." },
        so_luong: nullableInteger("Số công ty mới liệt kê (mặc định 30, tối đa 100)."),
      },
    },
    args: z.object({ khoi: text(80).nullable(), nhom_theo: z.enum(GROUP_BY).nullable(), loc: text(120).nullable(), ...dateZod, chi_cua_toi: z.boolean().nullable(), so_luong: z.number().int().min(1).max(100).nullable() }).strict(),
    maxOutputChars: 16_000,
  }, {
    name: "tong_hop_cv",
    permission: "customers.view",
    label: "Tổng hợp Tình trạng CV nhiều công ty",
    description: "Gom Tình trạng CV (Human) của NHIỀU công ty khách: loai = PHONG_VAN (lịch phỏng vấn theo ngày, vòng PV1/PV2…), CHO_GUI (UV chờ gửi + kỹ năng/vị trí phổ biến), DA_GUI, OFFER, ONBOARD, FAIL, TONG_QUAN (số CV từng loại theo công ty). Lọc theo khối, xếp hạng (ví dụ \"Dự án ưu tiên\"), tên công ty, trạng thái (ví dụ \"PV2\"), khoảng ngày (ngày phỏng vấn với PHONG_VAN, ngày cập nhật với loại khác). Dùng cho \"nay có lịch phỏng vấn gì\", \"tuần này mấy lịch PV2\", \"tóm tắt skill UV chờ gửi\", \"dự án ưu tiên có CV chưa\". Một công ty cụ thể đúng mẫu ghim nhóm → tinh_trang_cv.",
    parameters: {
      type: "object", additionalProperties: false, required: ["loai", "trang_thai", "ky", "tu_ngay", "den_ngay", "khoi", "loc", "cong_ty", "chi_cua_toi", "tom_tat_ky_nang", "so_luong"],
      properties: {
        loai: { type: ["string", "null"], enum: [...CV_KINDS, null], description: "Mặc định PHONG_VAN." },
        trang_thai: nullableString("Chữ trong trạng thái CV, ví dụ \"PV2\", \"PV1\", \"Chưa chốt lịch\", hoặc null."),
        ...dateArgs,
        khoi: nullableString("Tên/mã khối, hoặc null."),
        loc: nullableString("Chữ trong xếp hạng công ty (\"Dự án ưu tiên\", \"Hạng 1\"…), hoặc null."),
        cong_ty: nullableString("Tên công ty (một phần), hoặc null."),
        chi_cua_toi: { type: ["boolean", "null"], description: "true = chỉ khách người hỏi là Sale/AM (\"lịch của chị\")." },
        tom_tat_ky_nang: { type: ["boolean", "null"], description: "true = kèm kỹ năng/vị trí phổ biến (tự có với CHO_GUI)." },
        so_luong: nullableInteger("Số CV liệt kê (mặc định 40, tối đa 120)."),
      },
    },
    args: z.object({ loai: z.enum(CV_KINDS).nullable(), trang_thai: text(80).nullable(), ...dateZod, khoi: text(80).nullable(), loc: text(120).nullable(), cong_ty: text(120).nullable(), chi_cua_toi: z.boolean().nullable(), tom_tat_ky_nang: z.boolean().nullable(), so_luong: z.number().int().min(1).max(120).nullable() }).strict(),
    maxOutputChars: 20_000,
  }, {
    name: "dem_hoi_thoai",
    permission: "inbox.view",
    label: "Đếm hội thoại Suối Nguồn",
    description: "Đếm hội thoại Suối Nguồn trên các nick người hỏi được xem, theo nick: số hội thoại khách, CHỜ TRẢ LỜI (tin cuối là của khách, như tab Chưa trả lời), chưa đọc, nhóm; lọc kênh (EMAIL, ZALO…), nick, số ngày. nguoi_nhat = true: hội thoại với người Nhật (nhắn chữ tiếng Nhật, email .jp, liên hệ ghi Nhật Bản) kèm danh sách. Dùng cho \"bao nhiêu email khách phản hồi chưa được tiếp\", \"bao nhiêu email người Nhật ở Suối Nguồn\".",
    parameters: {
      type: "object", additionalProperties: false, required: ["kenh", "nick", "so_ngay", "nguoi_nhat", "so_luong"],
      properties: {
        kenh: { type: ["string", "null"], enum: ["EMAIL", "ZALO", "FACEBOOK", "FACEBOOK_PROFILE", null], description: "Kênh, hoặc null = mọi kênh." },
        nick: nullableString("Tên nick/hộp thư, hoặc null."),
        so_ngay: nullableInteger("Hội thoại có tin trong bao nhiêu ngày gần đây (mặc định 30, tối đa 90)."),
        nguoi_nhat: { type: ["boolean", "null"], description: "true = chỉ hội thoại với người Nhật." },
        so_luong: nullableInteger("Số hội thoại người Nhật liệt kê (mặc định 15, tối đa 40)."),
      },
    },
    args: z.object({ kenh: z.enum(["EMAIL", "ZALO", "FACEBOOK", "FACEBOOK_PROFILE"]).nullable(), nick: text(120).nullable(), so_ngay: z.number().int().min(1).max(90).nullable(), nguoi_nhat: z.boolean().nullable(), so_luong: z.number().int().min(1).max(40).nullable() }).strict(),
  }, {
    name: "nhom_zalo",
    permission: "inbox.view",
    label: "Đếm nhóm Zalo",
    description: "Số nhóm Zalo (HireX đã đồng bộ) của từng nick người hỏi được xem và tổng số nhóm (một nhóm nhiều nick chỉ tính một lần); lọc theo chữ trong tên nhóm; so_luong > 0 thì kèm tên nhóm.",
    parameters: {
      type: "object", additionalProperties: false, required: ["nick", "tu_khoa", "so_luong"],
      properties: { nick: nullableString("Tên nick (ví dụ \"Soda\"), hoặc null = mọi nick."), tu_khoa: nullableString("Chữ trong tên nhóm, hoặc null."), so_luong: nullableInteger("Số tên nhóm liệt kê (0 = không liệt kê, tối đa 100).") },
    },
    args: z.object({ nick: text(120).nullable(), tu_khoa: text(120).nullable(), so_luong: z.number().int().min(0).max(100).nullable() }).strict(),
  }];
}

// Màn CV (copied from Human): within the member's rights (all CVs, or the ones they are Rec of).
const CV_GROUPS = ["TINH_TRANG", "TRANG_THAI", "VI_TRI", "KY_NANG", "DIA_DIEM", "REC", "NGOAI_NGU", "KHOI"] as const;
function CV_TOOLS(): AssistantToolDefinition[] {
  return [{
    name: "tim_cv",
    permission: "cvs.view",
    label: "Tìm CV",
    description: "Tìm trong màn CV (CV ứng viên lấy từ Human) theo tên, SĐT, email, mã UV, kỹ năng, công ty đã gửi…; lọc tình trạng, vị trí, chỉ CV của người hỏi (Rec). Trả tổng số khớp và tối đa 30 CV: vị trí, kỹ năng, ngoại ngữ, địa điểm, trạng thái, Rec, công ty đã gửi, link. Người không có quyền xem tất cả chỉ thấy CV mình là Rec.",
    parameters: {
      type: "object", additionalProperties: false, required: ["tu_khoa", "trang_thai", "vi_tri", "chi_cua_toi", "so_luong"],
      properties: {
        tu_khoa: nullableString("Tên, SĐT, email, mã UV, kỹ năng, công ty… (có/không dấu), hoặc null."),
        trang_thai: nullableString("Chữ trong tình trạng CV, hoặc null."),
        vi_tri: nullableString("Chữ trong vị trí (BrSE, PM…), hoặc null."),
        chi_cua_toi: { type: ["boolean", "null"], description: "true = chỉ CV người hỏi là Rec." },
        so_luong: nullableInteger("Số CV trả về (mặc định 10, tối đa 30)."),
      },
    },
    args: z.object({ tu_khoa: text(120).nullable(), trang_thai: text(120).nullable(), vi_tri: text(120).nullable(), chi_cua_toi: z.boolean().nullable(), so_luong: z.number().int().min(1).max(30).nullable() }).strict(),
    maxOutputChars: 14_000,
  }, {
    name: "thong_ke_cv",
    permission: "cvs.view",
    label: "Thống kê CV",
    description: "Đếm CV trong màn CV theo tình trạng, trạng thái, vị trí, kỹ năng, địa điểm, Rec, ngoại ngữ hoặc khối; ky/tu_ngay/den_ngay = chỉ CV tạo trên Human trong khoảng đó (\"tuần này có bao nhiêu CV mới\"); loc = chỉ CV có chữ này (kỹ năng, vị trí, công ty…).",
    parameters: {
      type: "object", additionalProperties: false, required: ["nhom_theo", "ky", "tu_ngay", "den_ngay", "loc", "chi_cua_toi"],
      properties: {
        nhom_theo: { type: ["string", "null"], enum: [...CV_GROUPS, null], description: "Mặc định TINH_TRANG." },
        ky: { type: ["string", "null"], enum: [...KPI_PERIODS, "TAT_CA", null], description: "CV tạo trong khoảng này; null/TAT_CA = mọi CV." },
        tu_ngay: nullableString("YYYY-MM-DD, hoặc null."),
        den_ngay: nullableString("YYYY-MM-DD, hoặc null."),
        loc: nullableString("Chỉ CV có chữ này, hoặc null."),
        chi_cua_toi: { type: ["boolean", "null"], description: "true = chỉ CV người hỏi là Rec." },
      },
    },
    args: z.object({ nhom_theo: z.enum(CV_GROUPS).nullable(), ky: z.enum([...KPI_PERIODS, "TAT_CA"]).nullable(), tu_ngay: isoDate.nullable(), den_ngay: isoDate.nullable(), loc: text(120).nullable(), chi_cua_toi: z.boolean().nullable() }).strict(),
  }];
}

// Tương tác chiến dịch Zalo / Facebook cá nhân (read only): per owner and per sending nick.
const INTERACTION_FILTERS = ["TAT_CA", "QUAN_TAM", "KHONG_QUAN_TAM", "CHUA_RO", "CHUA_DOC", "DA_CO_CV", "OWNER_CHUA_TRA_LOI", "OWNER_DA_TRA_LOI"] as const;
function CAMPAIGN_INSIGHT_TOOLS(): AssistantToolDefinition[] {
  return [{
    name: "tuong_tac_chien_dich",
    permission: "campaigns.view",
    label: "Tổng hợp tương tác chiến dịch",
    description: "Tương tác của chiến dịch Zalo / Facebook cá nhân (UV đã phản hồi tin chiến dịch), TỔNG HỢP THEO OWNER (cột Owner của chiến dịch, ví dụ 204 = Tuấn Rec): số tương tác, owner (nick) đã trả lời UV hay chưa, UV quan tâm / không quan tâm / chưa rõ (theo Luồng Rec, file CV, còn lại AI đọc tin UV), số chuyển hoá thành CV và tỉ lệ; kèm danh sách UV lọc theo loc (tên UV, tin phản hồi, owner đã trả lời sau bao lâu, mức quan tâm và lý do, CV, link hội thoại). Dùng cho \"tổng hợp tương tác theo owner\", \"bao nhiêu tương tác ra CV\", \"lọc UV quan tâm / không quan tâm\", \"UV nào owner chưa trả lời\".",
    parameters: {
      type: "object", additionalProperties: false, required: ["ky", "tu_ngay", "den_ngay", "owner", "nick", "chien_dich", "loc", "so_luong"],
      properties: {
        ky: { type: ["string", "null"], enum: [...KPI_PERIODS, "TAT_CA", null], description: "Khoảng thời gian UV phản hồi; null/TAT_CA = toàn bộ." },
        tu_ngay: nullableString("YYYY-MM-DD, hoặc null."),
        den_ngay: nullableString("YYYY-MM-DD, hoặc null."),
        owner: nullableString("Owner: mã (\"204\") hoặc tên (\"Tuấn\"), hoặc null = mọi owner."),
        nick: nullableString("Tên nick gửi (ví dụ \"Xuân Ly\"), hoặc null."),
        chien_dich: nullableString("Một phần tên chiến dịch, hoặc null."),
        loc: { type: ["string", "null"], enum: [...INTERACTION_FILTERS, null], description: "Lọc danh sách UV: QUAN_TAM, KHONG_QUAN_TAM, CHUA_RO, CHUA_DOC (AI chưa đọc), DA_CO_CV, OWNER_CHUA_TRA_LOI, OWNER_DA_TRA_LOI; null = tất cả." },
        so_luong: nullableInteger("Số UV trong danh sách (mặc định 15, tối đa 50)."),
      },
    },
    args: z.object({ ky: z.enum([...KPI_PERIODS, "TAT_CA"]).nullable(), tu_ngay: isoDate.nullable(), den_ngay: isoDate.nullable(), owner: text(80).nullable(), nick: text(120).nullable(), chien_dich: text(160).nullable(), loc: z.enum(INTERACTION_FILTERS).nullable(), so_luong: z.number().int().min(1).max(50).nullable() }).strict(),
    maxOutputChars: 18_000,
  }, {
    name: "tien_do_chien_dich",
    permission: "campaigns.view",
    label: "Tiến độ chiến dịch theo tài khoản",
    description: "Tiến độ chiến dịch Zalo / Facebook cá nhân THEO TỪNG TÀI KHOẢN (nick gửi): đã chạy bao nhiêu UV trên tổng (da_chay/tong), còn chờ, phản hồi và tỉ lệ, lỗi, tốc độ gửi 24 giờ / 7 ngày so với giới hạn ngày, dự kiến số ngày còn lại, số UV phản hồi chưa được trả lời, và goi_y tính sẵn (nick mất kết nối, đứng gửi, chậm, sắp hết data, tỉ lệ phản hồi thấp/cao…). Dùng cho \"tương tác đã chạy được bao nhiêu trên bao nhiêu cho từng tài khoản\" và để đưa ra đề xuất.",
    parameters: {
      type: "object", additionalProperties: false, required: ["kenh", "nick", "chien_dich", "chi_dang_chay"],
      properties: {
        kenh: { type: ["string", "null"], enum: ["TAT_CA", "ZALO", "FACEBOOK_PROFILE", null], description: "Kênh; null = tất cả." },
        nick: nullableString("Tên nick, hoặc null = mọi nick."),
        chien_dich: nullableString("Một phần tên chiến dịch, hoặc null."),
        chi_dang_chay: { type: ["boolean", "null"], description: "true/null = chỉ chiến dịch đang chạy/tạm dừng/đã lên lịch; false = cả chiến dịch đã xong." },
      },
    },
    args: z.object({ kenh: z.enum(["TAT_CA", "ZALO", "FACEBOOK_PROFILE"]).nullable(), nick: text(120).nullable(), chien_dich: text(160).nullable(), chi_dang_chay: z.boolean().nullable() }).strict(),
    maxOutputChars: 16_000,
  }];
}

// "Lưu tài liệu anh vừa nhắn vào mục Tài liệu": a card; confirming keeps the text in Tài liệu HireX › <thư mục>.
function DOCUMENT_SAVE_TOOLS(): AssistantToolDefinition[] {
  return [{
    name: "de_xuat_luu_tai_lieu",
    permission: "documents.create",
    proposal: true,
    label: "Đề xuất lưu vào Tài liệu",
    description: "Lưu một tài liệu (văn bản) vào mục Tài liệu, thư mục Tài liệu HireX › <thu_muc> (mặc định \"Soda lưu\"); người dùng xác nhận thẻ mới lưu, sau đó tìm/đọc/hỏi được như tài liệu khác. nguon = TIN_VUA_NHAN (chỉ trên Zalo): máy chủ tự lấy NGUYÊN VĂN các tin người dùng vừa gửi ngay trước câu nhờ lưu (gộp các tin dán liền nhau) — dùng cho \"lưu tài liệu anh vừa nhắn/vừa gửi\". nguon = NOI_DUNG: lưu đúng noi_dung (trên web, hoặc khi người dùng đưa nội dung ngay trong câu). File gửi qua Zalo chưa đọc được nội dung.",
    parameters: {
      type: "object", additionalProperties: false, required: ["nguon", "noi_dung", "tieu_de", "thu_muc"],
      properties: {
        nguon: { type: "string", enum: ["TIN_VUA_NHAN", "NOI_DUNG"], description: "TIN_VUA_NHAN (Zalo) hoặc NOI_DUNG." },
        noi_dung: nullableString("NOI_DUNG: nguyên văn nội dung cần lưu (không tóm tắt, không sửa); TIN_VUA_NHAN: null."),
        tieu_de: nullableString("Tên tài liệu người dùng nói, hoặc một tên ngắn đúng nội dung; null = lấy dòng đầu."),
        thu_muc: nullableString("Thư mục người dùng nói (ví dụ \"Quy trình HR\"), hoặc null = \"Soda lưu\"."),
      },
    },
    args: z.object({ nguon: z.enum(["TIN_VUA_NHAN", "NOI_DUNG"]), noi_dung: text(200_000).nullable(), tieu_de: text(200).nullable(), thu_muc: text(120).nullable() }).strict(),
  }];
}

// Suối Nguồn bulk actions: the card shows how many conversations match; confirming runs it (undo 10 minutes).
function INBOX_BULK_TOOLS(): AssistantToolDefinition[] {
  return [{
    name: "de_xuat_thao_tac_hang_loat",
    permission: "inbox.update",
    proposal: true,
    label: "Đề xuất thao tác hàng loạt ở Suối Nguồn",
    description: "Gắn nhãn / bỏ nhãn, đánh dấu đã đọc, chuyển vào Khác hoặc về Chính, giao cho người phụ trách — cho NHIỀU hội thoại Suối Nguồn cùng lúc (tối đa 5.000), chọn theo tab, nick, kênh, nhãn đang có, từ khoá (tên, SĐT, email, tên nhóm). Thẻ cho biết số hội thoại khớp; người dùng xác nhận mới làm; hoàn tác được trong 10 phút ở Suối Nguồn.",
    parameters: {
      type: "object", additionalProperties: false, required: ["hanh_dong", "nhan", "tao_nhan_moi", "giao_cho", "tab", "tu_khoa", "nick", "kenh", "loc_theo_nhan"],
      properties: {
        hanh_dong: { type: "string", enum: ["GAN_NHAN", "BO_NHAN", "DA_DOC", "VAO_KHAC", "VE_CHINH", "GIAO"], description: "Việc cần làm." },
        nhan: { type: ["array", "null"], items: { type: "string" }, description: "Tên nhãn cần gắn/bỏ (GAN_NHAN, BO_NHAN), hoặc null." },
        tao_nhan_moi: { type: ["boolean", "null"], description: "true = tạo nhãn chưa có (chỉ khi người dùng đồng ý tạo nhãn mới)." },
        giao_cho: nullableString("GIAO: tên người được giao; null = bỏ người được giao."),
        tab: { type: ["string", "null"], enum: ["TAT_CA", "CHUA_TRA_LOI", "GIAO_CHO_TOI", "NHOM", "KHAC", "MOI_LOAI", null], description: "TAT_CA = khách (không gồm nhóm và mục Khác), CHUA_TRA_LOI, GIAO_CHO_TOI, NHOM, KHAC, MOI_LOAI = tất cả. Mặc định TAT_CA." },
        tu_khoa: nullableString("Chỉ hội thoại có tên/SĐT/email/tên nhóm chứa từ khoá này, hoặc null."),
        nick: { type: ["array", "null"], items: { type: "string" }, description: "Tên nick/tài khoản kênh; null = mọi nick người dùng được dùng." },
        kenh: { type: ["array", "null"], items: { type: "string", enum: ["ZALO", "FACEBOOK", "FACEBOOK_PROFILE", "EMAIL"] }, description: "Kênh; null = mọi kênh." },
        loc_theo_nhan: { type: ["array", "null"], items: { type: "string" }, description: "Chỉ hội thoại đang có đủ các nhãn này, hoặc null." },
      },
    },
    args: z.object({ hanh_dong: z.enum(["GAN_NHAN", "BO_NHAN", "DA_DOC", "VAO_KHAC", "VE_CHINH", "GIAO"]), nhan: z.array(text(80)).max(20).nullable(), tao_nhan_moi: z.boolean().nullable(),
      giao_cho: text(120).nullable(), tab: z.enum(["TAT_CA", "CHUA_TRA_LOI", "GIAO_CHO_TOI", "NHOM", "KHAC", "MOI_LOAI"]).nullable(), tu_khoa: text(100).nullable(),
      nick: z.array(text(120)).max(30).nullable(), kenh: z.array(z.enum(["ZALO", "FACEBOOK", "FACEBOOK_PROFILE", "EMAIL"])).max(4).nullable(), loc_theo_nhan: z.array(text(80)).max(10).nullable() }).strict(),
  }];
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

export const CONVERSATION_NAME_KEYS = ["conversationDisplayName", "participantDisplayName", "participantName", "displayName", "groupName"];
/** Display name of a conversation without a linked contact (same metadata keys the inbox uses). */
export function metadataName(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  for (const key of CONVERSATION_NAME_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  }
  return null;
}

/**
 * Zalo: a one-to-one thread's id is the other person's id, so an incoming message from someone else
 * means the thread is a group. (Not applied to other channels, whose thread ids work differently.)
 */
export function isZaloGroupThread(channel: string, providerConversationId: string | null | undefined, inboundSender: string | null | undefined) {
  return channel === "ZALO" && Boolean(providerConversationId) && Boolean(inboundSender) && inboundSender !== "system" && providerConversationId !== inboundSender;
}

/** E-mail from robots (no-reply, notifications, sign-up mails…): nobody needs to answer these. */
export function isAutomatedSender(address: string | null | undefined) {
  if (!address || !address.includes("@")) return false;
  const [local, domain] = address.toLowerCase().split("@");
  return /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|alerts?|registration|bounces?|newsletter)/.test(local)
    || /(^|\.)(facebookmail\.com|accounts\.google\.com)$/.test(domain);
}

/** Group chats (Zalo/Facebook groups): a reply there reaches every member. */
export function isGroupConversation(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return record.isGroup === true || typeof record.groupName === "string" || String(record.threadType ?? "").toUpperCase() === "GROUP"
    || String(record.conversationKind ?? "").toUpperCase() === "GROUP";
}

export const ASSISTANT_TOOLS: AssistantToolDefinition[] = [
  {
    name: "ban_tin_hom_nay",
    permission: "dashboard.view",
    label: "Xem bản tin hôm nay",
    description: "Bản tin hôm nay của người đang hỏi (theo đúng quyền): việc cần xử lý gấp/nên xem (tin chờ trả lời, kênh lỗi, bộ gửi email, chiến dịch lỗi, công việc quá hạn, AI Recruiter) và các phần đang ổn. Dùng đầu tiên cho câu hỏi tổng quát kiểu \"hôm nay có gì cần xử lý\".",
    parameters: noArgs,
    args: z.object({}).strict(),
  },
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
    description: "Các hội thoại trong Suối Nguồn mà tin cuối cùng là của khách/ứng viên và đã chờ ít nhất N giờ (trong 7 ngày gần đây), chờ lâu nhất trước; nhom_chat = nhóm chat.",
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
    name: "tim_hoi_thoai",
    permission: "inbox.view",
    label: "Tìm hội thoại",
    description: "Tìm hội thoại trong Suối Nguồn theo tên khách/ứng viên (tên liên hệ hoặc tên hiển thị trên Zalo/Facebook). Trả về tối đa 8 hội thoại, mới nhất trước, kèm id, kênh, tài khoản và tin cuối.",
    parameters: { type: "object", additionalProperties: false, required: ["tu_khoa"], properties: { tu_khoa: { type: "string", description: "Tên hoặc một phần tên." } } },
    args: z.object({ tu_khoa: text(100).min(1) }).strict(),
  },
  {
    name: "chi_tiet_hoi_thoai",
    permission: "inbox.view",
    label: "Đọc hội thoại",
    description: "Thông tin và tối đa 20 tin nhắn gần nhất của một hội thoại trong Suối Nguồn, theo id hội thoại (UUID).",
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
    name: "quy_tac_tu_dong",
    permission: "dashboard.view",
    label: "Xem quy tắc tự động",
    description: "Các quy tắc tự động người dùng đã tạo (quản trị viên thấy của mọi người): tên, mô tả, đang bật/tắt, lần khớp gần nhất. Bật/tắt/xóa quy tắc thực hiện ở trang có link trả về.",
    parameters: noArgs,
    args: z.object({}).strict(),
  },
  {
    name: "kho_mau_content",
    permission: "content.view",
    label: "Xem Kho mẫu",
    description: "Danh sách mẫu content đang dùng (mã mẫu, bộ phận, nhóm, ngôn ngữ, đoạn đầu) để chọn mẫu khi tạo content.",
    parameters: { type: "object", additionalProperties: false, required: ["bo_phan"], properties: { bo_phan: { type: ["string", "null"], enum: ["SALE", "HR", "REC", "MEDIA", "NOTICE", "CTV", null], description: "Lọc theo bộ phận, hoặc null." } } },
    args: z.object({ bo_phan: z.enum(["SALE", "HR", "REC", "MEDIA", "NOTICE", "CTV"]).nullable() }).strict(),
  },
  {
    name: "kho_content",
    permission: "content.view",
    label: "Xem Kho content",
    description: "Kho content: tổng số, các yêu cầu tạo content 7 ngày qua và kết quả, tìm content theo mã/tiêu đề/job.",
    parameters: { type: "object", additionalProperties: false, required: ["tu_khoa"], properties: { tu_khoa: nullableString("Mã (CT-000001), tiêu đề hoặc tên job; null để xem tổng quan.") } },
    args: z.object({ tu_khoa: text(100).nullable() }).strict(),
  },
  ...READ_TOOLS_2(),
  ...DOCUMENT_TOOLS(),
  ...CRM_READ_TOOLS(),
  ...CALENDAR_TOOLS(),
  ...FILE_TOOLS(),
  ...BROADCAST_TOOLS(),
  ...INBOX_BULK_TOOLS(),
  ...CUSTOMER_TOOLS(),
  ...CAMPAIGN_INSIGHT_TOOLS(),
  ...ROUND_ONE_TOOLS(),
  ...CV_TOOLS(),
  ...DOCUMENT_SAVE_TOOLS(),
  ...PROPOSAL_TOOLS(),
  ...CRM_PROPOSAL_TOOLS(),
  ...CAMPAIGN_PROPOSAL_TOOLS(),
];

export const ASSISTANT_TOOL_NAMES = ASSISTANT_TOOLS.map((tool) => tool.name);

/** Tools this member may use. Document tools also need the panel's "Tài liệu" switch. */
export function toolsFor(permissions: readonly string[], isAdmin: boolean, options: { documents?: boolean } = {}): AssistantToolDefinition[] {
  return ASSISTANT_TOOLS.filter((tool) => (!tool.documents || options.documents === true)
    && (tool.permission === "*" || (tool.permission === "workspace.admin" ? isAdmin : permissions.includes(tool.permission) || (isAdmin && tool.permission === "documents.view"))));
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
