begin;

alter table public.email_campaigns add column sequence_enabled boolean not null default false;
alter table public.email_messages add constraint email_messages_id_workspace_key unique(id,workspace_id);
alter table public.email_messages
  add column auto_submitted text, add column dsn_report_type text,
  add column failed_recipients text[] not null default '{}'::text[],
  add column dsn_final_recipient text, add column dsn_original_recipient text,
  add column dsn_action text, add column dsn_status text, add column dsn_diagnostic_code text,
  add column is_mailer_daemon boolean not null default false,
  add constraint email_messages_failed_recipients_no_nulls check(array_position(failed_recipients,null) is null),
  add constraint email_messages_dsn_status_safe check(dsn_status is null or dsn_status ~ '^[245][.][0-9]{1,3}[.][0-9]{1,3}$');
alter table public.email_campaign_recipients
  add column engagement_status text not null default 'ACTIVE',
  add column replied_at timestamptz,
  add column reply_email_message_id uuid,
  add column hard_bounced_at timestamptz,
  add column bounce_diagnostic text,
  add column last_engagement_at timestamptz,
  add column last_sent_step_order integer,
  add column stopped_reason text,
  add constraint email_campaign_recipient_engagement_allowed check (engagement_status in ('ACTIVE','REPLIED','HARD_BOUNCED','UNSUBSCRIBED','COMPLETED','CANCELLED')),
  add constraint email_campaign_recipient_reply_fk foreign key (reply_email_message_id,workspace_id) references public.email_messages(id,workspace_id) on delete restrict;

create table public.email_campaign_steps (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null, step_order integer not null check(step_order between 0 and 5),
  step_type text not null check(step_type in ('INITIAL','FOLLOW_UP')),
  delay_minutes integer not null check(delay_minutes between 0 and 525600),
  subject_template text not null check(btrim(subject_template)<>'' and length(subject_template)<=998),
  body_text_template text not null check(btrim(body_text_template)<>'' and length(body_text_template)<=100000),
  enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,workspace_id), constraint email_campaign_steps_campaign_order_key unique(campaign_id,step_order) deferrable initially immediate,
  foreign key(campaign_id,workspace_id) references public.email_campaigns(id,workspace_id) on delete cascade,
  check((step_order=0 and step_type='INITIAL' and delay_minutes=0) or (step_order between 1 and 5 and step_type='FOLLOW_UP' and delay_minutes>0))
);

create table public.email_campaign_recipient_steps (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null, recipient_id uuid not null, campaign_step_id uuid not null, step_order integer not null check(step_order between 0 and 5),
  status text not null default 'PENDING' check(status in ('PENDING','SENDING','SENT','FAILED','SUPPRESSED','CANCELLED','DELIVERY_UNKNOWN','SKIPPED_REPLY','SKIPPED_BOUNCE','SKIPPED_UNSUBSCRIBED')),
  eligible_at timestamptz not null, sender_email_account_id uuid, idempotency_key uuid not null default gen_random_uuid(),
  claim_token uuid, claimed_at timestamptz, send_request_id uuid, sent_at timestamptz, safe_error_code text,
  provider_message_id text, provider_thread_id text, rfc_message_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,workspace_id), unique(recipient_id,campaign_step_id), unique(idempotency_key),
  foreign key(campaign_id,workspace_id) references public.email_campaigns(id,workspace_id) on delete cascade,
  foreign key(recipient_id,workspace_id) references public.email_campaign_recipients(id,workspace_id) on delete cascade,
  foreign key(campaign_step_id,workspace_id) references public.email_campaign_steps(id,workspace_id) on delete cascade,
  foreign key(sender_email_account_id,workspace_id) references public.email_accounts(id,workspace_id) on delete restrict,
  foreign key(send_request_id,workspace_id) references public.email_send_requests(id,workspace_id) on delete restrict,
  check((status='PENDING' and claim_token is null and claimed_at is null) or (status='SENDING' and claim_token is not null and claimed_at is not null and sender_email_account_id is not null) or (status not in ('PENDING','SENDING') and claim_token is null and claimed_at is null)),
  check(send_request_id is null or sender_email_account_id is not null)
);

