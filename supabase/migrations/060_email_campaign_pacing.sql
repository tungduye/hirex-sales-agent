alter table public.email_campaigns
  add column if not exists daily_message_limit integer not null default 100,
  add column if not exists min_delay_seconds integer not null default 30,
  add column if not exists max_delay_seconds integer not null default 90,
  add column if not exists batch_size integer not null default 10,
  add column if not exists batch_pause_minutes integer not null default 15,
  add column if not exists pacing_next_at timestamptz,
  add column if not exists pacing_batch_sent integer not null default 0;

alter table public.email_campaigns
  add constraint email_campaigns_daily_message_limit_check check (daily_message_limit between 1 and 5000),
  add constraint email_campaigns_delay_range_check check (min_delay_seconds between 5 and 86400 and max_delay_seconds between min_delay_seconds and 86400),
  add constraint email_campaigns_batch_size_check check (batch_size between 1 and 1000),
  add constraint email_campaigns_batch_pause_check check (batch_pause_minutes between 1 and 1440),
  add constraint email_campaigns_pacing_batch_sent_check check (pacing_batch_sent between 0 and batch_size);

create or replace function public.reserve_email_campaign_dispatch_slot(p_workspace_id uuid,p_campaign_id uuid)
returns table(reserved boolean,next_dispatch_at timestamptz,reason text,sent_today integer,batch_progress integer)
language plpgsql security definer set search_path='' as $$
declare v_campaign public.email_campaigns%rowtype;v_now timestamptz:=clock_timestamp();v_sent integer;v_next timestamptz;v_progress integer;v_random integer;
begin
  select * into v_campaign from public.email_campaigns where id=p_campaign_id and workspace_id=p_workspace_id and status='RUNNING' for update;
  if not found then return query select false,null::timestamptz,'NOT_RUNNING'::text,0,0;return;end if;
  select count(*)::integer into v_sent from public.email_campaign_recipient_steps where workspace_id=p_workspace_id and campaign_id=p_campaign_id and status='SENT' and sent_at>=date_trunc('day',v_now at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
  if v_sent>=v_campaign.daily_message_limit then v_next=(date_trunc('day',v_now at time zone 'Asia/Ho_Chi_Minh')+interval '1 day') at time zone 'Asia/Ho_Chi_Minh';update public.email_campaigns set pacing_next_at=v_next,updated_at=v_now where id=p_campaign_id;return query select false,v_next,'DAILY_LIMIT'::text,v_sent,v_campaign.pacing_batch_sent;return;end if;
  if v_campaign.pacing_next_at is not null and v_campaign.pacing_next_at>v_now then return query select false,v_campaign.pacing_next_at,'WAITING'::text,v_sent,v_campaign.pacing_batch_sent;return;end if;
  v_progress:=v_campaign.pacing_batch_sent+1;
  if v_progress>=v_campaign.batch_size then v_next:=v_now+make_interval(mins=>v_campaign.batch_pause_minutes);v_progress:=0;else v_random:=v_campaign.min_delay_seconds+floor(random()*(v_campaign.max_delay_seconds-v_campaign.min_delay_seconds+1))::integer;v_next:=v_now+make_interval(secs=>v_random);end if;
  update public.email_campaigns set pacing_next_at=v_next,pacing_batch_sent=v_progress,updated_at=v_now where id=p_campaign_id;
  return query select true,v_next,'RESERVED'::text,v_sent,v_progress;
end $$;
revoke all on function public.reserve_email_campaign_dispatch_slot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_email_campaign_dispatch_slot(uuid,uuid) to service_role;
