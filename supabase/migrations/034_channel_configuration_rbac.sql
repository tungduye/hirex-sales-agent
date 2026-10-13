-- SECURITY DEFINER RPCs must not bypass the role matrix for authenticated callers.
begin;

create function public.guard_channel_configuration_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_required_permission text;
  v_account_id uuid;
  v_campaign_id uuid;
  v_running_transition boolean := false;
begin
  -- Internal service-role ingestion and campaign processors have their own trusted boundary.
  if auth.role() <> 'authenticated' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name like 'channel_campaign%' and tg_table_name <> 'channel_campaigns' then
    if tg_op = 'DELETE' then v_campaign_id := old.campaign_id;
    else v_campaign_id := new.campaign_id; end if;
  end if;
  if tg_table_name = 'channel_campaigns' and tg_op = 'UPDATE' then
    v_running_transition := new.status = 'RUNNING' and old.status <> 'RUNNING';
  end if;
  v_required_permission := case
    when tg_table_name in ('conversation_tags','conversation_tag_links') then 'inbox.update'
    when tg_table_name in ('quick_reply_templates','channel_automations','channel_suppressions','channel_automation_proposals') then 'channels.manage'
    when tg_table_name = 'channel_campaigns' and v_running_transition then 'campaigns.launch'
    when tg_table_name = 'channel_campaigns' and tg_op = 'INSERT' then 'campaigns.create'
    when tg_table_name like 'channel_campaign%' and tg_table_name <> 'channel_campaigns'
      and exists(select 1 from public.channel_campaigns c
        where c.id = v_campaign_id
          and c.status = 'RUNNING') then 'campaigns.launch'
    when tg_table_name like 'channel_campaign%' then 'campaigns.update'
    else null
  end;
  if v_required_permission is null or (
    not public.has_workspace_permission(v_required_permission)
    and not (v_required_permission = 'campaigns.update' and tg_op = 'INSERT'
      and public.has_workspace_permission('campaigns.create')
      and exists(select 1 from public.channel_campaigns c
        where c.id = v_campaign_id and c.status = 'DRAFT' and c.created_by = auth.uid()))
  ) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if tg_op = 'DELETE' then
    if old.workspace_id <> public.current_workspace_id() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  elsif new.workspace_id <> public.current_workspace_id() then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if tg_table_name = 'channel_campaign_senders' then
    v_account_id := case when tg_op = 'DELETE' then old.channel_account_id else new.channel_account_id end;
    if not public.can_access_channel_account(v_account_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

create trigger guard_conversation_tags_write before insert or update or delete on public.conversation_tags
for each row execute function public.guard_channel_configuration_write();
create trigger guard_conversation_tag_links_write before insert or update or delete on public.conversation_tag_links
for each row execute function public.guard_channel_configuration_write();
create trigger guard_quick_reply_templates_write before insert or update or delete on public.quick_reply_templates
for each row execute function public.guard_channel_configuration_write();
create trigger guard_channel_automations_write before insert or update or delete on public.channel_automations
for each row execute function public.guard_channel_configuration_write();
create trigger guard_channel_suppressions_write before insert or update or delete on public.channel_suppressions
for each row execute function public.guard_channel_configuration_write();
create trigger guard_channel_automation_proposals_write before insert or update or delete on public.channel_automation_proposals
for each row execute function public.guard_channel_configuration_write();
create trigger guard_channel_campaigns_write before insert or update or delete on public.channel_campaigns
for each row execute function public.guard_channel_configuration_write();
create trigger guard_channel_campaign_steps_write before insert or update or delete on public.channel_campaign_steps
for each row execute function public.guard_channel_configuration_write();
create trigger guard_channel_campaign_recipients_write before insert or update or delete on public.channel_campaign_recipients
for each row execute function public.guard_channel_configuration_write();
create trigger guard_channel_campaign_senders_write before insert or update or delete on public.channel_campaign_senders
for each row execute function public.guard_channel_configuration_write();

revoke all on function public.guard_channel_configuration_write() from public, anon, authenticated;

commit;
