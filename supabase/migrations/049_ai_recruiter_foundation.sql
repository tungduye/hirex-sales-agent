begin;

create table public.ai_recruiter_bots (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null, enabled boolean not null default false, mode text not null default 'DRAFT',
  model text not null default 'gpt-5.6-terra', recruiter_name text, company_intro text, job_scope text,
  debounce_seconds integer not null default 15, reminder_1_minutes integer not null default 120,
  reminder_2_minutes integer not null default 300, process_timeout_minutes integer not null default 60,
  max_jobs_to_offer integer not null default 2, extra_rules text, created_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,workspace_id), unique(workspace_id,name),
  foreign key(created_by,workspace_id) references public.profiles(id,workspace_id) on delete restrict,
  check(btrim(name)<>'' and btrim(model)<>''), check(mode in ('DRAFT','AUTO')),
  check(debounce_seconds between 0 and 300), check(reminder_1_minutes between 1 and 10080),
  check(reminder_2_minutes between reminder_1_minutes and 20160), check(process_timeout_minutes between 1 and 10080),
  check(max_jobs_to_offer between 1 and 10)
);

create table public.ai_recruiter_channel_bindings (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, bot_id uuid not null,
  channel_account_id uuid not null, enabled boolean not null default false, created_at timestamptz not null default now(),
  unique(workspace_id,channel_account_id),
  foreign key(bot_id,workspace_id) references public.ai_recruiter_bots(id,workspace_id) on delete cascade,
  foreign key(channel_account_id,workspace_id) references public.channel_accounts(id,workspace_id) on delete cascade
);

create table public.ai_recruiter_jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, bot_id uuid not null,
  external_job_id text not null, active boolean not null default true, priority integer not null default 100,
  sale_stage text not null, company_name text not null, job_title text not null, candidate_type text,
  location text, location_group text, japanese_level_min text, japan_years_min numeric,
  salary_range text, process_summary text, rank_salary_note text, summary text, selling_points text,
  requirements text, jd_link text, avoid_reason_tags text, note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id,bot_id,external_job_id), foreign key(bot_id,workspace_id) references public.ai_recruiter_bots(id,workspace_id) on delete cascade,
  check(btrim(external_job_id)<>'' and btrim(sale_stage)<>'' and btrim(company_name)<>'' and btrim(job_title)<>'')
);

create table public.ai_recruiter_stages (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, bot_id uuid not null,
  stage_key text not null, stage_name text not null, message_template text not null, next_stage text,
  wait_for_candidate boolean not null default true, stop_bot boolean not null default false,
  next_question_field text, notes text, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id,bot_id,stage_key), foreign key(bot_id,workspace_id) references public.ai_recruiter_bots(id,workspace_id) on delete cascade,
  check(btrim(stage_key)<>'' and btrim(stage_name)<>'' and btrim(message_template)<>'')
);

create table public.ai_recruiter_conversation_states (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, bot_id uuid not null, conversation_id uuid not null,
  status text not null default 'COLLECTING_PROFILE', current_stage text, profile jsonb not null default '{}'::jsonb,
  offered_job_ids text[] not null default '{}', last_inbound_message_id uuid, last_ai_run_id uuid,
  bot_paused boolean not null default false, pause_reason text, next_followup_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id,conversation_id), foreign key(bot_id,workspace_id) references public.ai_recruiter_bots(id,workspace_id) on delete cascade,
  foreign key(conversation_id,workspace_id) references public.omnichannel_conversations(id,workspace_id) on delete cascade,
  foreign key(last_inbound_message_id,workspace_id) references public.omnichannel_messages(id,workspace_id) on delete restrict,
  check(status in ('COLLECTING_PROFILE','PROFILE_COMPLETE','OFFERING_JOB','DISCUSSING_PROCESS','WAITING_RECRUITER','COMPLETED','PAUSED')),
  check(jsonb_typeof(profile)='object')
);

