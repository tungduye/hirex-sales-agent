-- Persisted campaign pacing. The reservation RPC serializes competing workers
-- on the campaign row so limits cannot be bypassed by concurrent scheduler runs.
alter table public.channel_campaigns
  add column if not exists daily_message_limit integer not null default 100,
  add column if not exists min_delay_seconds integer not null default 30,
  add column if not exists max_delay_seconds integer not null default 90,
  add column if not exists batch_size integer not null default 10,
  add column if not exists batch_pause_minutes integer not null default 15,
  add column if not exists pacing_next_at timestamptz,
  add column if not exists pacing_batch_sent integer not null default 0;

alter table public.channel_campaigns
  drop constraint if exists channel_campaigns_daily_message_limit_check,
  add constraint channel_campaigns_daily_message_limit_check check (daily_message_limit between 1 and 5000),
  drop constraint if exists channel_campaigns_delay_range_check,
  add constraint channel_campaigns_delay_range_check check (min_delay_seconds between 5 and 86400 and max_delay_seconds between min_delay_seconds and 86400),
  drop constraint if exists channel_campaigns_batch_size_check,
  add constraint channel_campaigns_batch_size_check check (batch_size between 1 and 1000),
  drop constraint if exists channel_campaigns_batch_pause_check,
  add constraint channel_campaigns_batch_pause_check check (batch_pause_minutes between 1 and 1440),
  drop constraint if exists channel_campaigns_pacing_batch_sent_check,
  add constraint channel_campaigns_pacing_batch_sent_check check (pacing_batch_sent between 0 and batch_size);

create or replace function public.reserve_channel_campaign_dispatch_slot(p_workspace_id uuid,p_campaign_id uuid)
returns table(reserved boolean,next_dispatch_at timestamptz,reason text,sent_today integer,batch_progress integer)
language plpgsql security definer set search_path='' as $$
declare
  v_campaign public.channel_campaigns%rowtype;
  v_now timestamptz := clock_timestamp();
  v_sent_today integer;
  v_next timestamptz;
  v_progress integer;
  v_random_seconds integer;
begin
  if p_workspace_id is null or p_campaign_id is null then
    return query select false,null::timestamptz,'INVALID_INPUT'::text,0,0;
    return;
  end if;
  select * into v_campaign from public.channel_campaigns
    where id=p_campaign_id and workspace_id=p_workspace_id and status='RUNNING' for update;
  if not found then
    return query select false,null::timestamptz,'NOT_RUNNING'::text,0,0;
    return;
  end if;
  select count(*)::integer into v_sent_today from public.channel_campaign_recipient_steps
    where workspace_id=p_workspace_id and campaign_id=p_campaign_id and status='SENT'
      and completed_at>=date_trunc('day',v_now at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
  if v_sent_today>=v_campaign.daily_message_limit then
    v_next=(date_trunc('day',v_now at time zone 'Asia/Ho_Chi_Minh')+interval '1 day') at time zone 'Asia/Ho_Chi_Minh';
    update public.channel_campaigns set pacing_next_at=v_next,updated_at=v_now where id=p_campaign_id;
    return query select false,v_next,'DAILY_LIMIT'::text,v_sent_today,v_campaign.pacing_batch_sent;
    return;
  end if;
  if v_campaign.pacing_next_at is not null and v_campaign.pacing_next_at>v_now then
    return query select false,v_campaign.pacing_next_at,'WAITING'::text,v_sent_today,v_campaign.pacing_batch_sent;
    return;
  end if;
  v_progress=v_campaign.pacing_batch_sent+1;
  if v_progress>=v_campaign.batch_size then
    v_next=v_now+make_interval(mins=>v_campaign.batch_pause_minutes);
    v_progress=0;
  else
    v_random_seconds=v_campaign.min_delay_seconds+floor(random()*(v_campaign.max_delay_seconds-v_campaign.min_delay_seconds+1))::integer;
    v_next=v_now+make_interval(secs=>v_random_seconds);
  end if;
  update public.channel_campaigns set pacing_next_at=v_next,pacing_batch_sent=v_progress,updated_at=v_now where id=p_campaign_id;
  return query select true,v_next,'RESERVED'::text,v_sent_today,v_progress;
end $$;

revoke all on function public.reserve_channel_campaign_dispatch_slot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_channel_campaign_dispatch_slot(uuid,uuid) to service_role;

-- The first step's configured delay now applies when the campaign starts.
create or replace function public.start_channel_campaign(p_campaign_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid(); v_started_at timestamptz := clock_timestamp(); v_initial_delay integer;
begin
  if v_workspace_id is null or v_actor_id is null or not public.has_workspace_permission('campaigns.launch') then return false; end if;
  select delay_minutes into v_initial_delay from public.channel_campaign_steps where campaign_id=p_campaign_id and workspace_id=v_workspace_id order by position limit 1;
  update public.channel_campaigns set status='RUNNING',started_at=v_started_at,pacing_next_at=v_started_at+make_interval(mins=>coalesce(v_initial_delay,0)),pacing_batch_sent=0 where id=p_campaign_id and workspace_id=v_workspace_id and status='DRAFT'
    and exists(select 1 from public.channel_campaign_steps where campaign_id=p_campaign_id and workspace_id=v_workspace_id)
    and exists(select 1 from public.channel_campaign_recipients where campaign_id=p_campaign_id and workspace_id=v_workspace_id)
    and exists(select 1 from public.channel_campaign_senders where campaign_id=p_campaign_id and workspace_id=v_workspace_id and enabled);
  if not found then return false; end if;
  update public.channel_campaign_recipients set next_step_at=v_started_at+make_interval(mins=>coalesce(v_initial_delay,0)) where campaign_id=p_campaign_id and workspace_id=v_workspace_id and status='ACTIVE';
  insert into public.channel_campaign_recipient_steps(workspace_id,campaign_id,recipient_id,step_id,idempotency_key)
    select v_workspace_id,p_campaign_id,r.id,s.id,'channel-campaign:'||p_campaign_id::text||':'||r.id::text||':'||s.id::text
    from public.channel_campaign_recipients r cross join public.channel_campaign_steps s
    where r.workspace_id=v_workspace_id and r.campaign_id=p_campaign_id and s.workspace_id=v_workspace_id and s.campaign_id=p_campaign_id;
  insert into public.channel_campaign_events(workspace_id,campaign_id,event_type,metadata) values(v_workspace_id,p_campaign_id,'STARTED',jsonb_build_object('firstDispatchAt',v_started_at+make_interval(mins=>coalesce(v_initial_delay,0))));
  return true;
end $$;

revoke all on function public.start_channel_campaign(uuid) from public,anon;
grant execute on function public.start_channel_campaign(uuid) to authenticated;
