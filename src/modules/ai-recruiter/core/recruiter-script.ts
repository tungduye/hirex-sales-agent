// Recruiter chatbot: the fixed steps once the four intro facts are known, following the Rec team's sales sample
// (senior BrSE/PM candidates: full, polite sentences, never a curt one-liner):
// 1) introduce one real job (company, place, company facts, rank, salary) and ask "anh đã từng apply công ty này chưa";
// 2) already applied → the next job from another company ("anh từng biết bên này chưa"); a second one → stop, a person checks;
// 3) not applied → a line on the interview process (only from the job data) + expected salary and when they could start;
// 4) salary and start known → the salary range + the job's salary note (only from the job data) + "CV hiện tại hoặc CV cũ";
// 5) no CV yet → send the old one, a person follows up; CV received → thanks and closing. Pure; tests/recruiter-script.test.mjs.

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

const clause = (value: unknown) => String(value ?? "").trim().replace(/[.。;]+$/u, "");
/** "Công ty hơn 2000 nhân sự" → "công ty hơn 2000 nhân sự" (names such as "VTI" keep their case). */
const lowerFirst = (text: string) => (/^\p{Lu}\p{Ll}/u.test(text) ? text[0].toLocaleLowerCase("vi-VN") + text.slice(1) : text);
const companyOf = (job: Job) => clause(job.company_name) || "bên dự án";

/** The rank the company is hiring: the title without its "tại …" tail ("BrSE/PM tại VTI Building" → "BrSE/PM"). */
function rankOf(job: Job) {
  return clause(job.job_title).replace(/\s+tại\s+.+$/iu, "").trim() || clause(job.candidate_type);
}
/** Where: the building named in the title when the company facts do not already say it, then the city. */
function whereOf(job: Job) {
  const city = placeLabel(job.location);
  const building = clause(job.job_title).match(/\s+tại\s+(.+)$/iu)?.[1]?.trim() ?? "";
  const facts = plain(job.summary);
  return building && plain(building) !== plain(job.company_name) && !facts.includes(plain(building)) ? [building, city].filter(Boolean).join(", ") : city;
}
function salaryPhrase(job: Job) {
  const salary = salaryLabel(job.salary_range);
  if (!salary) return "";
  return /^up to\s+/iu.test(salary) ? `lương lên tới ${salary.replace(/^up to\s+/iu, "")}` : `lương tầm ${salary}`;
}
/** "VTI ở Hà Nội, công ty hơn 2000 nhân sự, văn phòng riêng tại VTI Building" */
function companyLine(job: Job) {
  const facts = clause(job.summary);
  return `${companyOf(job)} ở ${whereOf(job)}${facts ? `, ${lowerFirst(facts)}` : ""}`;
}

/** What the candidate told about themselves, to open the first job naturally (only known facts, no praise). */
function profileOpening(profile: Record<string, unknown>) {
  const level = typeof profile.japanese_level === "string" && profile.japanese_level.trim() ? `tiếng Nhật ${profile.japanese_level.trim()}` : "";
  const years = typeof profile.japan_years === "number" && profile.japan_years > 0 ? `${profile.japan_years} năm sống và làm việc bên Nhật` : "";
  const known = [level, years].filter(Boolean).join(" và ");
  return known ? `Dạ với ${known} thì em đang có một job khá sát với anh ạ.` : "Dạ vâng anh ạ.";
}

/** Step 1: the first job, once the four intro facts are known. */
export function jobIntroduction(job: Job, profile: Record<string, unknown>) {
  const salary = salaryPhrase(job);
  return `${profileOpening(profile)}\n\nEm đang có job của ${companyLine(job)}, đợt này công ty lấy rank ${rankOf(job)}${salary ? ` ${salary}` : ""} anh ạ. Anh đã từng apply công ty này chưa ạ?`;
}

/** Step 2: the next job, after the candidate already applied to (or said why not) the last one. */
export function nextJobIntroduction(job: Job) {
  const salary = salaryPhrase(job);
  return `Vâng anh ơi, để em check bên dự án một chút. Nay em thấy có 1 job của ${companyLine(job)}, bên này lấy rank ${rankOf(job)}${salary ? ` ${salary}` : ""} anh ạ. Anh từng biết bên này chưa để em giới thiệu thêm đến anh ạ?`;
}

