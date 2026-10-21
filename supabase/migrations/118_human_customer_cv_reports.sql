-- 118: Khách hàng · Tình trạng CV. Human gives the CV report (yêu cầu, CV đã gửi, tình trạng Sale) one company at a
-- time (applicationHistory/report/partner/{id}); HireX keeps a copy per company, fetched again only when the
-- company's CV counts or status change (and when someone opens it after an hour). Readable by whoever may see
-- the company. Also: AM rankings become a list (rateAmId + rateAmId2 may each hold several codes).
begin;

create table public.human_partner_reports (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  partner_id bigint not null,
  data jsonb,
  fingerprint text,
  fetched_at timestamptz not null default now(),
  error text,
  primary key (workspace_id, partner_id)
);
alter table public.human_partner_reports enable row level security;
create policy human_partner_reports_read on public.human_partner_reports for select to authenticated
  using (workspace_id = public.current_workspace_id() and exists (
    select 1 from public.human_partners p where p.workspace_id = human_partner_reports.workspace_id and p.partner_id = human_partner_reports.partner_id));
revoke all on public.human_partner_reports from anon, authenticated;
grant select on public.human_partner_reports to authenticated;
grant all on public.human_partner_reports to service_role;

alter table public.human_partners add column am_ranks text[] not null default '{}';
create index human_partners_am_ranks on public.human_partners using gin (am_ranks);

create or replace function public.human_partner_facets()
returns table(kind text, value text, total bigint)
language sql stable security invoker set search_path = public as $$
  select 'project_rank', coalesce(p.project_rank, ''), count(*) from public.human_partners p where p.workspace_id = public.current_workspace_id() and p.active group by 2
  union all
  select 'job_rank', coalesce(p.job_rank, ''), count(*) from public.human_partners p where p.workspace_id = public.current_workspace_id() and p.active group by 2
  union all
  select 'am_rank', r, count(*) from public.human_partners p cross join unnest(p.am_ranks) r where p.workspace_id = public.current_workspace_id() and p.active group by 2
  union all
  select 'location', coalesce(p.location, ''), count(*) from public.human_partners p where p.workspace_id = public.current_workspace_id() and p.active group by 2
  union all
  select 'block', b::text, count(*) from public.human_partners p cross join unnest(p.block_ids) b where p.workspace_id = public.current_workspace_id() and p.active group by 2
$$;

commit;
