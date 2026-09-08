-- Phase 6 multichannel campaigns. This remains separate from the proven email
-- campaign engine so EMAIL delivery semantics are not silently changed.

create table public.channel_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  status text not null default 'DRAFT',
  stop_on_reply boolean not null default true,
  created_by uuid not null,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_campaigns_id_workspace_key unique(id, workspace_id),
  constraint channel_campaigns_creator_workspace_fk foreign key(created_by,workspace_id) references public.profiles(id,workspace_id) on delete restrict,
  constraint channel_campaigns_name_not_blank check(btrim(name) <> '' and length(btrim(name)) <= 160),
  constraint channel_campaigns_status_allowed check(status in ('DRAFT','SCHEDULED','RUNNING','PAUSED','COMPLETED','CANCELLED')),
  constraint channel_campaigns_lifecycle_shape check(
    (status='DRAFT' and scheduled_at is null and started_at is null and completed_at is null and cancelled_at is null)
    or (status='SCHEDULED' and scheduled_at is not null and started_at is null and completed_at is null and cancelled_at is null)
    or (status in ('RUNNING','PAUSED') and started_at is not null and completed_at is null and cancelled_at is null)
    or (status='COMPLETED' and started_at is not null and completed_at is not null and cancelled_at is null)
    or (status='CANCELLED' and cancelled_at is not null and completed_at is null)
  )
);

create table public.channel_campaign_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  position integer not null,
  delay_minutes integer not null default 0,
  text_template text,
  attachment_ids uuid[] not null default '{}'::uuid[],
  allowed_channels text[] not null,
  requires_provider_template boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_campaign_steps_id_workspace_key unique(id,workspace_id),
  constraint channel_campaign_steps_campaign_workspace_fk foreign key(campaign_id,workspace_id) references public.channel_campaigns(id,workspace_id) on delete cascade,
  constraint channel_campaign_steps_position_positive check(position > 0),
  constraint channel_campaign_steps_delay_nonnegative check(delay_minutes >= 0),
  constraint channel_campaign_steps_content_present check(text_template is not null or cardinality(attachment_ids) > 0),
  constraint channel_campaign_steps_text_safe check(text_template is null or (btrim(text_template) <> '' and length(text_template) <= 100000)),
  constraint channel_campaign_steps_channels_allowed check(cardinality(allowed_channels) between 1 and 7 and allowed_channels <@ array['EMAIL','FACEBOOK','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER']::text[] and array_position(allowed_channels,null) is null),
  constraint channel_campaign_steps_attachment_count check(cardinality(attachment_ids) <= 10 and array_position(attachment_ids,null) is null),
  unique(workspace_id,campaign_id,position)
);

create table public.channel_campaign_senders (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, campaign_id uuid not null,
  channel_account_id uuid not null, priority integer not null default 100, enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint channel_campaign_senders_campaign_workspace_fk foreign key(campaign_id,workspace_id) references public.channel_campaigns(id,workspace_id) on delete cascade,
  constraint channel_campaign_senders_account_workspace_fk foreign key(channel_account_id,workspace_id) references public.channel_accounts(id,workspace_id) on delete restrict,
  constraint channel_campaign_senders_priority_positive check(priority > 0),
  unique(workspace_id,campaign_id,channel_account_id)
);

create table public.channel_campaign_recipients (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, campaign_id uuid not null,
  contact_id uuid not null, status text not null default 'ACTIVE', stop_reason text,
  current_step_position integer not null default 1, next_step_at timestamptz,
  replied_at timestamptz, source_message_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint channel_campaign_recipients_id_workspace_key unique(id,workspace_id),
  constraint channel_campaign_recipients_campaign_workspace_fk foreign key(campaign_id,workspace_id) references public.channel_campaigns(id,workspace_id) on delete cascade,
  constraint channel_campaign_recipients_contact_workspace_fk foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id) on delete restrict,
  constraint channel_campaign_recipients_source_workspace_fk foreign key(source_message_id,workspace_id) references public.omnichannel_messages(id,workspace_id) on delete restrict,
  constraint channel_campaign_recipients_status_allowed check(status in ('ACTIVE','REPLIED','SUPPRESSED','COMPLETED','FAILED','DELIVERY_UNKNOWN')),
  constraint channel_campaign_recipients_step_positive check(current_step_position > 0),
  constraint channel_campaign_recipients_stop_shape check((status='ACTIVE' and stop_reason is null and replied_at is null) or (status='REPLIED' and stop_reason='REPLIED' and replied_at is not null and source_message_id is not null) or (status in ('SUPPRESSED','COMPLETED','FAILED','DELIVERY_UNKNOWN') and stop_reason is not null)),
  unique(workspace_id,campaign_id,contact_id)
);

