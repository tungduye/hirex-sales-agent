// Recruiter chatbot: the fixed steps of the approved sample chat, once the four intro facts are known.
// 1) introduce one real job (title, company, place, salary, key requirements) and ask about BrSE / management;
// 2) the candidate gives an expected salary → say whether it fits the range and ask the start date;
// 3) the start date is known → ask for the CV (the CV itself hands the chat to a person);
// 4) after a rejection with a reason → the next job. Pure; covered by tests/recruiter-script.test.mjs.

type Job = Record<string, unknown>;
const plain = (value: unknown) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/gu, "d").replace(/\s+/gu, " ").trim();
const PLACE: Record<string, string> = { "ha noi": "Hà Nội", hn: "Hà Nội", "ho chi minh": "HCM", hcm: "HCM", "sai gon": "HCM", japan: "Nhật", nhat: "Nhật", "nhat ban": "Nhật" };
export const placeLabel = (value: unknown) => PLACE[plain(value)] ?? String(value ?? "").trim();
const samePlace = (a: unknown, b: unknown) => { const x = plain(placeLabel(a)), y = plain(placeLabel(b)); return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x)); };
const roleOf = (value: unknown) => { const v = plain(value); return /brse/u.test(v) ? "brse" : /\bpm\b|project manager|quan ly du an/u.test(v) ? "pm" : /dev|developer|\bse\b|engineer/u.test(v) ? "dev" : v; };

/** "55-65M gross" → "55–65 triệu gross"; other ranges as written. */
export function salaryLabel(value: unknown) {
  const text = String(value ?? "").trim();
  return text.replace(/(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*M\b/iu, "$1–$2 triệu").replace(/^(\d+(?:[.,]\d+)?)\s*M\b/iu, "$1 triệu");
}

/** The next job to offer: right role, in the candidate's places (first-named first), not offered or refused before. */
export function nextScriptJob<T extends Job>(profile: Record<string, unknown>, jobs: readonly T[], offered: string[], eligible: Set<string>): T | null {
  const places = [profile.location, ...(Array.isArray(profile.preferred_locations) ? profile.preferred_locations : [])].filter((value) => typeof value === "string" && value.trim());
  const role = roleOf(profile.candidate_type);
  const open = jobs.filter((job) => eligible.has(String(job.external_job_id)) && !offered.includes(String(job.external_job_id)) && job.active !== false &&
    (!role || roleOf(job.candidate_type ?? job.job_title) === role || plain(`${job.job_title ?? ""} ${job.candidate_type ?? ""}`).includes(role)));
  for (const place of places) {
    const here = open.filter((job) => samePlace(job.location, place))
      .sort((a, b) => Number(b.sale_stage === "first_job") - Number(a.sale_stage === "first_job") || (Number(a.priority ?? 999) - Number(b.priority ?? 999)) || String(a.external_job_id).localeCompare(String(b.external_job_id)));
    if (here[0]) return here[0];
  }
  return null;
}

function requirementsLabel(job: Job) {
  const parts = [typeof job.japanese_level_min === "string" && job.japanese_level_min.trim() ? job.japanese_level_min.trim() : "",
    /trao doi.*(?:khach|tieng) nhat|giao tiep.*(?:khach|tieng) nhat|khach hang nhat/u.test(plain(`${job.requirements ?? ""} ${job.summary ?? ""}`)) ? "trao đổi trực tiếp với khách Nhật" : ""].filter(Boolean);
  return parts.join(" và ");
}

function closingQuestion(profile: Record<string, unknown>) {
  return roleOf(profile.candidate_type) === "dev"
    ? "Anh có bao nhiêu năm kinh nghiệm phát triển, chủ yếu với công nghệ nào ạ?"
    : "Anh đã từng làm BrSE chính, hay kiêm cả phần quản lý dự án ạ?";
}

/** Step 1: the first job, once the four intro facts are known. */
export function jobIntroduction(job: Job, profile: Record<string, unknown>) {
  const salary = salaryLabel(job.salary_range);
  const requirements = requirementsLabel(job);
  return `Với kinh nghiệm này em thấy vị trí ${String(job.job_title)} tại ${String(job.company_name)} (${placeLabel(job.location)}${salary ? `, khoảng ${salary}` : ""}) khá sát với anh${requirements ? `: vị trí yêu cầu ${requirements}` : ""}. ${closingQuestion(profile)}`;
}

/** Step 4: the next job after the candidate said why the last one does not fit. */
export function nextJobIntroduction(job: Job) {
  const salary = salaryLabel(job.salary_range);
  const requirements = requirementsLabel(job);
  return `Em còn vị trí ${String(job.job_title)} tại ${String(job.company_name)} (${placeLabel(job.location)}${salary ? `, khoảng ${salary}` : ""})${requirements ? `, yêu cầu ${requirements}` : ""}. Anh xem hướng này có phù hợp với mình không ạ?`;
}

/** Numbers and unit of a salary ("60tr", "55-65M gross", "up to 900 man"). */
function money(value: unknown) {
  const text = plain(value);
  const unit = /\bman\b|万|jpy|yen/u.test(text) ? "man" : /\b(?:m|tr|trieu|cu|million)\b|\d\s*(?:m|tr)\b/u.test(text) ? "trieu" : null;
  const numbers = [...text.matchAll(/\d+(?:[.,]\d+)?/gu)].map((match) => Number(match[0].replace(",", ".")));
  return { unit, numbers };
}

/** Step 2: the candidate's expected salary against the job's range, then the start date. */
export function salaryFollowup(expected: unknown, job: Job) {
  const said = String(expected ?? "").trim();
  if (!said) return null;
  const company = typeof job.company_name === "string" && job.company_name.trim() ? job.company_name.trim() : "vị trí này";
  const ask = "Anh dự kiến có thể bắt đầu công việc mới từ thời điểm nào nhé.";
  const want = money(said), range = money(job.salary_range);
  const upTo = /up to|toi da|den\b/u.test(plain(job.salary_range));
  const low = upTo ? 0 : range.numbers[0], high = range.numbers.at(-1);
  if (want.numbers.length && range.numbers.length && want.unit && want.unit === range.unit && low !== undefined && high !== undefined) {
    const value = want.numbers[0]!;
    if (value <= high && value >= low) return `Mức ${said} nằm trong range của ${company}. ${ask}`;
    if (value > high) return `Mức ${said} cao hơn range của ${company} (${salaryLabel(job.salary_range)}) một chút, em sẽ trao đổi thêm với khách. ${ask}`;
  }
  return `Em sẽ trao đổi mức ${said} với ${company}. ${ask}`;
}

/** Step 3: the start date is known. */
export const CV_REQUEST = "Dạ vâng ạ. Anh gửi em CV mới nhất để em chuyển recruiter phụ trách đặt lịch phỏng vấn cho anh nhé.";
/** Between steps 1 and 2: the candidate answered about experience but named no salary. */
export const SALARY_QUESTION = "Mức thu nhập anh mong muốn cho vị trí này khoảng bao nhiêu ạ?";
