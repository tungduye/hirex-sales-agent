// Bảng Job: the jobs recruiters offer to candidates. Hola, Hole (and later AI Recruiter) only use
// jobs that are "Đang tuyển", and only the facts written here. Pure helpers, unit-tested.

export const JOB_STATUSES = ["OPEN", "PAUSED", "CLOSED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABEL: Record<JobStatus, string> = { OPEN: "Đang tuyển", PAUSED: "Tạm dừng", CLOSED: "Đã đóng" };

export const JOB_PRIORITIES = ["HIGH", "NORMAL"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];
export const JOB_PRIORITY_LABEL: Record<JobPriority, string> = { HIGH: "Cao", NORMAL: "Thường" };

/** Suggestions only: any career track can be typed. */
export const CAREER_TRACKS = ["BrSE", "PM", "SE", "Developer", "QA/Tester", "Comtor", "Khác"] as const;
export const WORK_MODES = ["Onsite", "Hybrid", "Remote"] as const;
export const JAPANESE_LEVELS = ["Không yêu cầu", "N1", "N2", "N3", "N4", "N5"] as const;
/** Days without an update after which a job is flagged for a check. */
export const STALE_DAYS = 30;

export interface JobInput {
  code: string | null;
  title: string;
  careerTrack: string;
  companyName: string;
  companyNamePublic: boolean;
  location: string;
  workMode: string | null;
  japaneseLevelMin: string | null;
  experienceMin: string | null;
  salaryRange: string | null;
  sellingPoints: string | null;
  summary: string | null;
  requirements: string | null;
  jdLink: string | null;
  interviewProcess: string | null;
  status: JobStatus;
  priority: JobPriority;
  note: string | null;
}

export interface Job extends JobInput {
  id: string;
  code: string;
  ownerId: string | null;
  ownerName: string | null;
  updatedAt: string;
}

/** Text limits per field (characters). */
export const LIMITS: Record<keyof Omit<JobInput, "companyNamePublic" | "status" | "priority">, number> = {
  code: 40, title: 200, careerTrack: 60, companyName: 200, location: 200, workMode: 40, japaneseLevelMin: 40, experienceMin: 120,
  salaryRange: 120, sellingPoints: 2000, summary: 3000, requirements: 3000, jdLink: 1000, interviewProcess: 1000, note: 2000,
};

/** Excel columns: header text → field. The template and the import use the same headers. */
export const EXCEL_COLUMNS: Array<{ header: string; field: keyof JobInput; width: number; hint?: string }> = [
  { header: "Mã job", field: "code", width: 12, hint: "Để trống: tự tạo" },
  { header: "Vị trí", field: "title", width: 28 },
  { header: "Hướng nghề", field: "careerTrack", width: 14, hint: CAREER_TRACKS.join(" / ") },
  { header: "Công ty", field: "companyName", width: 26 },
  { header: "Được nói tên công ty", field: "companyNamePublic", width: 14, hint: "Có / Không" },
  { header: "Địa điểm", field: "location", width: 22 },
  { header: "Hình thức", field: "workMode", width: 12, hint: WORK_MODES.join(" / ") },
  { header: "Tiếng Nhật tối thiểu", field: "japaneseLevelMin", width: 14 },
  { header: "Kinh nghiệm tối thiểu", field: "experienceMin", width: 20 },
  { header: "Khoảng lương", field: "salaryRange", width: 20 },
  { header: "Điểm hấp dẫn", field: "sellingPoints", width: 30 },
  { header: "Mô tả công việc", field: "summary", width: 40 },
  { header: "Yêu cầu chính", field: "requirements", width: 40 },
  { header: "Link JD", field: "jdLink", width: 30 },
  { header: "Quy trình phỏng vấn", field: "interviewProcess", width: 26 },
  { header: "Trạng thái", field: "status", width: 12, hint: "Đang tuyển / Tạm dừng / Đã đóng" },
  { header: "Ưu tiên", field: "priority", width: 10, hint: "Cao / Thường" },
  { header: "Ghi chú", field: "note", width: 30 },
];

const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().replace(/\s+/gu, " ").trim();

/** Cleans one text value: trims, drops control characters, caps the length. Empty → null. */
export function cleanText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = (value instanceof Date ? value.toISOString().slice(0, 10) : String(value))
    .normalize("NFC").replace(/\r\n?/gu, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim();
  return text ? text.slice(0, max) : null;
}

export function parseStatus(value: unknown): JobStatus | null {
  const text = fold(String(value ?? ""));
  if (!text) return null;
  if (["open", "dang tuyen", "active", "true", "1", "co"].includes(text)) return "OPEN";
  if (["paused", "tam dung", "tam ngung"].includes(text)) return "PAUSED";
  if (["closed", "da dong", "dong", "inactive", "false", "0", "khong"].includes(text)) return "CLOSED";
  return null;
}

export function parsePriority(value: unknown): JobPriority | null {
  const text = fold(String(value ?? ""));
  if (!text) return null;
  if (["high", "cao", "uu tien"].includes(text)) return "HIGH";
  if (["normal", "thuong", "binh thuong"].includes(text)) return "NORMAL";
  return null;
}

export function parseYesNo(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  const text = fold(String(value ?? ""));
  if (!text) return fallback;
  if (["co", "yes", "true", "1", "x", "duoc"].includes(text)) return true;
  if (["khong", "no", "false", "0", "an", "an danh"].includes(text)) return false;
  return fallback;
}

/** A JD link must be an http(s) URL. */
export function cleanLink(value: unknown): string | null {
  const text = cleanText(value, LIMITS.jdLink);
  if (!text) return null;
  try { const url = new URL(text); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; } catch { return null; }
}

export type JobInputResult = { ok: true; value: JobInput } | { ok: false; error: string };

/** One job from a form or an Excel row (raw values by field). Required: vị trí, hướng nghề, công ty, địa điểm. */
export function toJobInput(raw: Partial<Record<keyof JobInput, unknown>>): JobInputResult {
  const text = (field: keyof typeof LIMITS) => cleanText(raw[field], LIMITS[field]);
  const title = text("title"), careerTrack = text("careerTrack"), companyName = text("companyName"), location = text("location");
  const missing = [!title && "Vị trí", !careerTrack && "Hướng nghề", !companyName && "Công ty", !location && "Địa điểm"].filter(Boolean);
  if (missing.length) return { ok: false, error: `Thiếu ${missing.join(", ")}.` };
  const code = text("code");
  if (code && !/^[\p{L}\p{N}._\-/]{1,40}$/u.test(code)) return { ok: false, error: "Mã job chỉ gồm chữ, số và . _ - /" };
  const rawLink = cleanText(raw.jdLink, LIMITS.jdLink);
  const jdLink = cleanLink(raw.jdLink);
  if (rawLink && !jdLink) return { ok: false, error: "Link JD phải bắt đầu bằng http:// hoặc https://" };
  const status = raw.status === undefined || raw.status === null || raw.status === "" ? "OPEN" : parseStatus(raw.status);
  if (!status) return { ok: false, error: "Trạng thái phải là Đang tuyển, Tạm dừng hoặc Đã đóng." };
  const priority = raw.priority === undefined || raw.priority === null || raw.priority === "" ? "NORMAL" : parsePriority(raw.priority);
  if (!priority) return { ok: false, error: "Ưu tiên phải là Cao hoặc Thường." };
  return { ok: true, value: {
    code, title: title!, careerTrack: careerTrack!, companyName: companyName!, companyNamePublic: parseYesNo(raw.companyNamePublic, true), location: location!,
    workMode: text("workMode"), japaneseLevelMin: text("japaneseLevelMin"), experienceMin: text("experienceMin"), salaryRange: text("salaryRange"),
    sellingPoints: text("sellingPoints"), summary: text("summary"), requirements: text("requirements"), jdLink, interviewProcess: text("interviewProcess"),
    status, priority, note: text("note"),
  } };
}

/** Maps a header row to fields (headers matched without accents or case). Unknown headers are ignored. */
export function mapHeaders(headers: unknown[]): Array<keyof JobInput | null> {
  const known = new Map(EXCEL_COLUMNS.map((column) => [fold(column.header), column.field]));
  return headers.map((header) => known.get(fold(String(header ?? ""))) ?? null);
}

/** Rows of a sheet (first row = headers) → jobs to save and per-row problems (row numbers as in Excel). */
export function parseJobSheet(rows: unknown[][], maxRows = 500): { jobs: JobInput[]; problems: Array<{ row: number; error: string }> } {
  const [header = [], ...body] = rows;
  const fields = mapHeaders(header);
  if (!fields.includes("title") || !fields.includes("companyName")) return { jobs: [], problems: [{ row: 1, error: "Không thấy cột \"Vị trí\" và \"Công ty\". Hãy dùng file mẫu." }] };
  const jobs: JobInput[] = [], problems: Array<{ row: number; error: string }> = [];
  body.slice(0, maxRows).forEach((cells, index) => {
    if (!cells.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "")) return;
    const raw: Partial<Record<keyof JobInput, unknown>> = {};
    fields.forEach((field, column) => { if (field) raw[field] = cells[column]; });
    const result = toJobInput(raw);
    if (result.ok) jobs.push(result.value); else problems.push({ row: index + 2, error: result.error });
  });
  if (body.length > maxRows) problems.push({ row: maxRows + 2, error: `Chỉ nhập tối đa ${maxRows} dòng mỗi lần.` });
  return { jobs, problems };
}

export function isStale(updatedAt: string, now: number): boolean {
  const at = Date.parse(updatedAt);
  return Number.isFinite(at) && now - at > STALE_DAYS * 86_400_000;
}

/** Location group used to match a candidate's area: Hà Nội, HCM, Nhật or the place itself. */
export function locationGroup(location: string): string {
  const text = fold(location);
  if (/\b(ha noi|hn|hanoi)\b/u.test(text)) return "Hà Nội";
  if (/\b(ho chi minh|hcm|hcmc|sai gon|saigon|tp hcm)\b/u.test(text)) return "HCM";
  if (/\b(nhat|japan|tokyo|osaka|nagoya|fukuoka|yokohama)\b/u.test(text)) return "Nhật";
  if (/\bda nang\b/u.test(text)) return "Đà Nẵng";
  return location.trim();
}