create table public.channel_campaign_recipient_steps (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, campaign_id uuid not null,
  recipient_id uuid not null, step_id uuid not null, channel_account_id uuid, channel_type text,
  recipient_external_id text, status text not null default 'PENDING', idempotency_key text not null,
  outbound_action_id uuid, claimed_at timestamptz, claim_lock_id uuid, completed_at timestamptz,
  safe_error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint channel_campaign_recipient_steps_campaign_workspace_fk foreign key(campaign_id,workspace_id) references public.channel_campaigns(id,workspace_id) on delete cascade,
  constraint channel_campaign_recipient_steps_recipient_workspace_fk foreign key(recipient_id,workspace_id) references public.channel_campaign_recipients(id,workspace_id) on delete cascade,
  constraint channel_campaign_recipient_steps_step_workspace_fk foreign key(step_id,workspace_id) references public.channel_campaign_steps(id,workspace_id) on delete cascade,
  constraint channel_campaign_recipient_steps_account_workspace_fk foreign key(channel_account_id,workspace_id) references public.channel_accounts(id,workspace_id) on delete restrict,
  constraint channel_campaign_recipient_steps_action_workspace_fk foreign key(outbound_action_id,workspace_id) references public.channel_outbound_actions(id,workspace_id) on delete restrict,
  constraint channel_campaign_recipient_steps_channel_allowed check(channel_type is null or channel_type in ('EMAIL','FACEBOOK','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER')),
  constraint channel_campaign_recipient_steps_status_allowed check(status in ('PENDING','CLAIMED','ACTION_CREATED','SENT','FAILED','DELIVERY_UNKNOWN','STOPPED')),
  constraint channel_campaign_recipient_steps_idempotency_not_blank check(btrim(idempotency_key) <> ''),
  constraint channel_campaign_recipient_steps_claim_shape check((status='CLAIMED' and claimed_at is not null and claim_lock_id is not null) or (status<>'CLAIMED' and claim_lock_id is null)),
  unique(workspace_id,campaign_id,recipient_id,step_id), unique(workspace_id,idempotency_key)
);

create table public.channel_campaign_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, campaign_id uuid not null,
  recipient_id uuid, event_type text not null, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint channel_campaign_events_campaign_workspace_fk foreign key(campaign_id,workspace_id) references public.channel_campaigns(id,workspace_id) on delete cascade,
  constraint channel_campaign_events_recipient_workspace_fk foreign key(recipient_id,workspace_id) references public.channel_campaign_recipients(id,workspace_id) on delete cascade,
  constraint channel_campaign_events_type_allowed check(event_type in ('CREATED','SCHEDULED','STARTED','PAUSED','RESUMED','COMPLETED','CANCELLED','STEP_CLAIMED','ACTION_CREATED','SENT','FAILED','DELIVERY_UNKNOWN','REPLIED','SUPPRESSED')),
  constraint channel_campaign_events_metadata_object check(jsonb_typeof(metadata)='object')
);

create index channel_campaigns_status_idx on public.channel_campaigns(workspace_id,status,created_at desc);
create index channel_campaign_recipients_due_idx on public.channel_campaign_recipients(workspace_id,campaign_id,status,next_step_at) where status='ACTIVE';
create index channel_campaign_recipient_steps_status_idx on public.channel_campaign_recipient_steps(workspace_id,campaign_id,status,created_at);
create index channel_campaign_events_timeline_idx on public.channel_campaign_events(workspace_id,campaign_id,created_at desc);

