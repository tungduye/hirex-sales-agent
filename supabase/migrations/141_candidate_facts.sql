-- Thông tin ứng viên tự ghi: after a candidate writes in a one-to-one Zalo/Facebook chat on a "nick tuyển dụng",
-- the server reads the new messages (about a minute later, so a burst is read once) and files what the candidate
-- said into Luồng Rec, each value with the candidate's own words as evidence.
-- * channel_accounts.candidate_facts_enabled: "Nick tuyển dụng" (on by default for nicks whose main user is in Rec).
-- * candidate_fact_jobs: one queue row per conversation; every inbound message pushes it a minute later.
-- * candidate_fact_history: every value ever filed, with its quote and message, who filed it, and whether a
--   recruiter confirmed it. The current values stay in candidate_flow_states.facts.
-- * The last 30 days of candidate chats on those nicks are queued once, spread out.
begin;

alter table public.channel_accounts add column if not exists candidate_facts_enabled boolean not null default false;
update public.channel_accounts a set candidate_facts_enabled = true
from public.profiles p
where p.id = a.primary_profile_id and p.workspace_id = a.workspace_id and lower(btrim(coalesce(p.department, ''))) like 'rec%'
  and a.channel_type in ('ZALO', 'FACEBOOK', 'FACEBOOK_PROFILE') and a.deleted_at is null;

create table if not exists public.candidate_fact_jobs (
  conversation_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  due_at timestamptz not null default now(),
  status text not null default 'PENDING',
  requeue boolean not null default false,
  attempts smallint not null default 0,
  processed_through timestamptz,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_fact_jobs_status check (status in ('PENDING', 'RUNNING', 'DONE', 'SKIPPED', 'FAILED')),
  constraint candidate_fact_jobs_conversation_fk foreign key (conversation_id, workspace_id) references public.omnichannel_conversations(id, workspace_id) on delete cascade
);
create index if not exists candidate_fact_jobs_due_idx on public.candidate_fact_jobs (due_at) where status = 'PENDING';
alter table public.candidate_fact_jobs enable row level security;

create table if not exists public.candidate_fact_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid,
  conversation_id uuid,
  field_key text not null,
  value text,
  previous_value text,
  quote text,
  source_message_id uuid,
  source text not null,
  confirmed boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint candidate_fact_history_source check (source in ('AI_CHAT', 'AI_DRAFT', 'MEMBER')),
  constraint candidate_fact_history_key check (field_key ~ '^[a-zA-Z]{2,40}$'),
  constraint candidate_fact_history_sizes check (coalesce(length(value), 0) <= 200 and coalesce(length(previous_value), 0) <= 200 and coalesce(length(quote), 0) <= 400),
  constraint candidate_fact_history_owner check (contact_id is not null or conversation_id is not null),
  constraint candidate_fact_history_contact_fk foreign key (contact_id, workspace_id) references public.contacts(id, workspace_id) on delete cascade,
  constraint candidate_fact_history_conversation_fk foreign key (conversation_id, workspace_id) references public.omnichannel_conversations(id, workspace_id) on delete cascade,
  constraint candidate_fact_history_creator_fk foreign key (created_by, workspace_id) references public.profiles(id, workspace_id) on delete set null (created_by)
);
create index if not exists candidate_fact_history_contact_idx on public.candidate_fact_history (workspace_id, contact_id, field_key, created_at desc) where contact_id is not null;
create index if not exists candidate_fact_history_conversation_idx on public.candidate_fact_history (workspace_id, conversation_id, field_key, created_at desc) where contact_id is null;
alter table public.candidate_fact_history enable row level security;

-- Every inbound message on a nick tuyển dụng pushes the conversation's job a minute later (a burst is read once).
create or replace function public.candidate_facts_enqueue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.direction <> 'INBOUND' or new.channel_type not in ('ZALO', 'FACEBOOK', 'FACEBOOK_PROFILE') then return new; end if;
  if not exists (select 1 from public.channel_accounts a where a.id = new.channel_account_id and a.candidate_facts_enabled) then return new; end if;
  insert into public.candidate_fact_jobs as j (conversation_id, workspace_id, due_at, status)
  values (new.conversation_id, new.workspace_id, now() + interval '60 seconds', 'PENDING')
  on conflict (conversation_id) do update set
    due_at = now() + interval '60 seconds',
    status = case when j.status = 'RUNNING' then 'RUNNING' else 'PENDING' end,
    requeue = j.status = 'RUNNING',
    attempts = case when j.status = 'RUNNING' then j.attempts else 0 end,
    updated_at = now();
  return new;
