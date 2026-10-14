-- 077: "Bản tin hôm nay" of Trợ lý HireX (phase 3, step 1). One brief per member per Vietnam day,
-- built from the member's own data and permissions, cached so the dashboard does not recompute it on
-- every visit. Written by the server only (service role); members read their own rows.
begin;

create table public.assistant_daily_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  brief_date date not null,
  content jsonb not null,
  generated_at timestamptz not null default now(),
  constraint assistant_daily_briefs_user_fk foreign key (user_id, workspace_id) references public.profiles(id, workspace_id) on delete cascade,
  constraint assistant_daily_briefs_one_per_day unique (workspace_id, user_id, brief_date),
  constraint assistant_daily_briefs_content_object check (jsonb_typeof(content) = 'object'),
  constraint assistant_daily_briefs_content_size check (pg_column_size(content) <= 200000)
);

alter table public.assistant_daily_briefs enable row level security;
create policy assistant_daily_briefs_select on public.assistant_daily_briefs for select to authenticated
using (workspace_id = public.current_workspace_id() and user_id = auth.uid());

revoke all on public.assistant_daily_briefs from anon, authenticated;
grant select on public.assistant_daily_briefs to authenticated;
grant all on public.assistant_daily_briefs to service_role;

commit;
