begin;

create table public.ai_recruiter_candidate_facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  bot_id uuid not null,
  conversation_id uuid not null,
  field_key text not null,
  field_value jsonb not null,
  confidence text not null,
  evidence_quote text not null,
  source_message_id uuid not null,
  source_run_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,conversation_id,field_key),
  foreign key(bot_id,workspace_id) references public.ai_recruiter_bots(id,workspace_id) on delete cascade,
  foreign key(conversation_id,workspace_id) references public.omnichannel_conversations(id,workspace_id) on delete cascade,
  foreign key(source_message_id,workspace_id) references public.omnichannel_messages(id,workspace_id) on delete restrict,
  foreign key(source_run_id,workspace_id) references public.ai_recruiter_runs(id,workspace_id) on delete restrict,
  check(field_key in (
    'candidate_type','current_role','seniority','primary_skills','years_experience','current_company',
    'location','preferred_locations','work_preference','japanese_level','english_level','japan_years',
    'current_salary','expected_salary','availability','motivation','job_priorities','applied_companies',
    'email','phone','cv_received'
  )),
  check(confidence in ('EXPLICIT','STRONG_INFERENCE')),
  check(jsonb_typeof(field_value) in ('string','number','boolean','array') and btrim(evidence_quote)<>'' and length(evidence_quote)<=1000)
);

create index ai_recruiter_candidate_facts_review
  on public.ai_recruiter_candidate_facts(workspace_id,bot_id,updated_at desc);

create trigger ai_recruiter_candidate_facts_updated_at
  before update on public.ai_recruiter_candidate_facts
  for each row execute function public.set_updated_at();

alter table public.ai_recruiter_candidate_facts enable row level security;
create policy ai_recruiter_candidate_facts_read on public.ai_recruiter_candidate_facts
  for select to authenticated
  using(workspace_id=public.current_workspace_id() and public.has_workspace_permission('roles.manage'));

revoke all on public.ai_recruiter_candidate_facts from anon,authenticated;
grant select on public.ai_recruiter_candidate_facts to authenticated;
grant all on public.ai_recruiter_candidate_facts to service_role;

commit;
