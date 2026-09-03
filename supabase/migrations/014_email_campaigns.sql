begin;

create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(name) <= 200), status text not null default 'DRAFT'
    check (status in ('DRAFT','SCHEDULED','RUNNING','PAUSED','COMPLETED','CANCELLED')),
  subject_template text not null check (length(subject_template) <= 998),
  body_text_template text not null check (length(body_text_template) <= 100000), body_html_template text,
  scheduled_at timestamptz, started_at timestamptz, paused_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
  tracking_enabled boolean not null default false, created_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (created_by, workspace_id) references public.profiles(id, workspace_id) on delete restrict,
  check (body_html_template is null),
  check ((status='DRAFT' and scheduled_at is null and started_at is null and paused_at is null and completed_at is null and cancelled_at is null)
    or (status='SCHEDULED' and scheduled_at is not null and started_at is null and completed_at is null and cancelled_at is null)
    or (status='RUNNING' and started_at is not null and completed_at is null and cancelled_at is null)
    or (status='PAUSED' and started_at is not null and paused_at is not null and completed_at is null and cancelled_at is null)
    or (status='COMPLETED' and started_at is not null and completed_at is not null and cancelled_at is null)
    or (status='CANCELLED' and cancelled_at is not null and completed_at is null))
);
create table public.email_campaign_senders (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null, email_account_id uuid not null, enabled boolean not null default true,
  daily_cap integer not null default 100 check (daily_cap between 1 and 2000),
  per_minute_cap integer not null default 10 check (per_minute_cap between 1 and 100), priority integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique(campaign_id,email_account_id), foreign key(campaign_id,workspace_id) references public.email_campaigns(id,workspace_id) on delete cascade,
  foreign key(email_account_id,workspace_id) references public.email_accounts(id,workspace_id) on delete restrict
);

alter table public.email_send_requests
  add constraint email_send_requests_id_workspace_key
  unique (id, workspace_id);