/** The candidate's answer to "anh đã từng apply công ty này chưa" / "anh từng biết bên này chưa", or null. */
export function appliedAnswer(text: string, lastAsked: string): "applied" | "not_applied" | null {
  if (!/apply cong ty nay chua|biet ben nay chua|ung tuyen (?:ben|cong ty) nay chua/u.test(plain(lastAsked))) return null;
  const value = plain(text).replace(/[.!?~,;:]+/gu, " ").replace(/\s+/gu, " ").trim();
  // "chưa phù hợp", "không quan tâm", "xa quá": a reason about the job, not an answer about applying.
  if (!value || /\b(?:phu hop|hop lam|thich|quan tam|xa qua|thap qua|avail)\b/u.test(value)) return null;
  const done = /\b(?:apply|ung tuyen|phong van|nop cv|gui cv) (?:roi|ben nay roi)\b|\b(?:da|tung) (?:apply|ung tuyen|phong van|nop cv)\b|\bfail\b|\btruot\b/u.test(value);
  if (!done && /\b(?:chua|khong|ko|k|kh|chua tung|chua bao gio)\b/u.test(value)) return "not_applied";
  if (done || /^(?:roi|da|co|dung|biet roi|co roi|da roi)\b/u.test(value)) return "applied";
  return null;
}

/** Numbers and unit of a salary ("60tr", "55-65M gross", "up to 900 man"). */
function money(value: unknown) {
  const text = plain(value);
  const unit = /\bman\b|万|jpy|yen/u.test(text) ? "man" : /\b(?:m|tr|trieu|cu|million)\b|\d\s*(?:m|tr)\b/u.test(text) ? "trieu" : null;
  const numbers = [...text.matchAll(/\d+(?:[.,]\d+)?/gu)].map((match) => Number(match[0].replace(",", ".")));
  return { unit, numbers };
}

/** The candidate's expected salary against the job's range, as one sentence ending in "ạ". */
function salaryFit(said: string, job: Job) {
  const company = companyOf(job), range = salaryLabel(job.salary_range);
  const want = money(said), offer = money(job.salary_range);
  const upTo = /up to|toi da|den\b/u.test(plain(job.salary_range));
  const low = upTo ? 0 : offer.numbers[0], high = offer.numbers.at(-1);
  if (want.numbers.length && offer.numbers.length && want.unit && want.unit === offer.unit && low !== undefined && high !== undefined) {
    const value = want.numbers[0]!;
    if (value <= high && value >= low) return `mức ${said} nằm trong khung lương bên ${company} đang lấy (${range}) anh ạ.`;
    if (value > high) return `mức ${said} cao hơn khung bên ${company} đang lấy (${range}) một chút, em sẽ trao đổi thêm với bên dự án xem có linh động được không ạ.`;
  }
  return `mức ${said} em sẽ trao đổi lại với bên ${company} ạ.`;
}

/** Both at once, as the Rec team asks it. */
export const SALARY_QUESTION = "Anh expect lương khoảng nào và nếu đáp ứng được thì lúc nào anh sang được ạ?";

/** Step 3: the candidate has not applied → the interview process (job data only) + salary and start. */
export function processPitch(job: Job) {
  const process = clause(job.process_summary);
  return `Vâng anh, ${process ? `bên ${companyOf(job)} ${lowerFirst(process)} anh ạ.` : `em giới thiệu thêm job này cho anh ạ.`} ${SALARY_QUESTION}`;
}

/** The candidate named a salary but no start date yet. */
export function salaryFollowup(expected: unknown, job: Job) {
  const said = String(expected ?? "").trim();
  if (!said) return null;
  return `Dạ, ${salaryFit(said, job)} Nếu đáp ứng được mức này thì khoảng lúc nào anh có thể sang được ạ?`;
}

