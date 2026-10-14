-- 078: Automatic alerts of Trợ lý HireX (phase 3, step 2). A background scan finds problems
-- (a channel account down, the e-mail sender stopped, a customer waiting too long) and gives each
-- affected member one alert per problem. While the problem lasts the alert stays open (no repeats);
-- when it is fixed the scan resolves it. Written by the server only; members read their own alerts.
begin;

create table public.assistant_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  kind text not null,
  dedupe_key text not null,
  severity text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  resolved_at timestamptz,
  constraint assistant_alerts_user_fk foreign key (user_id, workspace_id) references public.profiles(id, workspace_id) on delete cascade,
  constraint assistant_alerts_kind_allowed check (kind in ('CHANNEL_DOWN','EMAIL_WORKER_STALE','CUSTOMER_WAITING')),
  constraint assistant_alerts_severity_allowed check (severity in ('high','medium')),
  constraint assistant_alerts_text_limits check (length(dedupe_key) between 1 and 200 and length(title) between 1 and 300 and coalesce(length(body), 0) <= 1000),
  constraint assistant_alerts_internal_link check (link is null or (link ~ '^/[^/]' and length(link) <= 300))
);
-- One open alert per member per problem.
create unique index assistant_alerts_open_once on public.assistant_alerts(workspace_id, user_id, dedupe_key) where resolved_at is null;
create index assistant_alerts_user_recent on public.assistant_alerts(workspace_id, user_id, created_at desc);

alter table public.assistant_alerts enable row level security;
create policy assistant_alerts_select on public.assistant_alerts for select to authenticated
using (workspace_id = public.current_workspace_id() and user_id = auth.uid());

revoke all on public.assistant_alerts from anon, authenticated;
grant select on public.assistant_alerts to authenticated;
grant all on public.assistant_alerts to service_role;

commit;