create table public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null, contact_id uuid, email text not null, normalized_email text not null,
  display_name text, company text, position text, personalization_json jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check(status in ('PENDING','SENDING','SENT','FAILED','SUPPRESSED','CANCELLED','DELIVERY_UNKNOWN')),
  sender_email_account_id uuid, send_request_id uuid, idempotency_key uuid not null default gen_random_uuid(),
  claimed_at timestamptz, claim_token uuid, sent_at timestamptz, failed_at timestamptz, safe_error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, workspace_id), unique(campaign_id,normalized_email), unique(idempotency_key),
  foreign key(campaign_id,workspace_id) references public.email_campaigns(id,workspace_id) on delete cascade,
  foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id) on delete restrict,
  foreign key(sender_email_account_id,workspace_id) references public.email_accounts(id,workspace_id) on delete restrict,
  foreign key(send_request_id,workspace_id) references public.email_send_requests(id,workspace_id) on delete restrict,
  check(normalized_email=lower(btrim(email))), check(jsonb_typeof(personalization_json)='object'),
  check (
    (status='PENDING' and sender_email_account_id is null and send_request_id is null and claim_token is null and claimed_at is null and sent_at is null and failed_at is null)
    or (status='SENDING' and sender_email_account_id is not null and claim_token is not null and claimed_at is not null and sent_at is null and failed_at is null)
    or (status='SENT' and sender_email_account_id is not null and send_request_id is not null and claim_token is null and claimed_at is null and sent_at is not null and failed_at is null)
    or (status='DELIVERY_UNKNOWN' and sender_email_account_id is not null and send_request_id is not null and claim_token is null and claimed_at is null and sent_at is null and failed_at is null)
    or (status='FAILED' and claim_token is null and claimed_at is null and sent_at is null and failed_at is not null)
    or (status in ('SUPPRESSED','CANCELLED') and claim_token is null and claimed_at is null and sent_at is null and failed_at is null)
  ),
  check (email = btrim(email) and normalized_email <> '' and length(normalized_email) <= 320),
  check (send_request_id is null or sender_email_account_id is not null)
);
create table public.email_suppressions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  normalized_email text not null, reason text not null check(reason in ('MANUAL','UNSUBSCRIBED','HARD_BOUNCE')),
  source text not null check(length(source) between 1 and 100), created_at timestamptz not null default now(),
  unique(workspace_id,normalized_email), check(normalized_email=lower(btrim(normalized_email)))
);
create table public.email_campaign_sender_usage (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_sender_id uuid not null, bucket_kind text not null check (bucket_kind in ('UTC_DAY','UTC_MINUTE')),
  bucket_start timestamptz not null, sent_count integer not null default 0 check (sent_count >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (campaign_sender_id,bucket_kind,bucket_start),
  foreign key(campaign_sender_id,workspace_id) references public.email_campaign_senders(id,workspace_id) on delete cascade
);
create table public.email_sender_limits (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email_account_id uuid not null, daily_cap integer not null default 500 check(daily_cap between 1 and 5000),
  per_minute_cap integer not null default 20 check(per_minute_cap between 1 and 200),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id,email_account_id), unique(id,workspace_id),
  foreign key(email_account_id,workspace_id) references public.email_accounts(id,workspace_id) on delete cascade
);
create table public.email_sender_usage (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email_account_id uuid not null, bucket_kind text not null check(bucket_kind in ('UTC_DAY','UTC_MINUTE')),
  bucket_start timestamptz not null, reserved_count integer not null default 0 check(reserved_count>=0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id,email_account_id,bucket_kind,bucket_start),
  foreign key(email_account_id,workspace_id) references public.email_accounts(id,workspace_id) on delete cascade
);
create table public.email_campaign_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null, recipient_id uuid, event_type text not null check (event_type in ('CAMPAIGN_CREATED','AUDIENCE_IMPORTED','CAMPAIGN_SCHEDULED','CAMPAIGN_STARTED','CAMPAIGN_PAUSED','CAMPAIGN_RESUMED','CAMPAIGN_CANCELLED','CAMPAIGN_COMPLETED','RECIPIENT_CLAIMED','RECIPIENT_SENT','RECIPIENT_FAILED','RECIPIENT_SUPPRESSED','RECIPIENT_DELIVERY_UNKNOWN')),
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  foreign key(campaign_id,workspace_id) references public.email_campaigns(id,workspace_id) on delete cascade,
  foreign key(recipient_id,workspace_id) references public.email_campaign_recipients(id,workspace_id) on delete cascade,
  check(jsonb_typeof(metadata)='object')
);
create index email_campaigns_workspace_status_idx on public.email_campaigns(workspace_id,status,scheduled_at);
create index email_campaign_recipients_queue_idx on public.email_campaign_recipients(workspace_id,campaign_id,status,created_at);
create index email_campaign_senders_campaign_idx on public.email_campaign_senders(workspace_id,campaign_id,enabled);
create index email_campaign_events_campaign_idx on public.email_campaign_events(workspace_id,campaign_id,created_at desc);
create function public.require_draft_campaign_configuration() returns trigger language plpgsql set search_path='' as $$
declare v_campaign_id uuid;v_workspace_id uuid;
begin
  if tg_op='DELETE' then v_campaign_id:=old.campaign_id;v_workspace_id:=old.workspace_id;else v_campaign_id:=new.campaign_id;v_workspace_id:=new.workspace_id;end if;
  if not exists(select 1 from public.email_campaigns c where c.id=v_campaign_id and c.workspace_id=v_workspace_id and c.status='DRAFT' for update) then raise exception 'Campaign configuration is immutable outside DRAFT';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create function public.protect_campaign_recipient_snapshot() returns trigger language plpgsql set search_path='' as $$
declare v_campaign_id uuid;v_workspace_id uuid;
begin
  if tg_op='DELETE' then v_campaign_id:=old.campaign_id;v_workspace_id:=old.workspace_id;else v_campaign_id:=new.campaign_id;v_workspace_id:=new.workspace_id;end if;
  if tg_op in ('INSERT','DELETE') or (tg_op='UPDATE' and (new.campaign_id is distinct from old.campaign_id or new.workspace_id is distinct from old.workspace_id
    or new.contact_id is distinct from old.contact_id or new.email is distinct from old.email or new.normalized_email is distinct from old.normalized_email
    or new.display_name is distinct from old.display_name or new.company is distinct from old.company or new.position is distinct from old.position
    or new.personalization_json is distinct from old.personalization_json or new.idempotency_key is distinct from old.idempotency_key)) then
    if not exists(select 1 from public.email_campaigns c where c.id=v_campaign_id and c.workspace_id=v_workspace_id and c.status='DRAFT' for update) then raise exception 'Campaign audience is immutable outside DRAFT';end if;
  end if;if tg_op='DELETE' then return old;end if;return new;
