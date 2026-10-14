-- 075: Actions proposed by Trợ lý HireX (phase 2). The assistant only PROPOSES: a row is created
-- with a human-readable preview; nothing happens until the same member presses "Xác nhận".
-- Execution is claimed atomically (PROPOSED → EXECUTING) so a double click runs it once.
-- Written by the server only (service role); members can read their own rows.
begin;

create table public.assistant_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  kind text not null,
  params jsonb not null default '{}'::jsonb,
  preview jsonb not null default '{}'::jsonb,
  status text not null default 'PROPOSED',
  result_message text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  decided_at timestamptz,
  finished_at timestamptz,
  constraint assistant_actions_user_fk foreign key (user_id, workspace_id) references public.profiles(id, workspace_id) on delete cascade,
  constraint assistant_actions_kind_allowed check (kind in ('CREATE_TASK','SET_LEAD_STATUS','CAMPAIGN_CONTROL','CREATE_CONTENT','AI_RECRUITER_SAFE_STOP')),
  constraint assistant_actions_status_allowed check (status in ('PROPOSED','EXECUTING','EXECUTED','FAILED','CANCELLED','EXPIRED')),
  constraint assistant_actions_json_objects check (jsonb_typeof(params) = 'object' and jsonb_typeof(preview) = 'object'),
  constraint assistant_actions_result_limit check (coalesce(length(result_message), 0) <= 1000),
  constraint assistant_actions_decided_shape check ((status = 'PROPOSED') = (decided_at is null))
);
create index assistant_actions_user_created on public.assistant_actions(workspace_id, user_id, created_at desc);

alter table public.assistant_actions enable row level security;
create policy assistant_actions_select on public.assistant_actions for select to authenticated
using (workspace_id = public.current_workspace_id() and (user_id = auth.uid() or public.has_workspace_permission('roles.manage')));

revoke all on public.assistant_actions from anon, authenticated;
grant select on public.assistant_actions to authenticated;
grant all on public.assistant_actions to service_role;

commit;