create table public.email_campaign_signal_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null, recipient_id uuid not null, email_message_id uuid, signal_type text not null check(signal_type in ('REPLY','HARD_BOUNCE','UNSUBSCRIBE')),
  source_key text not null check(btrim(source_key)<>'' and length(source_key)<=300), metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), unique(workspace_id,signal_type,source_key),
  foreign key(campaign_id,workspace_id) references public.email_campaigns(id,workspace_id) on delete cascade,
  foreign key(recipient_id,workspace_id) references public.email_campaign_recipients(id,workspace_id) on delete cascade,
  foreign key(email_message_id,workspace_id) references public.email_messages(id,workspace_id) on delete restrict,
  check(jsonb_typeof(metadata)='object')
);

alter table public.email_campaign_events drop constraint email_campaign_events_event_type_check;
alter table public.email_campaign_events add constraint email_campaign_events_event_type_check check(event_type in ('CAMPAIGN_CREATED','AUDIENCE_IMPORTED','CAMPAIGN_SCHEDULED','CAMPAIGN_STARTED','CAMPAIGN_PAUSED','CAMPAIGN_RESUMED','CAMPAIGN_CANCELLED','CAMPAIGN_COMPLETED','RECIPIENT_CLAIMED','RECIPIENT_SENT','RECIPIENT_FAILED','RECIPIENT_SUPPRESSED','RECIPIENT_DELIVERY_UNKNOWN','SEQUENCE_INITIALIZED','STEP_SENT','STEP_FAILED','RECIPIENT_REPLIED','RECIPIENT_HARD_BOUNCED','RECIPIENT_UNSUBSCRIBED','RECIPIENT_COMPLETED'));

create function public.require_draft_campaign_step() returns trigger language plpgsql set search_path='' as $$
declare v_campaign_id uuid; v_workspace_id uuid;
begin
  v_campaign_id:=case when tg_op='DELETE' then old.campaign_id else new.campaign_id end; v_workspace_id:=case when tg_op='DELETE' then old.workspace_id else new.workspace_id end;
  if not exists(select 1 from public.email_campaigns c where c.id=v_campaign_id and c.workspace_id=v_workspace_id and c.status='DRAFT' for update) then raise exception 'Campaign sequence is immutable outside DRAFT'; end if;
  if tg_op<>'DELETE' and coalesce(current_setting('hirex.sequence_reorder',true),'off')<>'on' and new.step_order>0 and not exists(select 1 from public.email_campaign_steps s where s.campaign_id=v_campaign_id and s.workspace_id=v_workspace_id and s.step_order=new.step_order-1 and s.enabled) then raise exception 'Campaign sequence steps must be contiguous'; end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger email_campaign_steps_draft_guard before insert or update or delete on public.email_campaign_steps for each row execute function public.require_draft_campaign_step();
create trigger email_campaign_steps_updated_at before update on public.email_campaign_steps for each row execute function public.set_updated_at();
create trigger email_campaign_recipient_steps_updated_at before update on public.email_campaign_recipient_steps for each row execute function public.set_updated_at();

create function public.guard_sequence_email_send_request() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.email_campaign_recipient_steps d where d.workspace_id=new.workspace_id and d.sender_email_account_id=new.email_account_id and d.idempotency_key=new.idempotency_key) and not exists(
    select 1 from public.email_campaign_recipient_steps d join public.email_campaign_recipients r on r.id=d.recipient_id and r.workspace_id=d.workspace_id
    join public.email_campaigns c on c.id=d.campaign_id and c.workspace_id=d.workspace_id
    where d.workspace_id=new.workspace_id and d.sender_email_account_id=new.email_account_id and d.idempotency_key=new.idempotency_key and d.status='SENDING' and r.engagement_status='ACTIVE' and c.status='RUNNING' and c.sequence_enabled
    for update of d,r,c
  ) then raise exception 'Sequence delivery is no longer eligible';end if;
  return new;
