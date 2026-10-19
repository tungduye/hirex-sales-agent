"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { hasPermission } from "@/modules/access/server/access-control";
import { JOB_STATUSES, locationGroup, parseJobSheet, toJobInput, type JobInput } from "../core/job-fields";

export interface JobActionState { status: "idle" | "success" | "error"; message: string | null }
export interface JobImportResult { status: "success" | "error"; message: string; added: number; updated: number; problems: Array<{ row: number; error: string }> }

const uuid = z.string().uuid();

async function manager() {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete || !await hasPermission("jobs.manage")) return null;
  return { ...account, workspaceId: account.workspaceId };
}

function toRow(input: JobInput, workspaceId: string, userId: string) {
  return {
    workspace_id: workspaceId, title: input.title, career_track: input.careerTrack, company_name: input.companyName,
    company_name_public: input.companyNamePublic, location: input.location, location_group: locationGroup(input.location),
    work_mode: input.workMode, japanese_level_min: input.japaneseLevelMin, experience_min: input.experienceMin, salary_range: input.salaryRange,
    selling_points: input.sellingPoints, summary: input.summary, requirements: input.requirements, jd_link: input.jdLink,
    interview_process: input.interviewProcess, status: input.status, priority: input.priority, note: input.note, updated_by: userId,
  };
}

/** Adds a job (no id) or saves an edited one. Needs "Job · Quản lý". */
export async function saveJob(_state: JobActionState, formData: FormData): Promise<JobActionState> {
  const account = await manager();
  if (!account) return { status: "error", message: "Tài khoản của bạn chưa có quyền quản lý Job." };
  const id = formData.get("id");
  if (id && !uuid.safeParse(id).success) return { status: "error", message: "Không tìm thấy job." };
  const field = (name: string) => formData.get(name);
  const result = toJobInput({
    code: field("code"), title: field("title"), careerTrack: field("careerTrack"), companyName: field("companyName"),
    companyNamePublic: field("companyNamePublic") === "on" || field("companyNamePublic") === "true", location: field("location"),
    workMode: field("workMode"), japaneseLevelMin: field("japaneseLevelMin"), experienceMin: field("experienceMin"), salaryRange: field("salaryRange"),
    sellingPoints: field("sellingPoints"), summary: field("summary"), requirements: field("requirements"), jdLink: field("jdLink"),
    interviewProcess: field("interviewProcess"), status: field("status"), priority: field("priority"), note: field("note"),
  });
  if (!result.ok) return { status: "error", message: result.error };
  const ownerRaw = field("ownerId");
  const ownerId = typeof ownerRaw === "string" && uuid.safeParse(ownerRaw).success ? ownerRaw : null;
  const supabase = await createClient();
  const row = { ...toRow(result.value, account.workspaceId, account.userId), owner_id: ownerId, ...(result.value.code ? { code: result.value.code } : {}) };
  const query = typeof id === "string" && id
    ? supabase.from("recruitment_jobs").update(row).eq("id", id).eq("workspace_id", account.workspaceId).select("id").maybeSingle()
    : supabase.from("recruitment_jobs").insert({ ...row, created_by: account.userId }).select("id").maybeSingle();
  const { data, error } = await query;
  if (error?.code === "23505") return { status: "error", message: "Mã job này đã có. Hãy dùng mã khác hoặc để trống để tự tạo." };
  if (error || !data) return { status: "error", message: "Chưa lưu được job, thử lại sau." };
  revalidatePath("/jobs");
  return { status: "success", message: id ? "Đã lưu job." : "Đã thêm job." };
}

/** Quick status change from the list (Đang tuyển / Tạm dừng / Đã đóng). */
export async function setJobStatus(input: { id: string; status: string }): Promise<JobActionState> {
  const account = await manager();
  if (!account) return { status: "error", message: "Tài khoản của bạn chưa có quyền quản lý Job." };
  if (!uuid.safeParse(input.id).success || !JOB_STATUSES.includes(input.status as never)) return { status: "error", message: "Không đổi được trạng thái." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("recruitment_jobs").update({ status: input.status, updated_by: account.userId })
    .eq("id", input.id).eq("workspace_id", account.workspaceId).select("id").maybeSingle();
  if (error || !data) return { status: "error", message: "Không đổi được trạng thái." };
  revalidatePath("/jobs");
  return { status: "success", message: "Đã đổi trạng thái." };
}

/** Excel import (first sheet, headers as in the template). A row whose "Mã job" exists updates that job; others are added. */
export async function importJobs(formData: FormData): Promise<JobImportResult> {
  const fail = (message: string): JobImportResult => ({ status: "error", message, added: 0, updated: 0, problems: [] });
  const account = await manager();
  if (!account) return fail("Tài khoản của bạn chưa có quyền quản lý Job.");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Chưa chọn file.");
  if (file.size > 5_000_000 || !file.name.toLowerCase().endsWith(".xlsx")) return fail("Chỉ nhận file .xlsx tối đa 5 MB (dùng file mẫu).");
  let rows: unknown[][];
  try { rows = await (await import("read-excel-file/node")).readSheet(Buffer.from(await file.arrayBuffer()), 1) as unknown[][]; }
  catch { return fail("Không đọc được file Excel."); }
  const { jobs, problems } = parseJobSheet(rows);
  if (jobs.length === 0) return { status: "error", message: problems[0]?.error ?? "File không có dòng job nào.", added: 0, updated: 0, problems };
  const supabase = await createClient();
  const codes = [...new Set(jobs.flatMap((job) => job.code ? [job.code] : []))];
  const { data: existing, error: existingError } = codes.length
    ? await supabase.from("recruitment_jobs").select("code").eq("workspace_id", account.workspaceId).in("code", codes)
    : { data: [], error: null };
  if (existingError) return fail("Không kiểm tra được job hiện có, thử lại sau.");
  const known = new Set((existing ?? []).map((row) => String(row.code)));
  const seen = new Set<string>();
  const withCode: Array<ReturnType<typeof toRow> & { code: string }> = [], withoutCode: Array<ReturnType<typeof toRow> & { created_by: string }> = [];
  for (const job of jobs) {
    if (job.code) {
      if (seen.has(job.code)) continue; // the same code twice in the file: the first row wins
      seen.add(job.code);
      withCode.push({ ...toRow(job, account.workspaceId, account.userId), code: job.code });
    } else withoutCode.push({ ...toRow(job, account.workspaceId, account.userId), created_by: account.userId });
  }
  if (withCode.length) {
    const { error } = await supabase.from("recruitment_jobs").upsert(withCode, { onConflict: "workspace_id,code" });
    if (error) return fail("Chưa nhập được job, thử lại sau.");
  }
  if (withoutCode.length) {
    const { error } = await supabase.from("recruitment_jobs").insert(withoutCode);
    if (error) return fail("Chưa nhập được job, thử lại sau.");
  }
  revalidatePath("/jobs");
  const updated = withCode.filter((row) => known.has(row.code)).length, added = withCode.length - updated + withoutCode.length;
  return { status: "success", message: `Đã nhập ${added} job mới, cập nhật ${updated} job.${problems.length ? ` ${problems.length} dòng bị bỏ qua.` : ""}`, added, updated, problems };
}
