-- 084: Files attached in the Trợ lý HireX panel (phase 3b), and the proposal that turns one into
-- draft email campaigns. An upload holds the cleaned recipient list (same reader and rules as the
-- campaign audience import); only counts and column names are ever shown to the AI model, never
-- the addresses. Uploads expire after 24 hours. Written by the server only; members read their own.
begin;

create table public.assistant_uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  file_name text not null,
  recipients jsonb not null default '[]'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  columns text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint assistant_uploads_user_fk foreign key (user_id, workspace_id) references public.profiles(id, workspace_id) on delete cascade,
  constraint assistant_uploads_file_name_valid check (btrim(file_name) <> '' and length(file_name) <= 200),
  constraint assistant_uploads_json_shape check (jsonb_typeof(recipients) = 'array' and jsonb_typeof(stats) = 'object'),
  constraint assistant_uploads_row_limit check (jsonb_array_length(recipients) <= 20000)
);
create index assistant_uploads_user_created on public.assistant_uploads(workspace_id, user_id, created_at desc);

alter table public.assistant_uploads enable row level security;
create policy assistant_uploads_select on public.assistant_uploads for select to authenticated
using (workspace_id = public.current_workspace_id() and user_id = auth.uid());
revoke all on public.assistant_uploads from anon, authenticated;
grant select on public.assistant_uploads to authenticated;
grant all on public.assistant_uploads to service_role;

alter table public.assistant_actions drop constraint assistant_actions_kind_allowed,
  add constraint assistant_actions_kind_allowed check (kind in (
    'CREATE_TASK','SET_LEAD_STATUS','CAMPAIGN_CONTROL','CREATE_CONTENT','AI_RECRUITER_SAFE_STOP','SEND_REPLY','CREATE_RULE',
    'CREATE_CONTACT','UPDATE_CONTACT','ADD_NOTE','CREATE_COMPANY','UPDATE_COMPANY','UPDATE_TASK',
    'CREATE_EMAIL_CAMPAIGNS'));

commit;