end $$;
create trigger email_send_requests_sequence_guard before insert on public.email_send_requests for each row execute function public.guard_sequence_email_send_request();

create index email_campaign_steps_campaign_idx on public.email_campaign_steps(workspace_id,campaign_id,step_order);
create index email_campaign_recipient_steps_due_idx on public.email_campaign_recipient_steps(workspace_id,campaign_id,status,eligible_at);
create index email_campaign_recipient_steps_thread_idx on public.email_campaign_recipient_steps(workspace_id,provider_thread_id) where provider_thread_id is not null;
create index email_campaign_signal_events_message_idx on public.email_campaign_signal_events(workspace_id,email_message_id) where email_message_id is not null;
create index email_campaign_recipients_engagement_idx on public.email_campaign_recipients(workspace_id,campaign_id,engagement_status);

alter table public.email_campaign_steps enable row level security;
alter table public.email_campaign_recipient_steps enable row level security;
alter table public.email_campaign_signal_events enable row level security;
create policy campaign_step_read on public.email_campaign_steps for select to authenticated using(workspace_id=public.current_workspace_id());
create policy campaign_recipient_step_read on public.email_campaign_recipient_steps for select to authenticated using(workspace_id=public.current_workspace_id());
create policy campaign_signal_read on public.email_campaign_signal_events for select to authenticated using(workspace_id=public.current_workspace_id());
revoke all on public.email_campaign_steps,public.email_campaign_recipient_steps,public.email_campaign_signal_events from public,anon,authenticated;
grant select(id,workspace_id,campaign_id,step_order,step_type,delay_minutes,subject_template,body_text_template,enabled,created_at,updated_at) on public.email_campaign_steps to authenticated;
grant select(id,workspace_id,campaign_id,recipient_id,campaign_step_id,step_order,status,eligible_at,sender_email_account_id,sent_at,safe_error_code,created_at,updated_at) on public.email_campaign_recipient_steps to authenticated;
grant select(id,workspace_id,campaign_id,recipient_id,email_message_id,signal_type,created_at) on public.email_campaign_signal_events to authenticated;
grant select,insert,update,delete on public.email_campaign_steps,public.email_campaign_recipient_steps,public.email_campaign_signal_events to service_role;
grant select(sequence_enabled) on public.email_campaigns to authenticated;
grant select(engagement_status,replied_at,reply_email_message_id,hard_bounced_at,bounce_diagnostic,last_engagement_at,last_sent_step_order,stopped_reason) on public.email_campaign_recipients to authenticated;

create function public.reorder_email_campaign_steps(p_workspace_id uuid,p_campaign_id uuid,p_ordered_step_ids uuid[])
returns boolean language plpgsql security definer set search_path='' as $$
declare v_count integer;v_initial uuid;
begin
  if p_workspace_id is null or p_campaign_id is null or p_ordered_step_ids is null or cardinality(p_ordered_step_ids) not between 1 and 6 then return false;end if;
  perform 1 from public.email_campaigns c where c.id=p_campaign_id and c.workspace_id=p_workspace_id and c.status='DRAFT' and c.sequence_enabled for update;
  if not found then return false;end if;
  select count(*),min(id::text) filter(where step_type='INITIAL' and step_order=0)::uuid into v_count,v_initial from public.email_campaign_steps where workspace_id=p_workspace_id and campaign_id=p_campaign_id;
  perform 1 from public.email_campaign_steps where workspace_id=p_workspace_id and campaign_id=p_campaign_id for update;
  if v_count<>cardinality(p_ordered_step_ids) or v_initial is null or p_ordered_step_ids[1]<>v_initial or cardinality(p_ordered_step_ids)<>cardinality(array(select distinct x from unnest(p_ordered_step_ids) x)) or exists(select 1 from unnest(p_ordered_step_ids) x where not exists(select 1 from public.email_campaign_steps s where s.id=x and s.workspace_id=p_workspace_id and s.campaign_id=p_campaign_id)) then return false;end if;
  perform set_config('hirex.sequence_reorder','on',true);
  set constraints all deferred;
  update public.email_campaign_steps s set step_order=o.ordinality-1,step_type=case when o.ordinality=1 then 'INITIAL' else 'FOLLOW_UP' end,delay_minutes=case when o.ordinality=1 then 0 else greatest(s.delay_minutes,1) end from unnest(p_ordered_step_ids) with ordinality o(id,ordinality) where s.id=o.id and s.workspace_id=p_workspace_id and s.campaign_id=p_campaign_id;
  set constraints all immediate;
  perform set_config('hirex.sequence_reorder','off',true);
  return true;
