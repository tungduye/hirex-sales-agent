// "Mở trang": links to the app's pages (with filters) for Trợ lý HireX. A page is only offered when the
// member can open it, using the same permission the page itself checks. Pure; unit-tested.

export type PageAccess = { permissions: readonly string[]; isAdmin: boolean };

type PageDefinition = { path: string; label: string; permission: string | "workspace.admin" };

export const PAGES = {
  TONG_QUAN: { path: "/", label: "Tổng quan", permission: "dashboard.view" },
  HO_CHUA: { path: "/inbox/all", label: "Hồ Chứa", permission: "inbox.view" },
  LIEN_HE: { path: "/contacts", label: "Liên hệ", permission: "contacts.view" },
  CONG_TY: { path: "/companies", label: "Công ty", permission: "companies.view" },
  CHIEN_DICH_EMAIL: { path: "/campaigns", label: "Chiến dịch Email", permission: "campaigns.view" },
  CHIEN_DICH_ZALO: { path: "/campaigns/omnichannel", label: "Chiến dịch Zalo", permission: "campaigns.view" },
  CHIEN_DICH_FACEBOOK: { path: "/campaigns/facebook-profile", label: "Chiến dịch Facebook cá nhân", permission: "campaigns.view" },
  TAO_CHIEN_DICH: { path: "/campaigns/new", label: "Tạo chiến dịch Email", permission: "campaigns.create" },
  KHO_CONTENT: { path: "/content", label: "Kho content", permission: "content.view" },
  KHO_MAU: { path: "/content/templates", label: "Kho mẫu", permission: "content.view" },
  CONG_VIEC: { path: "/tasks", label: "Công việc", permission: "tasks.view" },
  PHAN_TICH: { path: "/analytics", label: "Phân tích", permission: "analytics.view" },
  TAI_LIEU: { path: "/documents", label: "Thư viện tài liệu", permission: "workspace.admin" },
  SCAN_CV: { path: "/scan/cv", label: "Scan CV", permission: "scan.cv" },
  SCAN_WEBSITE: { path: "/scan/website", label: "Scan Website", permission: "scan.website" },
  QUY_TAC: { path: "/assistant/rules", label: "Quy tắc tự động của trợ lý", permission: "dashboard.view" },
  CAI_DAT: { path: "/settings", label: "Cài đặt chung", permission: "settings.view" },
  KENH_KET_NOI: { path: "/settings/channels", label: "Tài khoản kết nối", permission: "channels.view" },
  VAI_TRO: { path: "/settings/roles", label: "Vai trò & phân quyền", permission: "roles.view" },
  DANH_SACH_CHAN: { path: "/settings/suppressions", label: "Danh sách chặn gửi", permission: "settings.view" },
  TU_DONG_HOA: { path: "/settings/automation", label: "Tự động hoá", permission: "workspace.admin" },
  AI_RECRUITER: { path: "/settings/ai-recruiter", label: "AI Recruiter", permission: "workspace.admin" },
  KET_NOI_HUMAN: { path: "/settings/human", label: "Kết nối Human", permission: "workspace.admin" },
} satisfies Record<string, PageDefinition>;

export type PageKey = keyof typeof PAGES;
export const PAGE_KEYS = Object.keys(PAGES) as PageKey[];

const LEAD_STATUSES = ["NEW", "CONTACTED", "ENGAGED", "QUALIFIED", "OPPORTUNITY", "WON", "LOST", "DO_NOT_CONTACT"];
const CAMPAIGN_STATUSES = ["DRAFT", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED"];
const INBOX_CHANNELS = ["ZALO", "FACEBOOK", "FACEBOOK_PROFILE", "EMAIL"];
const CONTENT_FORMATS = ["EMAIL", "POST_LONG", "POST_MEDIUM", "POST_SHORT", "COMMENT"];
const CONTENT_DEPARTMENTS = ["SALE", "HR", "REC", "MEDIA", "NOTICE", "CTV"];
const CONTENT_LANGUAGES = ["VI", "EN", "JA", "VI_EN", "VI_JA", "EN_JA"];

export interface PageFilters { tu_khoa?: string | null; trang_thai?: string | null; kenh?: string | null; dinh_dang?: string | null; bo_phan?: string | null; ngon_ngu?: string | null }

export function canOpenPage(page: PageKey, access: PageAccess) {
  const permission = PAGES[page].permission;
  return permission === "workspace.admin" ? access.isAdmin : access.permissions.includes(permission);
}

/** Pages this member can open (for the tool description and error messages). */
export function openablePages(access: PageAccess) {
  return PAGE_KEYS.filter((page) => canOpenPage(page, access));
}

/**
 * Link to a page with the filters that page understands (others are reported as ignored, never
 * silently dropped). Null link when the member cannot open the page.
 */
export function pageLink(page: PageKey, filters: PageFilters, access: PageAccess) {
  const definition = PAGES[page];
  if (!definition) return { loi: "Trang không tồn tại." };
  if (!canOpenPage(page, access)) return { loi: `Tài khoản chưa có quyền mở trang ${definition.label}.` };
  const params = new URLSearchParams();
  const used = new Set<keyof PageFilters>();
  const keyword = filters.tu_khoa?.trim().slice(0, 100) || null;
  const upper = (value: string | null | undefined) => value?.trim().toUpperCase() || null;
  const take = (name: keyof PageFilters, param: string, value: string | null, allowed?: string[]) => {
    if (!value || (allowed && !allowed.includes(value))) return;
    params.append(param, value);
    used.add(name);
  };
  switch (page) {
    case "LIEN_HE": take("tu_khoa", "q", keyword); take("trang_thai", "status", upper(filters.trang_thai), LEAD_STATUSES); break;
    case "CHIEN_DICH_EMAIL": take("tu_khoa", "q", keyword); take("trang_thai", "status", upper(filters.trang_thai), CAMPAIGN_STATUSES); break;
    case "HO_CHUA": take("kenh", "channel", upper(filters.kenh), INBOX_CHANNELS); break;
    case "KHO_CONTENT":
      take("tu_khoa", "q", keyword);
      take("dinh_dang", "format", upper(filters.dinh_dang), CONTENT_FORMATS);
      take("bo_phan", "dept", upper(filters.bo_phan), CONTENT_DEPARTMENTS);
      take("ngon_ngu", "lang", upper(filters.ngon_ngu), CONTENT_LANGUAGES);
      break;
    case "TAI_LIEU": take("tu_khoa", "q", keyword); break;
    default: break;
  }
  const ignored = (Object.keys(filters) as (keyof PageFilters)[]).filter((name) => filters[name] && !used.has(name));
  const search = params.toString();
  return {
    trang: definition.label,
    link: search ? `${definition.path}?${search}` : definition.path,
    ...(ignored.length ? { bo_loc_khong_ap_dung: ignored, ghi_chu: "Trang này không lọc sẵn theo các mục trên; người dùng tự lọc trên trang." } : {}),
  };
}
