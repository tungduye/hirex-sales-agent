-- 115: Suối Nguồn bulk actions (gắn nhãn hàng loạt). Tag / untag, mark read, move to Khác or back, assign,
-- on up to 5,000 conversations at once. Each run is recorded (who, what, how many, when) with what it
-- changed, so its author can undo it within 10 minutes. Rules are the ones of a single conversation:
-- Suối Nguồn "Cập nhật" and only nicks the member may use; anything else is skipped.
begin;

create table public.inbox_bulk_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null,
  action text not null,
  tag_ids uuid[] not null default '{}',
  assignee_id uuid,
  requested integer not null,
  affected integer not null,
  changes jsonb not null default '[]'::jsonb,
  source text not null default 'INBOX',
  undone_at timestamptz,
  undone_by uuid,
  created_at timestamptz not null default now(),
  constraint inbox_bulk_operations_action_allowed check (action in ('TAG_ADD', 'TAG_REMOVE', 'MARK_READ', 'MOVE_OTHER', 'MOVE_PRIMARY', 'ASSIGN')),
  constraint inbox_bulk_operations_source_allowed check (source in ('INBOX', 'ASSISTANT')),
  constraint inbox_bulk_operations_creator_fk foreign key (created_by, workspace_id) references public.profiles(id, workspace_id) on delete cascade
);
create index inbox_bulk_operations_recent on public.inbox_bulk_operations(workspace_id, created_by, created_at desc);
alter table public.inbox_bulk_operations enable row level security;
-- Members read their own runs; members who manage roles read everyone's (audit). Writes only through the functions below.
create policy inbox_bulk_operations_read on public.inbox_bulk_operations for select to authenticated
  using (workspace_id = public.current_workspace_id() and (created_by = auth.uid() or public.has_workspace_permission('roles.view')));
grant select on public.inbox_bulk_operations to authenticated;

create or replace function public.inbox_bulk_apply(
  p_conversation_ids uuid[], p_action text, p_tag_ids uuid[], p_assignee_id uuid, p_source text default 'INBOX')