exception when others then perform set_config('hirex.sequence_reorder','off',true);raise;
end $$;
revoke all on function public.reorder_email_campaign_steps(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.reorder_email_campaign_steps(uuid,uuid,uuid[]) to service_role;

create function public.initialize_email_campaign_sequence(p_workspace_id uuid,p_campaign_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  perform 1 from public.email_campaigns c where c.id=p_campaign_id and c.workspace_id=p_workspace_id and c.sequence_enabled and c.status='RUNNING' for update;
  if not found then return 0; end if;
  if not exists(select 1 from public.email_campaign_steps s where s.workspace_id=p_workspace_id and s.campaign_id=p_campaign_id and s.step_order=0 and s.step_type='INITIAL' and s.enabled) then return 0; end if;
  insert into public.email_campaign_recipient_steps(workspace_id,campaign_id,recipient_id,campaign_step_id,step_order,status,eligible_at,idempotency_key)
  select r.workspace_id,r.campaign_id,r.id,s.id,0,case when x.id is null then 'PENDING' else 'SUPPRESSED' end,clock_timestamp(),r.idempotency_key
  from public.email_campaign_recipients r join public.email_campaign_steps s on s.workspace_id=r.workspace_id and s.campaign_id=r.campaign_id and s.step_order=0 and s.enabled
  left join public.email_suppressions x on x.workspace_id=r.workspace_id and x.normalized_email=r.normalized_email
  where r.workspace_id=p_workspace_id and r.campaign_id=p_campaign_id and r.status='PENDING' on conflict(recipient_id,campaign_step_id) do nothing;
  get diagnostics v_count=row_count;
  update public.email_campaign_recipients r set status='SUPPRESSED',engagement_status='COMPLETED',stopped_reason='SUPPRESSED',last_engagement_at=clock_timestamp()
  where r.workspace_id=p_workspace_id and r.campaign_id=p_campaign_id and r.engagement_status='ACTIVE' and exists(select 1 from public.email_suppressions x where x.workspace_id=r.workspace_id and x.normalized_email=r.normalized_email);
  if v_count>0 then insert into public.email_campaign_events(workspace_id,campaign_id,event_type,metadata) values(p_workspace_id,p_campaign_id,'SEQUENCE_INITIALIZED',jsonb_build_object('deliveries',v_count)); end if;
  return v_count;
end $$;

create function public.apply_email_campaign_signal(p_workspace_id uuid,p_recipient_id uuid,p_signal_type text,p_source_key text,p_email_message_id uuid default null,p_diagnostic text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_recipient public.email_campaign_recipients%rowtype; v_status text; v_step_status text; v_event text;
begin
  if p_signal_type not in ('REPLY','HARD_BOUNCE','UNSUBSCRIBE') or p_source_key is null or btrim(p_source_key)='' then return false; end if;
  select * into v_recipient from public.email_campaign_recipients r where r.id=p_recipient_id and r.workspace_id=p_workspace_id for update;
  if not found then return false; end if;
  if v_recipient.engagement_status<>'ACTIVE' then return false;end if;
  insert into public.email_campaign_signal_events(workspace_id,campaign_id,recipient_id,email_message_id,signal_type,source_key)
  values(p_workspace_id,v_recipient.campaign_id,p_recipient_id,p_email_message_id,p_signal_type,p_source_key) on conflict(workspace_id,signal_type,source_key) do nothing;
  if not found then return false; end if;
  v_status:=case p_signal_type when 'REPLY' then 'REPLIED' when 'HARD_BOUNCE' then 'HARD_BOUNCED' else 'UNSUBSCRIBED' end;
  v_step_status:=case p_signal_type when 'REPLY' then 'SKIPPED_REPLY' when 'HARD_BOUNCE' then 'SKIPPED_BOUNCE' else 'SKIPPED_UNSUBSCRIBED' end;
  v_event:=case p_signal_type when 'REPLY' then 'RECIPIENT_REPLIED' when 'HARD_BOUNCE' then 'RECIPIENT_HARD_BOUNCED' else 'RECIPIENT_UNSUBSCRIBED' end;
  update public.email_campaign_recipients set engagement_status=v_status,last_engagement_at=clock_timestamp(),stopped_reason=p_signal_type,
    replied_at=case when p_signal_type='REPLY' then clock_timestamp() else replied_at end,reply_email_message_id=case when p_signal_type='REPLY' then p_email_message_id else reply_email_message_id end,
    hard_bounced_at=case when p_signal_type='HARD_BOUNCE' then clock_timestamp() else hard_bounced_at end,bounce_diagnostic=case when p_signal_type='HARD_BOUNCE' then left(p_diagnostic,300) else bounce_diagnostic end
  where id=p_recipient_id and workspace_id=p_workspace_id and engagement_status='ACTIVE';
  update public.email_campaign_recipient_steps set status=v_step_status,safe_error_code=p_signal_type where recipient_id=p_recipient_id and workspace_id=p_workspace_id and status='PENDING';
  if p_signal_type in ('HARD_BOUNCE','UNSUBSCRIBE') then
    insert into public.email_suppressions(workspace_id,normalized_email,reason,source) values(p_workspace_id,v_recipient.normalized_email,case when p_signal_type='UNSUBSCRIBE' then 'UNSUBSCRIBED' else 'HARD_BOUNCE' end,'CAMPAIGN_SIGNAL')
    on conflict(workspace_id,normalized_email) do update set reason=case when public.email_suppressions.reason='HARD_BOUNCE' then 'HARD_BOUNCE' else excluded.reason end,source=excluded.source;
  end if;
  insert into public.email_campaign_events(workspace_id,campaign_id,recipient_id,event_type) values(p_workspace_id,v_recipient.campaign_id,p_recipient_id,v_event);
  update public.email_campaigns c set status='COMPLETED',completed_at=clock_timestamp() where c.id=v_recipient.campaign_id and c.workspace_id=p_workspace_id and c.status='RUNNING' and c.sequence_enabled
    and not exists(select 1 from public.email_campaign_recipients r where r.campaign_id=c.id and r.workspace_id=c.workspace_id and r.engagement_status='ACTIVE')
    and not exists(select 1 from public.email_campaign_recipient_steps d where d.campaign_id=c.id and d.workspace_id=c.workspace_id and d.status in ('PENDING','SENDING'));
  if found then insert into public.email_campaign_events(workspace_id,campaign_id,event_type) values(p_workspace_id,v_recipient.campaign_id,'CAMPAIGN_COMPLETED');end if;
  return true;
end $$;

revoke all on function public.require_draft_campaign_step() from public,anon,authenticated;
revoke all on function public.guard_sequence_email_send_request() from public,anon,authenticated;
revoke all on function public.initialize_email_campaign_sequence(uuid,uuid) from public,anon,authenticated;
revoke all on function public.apply_email_campaign_signal(uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.initialize_email_campaign_sequence(uuid,uuid) to service_role;
grant execute on function public.apply_email_campaign_signal(uuid,uuid,text,text,uuid,text) to service_role;

create function public.claim_email_campaign_sequence_steps(p_workspace_id uuid,p_campaign_id uuid,p_claim_token uuid,p_limit integer)
returns table(delivery_id uuid,recipient_id uuid,step_order integer,email text,display_name text,company text,recipient_position text,personalization_json jsonb,
 sender_email_account_id uuid,idempotency_key uuid,subject_template text,body_text_template text,previous_provider_thread_id text,previous_rfc_message_id text)
language plpgsql security definer set search_path='' as $$
declare v_delivery public.email_campaign_recipient_steps%rowtype; v_sender public.email_campaign_senders%rowtype; v_recipient public.email_campaign_recipients%rowtype; v_step public.email_campaign_steps%rowtype; v_count integer:=0; v_reclaim boolean; v_day timestamptz:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';v_minute timestamptz:=date_trunc('minute',clock_timestamp());
begin
  if p_workspace_id is null or p_campaign_id is null or p_claim_token is null or p_limit not between 1 and 25 then return; end if;
  perform 1 from public.email_campaigns c where c.id=p_campaign_id and c.workspace_id=p_workspace_id and c.status='RUNNING' and c.sequence_enabled for update;
  if not found then return; end if;
  insert into public.email_sender_limits(workspace_id,email_account_id) select p_workspace_id,s.email_account_id from public.email_campaign_senders s where s.workspace_id=p_workspace_id and s.campaign_id=p_campaign_id on conflict(workspace_id,email_account_id) do nothing;
  for v_delivery in select d.* from public.email_campaign_recipient_steps d join public.email_campaign_recipients r on r.id=d.recipient_id and r.workspace_id=d.workspace_id
    where d.workspace_id=p_workspace_id and d.campaign_id=p_campaign_id and r.engagement_status='ACTIVE'
      and ((d.status='PENDING' and d.eligible_at<=clock_timestamp()) or (d.status='SENDING' and d.send_request_id is null and d.claimed_at<clock_timestamp()-interval '15 minutes'))
    order by (d.status='PENDING') desc,d.eligible_at,d.id for update of d,r skip locked limit p_limit
  loop
    exit when v_count>=p_limit; v_reclaim:=v_delivery.status='SENDING';
    if exists(select 1 from public.email_suppressions x join public.email_campaign_recipients r on r.id=v_delivery.recipient_id and r.workspace_id=v_delivery.workspace_id where x.workspace_id=r.workspace_id and x.normalized_email=r.normalized_email) then
      update public.email_campaign_recipient_steps set status='SUPPRESSED',claim_token=null,claimed_at=null,safe_error_code='SUPPRESSED' where id=v_delivery.id; continue;
    end if;
    if v_reclaim then select s.* into v_sender from public.email_campaign_senders s join public.email_accounts a on a.id=s.email_account_id and a.workspace_id=s.workspace_id where s.workspace_id=p_workspace_id and s.campaign_id=p_campaign_id and s.email_account_id=v_delivery.sender_email_account_id and s.enabled and a.status='CONNECTED' and a.provider='GMAIL' and a.scopes @> array['https://www.googleapis.com/auth/gmail.send']::text[] for update of s;
    else select s.* into v_sender from public.email_campaign_senders s join public.email_accounts a on a.id=s.email_account_id and a.workspace_id=s.workspace_id join public.email_sender_limits l on l.workspace_id=s.workspace_id and l.email_account_id=s.email_account_id
      where s.workspace_id=p_workspace_id and s.campaign_id=p_campaign_id and s.enabled and a.status='CONNECTED' and a.provider='GMAIL' and a.scopes @> array['https://www.googleapis.com/auth/gmail.send']::text[]
      and coalesce((select u.sent_count from public.email_campaign_sender_usage u where u.campaign_sender_id=s.id and u.bucket_kind='UTC_DAY' and u.bucket_start=v_day),0)<s.daily_cap
      and coalesce((select u.sent_count from public.email_campaign_sender_usage u where u.campaign_sender_id=s.id and u.bucket_kind='UTC_MINUTE' and u.bucket_start=v_minute),0)<s.per_minute_cap
      and coalesce((select u.reserved_count from public.email_sender_usage u where u.workspace_id=p_workspace_id and u.email_account_id=s.email_account_id and u.bucket_kind='UTC_DAY' and u.bucket_start=v_day),0)<l.daily_cap
      and coalesce((select u.reserved_count from public.email_sender_usage u where u.workspace_id=p_workspace_id and u.email_account_id=s.email_account_id and u.bucket_kind='UTC_MINUTE' and u.bucket_start=v_minute),0)<l.per_minute_cap
      order by coalesce((select sum(u.sent_count) from public.email_campaign_sender_usage u where u.campaign_sender_id=s.id),0),s.priority,s.id for update of s,l skip locked limit 1;end if;
    if not found then exit; end if;
    if not v_reclaim then
      insert into public.email_campaign_sender_usage(workspace_id,campaign_sender_id,bucket_kind,bucket_start,sent_count) values(p_workspace_id,v_sender.id,'UTC_DAY',v_day,1),(p_workspace_id,v_sender.id,'UTC_MINUTE',v_minute,1) on conflict(campaign_sender_id,bucket_kind,bucket_start) do update set sent_count=public.email_campaign_sender_usage.sent_count+1;
      insert into public.email_sender_usage(workspace_id,email_account_id,bucket_kind,bucket_start,reserved_count) values
       (p_workspace_id,v_sender.email_account_id,'UTC_DAY',v_day,1),(p_workspace_id,v_sender.email_account_id,'UTC_MINUTE',v_minute,1)
       on conflict(workspace_id,email_account_id,bucket_kind,bucket_start) do update set reserved_count=public.email_sender_usage.reserved_count+1;
    end if;
    update public.email_campaign_recipient_steps set status='SENDING',sender_email_account_id=v_sender.email_account_id,claim_token=p_claim_token,claimed_at=clock_timestamp() where id=v_delivery.id;
    select * into v_recipient from public.email_campaign_recipients where id=v_delivery.recipient_id and workspace_id=p_workspace_id;
    select * into v_step from public.email_campaign_steps where id=v_delivery.campaign_step_id and workspace_id=p_workspace_id;
    delivery_id:=v_delivery.id; recipient_id:=v_recipient.id; step_order:=v_delivery.step_order; email:=v_recipient.email;display_name:=v_recipient.display_name;company:=v_recipient.company;recipient_position:=v_recipient.position;personalization_json:=v_recipient.personalization_json;
    sender_email_account_id:=v_sender.email_account_id;idempotency_key:=v_delivery.idempotency_key;subject_template:=v_step.subject_template;body_text_template:=v_step.body_text_template;
    select d.provider_thread_id,d.rfc_message_id into previous_provider_thread_id,previous_rfc_message_id from public.email_campaign_recipient_steps d where d.recipient_id=v_recipient.id and d.workspace_id=p_workspace_id and d.status='SENT' and d.step_order<v_delivery.step_order order by d.step_order desc limit 1;
    return next;v_count:=v_count+1;
  end loop;
end $$;

create function public.finalize_email_campaign_sequence_step(p_workspace_id uuid,p_delivery_id uuid,p_claim_token uuid,p_status text,p_send_request_id uuid,p_safe_error_code text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_delivery public.email_campaign_recipient_steps%rowtype;v_request public.email_send_requests%rowtype;v_recipient public.email_campaign_recipients%rowtype;v_sent_at timestamptz:=clock_timestamp();v_next public.email_campaign_steps%rowtype;
begin
  if p_status not in ('SENT','FAILED','DELIVERY_UNKNOWN') or (p_status in ('SENT','DELIVERY_UNKNOWN') and p_send_request_id is null) then return false;end if;
  select * into v_delivery from public.email_campaign_recipient_steps where id=p_delivery_id and workspace_id=p_workspace_id and status='SENDING' and claim_token=p_claim_token for update;
  if not found then return false;end if;
  select * into v_recipient from public.email_campaign_recipients where id=v_delivery.recipient_id and workspace_id=p_workspace_id for update;if not found then return false;end if;
  if p_send_request_id is not null then select * into v_request from public.email_send_requests where id=p_send_request_id and workspace_id=p_workspace_id and email_account_id=v_delivery.sender_email_account_id and idempotency_key=v_delivery.idempotency_key and send_type='NEW' and cardinality(to_addresses)=1 and lower(btrim(to_addresses[1]))=v_recipient.normalized_email for update;if not found or (p_status='SENT' and v_request.status<>'SENT') or (p_status='DELIVERY_UNKNOWN' and v_request.status<>'SENDING') or (p_status='FAILED' and v_request.status<>'FAILED') then return false;end if;end if;
  update public.email_campaign_recipient_steps set status=p_status,send_request_id=p_send_request_id,sent_at=case when p_status='SENT' then v_sent_at else null end,
    safe_error_code=case when p_status='SENT' then null else p_safe_error_code end,provider_message_id=v_request.provider_message_id,provider_thread_id=v_request.provider_thread_id,rfc_message_id=v_request.rfc_message_id,claim_token=null,claimed_at=null where id=p_delivery_id;
  if p_status='SENT' then
    update public.email_campaign_recipients set last_sent_step_order=v_delivery.step_order,last_engagement_at=v_sent_at where id=v_delivery.recipient_id and workspace_id=p_workspace_id and engagement_status='ACTIVE';
    insert into public.email_campaign_events(workspace_id,campaign_id,recipient_id,event_type,metadata) values(p_workspace_id,v_delivery.campaign_id,v_delivery.recipient_id,'STEP_SENT',jsonb_build_object('stepOrder',v_delivery.step_order));
    select * into v_next from public.email_campaign_steps where campaign_id=v_delivery.campaign_id and workspace_id=p_workspace_id and enabled and step_order=v_delivery.step_order+1;
    if found and exists(select 1 from public.email_campaign_recipients where id=v_delivery.recipient_id and workspace_id=p_workspace_id and engagement_status='ACTIVE') then
      insert into public.email_campaign_recipient_steps(workspace_id,campaign_id,recipient_id,campaign_step_id,step_order,eligible_at) values(p_workspace_id,v_delivery.campaign_id,v_delivery.recipient_id,v_next.id,v_next.step_order,v_sent_at+make_interval(mins=>v_next.delay_minutes)) on conflict(recipient_id,campaign_step_id) do nothing;
    elsif not found then update public.email_campaign_recipients set engagement_status='COMPLETED',stopped_reason='SEQUENCE_COMPLETED',last_engagement_at=v_sent_at where id=v_delivery.recipient_id and workspace_id=p_workspace_id and engagement_status='ACTIVE'; end if;
  else update public.email_campaign_recipients set engagement_status='COMPLETED',stopped_reason=case when p_status='DELIVERY_UNKNOWN' then 'DELIVERY_UNKNOWN' else 'STEP_FAILED' end,last_engagement_at=v_sent_at where id=v_delivery.recipient_id and workspace_id=p_workspace_id and engagement_status='ACTIVE';insert into public.email_campaign_events(workspace_id,campaign_id,recipient_id,event_type,metadata) values(p_workspace_id,v_delivery.campaign_id,v_delivery.recipient_id,'STEP_FAILED',jsonb_build_object('stepOrder',v_delivery.step_order,'status',p_status)); end if;
  update public.email_campaigns c set status='COMPLETED',completed_at=v_sent_at where c.id=v_delivery.campaign_id and c.workspace_id=p_workspace_id and c.status='RUNNING' and c.sequence_enabled
    and not exists(select 1 from public.email_campaign_recipients r where r.campaign_id=c.id and r.workspace_id=c.workspace_id and r.engagement_status='ACTIVE')
    and not exists(select 1 from public.email_campaign_recipient_steps d where d.campaign_id=c.id and d.workspace_id=c.workspace_id and d.status in ('PENDING','SENDING'));
  if found then insert into public.email_campaign_events(workspace_id,campaign_id,event_type) values(p_workspace_id,v_delivery.campaign_id,'CAMPAIGN_COMPLETED');end if;
  return true;
end $$;
revoke all on function public.claim_email_campaign_sequence_steps(uuid,uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.finalize_email_campaign_sequence_step(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_email_campaign_sequence_steps(uuid,uuid,uuid,integer) to service_role;
grant execute on function public.finalize_email_campaign_sequence_step(uuid,uuid,uuid,text,uuid,text) to service_role;

commit;