create table public.ai_recruiter_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, bot_id uuid not null,
  conversation_id uuid not null, inbound_message_id uuid not null, status text not null default 'PENDING',
  mode text not null, input_snapshot jsonb not null default '{}'::jsonb, output_json jsonb,
  proposed_text_parts text[] not null default '{}', safe_error_code text, started_at timestamptz,
  completed_at timestamptz, created_at timestamptz not null default now(),
  unique(id,workspace_id), unique(workspace_id,bot_id,inbound_message_id), foreign key(bot_id,workspace_id) references public.ai_recruiter_bots(id,workspace_id) on delete cascade,
  foreign key(conversation_id,workspace_id) references public.omnichannel_conversations(id,workspace_id) on delete cascade,
  foreign key(inbound_message_id,workspace_id) references public.omnichannel_messages(id,workspace_id) on delete restrict,
  check(status in ('PENDING','RUNNING','DRAFT_READY','QUEUED','SENT','SKIPPED','FAILED')),
  check(mode in ('DRAFT','AUTO')), check(jsonb_typeof(input_snapshot)='object'),
  check(output_json is null or jsonb_typeof(output_json)='object')
);

create table public.ai_recruiter_scheduled_actions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, bot_id uuid not null,
  conversation_id uuid not null, run_id uuid, action_type text not null, due_at timestamptz not null,
  status text not null default 'PENDING', payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null, attempts integer not null default 0, safe_error_code text,
  created_at timestamptz not null default now(), completed_at timestamptz,
  unique(workspace_id,idempotency_key), foreign key(bot_id,workspace_id) references public.ai_recruiter_bots(id,workspace_id) on delete cascade,
  foreign key(conversation_id,workspace_id) references public.omnichannel_conversations(id,workspace_id) on delete cascade,
  foreign key(run_id,workspace_id) references public.ai_recruiter_runs(id,workspace_id) on delete cascade,
  check(action_type in ('REMINDER_1','REMINDER_2','PROCESS_TIMEOUT')), check(status in ('PENDING','CLAIMED','COMPLETED','CANCELLED','FAILED')),
  check(jsonb_typeof(payload)='object' and attempts between 0 and 10)
);

create index ai_recruiter_bindings_lookup on public.ai_recruiter_channel_bindings(workspace_id,channel_account_id,enabled);
create index ai_recruiter_runs_review on public.ai_recruiter_runs(workspace_id,status,created_at desc);
create index ai_recruiter_schedule_due on public.ai_recruiter_scheduled_actions(status,due_at) where status='PENDING';

create trigger ai_recruiter_bots_updated_at before update on public.ai_recruiter_bots for each row execute function public.set_updated_at();
create trigger ai_recruiter_jobs_updated_at before update on public.ai_recruiter_jobs for each row execute function public.set_updated_at();
create trigger ai_recruiter_stages_updated_at before update on public.ai_recruiter_stages for each row execute function public.set_updated_at();
create trigger ai_recruiter_states_updated_at before update on public.ai_recruiter_conversation_states for each row execute function public.set_updated_at();

alter table public.ai_recruiter_bots enable row level security;
alter table public.ai_recruiter_channel_bindings enable row level security;
alter table public.ai_recruiter_jobs enable row level security;
alter table public.ai_recruiter_stages enable row level security;
alter table public.ai_recruiter_conversation_states enable row level security;
alter table public.ai_recruiter_runs enable row level security;
alter table public.ai_recruiter_scheduled_actions enable row level security;

create policy ai_recruiter_bots_read on public.ai_recruiter_bots for select to authenticated using(workspace_id=public.current_workspace_id() and public.has_workspace_permission('roles.manage'));
create policy ai_recruiter_bindings_read on public.ai_recruiter_channel_bindings for select to authenticated using(workspace_id=public.current_workspace_id() and public.has_workspace_permission('roles.manage'));
create policy ai_recruiter_jobs_read on public.ai_recruiter_jobs for select to authenticated using(workspace_id=public.current_workspace_id() and public.has_workspace_permission('roles.manage'));
create policy ai_recruiter_stages_read on public.ai_recruiter_stages for select to authenticated using(workspace_id=public.current_workspace_id() and public.has_workspace_permission('roles.manage'));
create policy ai_recruiter_states_read on public.ai_recruiter_conversation_states for select to authenticated using(workspace_id=public.current_workspace_id() and public.has_workspace_permission('roles.manage'));
create policy ai_recruiter_runs_read on public.ai_recruiter_runs for select to authenticated using(workspace_id=public.current_workspace_id() and public.has_workspace_permission('roles.manage'));
create policy ai_recruiter_schedule_read on public.ai_recruiter_scheduled_actions for select to authenticated using(workspace_id=public.current_workspace_id() and public.has_workspace_permission('roles.manage'));