/** The candidate named a start date but no salary yet. */
export function startFollowup(job: Job) {
  return `Vâng anh, thời gian đó em sẽ báo lại bên dự án để chủ động sắp xếp ạ. Anh expect mức lương khoảng bao nhiêu để em trao đổi với bên ${companyOf(job)} ạ?`;
}

/** Step 4: salary and start known → the range (when just said), the job's salary note (job data only), the CV. */
export function cvRequest(job: Job, salaryJustSaid: string | null) {
  const note = clause(job.rank_salary_note);
  const fit = salaryJustSaid ? salaryFit(salaryJustSaid, job) : "";
  const parts = [
    fit ? `Vâng anh ạ, ${fit}` : "Vâng anh ạ.",
    note ? `Đợt này bên ${companyOf(job)} ${lowerFirst(note)} anh ạ.` : "",
    "Anh có sẵn CV hiện tại hoặc CV cũ không ạ, gửi giúp em qua đây để em gửi cho PM dự án bên em ạ?",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Step 5a: no CV ready → the old one is fine; a person takes over from here (CV templates, the PM email). */
export const NO_CV_REPLY = "Vâng anh, vậy anh có bản CV cũ thì cứ gửi em trước nếu tiện anh nha, chưa cập nhật cũng không sao ạ. Nếu cần anh cứ bảo em, em gửi anh vài mẫu CV bản doc để anh tham khảo. Em sẽ tổng hợp các thông tin anh em mình vừa trao đổi để gửi anh PM dự án luôn ạ.";
/** Step 5b: the CV arrived → thanks and close; a person takes over. */
export const CV_CLOSING = "Vâng em nhận được CV rồi ạ, em cám ơn anh. Em sẽ gửi CV cùng các thông tin anh em mình vừa trao đổi cho PM dự án. Em cám ơn anh đã dành thời gian để em chia sẻ thêm về job ạ, có gì em liên hệ anh sớm ạ.";
/** The closing, answering a JD request in the same burst: the job's JD link when there is one, else a person sends it. */
export function cvClosing(job: Job | null | undefined, askedJd: boolean) {
  if (!askedJd) return CV_CLOSING;
  const link = typeof job?.jd_link === "string" && /^https?:\/\//u.test(job.jd_link.trim()) ? job.jd_link.trim() : null;
  return `Vâng em nhận được CV rồi ạ, em cám ơn anh. ${link ? `JD chi tiết của vị trí này anh xem ở đây ạ: ${link}` : "JD chi tiết của vị trí này em gửi anh ngay sau đây ạ."} Em sẽ gửi CV cùng các thông tin anh em mình vừa trao đổi cho PM dự án. Em cám ơn anh đã dành thời gian để em chia sẻ thêm về job ạ, có gì em liên hệ anh sớm ạ.`;
}

/** The salary a candidate names ("Lương 60tr được không em", "mong muốn 1500 USD", "tầm 800 man"), as written. */
export function salaryInText(text: string) {
  const match = text.match(/(\d+(?:[.,]\d+)?\s*(?:-|–|đến|~)?\s*\d*(?:[.,]\d+)?\s*(?:tr\b|triệu|trieu|củ|cu\b|m\b|man\b|万|usd|\$|jpy|yên))/iu);
  if (!match) return null;
  const value = match[1]!.trim();
  // A bare count of years/people is not a salary.
  return /(?:năm|nam|người|nguoi)\s*$/iu.test(value) ? null : value;
}

/** A start date answering "bắt đầu công việc mới từ thời điểm nào" ("Tháng 12 anh nghỉ được", "2 tuần nữa", "ngay"). */
export function startDateInText(text: string, lastAsked: string) {
  if (!/thoi diem nao|bat dau cong viec|luc nao anh (?:co the )?sang/u.test(plain(lastAsked))) return null;
  const value = plain(text);
  if (/\b(?:thang\s*\d{1,2}|\d{1,2}\/\d{1,2}|\d+\s*(?:tuan|ngay|thang)|tuan sau|thang sau|ngay|luon|sau tet|dau nam|cuoi nam|dau thang|cuoi thang|q[1-4]|luc nao cung|bat (?:cu|ky) luc nao|nam sau)\b/u.test(value))
    return text.trim().slice(0, 120);
  return null;
}
