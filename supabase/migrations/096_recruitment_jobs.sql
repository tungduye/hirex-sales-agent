-- 096: Bảng Job. The jobs recruiters offer to candidates; Hola, Hole (and later AI Recruiter) use only
-- the "Đang tuyển" ones and only the facts written here. Members with "Job · Xem" read it; members with
-- "Job · Quản lý" add, edit and close jobs. Administrators get both. Jobs already loaded into AI Recruiter
-- are copied over once.
begin;

create sequence if not exists public.recruitment_job_code_seq;

create table public.recruitment_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null default ('J-' || lpad(nextval('public.recruitment_job_code_seq')::text, 4, '0')),
  title text not null,
  career_track text not null,
  company_name text not null,
  company_name_public boolean not null default true,
  location text not null,
  location_group text,
  work_mode text,
  japanese_level_min text,
  experience_min text,
  salary_range text,
  selling_points text,
  summary text,
  requirements text,
  jd_link text,
  interview_process text,
  status text not null default 'OPEN',
  priority text not null default 'NORMAL',
  owner_id uuid,
  note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recruitment_jobs_code_key unique (workspace_id, code),
  constraint recruitment_jobs_id_workspace_key unique (id, workspace_id),
  constraint recruitment_jobs_owner_fk foreign key (owner_id, workspace_id) references public.profiles(id, workspace_id) on delete set null (owner_id),
  constraint recruitment_jobs_creator_fk foreign key (created_by, workspace_id) references public.profiles(id, workspace_id) on delete set null (created_by),
  constraint recruitment_jobs_updater_fk foreign key (updated_by, workspace_id) references public.profiles(id, workspace_id) on delete set null (updated_by),
  constraint recruitment_jobs_status_allowed check (status in ('OPEN','PAUSED','CLOSED')),
  constraint recruitment_jobs_priority_allowed check (priority in ('HIGH','NORMAL')),
  constraint recruitment_jobs_required check (btrim(code) <> '' and length(code) <= 40 and btrim(title) <> '' and length(title) <= 200
    and btrim(career_track) <> '' and length(career_track) <= 60 and btrim(company_name) <> '' and length(company_name) <= 200
    and btrim(location) <> '' and length(location) <= 200),
  constraint recruitment_jobs_text_sizes check (coalesce(length(selling_points),0) <= 2000 and coalesce(length(summary),0) <= 3000
    and coalesce(length(requirements),0) <= 3000 and coalesce(length(interview_process),0) <= 1000 and coalesce(length(note),0) <= 2000
    and coalesce(length(salary_range),0) <= 120 and coalesce(length(experience_min),0) <= 120 and coalesce(length(work_mode),0) <= 40
    and coalesce(length(japanese_level_min),0) <= 40 and coalesce(length(location_group),0) <= 200),
  constraint recruitment_jobs_jd_link_shape check (jd_link is null or (jd_link ~* '^https?://' and length(jd_link) <= 1000))
);
create index recruitment_jobs_open_idx on public.recruitment_jobs (workspace_id, status, priority, updated_at desc);

create trigger recruitment_jobs_updated_at before update on public.recruitment_jobs for each row execute function public.set_updated_at();

alter table public.recruitment_jobs enable row level security;
create policy recruitment_jobs_read on public.recruitment_jobs for select to authenticated
  using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('jobs.view'));
create policy recruitment_jobs_insert on public.recruitment_jobs for insert to authenticated
  with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('jobs.manage'));
create policy recruitment_jobs_update on public.recruitment_jobs for update to authenticated
  using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('jobs.manage'))
  with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('jobs.manage'));
revoke all on public.recruitment_jobs from anon, authenticated;
grant select, insert, update on public.recruitment_jobs to authenticated;
grant all on public.recruitment_jobs to service_role;
grant usage on sequence public.recruitment_job_code_seq to authenticated, service_role;

-- Administrators read and manage jobs; other roles are granted in Settings > Roles.
insert into public.workspace_role_permissions(workspace_id, role_id, permission_key)
select role.workspace_id, role.id, key
from public.workspace_roles role cross join (values ('jobs.view'), ('jobs.manage')) as keys(key)
where role.is_system = true and role.name = 'Quản trị viên'
on conflict (role_id, permission_key) do nothing;

-- One-time copy of the jobs already loaded into AI Recruiter (the same job id in several bots → once).
insert into public.recruitment_jobs(workspace_id, code, title, career_track, company_name, location, location_group, japanese_level_min,
  experience_min, salary_range, selling_points, summary, requirements, jd_link, interview_process, status, priority, note)
select distinct on (job.workspace_id, left(btrim(job.external_job_id), 40))
  job.workspace_id, left(btrim(job.external_job_id), 40), left(job.job_title, 200), left(coalesce(nullif(btrim(job.candidate_type), ''), 'Khác'), 60),
  left(job.company_name, 200), left(coalesce(nullif(btrim(job.location), ''), 'Chưa rõ'), 200), left(job.location_group, 200), left(job.japanese_level_min, 40),
  case when job.japan_years_min is null then null when job.japan_years_min = 0 then 'Không cần từng ở Nhật' else 'Từng ở Nhật từ ' || job.japan_years_min::text || ' năm' end,
  left(job.salary_range, 120), left(job.selling_points, 2000), left(job.summary, 3000), left(job.requirements, 3000),
  case when job.jd_link ~* '^https?://' and length(job.jd_link) <= 1000 then job.jd_link end, left(job.process_summary, 1000),
  case when job.active then 'OPEN' else 'CLOSED' end, 'NORMAL',
  left(nullif(concat_ws(E'\n', nullif(job.rank_salary_note, ''), nullif(job.note, '')), ''), 2000)
from public.ai_recruiter_jobs job
where btrim(job.external_job_id) <> ''
order by job.workspace_id, left(btrim(job.external_job_id), 40), job.updated_at desc
on conflict (workspace_id, code) do nothing;

commit;
