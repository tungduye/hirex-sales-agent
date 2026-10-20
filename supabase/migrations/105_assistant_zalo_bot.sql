-- 105: Trợ lý on Zalo. One Zalo nick per workspace answers staff who linked their Zalo to their HireX
-- account (a 6-digit code from the Trợ lý page), in private chats and, when called with @name or /tl,
-- in groups. Answers use the asking member's own rights. Unlinked senders get no reply.
begin;

create table public.assistant_bot_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  channel_account_id uuid,
  enabled boolean not null default false,
  enabled_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint assistant_bot_settings_account_fk foreign key (channel_account_id) references public.channel_accounts(id) on delete set null
);

create table public.assistant_zalo_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null,
  zalo_user_id text not null check (char_length(zalo_user_id) between 1 and 200),
  zalo_name text check (char_length(zalo_name) <= 200),
  created_at timestamptz not null default now(),
  constraint assistant_zalo_links_profile_fk foreign key (profile_id, workspace_id) references public.profiles(id, workspace_id) on delete cascade,
  constraint assistant_zalo_links_unique unique (workspace_id, zalo_user_id)
);

create table public.assistant_link_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null,
  code text not null check (code ~ '^[0-9]{6}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint assistant_link_codes_profile_fk foreign key (profile_id, workspace_id) references public.profiles(id, workspace_id) on delete cascade
);
create unique index assistant_link_codes_open on public.assistant_link_codes(workspace_id, code) where used_at is null;

create table public.assistant_bot_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id uuid not null references public.channel_accounts(id) on delete cascade,
  conversation_id uuid not null references public.omnichannel_conversations(id) on delete cascade,
  message_id uuid not null references public.omnichannel_messages(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'DONE', 'SKIPPED', 'FAILED')),
  attempts integer not null default 0,
  safe_error_code text check (char_length(safe_error_code) <= 60),
  profile_id uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint assistant_bot_jobs_message_unique unique (message_id)
);
create index assistant_bot_jobs_queue on public.assistant_bot_jobs(status, created_at) where status in ('PENDING', 'RUNNING');

alter table public.assistant_conversations
  add column channel text not null default 'WEB' check (channel in ('WEB', 'ZALO')),
  add column source_conversation_id uuid;
create index assistant_conversations_source on public.assistant_conversations(workspace_id, user_id, source_conversation_id, updated_at desc) where source_conversation_id is not null;

alter table public.assistant_bot_settings enable row level security;
alter table public.assistant_zalo_links enable row level security;
alter table public.assistant_link_codes enable row level security;
alter table public.assistant_bot_jobs enable row level security;
create policy assistant_bot_settings_read on public.assistant_bot_settings for select to authenticated using (workspace_id = public.current_workspace_id());
create policy assistant_zalo_links_own_read on public.assistant_zalo_links for select to authenticated using (workspace_id = public.current_workspace_id() and profile_id = auth.uid());
create policy assistant_zalo_links_own_delete on public.assistant_zalo_links for delete to authenticated using (workspace_id = public.current_workspace_id() and profile_id = auth.uid());
revoke all on public.assistant_bot_settings, public.assistant_zalo_links, public.assistant_link_codes, public.assistant_bot_jobs from anon, authenticated;
grant select on public.assistant_bot_settings to authenticated;
grant select, delete on public.assistant_zalo_links to authenticated;
grant all on public.assistant_bot_settings, public.assistant_zalo_links, public.assistant_link_codes, public.assistant_bot_jobs to service_role;

-- Takes the next job (or one stuck for 5 minutes, at most 3 tries) for the worker.
create or replace function public.claim_assistant_bot_job()
returns setof public.assistant_bot_jobs language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.assistant_bot_jobs set status = 'FAILED', safe_error_code = 'TOO_MANY_ATTEMPTS', completed_at = clock_timestamp()
  where status = 'RUNNING' and started_at < clock_timestamp() - interval '5 minutes' and attempts >= 3;
  select j.id into v_id from public.assistant_bot_jobs j
  where j.status = 'PENDING' or (j.status = 'RUNNING' and j.started_at < clock_timestamp() - interval '5 minutes' and j.attempts < 3)
  order by j.created_at limit 1 for update skip locked;
  if v_id is null then return; end if;
  return query update public.assistant_bot_jobs set status = 'RUNNING', attempts = attempts + 1, started_at = clock_timestamp() where id = v_id returning *;
end $$;

-- An approved Zalo reply from the Trợ lý nick into the job's own chat (the asker's private chat or the
-- group they called it from). No human approves it, as with AI Recruiter AUTO.
create or replace function public.propose_assistant_bot_message_service(p_workspace_id uuid, p_job_id uuid, p_text_content text, p_part integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_job public.assistant_bot_jobs%rowtype; v_conversation public.omnichannel_conversations%rowtype; v_policy_id uuid; v_action_id uuid; v_key text;
begin
  if p_workspace_id is null or p_job_id is null or p_part < 1 or p_part > 10 or p_text_content is null or btrim(p_text_content) = '' or length(p_text_content) > 4000 then return null; end if;
  select * into v_job from public.assistant_bot_jobs where id = p_job_id and workspace_id = p_workspace_id and status = 'RUNNING';
  if not found then return null; end if;
  if not exists (select 1 from public.assistant_bot_settings s where s.workspace_id = p_workspace_id and s.enabled and s.channel_account_id = v_job.channel_account_id) then return null; end if;
  select * into v_conversation from public.omnichannel_conversations where id = v_job.conversation_id and workspace_id = p_workspace_id and channel_account_id = v_job.channel_account_id and channel_type = 'ZALO';
  if not found then return null; end if;
  v_key := 'assistant-bot:' || p_job_id::text || ':part:' || p_part::text;
  insert into public.channel_policy_decisions(workspace_id, conversation_id, channel_account_id, channel_type, normalized_recipient, allowed, reason_codes, expires_at)
    values (p_workspace_id, v_conversation.id, v_conversation.channel_account_id, 'ZALO', lower(btrim(v_conversation.provider_conversation_id)), true, array['ASSISTANT_BOT'], clock_timestamp() + interval '10 minutes')
    returning id into v_policy_id;
  insert into public.channel_outbound_actions(workspace_id, conversation_id, channel_account_id, channel_type, recipient_external_id, status, text_content, attachment_ids, approved_by, approved_at, idempotency_key, policy_decision_id, proposed_by, dispatch_source)
    values (p_workspace_id, v_conversation.id, v_conversation.channel_account_id, 'ZALO', v_conversation.provider_conversation_id, 'APPROVED', p_text_content, '{}', null, clock_timestamp(), v_key, v_policy_id, 'AI_ASSIST', 'AI_AUTOMATION')
    on conflict (workspace_id, channel_account_id, idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then select id into v_action_id from public.channel_outbound_actions where workspace_id = p_workspace_id and channel_account_id = v_conversation.channel_account_id and idempotency_key = v_key; end if;
  return v_action_id;
end $$;

revoke all on function public.claim_assistant_bot_job() from public, anon, authenticated;
revoke all on function public.propose_assistant_bot_message_service(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_assistant_bot_job() to service_role;
grant execute on function public.propose_assistant_bot_message_service(uuid, uuid, text, integer) to service_role;

commit;
