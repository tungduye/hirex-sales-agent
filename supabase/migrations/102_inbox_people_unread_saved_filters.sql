-- 102: Suối Nguồn
-- 1) Unread counts that leave out e-mail from robots (no-reply, notifications…) and the "Khác" folder,
--    so the number says how many real people are waiting. Same robot rule as isAutomatedSender() in code.
-- 2) Saved filters ("Bộ lọc đã lưu"): each member keeps their own list.
begin;

create or replace function public.inbox_is_automated_sender(p_address text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(position('@' in p_address) > 0 and (
    split_part(lower(p_address), '@', 1) ~ '(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|alerts?|registration|bounces?|newsletter)'
    or split_part(lower(p_address), '@', 2) ~ '(^|\.)(facebookmail\.com|accounts\.google\.com)$'), false);
$$;

drop function if exists public.get_inbox_unread_by_account(uuid[]);
create function public.get_inbox_unread_by_account(p_account_ids uuid[])
returns table(channel_account_id uuid, unread bigint, unread_people bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select c.channel_account_id, count(*),
    count(*) filter (where coalesce(c.metadata->>'folder', '') <> 'OTHER' and not coalesce(public.inbox_is_automated_sender(s.sender), false))
  from public.omnichannel_conversations c
  left join lateral (
    select m.sender_external_id as sender
    from public.omnichannel_messages m
    where c.channel_type = 'EMAIL' and m.workspace_id = c.workspace_id and m.conversation_id = c.id and m.direction = 'INBOUND'
    order by m.created_at desc, m.id desc
    limit 1
  ) s on true
  where c.channel_account_id = any(p_account_ids)
    and c.workspace_id = public.current_workspace_id()
    and c.unread_count > 0
    and coalesce(c.metadata->>'hidden', '') <> 'true'
    and coalesce(array_length(p_account_ids, 1), 0) <= 500
  group by c.channel_account_id;
$$;
revoke all on function public.get_inbox_unread_by_account(uuid[]) from public;
grant execute on function public.get_inbox_unread_by_account(uuid[]) to authenticated;

create table public.inbox_saved_filters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  query text not null default '' check (char_length(query) <= 6000),
  scope text check (scope in ('MINE', 'TEAM', 'ALL')),
  view text check (view in ('all', 'waiting', 'mine', 'groups', 'other')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  constraint inbox_saved_filters_profile_fk foreign key (profile_id, workspace_id) references public.profiles(id, workspace_id) on delete cascade,
  constraint inbox_saved_filters_name_unique unique (profile_id, name)
);
create index inbox_saved_filters_owner on public.inbox_saved_filters(workspace_id, profile_id, sort, created_at);
alter table public.inbox_saved_filters enable row level security;
create policy inbox_saved_filters_own on public.inbox_saved_filters for all to authenticated
  using (workspace_id = public.current_workspace_id() and profile_id = auth.uid())
  with check (workspace_id = public.current_workspace_id() and profile_id = auth.uid());
revoke all on public.inbox_saved_filters from anon, authenticated;
grant select, insert, update, delete on public.inbox_saved_filters to authenticated;
grant all on public.inbox_saved_filters to service_role;

commit;
