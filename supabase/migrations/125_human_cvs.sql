-- 125: Màn CV. A read-only copy of the CVs in Human (POST /cv with a filter body; blockId "CV_GOC" and any block an
-- admin adds), refreshed by hand or every 6 hours. Who sees what: "CV · Xem" plus either "Xem tất cả CV" or being
-- the CV's Rec (recerId; Human users are linked to HireX members in Cài đặt, the same links as Khách hàng).
-- Phones and e-mails are kept as match keys to find the candidate's Suối Nguồn conversations. Only the server writes.
begin;

create table public.human_cv_blocks (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  block_key text not null check (block_key ~ '^[A-Za-z0-9_-]{1,60}$'),
  name text check (name is null or char_length(name) <= 80),
  enabled boolean not null default true,
  sort integer not null default 0,
  last_synced_at timestamptz,
  last_count integer,
  last_error text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, block_key)
);

create table public.human_cvs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cv_id bigint not null,
  history_id bigint,
  history_count integer not null default 1,
  block_keys text[] not null default '{}',
  code text,
  name text,
  phone text,
  email text,
  position text,
  skill text,
  skill_tech text,
  location text,
  languages text,
  status1 text,
  status2 text,
  recer_human_id text,
  recer_name text,
  partner_name text,
  companies text,
  salary text,
  human_created_at timestamptz,
  human_updated_at timestamptz,
  phone_keys text[] not null default '{}',
  email_keys text[] not null default '{}',
  -- The record exactly as Human returned it (long text cut), and every value folded for search.
  data jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  primary key (workspace_id, cv_id)
);
create index human_cvs_list on public.human_cvs(workspace_id, active, cv_id desc);
create index human_cvs_recer on public.human_cvs(workspace_id, recer_human_id);
create index human_cvs_blocks on public.human_cvs using gin (block_keys);
create index human_cvs_phone_keys on public.human_cvs using gin (phone_keys);
create index human_cvs_email_keys on public.human_cvs using gin (email_keys);

create table public.human_cv_syncs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trigger text not null check (trigger in ('MANUAL', 'SCHEDULE')),
  started_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  rows integer,
  error text
);
create index human_cv_syncs_recent on public.human_cv_syncs(workspace_id, started_at desc);

alter table public.human_cv_blocks enable row level security;
alter table public.human_cvs enable row level security;
alter table public.human_cv_syncs enable row level security;
create policy human_cv_blocks_read on public.human_cv_blocks for select to authenticated
  using (workspace_id = public.current_workspace_id() and (select public.has_workspace_permission('cvs.view')));
create policy human_cv_syncs_read on public.human_cv_syncs for select to authenticated
  using (workspace_id = public.current_workspace_id() and (select public.has_workspace_permission('cvs.view')));
create policy human_cvs_read on public.human_cvs for select to authenticated
  using (workspace_id = public.current_workspace_id() and (select public.has_workspace_permission('cvs.view')) and (
    (select public.has_workspace_permission('cvs.view_all'))
    or exists (select 1 from public.human_user_links l where l.workspace_id = human_cvs.workspace_id and l.profile_id = (select auth.uid()) and l.human_user_id = human_cvs.recer_human_id)));
revoke all on public.human_cv_blocks, public.human_cvs, public.human_cv_syncs from anon, authenticated;
grant select on public.human_cv_blocks, public.human_cvs, public.human_cv_syncs to authenticated;
grant all on public.human_cv_blocks, public.human_cvs, public.human_cv_syncs to service_role;

-- Human people (Sale, AM, Rec) are shared by Khách hàng and CV: readable with either screen.
drop policy human_user_links_read on public.human_user_links;
create policy human_user_links_read on public.human_user_links for select to authenticated
  using (workspace_id = public.current_workspace_id() and ((select public.has_workspace_permission('customers.view')) or (select public.has_workspace_permission('cvs.view'))));

-- Filter choices on the CV page over the CVs this member may see.
create or replace function public.human_cv_facets()
returns table(kind text, value text, total bigint)
language sql stable security invoker set search_path = public as $$
  select 'status1', coalesce(c.status1, ''), count(*) from public.human_cvs c where c.workspace_id = public.current_workspace_id() and c.active group by 2
  union all
  select 'status2', coalesce(c.status2, ''), count(*) from public.human_cvs c where c.workspace_id = public.current_workspace_id() and c.active group by 2
  union all
  select 'position', coalesce(c.position, ''), count(*) from public.human_cvs c where c.workspace_id = public.current_workspace_id() and c.active group by 2
  union all
  select 'location', coalesce(c.location, ''), count(*) from public.human_cvs c where c.workspace_id = public.current_workspace_id() and c.active group by 2
  union all
  select 'recer', coalesce(c.recer_human_id, ''), count(*) from public.human_cvs c where c.workspace_id = public.current_workspace_id() and c.active group by 2
  union all
  select 'block', b, count(*) from public.human_cvs c cross join unnest(c.block_keys) b where c.workspace_id = public.current_workspace_id() and c.active group by 2
$$;
revoke all on function public.human_cv_facets() from public, anon;
grant execute on function public.human_cv_facets() to authenticated;

insert into public.human_cv_blocks(workspace_id, block_key, name, sort)
select w.id, 'CV_GOC', 'CV gốc', 1 from public.workspaces w
on conflict do nothing;

insert into public.workspace_role_permissions(workspace_id, role_id, permission_key)
select role.workspace_id, role.id, p.key
from public.workspace_roles role cross join (values ('cvs.view'), ('cvs.view_all'), ('cvs.manage')) as p(key)
where role.is_system = true and role.name = 'Quản trị viên'
on conflict (role_id, permission_key) do nothing;

-- Soda: CVs counted by one column (status, position, Rec, …), optionally new in a period, matching a search, of some Recs.
create or replace function public.human_cv_stats(p_group text, p_from timestamptz, p_to timestamptz, p_search text, p_recers text[])
returns table(value text, total bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(case p_group when 'status1' then c.status1 when 'position' then c.position when 'skill' then c.skill when 'location' then c.location
    when 'recer' then c.recer_human_id when 'languages' then c.languages when 'block' then array_to_string(c.block_keys, ', ') else c.status2 end, ''), count(*)
  from public.human_cvs c
  where c.workspace_id = public.current_workspace_id() and c.active
    and (p_from is null or c.human_created_at >= p_from) and (p_to is null or c.human_created_at < p_to)
    and (coalesce(p_search, '') = '' or c.search_text like '%' || p_search || '%')
    and (p_recers is null or c.recer_human_id = any(p_recers))
  group by 1 order by 2 desc limit 300
$$;
revoke all on function public.human_cv_stats(text, timestamptz, timestamptz, text, text[]) from public, anon;
grant execute on function public.human_cv_stats(text, timestamptz, timestamptz, text, text[]) to authenticated;

commit;