end $$;
create function public.preserve_email_suppression_precedence() returns trigger language plpgsql set search_path='' as $$
begin
  if old.reason='HARD_BOUNCE' and new.reason<>'HARD_BOUNCE' then new.reason:=old.reason;new.source:=old.source;
  elsif old.reason='UNSUBSCRIBED' and new.reason='MANUAL' then new.reason:=old.reason;new.source:=old.source;end if;
  return new;
end $$;
create trigger email_campaign_senders_draft_guard before insert or update or delete on public.email_campaign_senders for each row execute function public.require_draft_campaign_configuration();
create trigger email_campaign_recipients_snapshot_guard before insert or update or delete on public.email_campaign_recipients for each row execute function public.protect_campaign_recipient_snapshot();
create trigger email_suppressions_precedence_guard before update on public.email_suppressions for each row execute function public.preserve_email_suppression_precedence();
revoke all on function public.require_draft_campaign_configuration() from public,anon,authenticated;
revoke all on function public.protect_campaign_recipient_snapshot() from public,anon,authenticated;
revoke all on function public.preserve_email_suppression_precedence() from public,anon,authenticated;
create trigger email_campaigns_updated_at before update on public.email_campaigns for each row execute function public.set_updated_at();
create trigger email_campaign_senders_updated_at before update on public.email_campaign_senders for each row execute function public.set_updated_at();
create trigger email_campaign_recipients_updated_at before update on public.email_campaign_recipients for each row execute function public.set_updated_at();
create trigger email_campaign_sender_usage_updated_at before update on public.email_campaign_sender_usage for each row execute function public.set_updated_at();
create trigger email_sender_limits_updated_at before update on public.email_sender_limits for each row execute function public.set_updated_at();
create trigger email_sender_usage_updated_at before update on public.email_sender_usage for each row execute function public.set_updated_at();
alter table public.email_campaigns enable row level security;
alter table public.email_campaign_senders enable row level security;
alter table public.email_campaign_recipients enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_campaign_events enable row level security;
alter table public.email_campaign_sender_usage enable row level security;
alter table public.email_sender_limits enable row level security;
alter table public.email_sender_usage enable row level security;
create policy campaign_read on public.email_campaigns for select to authenticated using(workspace_id=public.current_workspace_id());
create policy campaign_sender_read on public.email_campaign_senders for select to authenticated using(workspace_id=public.current_workspace_id());
create policy campaign_recipient_read on public.email_campaign_recipients for select to authenticated using(workspace_id=public.current_workspace_id());
create policy suppression_read on public.email_suppressions for select to authenticated using(workspace_id=public.current_workspace_id());
create policy campaign_event_read on public.email_campaign_events for select to authenticated using(workspace_id=public.current_workspace_id());
create policy campaign_sender_usage_read on public.email_campaign_sender_usage for select to authenticated using(workspace_id=public.current_workspace_id());
create policy email_sender_limits_read on public.email_sender_limits for select to authenticated using(workspace_id=public.current_workspace_id());
create policy email_sender_usage_read on public.email_sender_usage for select to authenticated using(workspace_id=public.current_workspace_id());
revoke all on public.email_campaigns,public.email_campaign_senders,public.email_campaign_recipients,public.email_suppressions,public.email_campaign_events,public.email_campaign_sender_usage,public.email_sender_limits,public.email_sender_usage from anon,authenticated;
grant select(id,workspace_id,name,status,subject_template,body_text_template,scheduled_at,started_at,paused_at,completed_at,cancelled_at,tracking_enabled,created_at,updated_at) on public.email_campaigns to authenticated;
grant select(id,workspace_id,campaign_id,email_account_id,enabled,daily_cap,per_minute_cap,priority,created_at,updated_at) on public.email_campaign_senders to authenticated;
grant select(id,workspace_id,campaign_id,contact_id,email,normalized_email,display_name,company,position,personalization_json,status,sender_email_account_id,sent_at,failed_at,safe_error_code,created_at,updated_at) on public.email_campaign_recipients to authenticated;
grant select(id,workspace_id,normalized_email,reason,source,created_at) on public.email_suppressions to authenticated;
grant select(id,workspace_id,campaign_id,recipient_id,event_type,metadata,created_at) on public.email_campaign_events to authenticated;
grant select(id,workspace_id,campaign_sender_id,bucket_kind,bucket_start,sent_count,created_at,updated_at) on public.email_campaign_sender_usage to authenticated;
grant select(id,workspace_id,email_account_id,daily_cap,per_minute_cap,created_at,updated_at) on public.email_sender_limits to authenticated;
grant select(id,workspace_id,email_account_id,bucket_kind,bucket_start,reserved_count,created_at,updated_at) on public.email_sender_usage to authenticated;
grant select,insert,update,delete on public.email_campaigns,public.email_campaign_senders,public.email_campaign_recipients,public.email_suppressions,public.email_campaign_events,public.email_campaign_sender_usage,public.email_sender_limits,public.email_sender_usage to service_role;