end $$;
revoke all on function public.candidate_facts_enqueue() from public, anon, authenticated;
drop trigger if exists candidate_facts_enqueue on public.omnichannel_messages;
create trigger candidate_facts_enqueue after insert on public.omnichannel_messages
for each row execute function public.candidate_facts_enqueue();

-- The worker takes a few due jobs at a time; a job left running for 10 minutes is taken again.
create or replace function public.claim_candidate_fact_jobs(p_limit integer)
returns table(conversation_id uuid, workspace_id uuid, processed_through timestamptz, attempts smallint)
language sql security definer set search_path = '' as $$
  update public.candidate_fact_jobs j set status = 'RUNNING', claimed_at = now(), attempts = j.attempts + 1, requeue = false, updated_at = now()
  where j.conversation_id in (
    select c.conversation_id from public.candidate_fact_jobs c
    where (c.status = 'PENDING' and c.due_at <= now()) or (c.status = 'RUNNING' and c.claimed_at < now() - interval '10 minutes')
    order by c.due_at limit least(greatest(coalesce(p_limit, 5), 1), 20)
    for update skip locked)
  returning j.conversation_id, j.workspace_id, j.processed_through, j.attempts
$$;
revoke all on function public.claim_candidate_fact_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_candidate_fact_jobs(integer) to service_role;

-- Done: DONE / SKIPPED / FAILED, unless a new message came in meanwhile (then it runs again a minute later).
-- WAIT (the AI service is out of credit or overloaded): back in 30 minutes, without using up an attempt.
create or replace function public.finish_candidate_fact_job(p_conversation_id uuid, p_status text, p_processed_through timestamptz, p_error text)
returns void language sql security definer set search_path = '' as $$
  update public.candidate_fact_jobs j set
    status = case when p_status = 'WAIT' then 'PENDING' when j.requeue then 'PENDING' when p_status = 'FAILED' and j.attempts < 3 then 'PENDING' else p_status end,
    attempts = case when p_status = 'WAIT' then 0 else j.attempts end,
    due_at = case when p_status = 'WAIT' then now() + interval '30 minutes' when j.requeue then now() + interval '60 seconds' when p_status = 'FAILED' then now() + interval '5 minutes' else j.due_at end,
    processed_through = coalesce(p_processed_through, j.processed_through),
    last_error = left(p_error, 200), requeue = false, claimed_at = null, updated_at = now()
  where j.conversation_id = p_conversation_id
$$;
revoke all on function public.finish_candidate_fact_job(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.finish_candidate_fact_job(uuid, text, timestamptz, text) to service_role;

-- The last 30 days of one-to-one chats on some nicks, once, spread out (one every 3 seconds) so the worker keeps up.
-- Run here for the nicks on by default, and again for a nick when someone turns "Nick tuyển dụng" on.
create or replace function public.queue_candidate_facts_backfill(p_account_ids uuid[], p_days integer default 30)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  insert into public.candidate_fact_jobs (conversation_id, workspace_id, due_at, status)
  select c.id, c.workspace_id, now() + interval '1 minute' + (row_number() over (order by c.last_message_at desc) * interval '3 seconds'), 'PENDING'
  from public.omnichannel_conversations c
  join public.channel_accounts a on a.id = c.channel_account_id and a.candidate_facts_enabled
  where c.channel_account_id = any(p_account_ids)
    and c.last_message_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90))
    and c.channel_type in ('ZALO', 'FACEBOOK', 'FACEBOOK_PROFILE')
    and upper(coalesce(c.metadata->>'conversationKind', '')) <> 'GROUP' and upper(coalesce(c.metadata->>'threadType', '')) <> 'GROUP'
    and coalesce(c.metadata->>'isGroup', '') <> 'true' and coalesce(jsonb_typeof(c.metadata->'groupName'), '') <> 'string'
    and exists (select 1 from public.omnichannel_messages m where m.workspace_id = c.workspace_id and m.conversation_id = c.id and m.direction = 'INBOUND')
  on conflict (conversation_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.queue_candidate_facts_backfill(uuid[], integer) from public, anon, authenticated;
grant execute on function public.queue_candidate_facts_backfill(uuid[], integer) to service_role;

select public.queue_candidate_facts_backfill(coalesce(array_agg(id), '{}'), 30) from public.channel_accounts where candidate_facts_enabled;

commit;
