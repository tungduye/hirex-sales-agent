-- 097: Luồng Rec state per candidate: the step of the 8-step flow, what the candidate has said
-- (hướng nghề, khu vực, tiếng Nhật…), jobs offered and declined, and the outcome. Kept per contact so
-- every nick chatting with the same person sees it; a conversation without a contact keeps its own.
-- Read and written only by the server, after checking the member may reply in that conversation.
begin;

create table public.candidate_flow_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid,
  conversation_id uuid,
  step smallint not null default 1,
  facts jsonb not null default '{}'::jsonb,
  offered_job_ids uuid[] not null default '{}'::uuid[],
  rejected_jobs jsonb not null default '[]'::jsonb,
  outcome text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_flow_states_owner check (contact_id is not null or conversation_id is not null),
  constraint candidate_flow_states_step_range check (step between 1 and 8),
  constraint candidate_flow_states_facts_object check (jsonb_typeof(facts) = 'object' and pg_column_size(facts) <= 8192),
  constraint candidate_flow_states_rejected_array check (jsonb_typeof(rejected_jobs) = 'array' and pg_column_size(rejected_jobs) <= 16384),
  constraint candidate_flow_states_offered_size check (cardinality(offered_job_ids) <= 50),
  constraint candidate_flow_states_outcome_allowed check (outcome is null or outcome in ('CV_RECEIVED','NEED_OTHER_JOB','NOT_INTERESTED')),
  constraint candidate_flow_states_contact_fk foreign key (contact_id, workspace_id) references public.contacts(id, workspace_id) on delete cascade,
  constraint candidate_flow_states_conversation_fk foreign key (conversation_id, workspace_id) references public.omnichannel_conversations(id, workspace_id) on delete cascade,
  constraint candidate_flow_states_updater_fk foreign key (updated_by, workspace_id) references public.profiles(id, workspace_id) on delete set null (updated_by)
);
create unique index candidate_flow_states_contact_key on public.candidate_flow_states (workspace_id, contact_id) where contact_id is not null;
create unique index candidate_flow_states_conversation_key on public.candidate_flow_states (workspace_id, conversation_id) where contact_id is null;
create trigger candidate_flow_states_updated_at before update on public.candidate_flow_states for each row execute function public.set_updated_at();

alter table public.candidate_flow_states enable row level security;
revoke all on public.candidate_flow_states from anon, authenticated;
grant all on public.candidate_flow_states to service_role;

commit;
