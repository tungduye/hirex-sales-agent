// JD (Word) from a job of the job board, using only what is stored for that job. Pure; unit-tested.
export interface JdJob {
  code: string; title: string; careerTrack: string; companyName: string; companyNamePublic: boolean; location: string; workMode: string | null;
  japaneseLevelMin: string | null; experienceMin: string | null; salaryRange: string | null; sellingPoints: string | null; summary: string | null;
  requirements: string | null; interviewProcess: string | null; jdLink: string | null;
}

/** Text with one item per line ("- a", "• b", "1. c" or plain lines) as Markdown bullets. */
function asList(value: string) {
  const lines = value.split(/\r?\n/u).map((line) => line.trim().replace(/^([-*•+]|\d{1,2}[.)])\s+/u, "")).filter(Boolean);
  return lines.length > 1 ? lines.map((line) => `- ${line}`).join("\n") : value.trim();
}

export function jdMarkdown(job: JdJob, options: { hideCompany: boolean; contact: string | null }) {
  const company = options.hideCompany ? "Công ty Nhật Bản (thông tin chi tiết trao đổi khi ứng tuyển)" : job.companyName;
  const rows: Array<[string, string | null]> = [
    ["Vị trí", job.title], ["Mã job", job.code], ["Hướng nghề", job.careerTrack], ["Công ty", company], ["Địa điểm", job.location],
    ["Hình thức", job.workMode], ["Tiếng Nhật", job.japaneseLevelMin], ["Kinh nghiệm", job.experienceMin], ["Mức lương", job.salaryRange],
  ];
  const cell = (value: string) => value.replace(/\|/gu, "/").replace(/\s*\n\s*/gu, "; ");
  return [
    `# ${job.title}${options.hideCompany ? "" : ` – ${job.companyName}`}`,
    "## Thông tin chung",
    "| Mục | Chi tiết |", "|---|---|",
    ...rows.filter(([, value]) => value && value.trim()).map(([label, value]) => `| ${label} | ${cell(value!)} |`),
    ...(job.summary ? ["## Mô tả công việc", asList(job.summary)] : []),
    ...(job.requirements ? ["## Yêu cầu", asList(job.requirements)] : []),
    ...(job.sellingPoints ? ["## Điểm hấp dẫn", asList(job.sellingPoints)] : []),
    ...(job.interviewProcess ? ["## Quy trình phỏng vấn", asList(job.interviewProcess)] : []),
    ...(job.jdLink ? ["## JD chi tiết", job.jdLink] : []),
    ...(options.contact ? ["## Liên hệ", options.contact] : []),
  ].join("\n\n");
}

/** What the writer model may return: the Markdown subset, without a code fence around it. */
export function cleanWrittenMarkdown(text: string) {
  return text.trim().replace(/^```(?:markdown|md)?\s*\n/iu, "").replace(/\n```\s*$/u, "").trim().slice(0, 40_000);
}
