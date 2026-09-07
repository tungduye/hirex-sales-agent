-- Allow a strongly matched inbound reply to supersede sequence completion.
-- Other terminal signal transitions remain fail-closed.
create or replace function public.apply_email_campaign_signal(p_workspace_id uuid,p_recipient_id uuid,p_signal_type text,p_source_key text,p_email_message_id uuid default null,p_diagnostic text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_recipient public.email_campaign_recipients%rowtype; v_status text; v_step_status text; v_event text;
begin
  if p_signal_type not in ('REPLY','HARD_BOUNCE','UNSUBSCRIBE') or p_source_key is null or btrim(p_source_key)='' then return false; end if;
  select * into v_recipient from public.email_campaign_recipients r where r.id=p_recipient_id and r.workspace_id=p_workspace_id for update;
  if not found then return false; end if;
  if p_signal_type='REPLY' then
    if v_recipient.engagement_status not in ('ACTIVE','COMPLETED') then return false; end if;
  elsif v_recipient.engagement_status<>'ACTIVE' then
    return false;
  end if;
  insert into public.email_campaign_signal_events(workspace_id,campaign_id,recipient_id,email_message_id,signal_type,source_key)
  values(p_workspace_id,v_recipient.campaign_id,p_recipient_id,p_email_message_id,p_signal_type,p_source_key) on conflict(workspace_id,signal_type,source_key) do nothing;
  if not found then return false; end if;
  v_status:=case p_signal_type when 'REPLY' then 'REPLIED' when 'HARD_BOUNCE' then 'HARD_BOUNCED' else 'UNSUBSCRIBED' end;
  v_step_status:=case p_signal_type when 'REPLY' then 'SKIPPED_REPLY' when 'HARD_BOUNCE' then 'SKIPPED_BOUNCE' else 'SKIPPED_UNSUBSCRIBED' end;
  v_event:=case p_signal_type when 'REPLY' then 'RECIPIENT_REPLIED' when 'HARD_BOUNCE' then 'RECIPIENT_HARD_BOUNCED' else 'RECIPIENT_UNSUBSCRIBED' end;
  update public.email_campaign_recipients set engagement_status=v_status,last_engagement_at=clock_timestamp(),stopped_reason=p_signal_type,
    replied_at=case when p_signal_type='REPLY' then clock_timestamp() else replied_at end,reply_email_message_id=case when p_signal_type='REPLY' then p_email_message_id else reply_email_message_id end,
    hard_bounced_at=case when p_signal_type='HARD_BOUNCE' then clock_timestamp() else hard_bounced_at end,bounce_diagnostic=case when p_signal_type='HARD_BOUNCE' then left(p_diagnostic,300) else bounce_diagnostic end
  where id=p_recipient_id and workspace_id=p_workspace_id
    and ((p_signal_type='REPLY' and engagement_status in ('ACTIVE','COMPLETED')) or (p_signal_type<>'REPLY' and engagement_status='ACTIVE'));
  if not found then return false; end if;
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

revoke all on function public.apply_email_campaign_signal(uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.apply_email_campaign_signal(uuid,uuid,text,text,uuid,text) to service_role;