create function public.claim_email_campaign_recipients(p_workspace_id uuid,p_campaign_id uuid,p_claim_token uuid,p_limit integer)
returns table(recipient_id uuid,workspace_id uuid,campaign_id uuid,email text,display_name text,company text,recipient_position text,personalization_json jsonb,
  sender_email_account_id uuid,idempotency_key uuid,claim_token uuid,subject_template text,body_text_template text)
language plpgsql security definer set search_path='' as $$
declare
  v_recipient public.email_campaign_recipients%rowtype;
  v_sender public.email_campaign_senders%rowtype;
  v_campaign public.email_campaigns%rowtype;
  v_day timestamptz := date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  v_minute timestamptz := date_trunc('minute',clock_timestamp());
  v_count integer := 0;
  v_reclaim boolean;
begin
  if p_workspace_id is null or p_campaign_id is null or p_claim_token is null or p_limit not between 1 and 25 then return; end if;
  select * into v_campaign from public.email_campaigns c where c.id=p_campaign_id and c.workspace_id=p_workspace_id and c.status='RUNNING' for update;
  if not found then return; end if;
  insert into public.email_sender_limits(workspace_id,email_account_id)
    select p_workspace_id,s.email_account_id from public.email_campaign_senders s where s.workspace_id=p_workspace_id and s.campaign_id=p_campaign_id
    on conflict(workspace_id,email_account_id) do nothing;
  with suppressed_candidates as (
    select r.id from public.email_campaign_recipients r where r.workspace_id=p_workspace_id and r.campaign_id=p_campaign_id and r.status='PENDING'
      and exists(select 1 from public.email_suppressions s where s.workspace_id=r.workspace_id and s.normalized_email=r.normalized_email)
    order by r.created_at,r.id for update skip locked limit p_limit
  ), marked as (
    update public.email_campaign_recipients r set status='SUPPRESSED',claim_token=null,claimed_at=null,safe_error_code='SUPPRESSED'
    from suppressed_candidates s where r.id=s.id returning r.id,r.campaign_id
  ) insert into public.email_campaign_events(workspace_id,campaign_id,recipient_id,event_type)
    select p_workspace_id,m.campaign_id,m.id,'RECIPIENT_SUPPRESSED' from marked m;
  while v_count < p_limit loop
    select r.* into v_recipient from public.email_campaign_recipients r
    where r.workspace_id=p_workspace_id and r.campaign_id=p_campaign_id
      and (r.status='PENDING' or (r.status='SENDING' and r.send_request_id is null and r.claimed_at < clock_timestamp()-interval '15 minutes'))
      and not exists(select 1 from public.email_suppressions s where s.workspace_id=r.workspace_id and s.normalized_email=r.normalized_email)
    order by (r.status='PENDING') desc,r.created_at,r.id for update skip locked limit 1;
    if not found then exit; end if;
    v_reclaim := v_recipient.status='SENDING';

    if v_reclaim then
      select s.* into v_sender from public.email_campaign_senders s join public.email_accounts a on a.id=s.email_account_id and a.workspace_id=s.workspace_id
      where s.workspace_id=p_workspace_id and s.campaign_id=p_campaign_id and s.email_account_id=v_recipient.sender_email_account_id
        and s.enabled and a.provider='GMAIL' and a.status='CONNECTED' and a.scopes @> array['https://www.googleapis.com/auth/gmail.send']::text[] for update of s;
    else
      select s.* into v_sender from public.email_campaign_senders s join public.email_accounts a on a.id=s.email_account_id and a.workspace_id=s.workspace_id
      join public.email_sender_limits l on l.workspace_id=s.workspace_id and l.email_account_id=s.email_account_id
      where s.workspace_id=p_workspace_id and s.campaign_id=p_campaign_id and s.enabled and a.provider='GMAIL' and a.status='CONNECTED'
        and a.scopes @> array['https://www.googleapis.com/auth/gmail.send']::text[]
        and coalesce((select u.sent_count from public.email_campaign_sender_usage u where u.campaign_sender_id=s.id and u.bucket_kind='UTC_DAY' and u.bucket_start=v_day),0)<s.daily_cap
        and coalesce((select u.sent_count from public.email_campaign_sender_usage u where u.campaign_sender_id=s.id and u.bucket_kind='UTC_MINUTE' and u.bucket_start=v_minute),0)<s.per_minute_cap
        and coalesce((select u.reserved_count from public.email_sender_usage u where u.workspace_id=p_workspace_id and u.email_account_id=s.email_account_id and u.bucket_kind='UTC_DAY' and u.bucket_start=v_day),0)<l.daily_cap
        and coalesce((select u.reserved_count from public.email_sender_usage u where u.workspace_id=p_workspace_id and u.email_account_id=s.email_account_id and u.bucket_kind='UTC_MINUTE' and u.bucket_start=v_minute),0)<l.per_minute_cap
      order by coalesce((select sum(u.sent_count) from public.email_campaign_sender_usage u where u.campaign_sender_id=s.id),0),s.priority,s.id
      for update of s,l skip locked limit 1;
    end if;
    if not found then exit; end if;

    if not v_reclaim then
      insert into public.email_campaign_sender_usage(workspace_id,campaign_sender_id,bucket_kind,bucket_start,sent_count)
        values(p_workspace_id,v_sender.id,'UTC_DAY',v_day,1)
        on conflict(campaign_sender_id,bucket_kind,bucket_start) do update set sent_count=public.email_campaign_sender_usage.sent_count+1;
      insert into public.email_sender_usage(workspace_id,email_account_id,bucket_kind,bucket_start,reserved_count)
        values(p_workspace_id,v_sender.email_account_id,'UTC_DAY',v_day,1)
        on conflict(workspace_id,email_account_id,bucket_kind,bucket_start) do update set reserved_count=public.email_sender_usage.reserved_count+1;
      insert into public.email_sender_usage(workspace_id,email_account_id,bucket_kind,bucket_start,reserved_count)
        values(p_workspace_id,v_sender.email_account_id,'UTC_MINUTE',v_minute,1)
        on conflict(workspace_id,email_account_id,bucket_kind,bucket_start) do update set reserved_count=public.email_sender_usage.reserved_count+1;
      insert into public.email_campaign_sender_usage(workspace_id,campaign_sender_id,bucket_kind,bucket_start,sent_count)
        values(p_workspace_id,v_sender.id,'UTC_MINUTE',v_minute,1)
        on conflict(campaign_sender_id,bucket_kind,bucket_start) do update set sent_count=public.email_campaign_sender_usage.sent_count+1;
    end if;
    update public.email_campaign_recipients r set status='SENDING',sender_email_account_id=v_sender.email_account_id,
      claim_token=p_claim_token,claimed_at=clock_timestamp() where r.id=v_recipient.id and r.workspace_id=p_workspace_id;
    insert into public.email_campaign_events(workspace_id,campaign_id,recipient_id,event_type) values(p_workspace_id,p_campaign_id,v_recipient.id,'RECIPIENT_CLAIMED');
    recipient_id:=v_recipient.id; workspace_id:=p_workspace_id; campaign_id:=p_campaign_id; email:=v_recipient.email; display_name:=v_recipient.display_name;
    company:=v_recipient.company; recipient_position:=v_recipient.position; personalization_json:=v_recipient.personalization_json;
    sender_email_account_id:=v_sender.email_account_id; idempotency_key:=v_recipient.idempotency_key; claim_token:=p_claim_token;
    subject_template:=v_campaign.subject_template; body_text_template:=v_campaign.body_text_template;
    return next; v_count:=v_count+1;
  end loop;
