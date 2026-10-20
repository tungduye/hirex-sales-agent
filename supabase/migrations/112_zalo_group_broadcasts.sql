-- 112: Gửi hàng loạt vào nhóm Zalo (Đợt D). A member with "Gửi hàng loạt Zalo · Tạo và gửi" prepares a
-- message for many Zalo groups; each group is sent from one of the nicks that is in it, one group at a
-- time per nick, with a random 90–180 s gap, at most 30 groups per nick per day, between 8:00 and 21:00
-- (Vietnam). Optionally the same text is pinned as a note ("Ghi chú" ghim) at the top of each group.
-- Nothing is sent until the member starts (approves) the broadcast; they can pause or cancel it.
-- Tables are service-role only: the server checks the permission and the member's nick scope.
-- Sends reuse the approved Zalo path with keys "group-broadcast:{target}:part:{attempt}".
begin;

create table public.zalo_broadcasts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  text_content text not null check (char_length(btrim(text_content)) between 1 and 4000),
  send_message boolean not null default true,
  pin_note boolean not null default false,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'RUNNING', 'PAUSED', 'DONE', 'CANCELLED')),
  daily_cap_per_nick integer not null default 30 check (daily_cap_per_nick between 1 and 100),
  min_gap_seconds integer not null default 90 check (min_gap_seconds between 30 and 3600),
  max_gap_seconds integer not null default 180 check (max_gap_seconds between 30 and 7200),
  window_start_hour smallint not null default 8 check (window_start_hour between 0 and 23),
  window_end_hour smallint not null default 21 check (window_end_hour between 1 and 24),
  created_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  finished_at timestamptz,
  source text not null default 'WEB' check (source in ('WEB', 'ASSISTANT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zalo_broadcasts_id_workspace_key unique (id, workspace_id),
  constraint zalo_broadcasts_gap_order check (max_gap_seconds >= min_gap_seconds),
  constraint zalo_broadcasts_window_order check (window_end_hour > window_start_hour),
  constraint zalo_broadcasts_does_something check (send_message or pin_note),
  constraint zalo_broadcasts_pin_length check (not pin_note or char_length(text_content) <= 2000),
  constraint zalo_broadcasts_started_by_someone check (status = 'DRAFT' or (approved_by is not null and approved_at is not null)),
  constraint zalo_broadcasts_creator_fk foreign key (created_by, workspace_id) references public.profiles(id, workspace_id) on delete cascade,
  constraint zalo_broadcasts_approver_fk foreign key (approved_by, workspace_id) references public.profiles(id, workspace_id) on delete set null (approved_by)
);
create index zalo_broadcasts_running on public.zalo_broadcasts(workspace_id, status) where status = 'RUNNING';
create trigger zalo_broadcasts_updated_at before update on public.zalo_broadcasts for each row execute function public.set_updated_at();

create table public.zalo_broadcast_targets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  broadcast_id uuid not null,
  conversation_id uuid not null,
  channel_account_id uuid not null references public.channel_accounts(id) on delete cascade,
  group_id text not null check (char_length(group_id) between 1 and 512),
  group_name text check (char_length(group_name) <= 300),
  position integer not null default 0,
  status text not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED', 'UNKNOWN', 'SKIPPED', 'CANCELLED')),
  pin_status text not null default 'NONE' check (pin_status in ('NONE', 'PENDING', 'PINNED', 'FAILED')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  pin_attempts integer not null default 0 check (pin_attempts between 0 and 3),
  outbound_action_id uuid,
  done_at timestamptz,
  error_code text check (char_length(error_code) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zalo_broadcast_targets_broadcast_fk foreign key (broadcast_id, workspace_id) references public.zalo_broadcasts(id, workspace_id) on delete cascade,
  constraint zalo_broadcast_targets_conversation_fk foreign key (conversation_id, workspace_id) references public.omnichannel_conversations(id, workspace_id) on delete cascade,
  constraint zalo_broadcast_targets_one_per_group unique (broadcast_id, group_id)
);
create index zalo_broadcast_targets_queue on public.zalo_broadcast_targets(broadcast_id, channel_account_id, status, position);
create index zalo_broadcast_targets_account_done on public.zalo_broadcast_targets(channel_account_id, done_at) where done_at is not null;
create trigger zalo_broadcast_targets_updated_at before update on public.zalo_broadcast_targets for each row execute function public.set_updated_at();

alter table public.zalo_broadcasts enable row level security;
alter table public.zalo_broadcast_targets enable row level security;
revoke all on public.zalo_broadcasts, public.zalo_broadcast_targets from anon, authenticated;
grant all on public.zalo_broadcasts, public.zalo_broadcast_targets to service_role;

-- The approved send of one target: the broadcast text into the group, from the target's nick, approved by
-- the member who started the broadcast. Only while the broadcast runs and the target waits.
create or replace function public.propose_zalo_broadcast_send_service(p_workspace_id uuid, p_target_id uuid, p_attempt integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_target public.zalo_broadcast_targets%rowtype; v_broadcast public.zalo_broadcasts%rowtype; v_conversation public.omnichannel_conversations%rowtype;
  v_policy_id uuid; v_action_id uuid; v_key text;
begin
  if p_workspace_id is null or p_target_id is null or p_attempt is null or p_attempt < 1 or p_attempt > 3 then return null; end if;
  select * into v_target from public.zalo_broadcast_targets where id = p_target_id and workspace_id = p_workspace_id and status = 'PENDING';
  if not found then return null; end if;
  select * into v_broadcast from public.zalo_broadcasts where id = v_target.broadcast_id and workspace_id = p_workspace_id and status = 'RUNNING' and send_message and approved_by is not null;
  if not found then return null; end if;
  select * into v_conversation from public.omnichannel_conversations where id = v_target.conversation_id and workspace_id = p_workspace_id
    and channel_account_id = v_target.channel_account_id and channel_type = 'ZALO' and provider_conversation_id = v_target.group_id;
  if not found or not public.is_zalo_group_conversation(v_conversation.id) then return null; end if;
  v_key := 'group-broadcast:' || p_target_id::text || ':part:' || p_attempt::text;
  insert into public.channel_policy_decisions(workspace_id, conversation_id, channel_account_id, channel_type, normalized_recipient, allowed, reason_codes, expires_at)
    values (p_workspace_id, v_conversation.id, v_conversation.channel_account_id, 'ZALO', lower(btrim(v_conversation.provider_conversation_id)), true, array['GROUP_BROADCAST'], clock_timestamp() + interval '10 minutes')
    returning id into v_policy_id;
  insert into public.channel_outbound_actions(workspace_id, conversation_id, channel_account_id, channel_type, recipient_external_id, status, text_content, attachment_ids, approved_by, approved_at, idempotency_key, policy_decision_id, proposed_by, dispatch_source)
    values (p_workspace_id, v_conversation.id, v_conversation.channel_account_id, 'ZALO', v_conversation.provider_conversation_id, 'APPROVED', v_broadcast.text_content, '{}', v_broadcast.approved_by, clock_timestamp(), v_key, v_policy_id, 'HUMAN', 'AI_AUTOMATION')
    on conflict (workspace_id, channel_account_id, idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then select id into v_action_id from public.channel_outbound_actions where workspace_id = p_workspace_id and channel_account_id = v_conversation.channel_account_id and idempotency_key = v_key; end if;
  update public.zalo_broadcast_targets set outbound_action_id = v_action_id, attempts = greatest(attempts, p_attempt) where id = p_target_id;
  return v_action_id;
end $$;
revoke all on function public.propose_zalo_broadcast_send_service(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.propose_zalo_broadcast_send_service(uuid, uuid, integer) to service_role;

-- "Gửi hàng loạt Zalo": administrators get it; other roles when an administrator grants it.
insert into public.workspace_role_permissions(workspace_id, role_id, permission_key)
select role.workspace_id, role.id, key
from public.workspace_roles role cross join (values ('broadcasts.view'), ('broadcasts.manage')) as keys(key)
where role.is_system = true and role.name = 'Quản trị viên'
on conflict (role_id, permission_key) do nothing;

-- Trợ lý may prepare a draft broadcast (the member still starts it on the web page).
alter table public.assistant_actions drop constraint assistant_actions_kind_allowed,
  add constraint assistant_actions_kind_allowed check (kind in (
    'CREATE_TASK','SET_LEAD_STATUS','CAMPAIGN_CONTROL','CREATE_CONTENT','AI_RECRUITER_SAFE_STOP','SEND_REPLY','CREATE_RULE',
    'CREATE_CONTACT','UPDATE_CONTACT','ADD_NOTE','CREATE_COMPANY','UPDATE_COMPANY','UPDATE_TASK',
    'CREATE_EMAIL_CAMPAIGNS','CREATE_EVENT','CANCEL_EVENT','SET_REMINDER','CREATE_BROADCAST'));

commit;