create trigger channel_campaigns_updated_at before update on public.channel_campaigns for each row execute function public.set_updated_at();
create trigger channel_campaign_steps_updated_at before update on public.channel_campaign_steps for each row execute function public.set_updated_at();
create trigger channel_campaign_recipients_updated_at before update on public.channel_campaign_recipients for each row execute function public.set_updated_at();
create trigger channel_campaign_recipient_steps_updated_at before update on public.channel_campaign_recipient_steps for each row execute function public.set_updated_at();

create function public.mark_channel_campaign_reply(p_workspace_id uuid,p_campaign_id uuid,p_contact_id uuid,p_source_message_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_recipient_id uuid;
begin
  if p_workspace_id is null or p_campaign_id is null or p_contact_id is null or p_source_message_id is null then return false; end if;
  if not exists(select 1 from public.omnichannel_messages m where m.id=p_source_message_id and m.workspace_id=p_workspace_id and m.direction='INBOUND') then return false; end if;
  update public.channel_campaign_recipients set status='REPLIED',stop_reason='REPLIED',replied_at=clock_timestamp(),source_message_id=p_source_message_id,next_step_at=null
  where workspace_id=p_workspace_id and campaign_id=p_campaign_id and contact_id=p_contact_id and status='ACTIVE' returning id into v_recipient_id;
  if v_recipient_id is null then return exists(select 1 from public.channel_campaign_recipients where workspace_id=p_workspace_id and campaign_id=p_campaign_id and contact_id=p_contact_id and status='REPLIED' and source_message_id=p_source_message_id); end if;
  update public.channel_campaign_recipient_steps set status='STOPPED',completed_at=clock_timestamp(),safe_error_code='RECIPIENT_REPLIED'
  where workspace_id=p_workspace_id and campaign_id=p_campaign_id and recipient_id=v_recipient_id and status='PENDING';
  insert into public.channel_campaign_events(workspace_id,campaign_id,recipient_id,event_type,metadata) values(p_workspace_id,p_campaign_id,v_recipient_id,'REPLIED',jsonb_build_object('sourceMessageId',p_source_message_id));
  return true;
end $$;

create function public.create_channel_campaign_draft(p_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid(); v_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null or p_name is null or btrim(p_name)='' or length(btrim(p_name))>160 then return null; end if;
  insert into public.channel_campaigns(workspace_id,name,created_by) values(v_workspace_id,btrim(p_name),v_actor_id) returning id into v_id;
  insert into public.channel_campaign_events(workspace_id,campaign_id,event_type) values(v_workspace_id,v_id,'CREATED');
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id) values(v_workspace_id,v_actor_id,'CHANNEL_CAMPAIGN_CREATED','CHANNEL_CAMPAIGN',v_id);
  return v_id;
end $$;

create function public.add_channel_campaign_step(p_campaign_id uuid,p_delay_minutes integer,p_text_template text,p_allowed_channels text[])
returns uuid language plpgsql security definer set search_path='' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid(); v_id uuid; v_position integer;
begin
  if v_workspace_id is null or v_actor_id is null or p_delay_minutes is null or p_delay_minutes<0 or p_text_template is null or btrim(p_text_template)='' or length(p_text_template)>100000
    or p_allowed_channels is null or cardinality(p_allowed_channels) not between 1 and 7 or not (p_allowed_channels <@ array['EMAIL','FACEBOOK','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER']::text[]) or array_position(p_allowed_channels,null) is not null then return null; end if;
  perform 1 from public.channel_campaigns where id=p_campaign_id and workspace_id=v_workspace_id and status='DRAFT' for update;
  if not found then return null; end if;
  select coalesce(max(position),0)+1 into v_position from public.channel_campaign_steps where workspace_id=v_workspace_id and campaign_id=p_campaign_id;
  insert into public.channel_campaign_steps(workspace_id,campaign_id,position,delay_minutes,text_template,allowed_channels) values(v_workspace_id,p_campaign_id,v_position,p_delay_minutes,p_text_template,p_allowed_channels) returning id into v_id;
  return v_id;
end $$;

create function public.add_channel_campaign_recipient(p_campaign_id uuid,p_contact_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid(); v_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null then return null; end if;
  perform 1 from public.channel_campaigns where id=p_campaign_id and workspace_id=v_workspace_id and status='DRAFT' for update;
  if not found or not exists(select 1 from public.contacts where id=p_contact_id and workspace_id=v_workspace_id) then return null; end if;
  insert into public.channel_campaign_recipients(workspace_id,campaign_id,contact_id) values(v_workspace_id,p_campaign_id,p_contact_id) on conflict do nothing returning id into v_id;
  return v_id;
end $$;

create function public.add_channel_campaign_sender(p_campaign_id uuid,p_channel_account_id uuid,p_priority integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid(); v_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null or p_priority is null or p_priority<=0 then return null; end if;
  perform 1 from public.channel_campaigns where id=p_campaign_id and workspace_id=v_workspace_id and status='DRAFT' for update;
  if not found or not exists(select 1 from public.channel_accounts where id=p_channel_account_id and workspace_id=v_workspace_id and status='CONNECTED') then return null; end if;
  insert into public.channel_campaign_senders(workspace_id,campaign_id,channel_account_id,priority) values(v_workspace_id,p_campaign_id,p_channel_account_id,p_priority) on conflict do nothing returning id into v_id;
  return v_id;
end $$;

create function public.start_channel_campaign(p_campaign_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_workspace_id uuid := public.current_workspace_id(); v_actor_id uuid := auth.uid(); v_started_at timestamptz := clock_timestamp();
begin
  if v_workspace_id is null or v_actor_id is null then return false; end if;
  update public.channel_campaigns set status='RUNNING',started_at=v_started_at where id=p_campaign_id and workspace_id=v_workspace_id and status='DRAFT'
    and exists(select 1 from public.channel_campaign_steps where campaign_id=p_campaign_id and workspace_id=v_workspace_id)
    and exists(select 1 from public.channel_campaign_recipients where campaign_id=p_campaign_id and workspace_id=v_workspace_id)
    and exists(select 1 from public.channel_campaign_senders where campaign_id=p_campaign_id and workspace_id=v_workspace_id and enabled);
  if not found then return false; end if;
  update public.channel_campaign_recipients set next_step_at=v_started_at where campaign_id=p_campaign_id and workspace_id=v_workspace_id and status='ACTIVE';
  insert into public.channel_campaign_recipient_steps(workspace_id,campaign_id,recipient_id,step_id,idempotency_key)
    select v_workspace_id,p_campaign_id,r.id,s.id,'channel-campaign:'||p_campaign_id::text||':'||r.id::text||':'||s.id::text
    from public.channel_campaign_recipients r cross join public.channel_campaign_steps s
    where r.workspace_id=v_workspace_id and r.campaign_id=p_campaign_id and s.workspace_id=v_workspace_id and s.campaign_id=p_campaign_id;
  insert into public.channel_campaign_events(workspace_id,campaign_id,event_type) values(v_workspace_id,p_campaign_id,'STARTED');
  return true;
end $$;

create function public.claim_channel_campaign_recipient_step(p_workspace_id uuid,p_campaign_id uuid,p_claim_lock_id uuid)
returns table(recipient_step_id uuid,recipient_id uuid,step_id uuid,channel_account_id uuid,channel_type text,recipient_external_id text,text_template text,attachment_ids uuid[],idempotency_key text,claim_lock_id uuid)
language plpgsql security definer set search_path='' as $$
declare v_candidate record; v_now timestamptz:=clock_timestamp();
begin
  if p_workspace_id is null or p_campaign_id is null or p_claim_lock_id is null then return; end if;
  perform 1 from public.channel_campaigns campaign where campaign.id=p_campaign_id and campaign.workspace_id=p_workspace_id and campaign.status='RUNNING' for update;
  if not found then return; end if;
  select rs.id as recipient_step_id,r.id as recipient_id,s.id as step_id,sender.channel_account_id,account.channel_type,cc.channel_value as recipient_external_id,s.text_template,s.attachment_ids,rs.idempotency_key
    into v_candidate
  from public.channel_campaign_recipient_steps rs
  join public.channel_campaign_recipients r on r.id=rs.recipient_id and r.workspace_id=rs.workspace_id and r.campaign_id=rs.campaign_id
  join public.channel_campaign_steps s on s.id=rs.step_id and s.workspace_id=rs.workspace_id and s.campaign_id=rs.campaign_id and s.position=r.current_step_position
  join public.contact_channels cc on cc.contact_id=r.contact_id and cc.workspace_id=r.workspace_id and cc.channel_type=any(s.allowed_channels)
  join public.channel_campaign_senders sender on sender.campaign_id=rs.campaign_id and sender.workspace_id=rs.workspace_id and sender.enabled
  join public.channel_accounts account on account.id=sender.channel_account_id and account.workspace_id=sender.workspace_id and account.status='CONNECTED' and account.channel_type=cc.channel_type
  where rs.workspace_id=p_workspace_id and rs.campaign_id=p_campaign_id and rs.status='PENDING' and r.status='ACTIVE' and r.next_step_at<=v_now
    and account.channel_type in ('FACEBOOK','ZALO') and cc.marketing_consent_status='OPTED_IN' and (s.text_template is null or 'SEND_TEXT'=any(account.capabilities)) and (cardinality(s.attachment_ids)=0 or 'SEND_FILE'=any(account.capabilities))
    and (account.channel_type <> 'FACEBOOK' or exists(
      select 1 from public.omnichannel_conversations conversation
      where conversation.workspace_id=p_workspace_id and conversation.channel_account_id=account.id
        and conversation.provider_conversation_id=cc.channel_value and conversation.status in ('OPEN','PENDING')
        and conversation.last_message_at >= now()-interval '23 hours'
    ))
    and not exists(select 1 from public.channel_suppressions suppression where suppression.workspace_id=p_workspace_id and suppression.channel_type=account.channel_type and lower(btrim(suppression.normalized_recipient))=lower(btrim(cc.channel_value)))
  order by r.next_step_at,rs.created_at,sender.priority,rs.id,account.id
  for update of rs skip locked limit 1;
  if v_candidate.recipient_step_id is null then return; end if;
  update public.channel_campaign_recipient_steps rs set status='CLAIMED',channel_account_id=v_candidate.channel_account_id,channel_type=v_candidate.channel_type,recipient_external_id=v_candidate.recipient_external_id,claimed_at=v_now,claim_lock_id=p_claim_lock_id
  where rs.id=v_candidate.recipient_step_id and rs.workspace_id=p_workspace_id and rs.status='PENDING';
  if not found then return; end if;
  insert into public.channel_campaign_events(workspace_id,campaign_id,recipient_id,event_type,metadata) values(p_workspace_id,p_campaign_id,v_candidate.recipient_id,'STEP_CLAIMED',jsonb_build_object('recipientStepId',v_candidate.recipient_step_id));
  return query select v_candidate.recipient_step_id,v_candidate.recipient_id,v_candidate.step_id,v_candidate.channel_account_id,v_candidate.channel_type,v_candidate.recipient_external_id,v_candidate.text_template,v_candidate.attachment_ids,v_candidate.idempotency_key,p_claim_lock_id;
end $$;

create function public.materialize_channel_campaign_action(p_workspace_id uuid,p_campaign_id uuid,p_recipient_step_id uuid,p_claim_lock_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_step public.channel_campaign_recipient_steps%rowtype; v_campaign public.channel_campaigns%rowtype; v_template text; v_attachments uuid[]; v_policy_id uuid; v_action_id uuid;
begin
  select * into v_campaign from public.channel_campaigns where id=p_campaign_id and workspace_id=p_workspace_id and status='RUNNING' for update;
  if not found then return null; end if;
  select * into v_step from public.channel_campaign_recipient_steps where id=p_recipient_step_id and workspace_id=p_workspace_id and campaign_id=p_campaign_id and status='CLAIMED' and claim_lock_id=p_claim_lock_id for update;
  if not found or v_step.channel_account_id is null or v_step.channel_type is null or v_step.recipient_external_id is null then return null; end if;
  if exists(select 1 from public.channel_suppressions where workspace_id=p_workspace_id and channel_type=v_step.channel_type and lower(btrim(normalized_recipient))=lower(btrim(v_step.recipient_external_id))) then
    update public.channel_campaign_recipient_steps set status='STOPPED',safe_error_code='RECIPIENT_SUPPRESSED',claim_lock_id=null,completed_at=clock_timestamp() where id=v_step.id;
    update public.channel_campaign_recipients set status='SUPPRESSED',stop_reason='SUPPRESSED',next_step_at=null where id=v_step.recipient_id and workspace_id=p_workspace_id and status='ACTIVE'; return null;
  end if;
  select text_template,attachment_ids into v_template,v_attachments from public.channel_campaign_steps where id=v_step.step_id and workspace_id=p_workspace_id;
  insert into public.channel_policy_decisions(workspace_id,channel_account_id,channel_type,normalized_recipient,allowed,expires_at) values(p_workspace_id,v_step.channel_account_id,v_step.channel_type,lower(btrim(v_step.recipient_external_id)),true,clock_timestamp()+interval '10 minutes') returning id into v_policy_id;
  insert into public.channel_outbound_actions(workspace_id,channel_account_id,channel_type,recipient_external_id,status,text_content,attachment_ids,idempotency_key,policy_decision_id,proposed_by,approved_by,approved_at)
    values(p_workspace_id,v_step.channel_account_id,v_step.channel_type,v_step.recipient_external_id,'QUEUED',v_template,v_attachments,v_step.idempotency_key,v_policy_id,'HUMAN',v_campaign.created_by,clock_timestamp())
    on conflict(workspace_id,channel_account_id,idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then select id into v_action_id from public.channel_outbound_actions where workspace_id=p_workspace_id and channel_account_id=v_step.channel_account_id and idempotency_key=v_step.idempotency_key; end if;
  if v_action_id is null then return null; end if;
  update public.channel_campaign_recipient_steps set status='ACTION_CREATED',outbound_action_id=v_action_id,claim_lock_id=null where id=v_step.id and workspace_id=p_workspace_id and status='CLAIMED' and claim_lock_id=p_claim_lock_id;
  if not found then return null; end if;
  insert into public.channel_campaign_events(workspace_id,campaign_id,recipient_id,event_type,metadata) values(p_workspace_id,p_campaign_id,v_step.recipient_id,'ACTION_CREATED',jsonb_build_object('outboundActionId',v_action_id));
  return v_action_id;
end $$;

create function public.finalize_channel_campaign_recipient_step(p_workspace_id uuid,p_campaign_id uuid,p_recipient_step_id uuid,p_outbound_action_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_step public.channel_campaign_recipient_steps%rowtype; v_action public.channel_outbound_actions%rowtype; v_position integer; v_next public.channel_campaign_steps%rowtype; v_now timestamptz:=clock_timestamp();
begin
  select * into v_step from public.channel_campaign_recipient_steps where id=p_recipient_step_id and workspace_id=p_workspace_id and campaign_id=p_campaign_id and status='ACTION_CREATED' and outbound_action_id=p_outbound_action_id for update;
  if not found then return exists(select 1 from public.channel_campaign_recipient_steps where id=p_recipient_step_id and workspace_id=p_workspace_id and outbound_action_id=p_outbound_action_id and status in ('SENT','FAILED','DELIVERY_UNKNOWN')); end if;
  select * into v_action from public.channel_outbound_actions where id=p_outbound_action_id and workspace_id=p_workspace_id and channel_account_id=v_step.channel_account_id and status in ('SENT','FAILED','DELIVERY_UNKNOWN');
  if not found then return false; end if;
  update public.channel_campaign_recipient_steps set status=v_action.status,completed_at=v_now,safe_error_code=v_action.safe_error_code where id=v_step.id;
  if v_action.status='SENT' then
    select position into v_position from public.channel_campaign_steps where id=v_step.step_id and workspace_id=p_workspace_id;
    select * into v_next from public.channel_campaign_steps where workspace_id=p_workspace_id and campaign_id=p_campaign_id and position>v_position order by position limit 1;
    if found then update public.channel_campaign_recipients set current_step_position=v_next.position,next_step_at=v_now+make_interval(mins=>v_next.delay_minutes) where id=v_step.recipient_id and workspace_id=p_workspace_id and status='ACTIVE';
    else update public.channel_campaign_recipients set status='COMPLETED',stop_reason='SEQUENCE_COMPLETED',next_step_at=null where id=v_step.recipient_id and workspace_id=p_workspace_id and status='ACTIVE'; end if;
    insert into public.channel_campaign_events(workspace_id,campaign_id,recipient_id,event_type,metadata) values(p_workspace_id,p_campaign_id,v_step.recipient_id,'SENT',jsonb_build_object('outboundActionId',p_outbound_action_id));
  elsif v_action.status='DELIVERY_UNKNOWN' then update public.channel_campaign_recipients set status='DELIVERY_UNKNOWN',stop_reason='DELIVERY_UNKNOWN',next_step_at=null where id=v_step.recipient_id and workspace_id=p_workspace_id and status='ACTIVE';
  else update public.channel_campaign_recipients set status='FAILED',stop_reason=coalesce(v_action.safe_error_code,'SEND_FAILED'),next_step_at=null where id=v_step.recipient_id and workspace_id=p_workspace_id and status='ACTIVE'; end if;
  return true;
end $$;

revoke all on function public.mark_channel_campaign_reply(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_channel_campaign_draft(text) from public,anon;
revoke all on function public.add_channel_campaign_step(uuid,integer,text,text[]) from public,anon;
revoke all on function public.add_channel_campaign_recipient(uuid,uuid) from public,anon;
revoke all on function public.add_channel_campaign_sender(uuid,uuid,integer) from public,anon;
revoke all on function public.start_channel_campaign(uuid) from public,anon;
revoke all on function public.claim_channel_campaign_recipient_step(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.materialize_channel_campaign_action(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.finalize_channel_campaign_recipient_step(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.mark_channel_campaign_reply(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.create_channel_campaign_draft(text) to authenticated;
grant execute on function public.add_channel_campaign_step(uuid,integer,text,text[]) to authenticated;
grant execute on function public.add_channel_campaign_recipient(uuid,uuid) to authenticated;
grant execute on function public.add_channel_campaign_sender(uuid,uuid,integer) to authenticated;
grant execute on function public.start_channel_campaign(uuid) to authenticated;
grant execute on function public.claim_channel_campaign_recipient_step(uuid,uuid,uuid) to service_role;
grant execute on function public.materialize_channel_campaign_action(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.finalize_channel_campaign_recipient_step(uuid,uuid,uuid,uuid) to service_role;

alter table public.channel_campaigns enable row level security;
alter table public.channel_campaign_steps enable row level security;
alter table public.channel_campaign_senders enable row level security;
alter table public.channel_campaign_recipients enable row level security;
alter table public.channel_campaign_recipient_steps enable row level security;
alter table public.channel_campaign_events enable row level security;

create policy channel_campaigns_read on public.channel_campaigns for select to authenticated using(workspace_id=public.current_workspace_id());
create policy channel_campaign_steps_read on public.channel_campaign_steps for select to authenticated using(workspace_id=public.current_workspace_id());
create policy channel_campaign_senders_read on public.channel_campaign_senders for select to authenticated using(workspace_id=public.current_workspace_id());
create policy channel_campaign_recipients_read on public.channel_campaign_recipients for select to authenticated using(workspace_id=public.current_workspace_id());
create policy channel_campaign_recipient_steps_read on public.channel_campaign_recipient_steps for select to authenticated using(workspace_id=public.current_workspace_id());
create policy channel_campaign_events_read on public.channel_campaign_events for select to authenticated using(workspace_id=public.current_workspace_id());

revoke all on public.channel_campaigns,public.channel_campaign_steps,public.channel_campaign_senders,public.channel_campaign_recipients,public.channel_campaign_recipient_steps,public.channel_campaign_events from anon,authenticated;
grant select on public.channel_campaigns,public.channel_campaign_steps,public.channel_campaign_senders,public.channel_campaign_recipients,public.channel_campaign_recipient_steps,public.channel_campaign_events to authenticated;
grant select,insert,update,delete on public.channel_campaigns,public.channel_campaign_steps,public.channel_campaign_senders,public.channel_campaign_recipients,public.channel_campaign_recipient_steps,public.channel_campaign_events to service_role;