end $$;
revoke all on function public.claim_email_campaign_recipients(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_email_campaign_recipients(uuid,uuid,uuid,integer) to service_role;

create function public.finalize_email_campaign_recipient(p_workspace_id uuid,p_recipient_id uuid,p_claim_token uuid,
  p_status text,p_send_request_id uuid,p_safe_error_code text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_campaign_id uuid;v_recipient public.email_campaign_recipients%rowtype;v_request public.email_send_requests%rowtype;
begin
  if p_status not in ('SENT','FAILED','DELIVERY_UNKNOWN') or (p_status in ('SENT','DELIVERY_UNKNOWN') and p_send_request_id is null) then return false; end if;
  select * into v_recipient from public.email_campaign_recipients r where r.id=p_recipient_id and r.workspace_id=p_workspace_id and r.status='SENDING' and r.claim_token=p_claim_token for update;
  if not found then return false; end if;
  if p_send_request_id is not null then
    select * into v_request from public.email_send_requests s where s.id=p_send_request_id and s.workspace_id=p_workspace_id
      and s.email_account_id=v_recipient.sender_email_account_id and s.idempotency_key=v_recipient.idempotency_key and s.send_type='NEW'
      and cardinality(s.to_addresses)=1 and lower(btrim(s.to_addresses[1]))=v_recipient.normalized_email for update;
    if not found or (p_status='SENT' and v_request.status<>'SENT')
      or (p_status='DELIVERY_UNKNOWN' and v_request.status<>'SENDING')
      or (p_status='FAILED' and v_request.status<>'FAILED') then return false; end if;
  end if;
  update public.email_campaign_recipients r set status=p_status,send_request_id=p_send_request_id,
    sent_at=case when p_status='SENT' then clock_timestamp() else null end,
    failed_at=case when p_status='FAILED' then clock_timestamp() else null end,
    safe_error_code=case when p_status='SENT' then null else p_safe_error_code end,claim_token=null,claimed_at=null
  where r.id=p_recipient_id and r.workspace_id=p_workspace_id and r.status='SENDING' and r.claim_token=p_claim_token
  returning r.campaign_id into v_campaign_id;
  if not found then return false; end if;
  insert into public.email_campaign_events(workspace_id,campaign_id,recipient_id,event_type)
  values(p_workspace_id,v_campaign_id,p_recipient_id,case p_status when 'SENT' then 'RECIPIENT_SENT' when 'FAILED' then 'RECIPIENT_FAILED' else 'RECIPIENT_DELIVERY_UNKNOWN' end);
  update public.email_campaigns c set status='COMPLETED',completed_at=clock_timestamp()
  where c.id=v_campaign_id and c.workspace_id=p_workspace_id and c.status='RUNNING'
    and not exists(select 1 from public.email_campaign_recipients r where r.campaign_id=c.id and r.workspace_id=c.workspace_id and r.status in ('PENDING','SENDING'));
  if found then insert into public.email_campaign_events(workspace_id,campaign_id,event_type) values(p_workspace_id,v_campaign_id,'CAMPAIGN_COMPLETED'); end if;
  return true;
end $$;
revoke all on function public.finalize_email_campaign_recipient(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_email_campaign_recipient(uuid,uuid,uuid,text,uuid,text) to service_role;

create function public.complete_email_campaign_if_idle(p_workspace_id uuid,p_campaign_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.email_campaigns c where c.id=p_campaign_id and c.workspace_id=p_workspace_id and c.status='RUNNING' for update;
  if not found or exists(select 1 from public.email_campaign_recipients r where r.workspace_id=p_workspace_id and r.campaign_id=p_campaign_id and r.status in ('PENDING','SENDING')) then return false; end if;
  update public.email_campaigns set status='COMPLETED',completed_at=clock_timestamp() where id=p_campaign_id and workspace_id=p_workspace_id and status='RUNNING';
  if not found then return false; end if;
  insert into public.email_campaign_events(workspace_id,campaign_id,event_type) values(p_workspace_id,p_campaign_id,'CAMPAIGN_COMPLETED');return true;
end $$;
revoke all on function public.complete_email_campaign_if_idle(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_email_campaign_if_idle(uuid,uuid) to service_role;
commit;