create function public.propose_ai_recruiter_message_service(p_workspace_id uuid,p_run_id uuid,p_text_content text,p_part integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_run public.ai_recruiter_runs%rowtype; v_bot public.ai_recruiter_bots%rowtype; v_conversation public.omnichannel_conversations%rowtype;
  v_policy_id uuid; v_action_id uuid; v_recipient text; v_reason text[]:=array[]::text[];
begin
  if p_workspace_id is null or p_run_id is null or p_part<1 or p_part>10 or p_text_content is null or btrim(p_text_content)='' or length(p_text_content)>10000 then return null;end if;
  select * into v_run from public.ai_recruiter_runs where id=p_run_id and workspace_id=p_workspace_id for update;
  if not found or v_run.mode<>'AUTO' or v_run.status not in ('RUNNING','DRAFT_READY','QUEUED') or v_run.proposed_text_parts[p_part] is distinct from p_text_content then return null;end if;
  select * into v_bot from public.ai_recruiter_bots where id=v_run.bot_id and workspace_id=p_workspace_id and enabled and mode='AUTO';if not found then return null;end if;
  select * into v_conversation from public.omnichannel_conversations where id=v_run.conversation_id and workspace_id=p_workspace_id and status in ('OPEN','PENDING') and takeover_mode='BOT_ALLOWED';if not found then return null;end if;
  if not exists(select 1 from public.ai_recruiter_channel_bindings where workspace_id=p_workspace_id and bot_id=v_bot.id and channel_account_id=v_conversation.channel_account_id and enabled) then return null;end if;
  select sender_external_id into v_recipient from public.omnichannel_messages where workspace_id=p_workspace_id and conversation_id=v_conversation.id and direction='INBOUND' order by received_at desc nulls last,created_at desc limit 1;
  if v_recipient is null or btrim(v_recipient)='' then return null;end if;
  if exists(select 1 from public.channel_suppressions where workspace_id=p_workspace_id and channel_type=v_conversation.channel_type and normalized_recipient=lower(btrim(v_recipient))) then return null;end if;
  insert into public.channel_policy_decisions(workspace_id,conversation_id,channel_account_id,channel_type,normalized_recipient,allowed,reason_codes,expires_at)
    values(p_workspace_id,v_conversation.id,v_conversation.channel_account_id,v_conversation.channel_type,lower(btrim(v_recipient)),true,v_reason,clock_timestamp()+interval '10 minutes') returning id into v_policy_id;
  insert into public.channel_outbound_actions(workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,status,text_content,attachment_ids,approved_by,approved_at,idempotency_key,policy_decision_id,proposed_by,dispatch_source)
    values(p_workspace_id,v_conversation.id,v_conversation.channel_account_id,v_conversation.channel_type,v_recipient,'APPROVED',p_text_content,'{}',v_bot.created_by,clock_timestamp(),'ai-recruiter:'||p_run_id::text||':part:'||p_part::text,v_policy_id,'AI_ASSIST','AI_AUTOMATION')
    on conflict(workspace_id,channel_account_id,idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then select id into v_action_id from public.channel_outbound_actions where workspace_id=p_workspace_id and channel_account_id=v_conversation.channel_account_id and idempotency_key='ai-recruiter:'||p_run_id::text||':part:'||p_part::text;end if;
  return v_action_id;
end $$;

create function public.propose_ai_recruiter_draft_service(p_workspace_id uuid,p_run_id uuid,p_text_content text,p_part integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_run public.ai_recruiter_runs%rowtype; v_bot public.ai_recruiter_bots%rowtype; v_conversation public.omnichannel_conversations%rowtype; v_policy_id uuid; v_action_id uuid; v_recipient text;
begin
  if p_workspace_id is null or p_run_id is null or p_part<1 or p_part>10 or p_text_content is null or btrim(p_text_content)='' or length(p_text_content)>10000 then return null;end if;
  select * into v_run from public.ai_recruiter_runs where id=p_run_id and workspace_id=p_workspace_id and mode='DRAFT' and status='DRAFT_READY';if not found or v_run.proposed_text_parts[p_part] is distinct from p_text_content then return null;end if;
  select * into v_bot from public.ai_recruiter_bots where id=v_run.bot_id and workspace_id=p_workspace_id and enabled;if not found then return null;end if;
  select * into v_conversation from public.omnichannel_conversations where id=v_run.conversation_id and workspace_id=p_workspace_id and status in ('OPEN','PENDING') and takeover_mode='BOT_ALLOWED';if not found then return null;end if;
  if not exists(select 1 from public.ai_recruiter_channel_bindings where workspace_id=p_workspace_id and bot_id=v_bot.id and channel_account_id=v_conversation.channel_account_id and enabled) then return null;end if;
  select sender_external_id into v_recipient from public.omnichannel_messages where workspace_id=p_workspace_id and conversation_id=v_conversation.id and direction='INBOUND' order by received_at desc nulls last,created_at desc limit 1;if v_recipient is null or btrim(v_recipient)='' then return null;end if;
  if exists(select 1 from public.channel_suppressions where workspace_id=p_workspace_id and channel_type=v_conversation.channel_type and normalized_recipient=lower(btrim(v_recipient))) then return null;end if;
  insert into public.channel_policy_decisions(workspace_id,conversation_id,channel_account_id,channel_type,normalized_recipient,allowed,reason_codes,expires_at) values(p_workspace_id,v_conversation.id,v_conversation.channel_account_id,v_conversation.channel_type,lower(btrim(v_recipient)),true,'{}',clock_timestamp()+interval '10 minutes') returning id into v_policy_id;
  insert into public.channel_outbound_actions(workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,text_content,idempotency_key,policy_decision_id,proposed_by,dispatch_source)
    values(p_workspace_id,v_conversation.id,v_conversation.channel_account_id,v_conversation.channel_type,v_recipient,p_text_content,'ai-recruiter-draft:'||p_run_id::text||':part:'||p_part::text,v_policy_id,'AI_ASSIST','AI_AUTOMATION')
    on conflict(workspace_id,channel_account_id,idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then select id into v_action_id from public.channel_outbound_actions where workspace_id=p_workspace_id and channel_account_id=v_conversation.channel_account_id and idempotency_key='ai-recruiter-draft:'||p_run_id::text||':part:'||p_part::text;end if;
  return v_action_id;
end $$;

revoke all on public.ai_recruiter_bots, public.ai_recruiter_channel_bindings, public.ai_recruiter_jobs,
  public.ai_recruiter_stages, public.ai_recruiter_conversation_states, public.ai_recruiter_runs,
  public.ai_recruiter_scheduled_actions from anon,authenticated;
grant select on public.ai_recruiter_bots, public.ai_recruiter_channel_bindings, public.ai_recruiter_jobs,
  public.ai_recruiter_stages, public.ai_recruiter_conversation_states, public.ai_recruiter_runs,
  public.ai_recruiter_scheduled_actions to authenticated;
grant all on public.ai_recruiter_bots, public.ai_recruiter_channel_bindings, public.ai_recruiter_jobs,
  public.ai_recruiter_stages, public.ai_recruiter_conversation_states, public.ai_recruiter_runs,
  public.ai_recruiter_scheduled_actions to service_role;
revoke all on function public.propose_ai_recruiter_message_service(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.propose_ai_recruiter_message_service(uuid,uuid,text,integer) to service_role;
revoke all on function public.propose_ai_recruiter_draft_service(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.propose_ai_recruiter_draft_service(uuid,uuid,text,integer) to service_role;

commit;