returns table(operation_id uuid, affected integer, skipped integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_actor uuid := auth.uid();
  v_ids uuid[];
  v_requested integer := coalesce(cardinality(p_conversation_ids), 0);
  v_tags uuid[] := coalesce(p_tag_ids, '{}');
  v_changes jsonb := '[]'::jsonb;
  v_affected integer := 0;
  v_operation uuid;
begin
  if v_workspace is null or v_actor is null or not public.has_workspace_permission('inbox.update') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_action not in ('TAG_ADD', 'TAG_REMOVE', 'MARK_READ', 'MOVE_OTHER', 'MOVE_PRIMARY', 'ASSIGN') or coalesce(p_source, 'INBOX') not in ('INBOX', 'ASSISTANT') then
    raise exception 'INVALID_ACTION' using errcode = '22023';
  end if;
  if v_requested = 0 or v_requested > 5000 then raise exception 'TOO_MANY' using errcode = '22023'; end if;
  if p_action in ('TAG_ADD', 'TAG_REMOVE') then
    if cardinality(v_tags) = 0 or cardinality(v_tags) > 20 or (select count(*) from public.conversation_tags t where t.workspace_id = v_workspace and t.id = any(v_tags)) <> cardinality(v_tags) then
      raise exception 'INVALID_TAG' using errcode = '22023';
    end if;
  end if;
  if p_action = 'ASSIGN' and p_assignee_id is not null and not exists (select 1 from public.profiles p where p.id = p_assignee_id and p.workspace_id = v_workspace) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '22023';
  end if;

  -- Only conversations of this workspace, on nicks the member may use, not deleted.
  select array_agg(c.id) into v_ids
  from public.omnichannel_conversations c
  where c.workspace_id = v_workspace and c.id = any(p_conversation_ids)
    and coalesce(c.metadata->>'hidden', '') <> 'true'
    and c.channel_account_id in (select a.id from public.channel_accounts a where a.workspace_id = v_workspace and public.can_access_channel_account(a.id));
  v_ids := coalesce(v_ids, '{}');

  if p_action = 'TAG_ADD' then
    with added as (
      insert into public.conversation_tag_links(workspace_id, conversation_id, tag_id)
      select v_workspace, c, t from unnest(v_ids) c cross join unnest(v_tags) t
      on conflict do nothing
      returning conversation_id, tag_id)
    select coalesce(jsonb_agg(jsonb_build_object('c', conversation_id, 't', tag_id)), '[]'::jsonb), count(distinct conversation_id) into v_changes, v_affected from added;
  elsif p_action = 'TAG_REMOVE' then
    with removed as (
      delete from public.conversation_tag_links l
      where l.workspace_id = v_workspace and l.conversation_id = any(v_ids) and l.tag_id = any(v_tags)
      returning l.conversation_id, l.tag_id)
    select coalesce(jsonb_agg(jsonb_build_object('c', conversation_id, 't', tag_id)), '[]'::jsonb), count(distinct conversation_id) into v_changes, v_affected from removed;
  elsif p_action = 'MARK_READ' then
    with before as (select c.id, c.unread_count from public.omnichannel_conversations c where c.id = any(v_ids) and c.unread_count > 0 for update),
    changed as (update public.omnichannel_conversations c set unread_count = 0 from before b where c.id = b.id returning b.id, b.unread_count)
    select coalesce(jsonb_agg(jsonb_build_object('c', id, 'v', unread_count)), '[]'::jsonb), count(*) into v_changes, v_affected from changed;
  elsif p_action in ('MOVE_OTHER', 'MOVE_PRIMARY') then
    with before as (select c.id, c.metadata->'folder' as folder from public.omnichannel_conversations c
        where c.id = any(v_ids) and coalesce(c.metadata->>'folder', 'PRIMARY') <> case when p_action = 'MOVE_OTHER' then 'OTHER' else 'PRIMARY' end for update),
    changed as (update public.omnichannel_conversations c
        set metadata = jsonb_set(coalesce(c.metadata, '{}'::jsonb), '{folder}', to_jsonb(case when p_action = 'MOVE_OTHER' then 'OTHER' else 'PRIMARY' end))
        from before b where c.id = b.id returning b.id, b.folder)
    select coalesce(jsonb_agg(jsonb_build_object('c', id, 'v', folder)), '[]'::jsonb), count(*) into v_changes, v_affected from changed;
  elsif p_action = 'ASSIGN' then
    with before as (select c.id, c.assigned_to from public.omnichannel_conversations c where c.id = any(v_ids) and c.assigned_to is distinct from p_assignee_id for update),
    changed as (update public.omnichannel_conversations c set assigned_to = p_assignee_id from before b where c.id = b.id returning b.id, b.assigned_to)
    select coalesce(jsonb_agg(jsonb_build_object('c', id, 'v', assigned_to)), '[]'::jsonb), count(*) into v_changes, v_affected from changed;
  end if;

  insert into public.inbox_bulk_operations(workspace_id, created_by, action, tag_ids, assignee_id, requested, affected, changes, source)
  values (v_workspace, v_actor, p_action, case when p_action in ('TAG_ADD', 'TAG_REMOVE') then v_tags else '{}' end,
    case when p_action = 'ASSIGN' then p_assignee_id end, v_requested, v_affected, v_changes, coalesce(p_source, 'INBOX'))
  returning id into v_operation;
  operation_id := v_operation; affected := v_affected; skipped := v_requested - cardinality(v_ids);
  return next;
end $$;

-- Undo a run: only its author, within 10 minutes, once. A conversation changed again since is left as it is.
create or replace function public.inbox_bulk_undo(p_operation_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := public.current_workspace_id();
  v_actor uuid := auth.uid();
  op public.inbox_bulk_operations%rowtype;
  v_restored integer := 0;
begin
  if v_workspace is null or v_actor is null or not public.has_workspace_permission('inbox.update') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into op from public.inbox_bulk_operations o where o.id = p_operation_id and o.workspace_id = v_workspace for update;
  if not found or op.created_by <> v_actor then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if op.undone_at is not null then raise exception 'ALREADY_UNDONE' using errcode = '22023'; end if;
  if op.created_at < now() - interval '10 minutes' then raise exception 'TOO_LATE' using errcode = '22023'; end if;

  if op.action = 'TAG_ADD' then
    with gone as (delete from public.conversation_tag_links l using jsonb_array_elements(op.changes) e
      where l.workspace_id = v_workspace and l.conversation_id = (e->>'c')::uuid and l.tag_id = (e->>'t')::uuid returning 1)
    select count(*) into v_restored from gone;
  elsif op.action = 'TAG_REMOVE' then
    with back as (insert into public.conversation_tag_links(workspace_id, conversation_id, tag_id)
      select v_workspace, (e->>'c')::uuid, (e->>'t')::uuid from jsonb_array_elements(op.changes) e
      where exists (select 1 from public.omnichannel_conversations c where c.id = (e->>'c')::uuid and c.workspace_id = v_workspace)
        and exists (select 1 from public.conversation_tags t where t.id = (e->>'t')::uuid and t.workspace_id = v_workspace)
      on conflict do nothing returning 1)
    select count(*) into v_restored from back;
  elsif op.action = 'MARK_READ' then
    with back as (update public.omnichannel_conversations c set unread_count = greatest(c.unread_count, (e->>'v')::integer)
      from jsonb_array_elements(op.changes) e where c.workspace_id = v_workspace and c.id = (e->>'c')::uuid and c.unread_count = 0 returning 1)
    select count(*) into v_restored from back;
  elsif op.action in ('MOVE_OTHER', 'MOVE_PRIMARY') then
    with back as (update public.omnichannel_conversations c
      set metadata = case when e->'v' is null or e->'v' = 'null'::jsonb then coalesce(c.metadata, '{}'::jsonb) - 'folder' else jsonb_set(coalesce(c.metadata, '{}'::jsonb), '{folder}', e->'v') end
      from jsonb_array_elements(op.changes) e
      where c.workspace_id = v_workspace and c.id = (e->>'c')::uuid
        and coalesce(c.metadata->>'folder', 'PRIMARY') = case when op.action = 'MOVE_OTHER' then 'OTHER' else 'PRIMARY' end returning 1)
    select count(*) into v_restored from back;
  elsif op.action = 'ASSIGN' then
    with back as (update public.omnichannel_conversations c set assigned_to = nullif(e->>'v', '')::uuid
      from jsonb_array_elements(op.changes) e
      where c.workspace_id = v_workspace and c.id = (e->>'c')::uuid and c.assigned_to is not distinct from op.assignee_id returning 1)
    select count(*) into v_restored from back;
  end if;
  update public.inbox_bulk_operations set undone_at = now(), undone_by = v_actor where id = op.id;
  return v_restored;
end $$;

-- Every conversation id that passes the Suối Nguồn filters and tab (newest first, at most p_max + 1, so the
-- caller can tell "more than p_max"). Security invoker: row level security decides what the member sees.
create or replace function public.inbox_matching_conversation_ids(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date,
  p_view text, p_search text, p_user_id uuid, p_max integer)
returns uuid[]
language sql stable security invoker set search_path = public as $$
  select coalesce(array_agg(f.id order by f.sort_at desc, f.id desc), '{}')
  from (
    select f.id, f.sort_at from public.inbox_filtered_conversations(p_account_ids, p_channel_types, p_tag_ids, p_tag_mode, p_first_from, p_first_to,
      p_search, case when p_view = 'mine' then coalesce(p_user_id, '00000000-0000-0000-0000-000000000000'::uuid) end, null, null, null, null) f
    where public.inbox_view_matches(p_view, f.is_group, f.is_other, f.latest_direction, f.assigned_to, p_user_id)
    order by f.sort_at desc, f.id desc
    limit least(greatest(coalesce(p_max, 5000), 1), 5000) + 1
  ) f
$$;

revoke all on function public.inbox_bulk_apply(uuid[], text, uuid[], uuid, text) from public, anon;
revoke all on function public.inbox_bulk_undo(uuid) from public, anon;
revoke all on function public.inbox_matching_conversation_ids(uuid[], text[], uuid[], text, date, date, text, text, uuid, integer) from public, anon;
grant execute on function public.inbox_bulk_apply(uuid[], text, uuid[], uuid, text) to authenticated;
grant execute on function public.inbox_bulk_undo(uuid) to authenticated;
grant execute on function public.inbox_matching_conversation_ids(uuid[], text[], uuid[], text, date, date, text, text, uuid, integer) to authenticated;

-- Soda (Trợ lý) runs the same bulk action for a member, after the member confirms its card. The Trợ lý works
-- without the member's browser session, so this (service role only) acts as that member: their permission,
-- their nicks, and the run is recorded under their name with source ASSISTANT.
create or replace function public.assistant_inbox_bulk(
  p_actor uuid, p_account_ids uuid[], p_channel_types text[], p_filter_tag_ids uuid[], p_view text, p_search text,
  p_action text, p_tag_ids uuid[], p_assignee_id uuid, p_dry_run boolean)
returns table(operation_id uuid, matched integer, affected integer, skipped integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_accounts uuid[];
  v_ids uuid[];
  r record;
begin
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  if public.current_workspace_id() is null or not public.has_workspace_permission('inbox.update') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select array_agg(a.id) into v_accounts from public.channel_accounts a
  where a.workspace_id = public.current_workspace_id() and a.deleted_at is null and public.can_access_channel_account(a.id)
    and (p_account_ids is null or cardinality(p_account_ids) = 0 or a.id = any(p_account_ids));
  v_ids := case when v_accounts is null then '{}'::uuid[] else public.inbox_matching_conversation_ids(v_accounts, p_channel_types, p_filter_tag_ids, 'all', null, null,
    coalesce(p_view, 'all'), p_search, p_actor, 5000) end;
  matched := cardinality(v_ids);
  if p_dry_run then return next; return; end if;
  if matched = 0 then raise exception 'NOTHING_MATCHED' using errcode = '22023'; end if;
  if matched > 5000 then raise exception 'TOO_MANY' using errcode = '22023'; end if;
  select * into r from public.inbox_bulk_apply(v_ids, p_action, p_tag_ids, p_assignee_id, 'ASSISTANT');
  operation_id := r.operation_id; affected := r.affected; skipped := r.skipped;
  return next;
end $$;
revoke all on function public.assistant_inbox_bulk(uuid, uuid[], text[], uuid[], text, text, text, uuid[], uuid, boolean) from public, anon, authenticated;
grant execute on function public.assistant_inbox_bulk(uuid, uuid[], text[], uuid[], text, text, text, uuid[], uuid, boolean) to service_role;

alter table public.assistant_actions drop constraint assistant_actions_kind_allowed,
  add constraint assistant_actions_kind_allowed check (kind in (
    'CREATE_TASK','SET_LEAD_STATUS','CAMPAIGN_CONTROL','CREATE_CONTENT','AI_RECRUITER_SAFE_STOP','SEND_REPLY','CREATE_RULE',
    'CREATE_CONTACT','UPDATE_CONTACT','ADD_NOTE','CREATE_COMPANY','UPDATE_COMPANY','UPDATE_TASK',
    'CREATE_EMAIL_CAMPAIGNS','CREATE_EVENT','CANCEL_EVENT','SET_REMINDER','CREATE_BROADCAST','BULK_INBOX'));

commit;
