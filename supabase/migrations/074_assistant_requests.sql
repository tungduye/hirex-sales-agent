-- 074: Usage log of "Trợ lý HireX" (phase 1, read-only assistant).
-- One row per question: who asked, which tools ran, outcome and token usage. The question text is
-- kept (truncated) for audit; answers and tool data are not stored. Written by the server only.
begin;

create table public.assistant_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  question text not null,
  page_path text,
  tools_used text[] not null default '{}',
  status text not null,
  error_code text,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  duration_ms integer,
  created_at timestamptz not null default now(),
  constraint assistant_requests_user_fk foreign key (user_id, workspace_id) references public.profiles(id, workspace_id) on delete cascade,
  constraint assistant_requests_status_allowed check (status in ('ANSWERED','FAILED','RATE_LIMITED')),
  constraint assistant_requests_text_limits check (length(question) <= 1000 and coalesce(length(page_path),0) <= 300 and coalesce(length(error_code),0) <= 60),
  constraint assistant_requests_tokens_valid check (input_tokens >= 0 and output_tokens >= 0)
);
create index assistant_requests_user_day on public.assistant_requests(workspace_id, user_id, created_at desc);

alter table public.assistant_requests enable row level security;
-- Members see their own questions; members who manage roles see the whole workspace.
create policy assistant_requests_select on public.assistant_requests for select to authenticated
using (workspace_id = public.current_workspace_id() and (user_id = auth.uid() or public.has_workspace_permission('roles.manage')));

revoke all on public.assistant_requests from anon, authenticated;
grant select on public.assistant_requests to authenticated;
grant all on public.assistant_requests to service_role;

commit;
