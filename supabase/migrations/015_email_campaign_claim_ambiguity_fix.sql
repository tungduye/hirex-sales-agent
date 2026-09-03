-- Phase 4AB hotfix: make SQL column resolution explicit inside the campaign
-- claim RPC. Migration 014 is already applied and remains immutable.

begin;

create or replace function public.claim_email_campaign_recipients(p_workspace_id uuid,p_campaign_id uuid,p_claim_token uuid,p_limit integer)
returns table(recipient_id uuid,workspace_id uuid,campaign_id uuid,email text,display_name text,company text,recipient_position text,personalization_json jsonb,
  sender_email_account_id uuid,idempotency_key uuid,claim_token uuid,subject_template text,body_text_template text)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
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

commit;
