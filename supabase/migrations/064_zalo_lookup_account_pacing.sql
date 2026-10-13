-- One lookup budget per connected Zalo account, shared by all campaigns.
-- The lease is committed before calling the bridge, so concurrent workers
-- cannot burst lookups through the same account.
create table public.zalo_lookup_account_pacing (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id uuid not null,
  next_allowed_at timestamptz not null default now(),
  backoff_level integer not null default 0 check (backoff_level between 0 and 6),
  last_error_code text,
  last_lookup_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, channel_account_id),
  foreign key (channel_account_id, workspace_id)
    references public.channel_accounts(id, workspace_id) on delete cascade
);

create table public.zalo_phone_lookup_cache (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id uuid not null,
  phone text not null check (phone ~ '^0[35789][0-9]{8}$'),
  result text not null check (result in ('FOUND', 'NOT_FOUND')),
  zalo_user_id text,
  display_name text,
  avatar_url text,
  is_friend boolean,
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (workspace_id, channel_account_id, phone),
  foreign key (channel_account_id, workspace_id)
    references public.channel_accounts(id, workspace_id) on delete cascade,
  check ((result = 'NOT_FOUND' and zalo_user_id is null)
    or (result = 'FOUND' and zalo_user_id is not null and display_name is not null and is_friend is not null))
);

create index zalo_phone_lookup_cache_expiry_idx on public.zalo_phone_lookup_cache(expires_at);

alter table public.zalo_lookup_account_pacing enable row level security;
alter table public.zalo_phone_lookup_cache enable row level security;
revoke all on public.zalo_lookup_account_pacing from public, anon, authenticated;
revoke all on public.zalo_phone_lookup_cache from public, anon, authenticated;
grant select, insert, update on public.zalo_lookup_account_pacing to service_role;
grant select, insert, update on public.zalo_phone_lookup_cache to service_role;

create function public.reserve_zalo_phone_lookup(p_workspace_id uuid, p_channel_account_id uuid)
returns table(granted boolean, next_allowed_at timestamptz, backoff_level integer, last_error_code text)
language plpgsql security definer set search_path = '' as $$
declare v_state public.zalo_lookup_account_pacing%rowtype; v_now timestamptz := clock_timestamp();
begin
  if auth.role() <> 'service_role' or p_workspace_id is null or p_channel_account_id is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists(select 1 from public.channel_accounts a where a.id = p_channel_account_id
    and a.workspace_id = p_workspace_id and a.channel_type = 'ZALO' and a.status = 'CONNECTED') then
    return query select false, v_now + interval '5 minutes', 0, 'ACCOUNT_UNAVAILABLE'::text;
    return;
  end if;
  insert into public.zalo_lookup_account_pacing(workspace_id, channel_account_id)
    values(p_workspace_id, p_channel_account_id) on conflict do nothing;
  select * into v_state from public.zalo_lookup_account_pacing p
    where p.workspace_id = p_workspace_id and p.channel_account_id = p_channel_account_id for update;
  if v_state.next_allowed_at > v_now then
    return query select false, v_state.next_allowed_at, v_state.backoff_level, v_state.last_error_code;
    return;
  end if;
  update public.zalo_lookup_account_pacing p
    set next_allowed_at = v_now + interval '20 seconds', last_lookup_at = v_now, updated_at = v_now
    where p.workspace_id = p_workspace_id and p.channel_account_id = p_channel_account_id;
  return query select true, v_now + interval '20 seconds', v_state.backoff_level, v_state.last_error_code;
end $$;

create function public.record_zalo_phone_lookup_outcome(
  p_workspace_id uuid, p_channel_account_id uuid, p_error_code text
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_state public.zalo_lookup_account_pacing%rowtype; v_now timestamptz := clock_timestamp();
  v_level integer; v_seconds integer;
begin
  if auth.role() <> 'service_role' or p_workspace_id is null or p_channel_account_id is null
    or (p_error_code is not null and p_error_code not in ('ACCOUNT_BUSY','RATE_LIMITED','ACCOUNT_UNAVAILABLE')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_state from public.zalo_lookup_account_pacing p
    where p.workspace_id = p_workspace_id and p.channel_account_id = p_channel_account_id for update;
  if not found then raise exception 'LOOKUP_SLOT_MISSING'; end if;
  if p_error_code is null then
    update public.zalo_lookup_account_pacing p set backoff_level = 0, last_error_code = null, updated_at = v_now
      where p.workspace_id = p_workspace_id and p.channel_account_id = p_channel_account_id;
    return v_state.next_allowed_at;
  end if;
  v_level := least(v_state.backoff_level + 1, 6);
  v_seconds := least(case when p_error_code = 'RATE_LIMITED' then 300 else 60 end * (2 ^ (v_level - 1))::integer, 7200);
  update public.zalo_lookup_account_pacing p
    set next_allowed_at = greatest(p.next_allowed_at, v_now + make_interval(secs => v_seconds)),
      backoff_level = v_level, last_error_code = p_error_code, updated_at = v_now
    where p.workspace_id = p_workspace_id and p.channel_account_id = p_channel_account_id
    returning p.next_allowed_at into v_state.next_allowed_at;
  return v_state.next_allowed_at;
end $$;

revoke all on function public.reserve_zalo_phone_lookup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_zalo_phone_lookup_outcome(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_zalo_phone_lookup(uuid, uuid) to service_role;
grant execute on function public.record_zalo_phone_lookup_outcome(uuid, uuid, text) to service_role;
