-- 120: Soda pins each company's "Tình trạng CV" in the company's Zalo groups, once a day, instead of the AM.
--   * human_partner_groups: which Zalo groups (of the Soda nick) belong to which company. HireX suggests
--     from the group name; an AM (or someone with Khách hàng · Cài đặt) confirms or rejects.
--   * human_cv_pin_settings: on/off and the time of day; the member who switches it on approves the sends.
--   * Group broadcasts may now carry their own text per group, in up to 3 parts (a long CV list): the
--     parts are sent in order and the first one is pinned. kind = 'CV_STATUS' marks these broadcasts.
begin;

create table public.human_partner_groups (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  group_id text not null check (char_length(group_id) between 1 and 512),
  partner_id bigint not null,
  group_name text,
  status text not null default 'SUGGESTED' check (status in ('SUGGESTED', 'CONFIRMED', 'REJECTED')),
  score integer not null default 0,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (workspace_id, group_id, partner_id),
  constraint human_partner_groups_partner_fk foreign key (workspace_id, partner_id) references public.human_partners(workspace_id, partner_id) on delete cascade
);
create index human_partner_groups_partner on public.human_partner_groups(workspace_id, partner_id);
alter table public.human_partner_groups enable row level security;
create policy human_partner_groups_read on public.human_partner_groups for select to authenticated
  using (workspace_id = public.current_workspace_id() and exists (
    select 1 from public.human_partners p where p.workspace_id = human_partner_groups.workspace_id and p.partner_id = human_partner_groups.partner_id));
revoke all on public.human_partner_groups from anon, authenticated;
grant select on public.human_partner_groups to authenticated;
grant all on public.human_partner_groups to service_role;

create table public.human_cv_pin_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  run_hour smallint not null default 8 check (run_hour between 8 and 20),
  run_minute smallint not null default 30 check (run_minute between 0 and 59),
  enabled_by uuid,
  last_run_date date,
  last_run_at timestamptz,
  last_result text,
  updated_at timestamptz not null default now(),
  constraint human_cv_pin_settings_enabled_by_fk foreign key (enabled_by, workspace_id) references public.profiles(id, workspace_id) on delete set null (enabled_by),
  constraint human_cv_pin_settings_enabled_needs_person check (not enabled or enabled_by is not null)
);
alter table public.human_cv_pin_settings enable row level security;
create policy human_cv_pin_settings_read on public.human_cv_pin_settings for select to authenticated
  using (workspace_id = public.current_workspace_id() and (select public.has_workspace_permission('customers.view')));
revoke all on public.human_cv_pin_settings from anon, authenticated;
grant select on public.human_cv_pin_settings to authenticated;
grant all on public.human_cv_pin_settings to service_role;

alter table public.zalo_broadcasts
  add column kind text not null default 'GENERAL' check (kind in ('GENERAL', 'CV_STATUS'));
alter table public.zalo_broadcasts drop constraint if exists zalo_broadcasts_source_check;
alter table public.zalo_broadcasts add constraint zalo_broadcasts_source_check check (source in ('WEB', 'ASSISTANT', 'SCHEDULE'));
alter table public.zalo_broadcast_targets
  add column text_parts text[] check (text_parts is null or (cardinality(text_parts) between 1 and 3)),
  add column parts_sent integer not null default 0 check (parts_sent between 0 and 3),
  add column pin_action_id uuid,
  add column partner_id bigint,
  add column content_hash text;
create index zalo_broadcast_targets_content on public.zalo_broadcast_targets(workspace_id, group_id, done_at desc) where content_hash is not null;

-- The send of one part: its own text (text_parts[p_part + 1]) when the group has one, else the broadcast's
-- text. Keys stay "group-broadcast:<target>:part:<n>" with n = part * 3 + attempt (1–9), as the bridge expects.
create or replace function public.propose_zalo_broadcast_send_service(p_workspace_id uuid, p_target_id uuid, p_attempt integer, p_part integer default 0)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_target public.zalo_broadcast_targets%rowtype; v_broadcast public.zalo_broadcasts%rowtype; v_conversation public.omnichannel_conversations%rowtype;
  v_policy_id uuid; v_action_id uuid; v_key text; v_text text;
begin
  if p_workspace_id is null or p_target_id is null or p_attempt is null or p_attempt < 1 or p_attempt > 3 or p_part is null or p_part < 0 or p_part > 2 then return null; end if;
  select * into v_target from public.zalo_broadcast_targets where id = p_target_id and workspace_id = p_workspace_id and status = 'PENDING';
  if not found then return null; end if;
  select * into v_broadcast from public.zalo_broadcasts where id = v_target.broadcast_id and workspace_id = p_workspace_id and status = 'RUNNING' and send_message and approved_by is not null;
  if not found then return null; end if;
  select * into v_conversation from public.omnichannel_conversations where id = v_target.conversation_id and workspace_id = p_workspace_id
    and channel_account_id = v_target.channel_account_id and channel_type = 'ZALO' and provider_conversation_id = v_target.group_id;
  if not found or not public.is_zalo_group_conversation(v_conversation.id) then return null; end if;
  v_text := case when v_target.text_parts is not null then v_target.text_parts[p_part + 1] else v_broadcast.text_content end;
  if v_text is null or btrim(v_text) = '' then return null; end if;
  v_key := 'group-broadcast:' || p_target_id::text || ':part:' || (p_part * 3 + p_attempt)::text;
  insert into public.channel_policy_decisions(workspace_id, conversation_id, channel_account_id, channel_type, normalized_recipient, allowed, reason_codes, expires_at)
    values (p_workspace_id, v_conversation.id, v_conversation.channel_account_id, 'ZALO', lower(btrim(v_conversation.provider_conversation_id)), true, array['GROUP_BROADCAST'], clock_timestamp() + interval '10 minutes')
    returning id into v_policy_id;
  insert into public.channel_outbound_actions(workspace_id, conversation_id, channel_account_id, channel_type, recipient_external_id, status, text_content, attachment_ids, approved_by, approved_at, idempotency_key, policy_decision_id, proposed_by, dispatch_source)
    values (p_workspace_id, v_conversation.id, v_conversation.channel_account_id, 'ZALO', v_conversation.provider_conversation_id, 'APPROVED', v_text, '{}', v_broadcast.approved_by, clock_timestamp(), v_key, v_policy_id, 'HUMAN', 'AI_AUTOMATION')
    on conflict (workspace_id, channel_account_id, idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then select id into v_action_id from public.channel_outbound_actions where workspace_id = p_workspace_id and channel_account_id = v_conversation.channel_account_id and idempotency_key = v_key; end if;
  update public.zalo_broadcast_targets set outbound_action_id = v_action_id, attempts = greatest(attempts, p_attempt) where id = p_target_id;
  return v_action_id;
end $$;
drop function if exists public.propose_zalo_broadcast_send_service(uuid, uuid, integer);
revoke all on function public.propose_zalo_broadcast_send_service(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.propose_zalo_broadcast_send_service(uuid, uuid, integer, integer) to service_role;

commit;
