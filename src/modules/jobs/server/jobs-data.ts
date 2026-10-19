import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { hasPermission } from "@/modules/access/server/access-control";
import { JOB_PRIORITIES, JOB_STATUSES, type Job, type JobPriority, type JobStatus } from "../core/job-fields";

export const JOB_COLUMNS = "id,code,title,career_track,company_name,company_name_public,location,work_mode,japanese_level_min,experience_min,salary_range,selling_points,summary,requirements,jd_link,interview_process,status,priority,note,owner_id,updated_at";

type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value : null;

export function mapJob(row: Row, owners: Map<string, string>): Job | null {
  if (typeof row.id !== "string" || typeof row.code !== "string" || typeof row.title !== "string" || typeof row.career_track !== "string" ||
    typeof row.company_name !== "string" || typeof row.location !== "string" || typeof row.updated_at !== "string" ||
    !JOB_STATUSES.includes(row.status as JobStatus) || !JOB_PRIORITIES.includes(row.priority as JobPriority)) return null;
  const ownerId = text(row.owner_id);
  return { id: row.id, code: row.code, title: row.title, careerTrack: row.career_track, companyName: row.company_name,
    companyNamePublic: row.company_name_public !== false, location: row.location, workMode: text(row.work_mode),
    japaneseLevelMin: text(row.japanese_level_min), experienceMin: text(row.experience_min), salaryRange: text(row.salary_range),
    sellingPoints: text(row.selling_points), summary: text(row.summary), requirements: text(row.requirements), jdLink: text(row.jd_link),
    interviewProcess: text(row.interview_process), status: row.status as JobStatus, priority: row.priority as JobPriority, note: text(row.note),
    ownerId, ownerName: ownerId ? owners.get(ownerId) ?? null : null, updatedAt: row.updated_at };
}

export interface JobsPageData { status: "ok" | "forbidden" | "error"; jobs: Job[]; canManage: boolean; members: Array<{ id: string; name: string }> }

/** All jobs of the workspace (at most 2000), open and high-priority first. Filtering happens on the page. */
export async function listJobs(): Promise<JobsPageData> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !await hasPermission("jobs.view")) return { status: "forbidden", jobs: [], canManage: false, members: [] };
  const supabase = await createClient();
  const [{ data, error }, { data: profiles }, canManage] = await Promise.all([
    supabase.from("recruitment_jobs").select(JOB_COLUMNS).eq("workspace_id", account.workspaceId)
      .order("status", { ascending: false }).order("priority", { ascending: true }).order("updated_at", { ascending: false }).limit(2000),
    supabase.from("profiles").select("id,full_name").eq("workspace_id", account.workspaceId).order("full_name"),
    hasPermission("jobs.manage"),
  ]);
  if (error) return { status: "error", jobs: [], canManage, members: [] };
  const members = (profiles ?? []).flatMap((profile) => typeof profile.id === "string" ? [{ id: profile.id, name: typeof profile.full_name === "string" && profile.full_name.trim() ? profile.full_name : "Thành viên" }] : []);
  const owners = new Map(members.map((member) => [member.id, member.name]));
  const order: Record<JobStatus, number> = { OPEN: 0, PAUSED: 1, CLOSED: 2 };
  const jobs = (data ?? []).flatMap((row) => { const job = mapJob(row as Row, owners); return job ? [job] : []; })
    .sort((a, b) => order[a.status] - order[b.status] || (a.priority === b.priority ? 0 : a.priority === "HIGH" ? -1 : 1) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return { status: "ok", jobs, canManage, members };
}
