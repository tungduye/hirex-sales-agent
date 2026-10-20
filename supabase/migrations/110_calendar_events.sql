-- 110: Lịch hẹn in HireX. Events (one-off or repeating) with attendees; each attendee chooses when
-- the Trợ lý reminds them on Zalo (per event, or their own default, else 30 minutes before).
-- Read and written only by the server, which applies who may see what (as for KPI: one's own events,
-- events of the people one manages, everything for administrators and members who may view roles).
-- A reminder is sent by the Trợ lý nick as an assistant_bot_jobs row of kind REMINDER, so it goes
-- through the same approved bridge path as the Trợ lý's answers.
begin;

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  kind text not null default 'HOP' check (kind in ('HOP', 'PHONG_VAN', 'GAP_KHACH', 'CA_NHAN', 'KHAC')),
  starts_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 1440),
  location text check (char_length(location) <= 300),
  note text check (char_length(note) <= 2000),
  recurrence text not null default 'NONE' check (recurrence in ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY')),
  recurrence_days smallint[] not null default '{}' check (recurrence_days <@ array[1,2,3,4,5,6,7]::smallint[]),
  recurrence_until date,
  contact_id uuid,
  conversation_id uuid,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED')),
  source text not null default 'WEB' check (source in ('WEB', 'ASSISTANT')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_id_workspace_key unique (id, workspace_id),
  constraint calendar_events_creator_fk foreign key (created_by, workspace_id) references public.profiles(id, workspace_id) on delete cascade,
  constraint calendar_events_contact_fk foreign key (contact_id, workspace_id) references public.contacts(id, workspace_id) on delete set null (contact_id),
  constraint calendar_events_conversation_fk foreign key (conversation_id, workspace_id) references public.omnichannel_conversations(id, workspace_id) on delete set null (conversation_id)
);
create index calendar_events_active on public.calendar_events(workspace_id, starts_at) where status = 'ACTIVE';
create trigger calendar_events_updated_at before update on public.calendar_events for each row execute function public.set_updated_at();

create table public.calendar_event_attendees (
  event_id uuid not null,
  workspace_id uuid not null,
  profile_id uuid not null,
  remind_minutes integer check (remind_minutes between 0 and 10080),
  declined boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (event_id, profile_id),
  constraint calendar_event_attendees_event_fk foreign key (event_id, workspace_id) references public.calendar_events(id, workspace_id) on delete cascade,
  constraint calendar_event_attendees_profile_fk foreign key (profile_id, workspace_id) references public.profiles(id, workspace_id) on delete cascade
);
create index calendar_event_attendees_profile on public.calendar_event_attendees(workspace_id, profile_id);

create table public.calendar_member_settings (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null,
  remind_minutes integer not null default 30 check (remind_minutes between 0 and 10080),
  zalo_reminders boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, profile_id),
  constraint calendar_member_settings_profile_fk foreign key (profile_id, workspace_id) references public.profiles(id, workspace_id) on delete cascade
);

create table public.calendar_reminders_sent (
  event_id uuid not null,
  workspace_id uuid not null,
  profile_id uuid not null,
  occurrence_start timestamptz not null,
  status text not null default 'SENT' check (status in ('SENT', 'FAILED', 'SKIPPED')),
  created_at timestamptz not null default now(),
  primary key (event_id, profile_id, occurrence_start),
  constraint calendar_reminders_sent_event_fk foreign key (event_id, workspace_id) references public.calendar_events(id, workspace_id) on delete cascade
);

alter table public.calendar_events enable row level security;
alter table public.calendar_event_attendees enable row level security;
alter table public.calendar_member_settings enable row level security;
alter table public.calendar_reminders_sent enable row level security;
revoke all on public.calendar_events, public.calendar_event_attendees, public.calendar_member_settings, public.calendar_reminders_sent from anon, authenticated;
grant all on public.calendar_events, public.calendar_event_attendees, public.calendar_member_settings, public.calendar_reminders_sent to service_role;

-- Reminders reuse the Trợ lý send path: a job without an incoming message.
alter table public.assistant_bot_jobs alter column message_id drop not null,
  add column kind text not null default 'QUESTION' check (kind in ('QUESTION', 'REMINDER')),
  add constraint assistant_bot_jobs_question_message check (kind <> 'QUESTION' or message_id is not null);

create or replace function public.claim_assistant_bot_job()
returns setof public.assistant_bot_jobs language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.assistant_bot_jobs set status = 'FAILED', safe_error_code = 'TOO_MANY_ATTEMPTS', completed_at = clock_timestamp()
  where status = 'RUNNING' and started_at < clock_timestamp() - interval '5 minutes' and attempts >= 3;
  select j.id into v_id from public.assistant_bot_jobs j
  where j.kind = 'QUESTION' and (j.status = 'PENDING' or (j.status = 'RUNNING' and j.started_at < clock_timestamp() - interval '5 minutes' and j.attempts < 3))
  order by j.created_at limit 1 for update skip locked;
  if v_id is null then return; end if;
  return query update public.assistant_bot_jobs set status = 'RUNNING', attempts = attempts + 1, started_at = clock_timestamp() where id = v_id returning *;
end $$;
revoke all on function public.claim_assistant_bot_job() from public, anon, authenticated;
grant execute on function public.claim_assistant_bot_job() to service_role;

alter table public.assistant_actions drop constraint assistant_actions_kind_allowed,
  add constraint assistant_actions_kind_allowed check (kind in (
    'CREATE_TASK','SET_LEAD_STATUS','CAMPAIGN_CONTROL','CREATE_CONTENT','AI_RECRUITER_SAFE_STOP','SEND_REPLY','CREATE_RULE',
    'CREATE_CONTACT','UPDATE_CONTACT','ADD_NOTE','CREATE_COMPANY','UPDATE_COMPANY','UPDATE_TASK',
    'CREATE_EMAIL_CAMPAIGNS','CREATE_EVENT','CANCEL_EVENT','SET_REMINDER'));

commit;
