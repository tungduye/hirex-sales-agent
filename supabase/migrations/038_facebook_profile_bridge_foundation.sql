-- Internal Facebook Profile bridge foundation. This is intentionally a
-- separate channel from the official Meta Graph Facebook Page integration.
alter table public.channel_accounts drop constraint if exists channel_accounts_type_allowed;
alter table public.channel_accounts add constraint channel_accounts_type_allowed check(channel_type in ('EMAIL','FACEBOOK','FACEBOOK_PROFILE','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER'));
alter table public.omnichannel_conversations drop constraint if exists omnichannel_conversations_type_allowed;
alter table public.omnichannel_conversations add constraint omnichannel_conversations_type_allowed check(channel_type in ('EMAIL','FACEBOOK','FACEBOOK_PROFILE','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER'));
alter table public.channel_policy_decisions drop constraint if exists channel_policy_decisions_type_allowed;
alter table public.channel_policy_decisions add constraint channel_policy_decisions_type_allowed check(channel_type in ('EMAIL','FACEBOOK','FACEBOOK_PROFILE','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER'));
alter table public.channel_outbound_actions drop constraint if exists channel_outbound_actions_type_allowed;
alter table public.channel_outbound_actions add constraint channel_outbound_actions_type_allowed check(channel_type in ('EMAIL','FACEBOOK','FACEBOOK_PROFILE','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER'));
alter table public.quick_reply_templates drop constraint if exists quick_reply_templates_channels_allowed;
alter table public.quick_reply_templates add constraint quick_reply_templates_channels_allowed check(channel_types <@ array['EMAIL','FACEBOOK','FACEBOOK_PROFILE','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER']::text[]);
alter table public.channel_suppressions drop constraint if exists channel_suppressions_type_allowed;
alter table public.channel_suppressions add constraint channel_suppressions_type_allowed check(channel_type in ('EMAIL','FACEBOOK','FACEBOOK_PROFILE','ZALO','WHATSAPP','VIBER','TELEGRAM','OTHER'));

create or replace function public.upsert_channel_account_credential(
  p_workspace_id uuid,p_connected_by uuid,p_channel_type text,p_provider text,
  p_external_account_id text,p_display_name text,p_capabilities text[],
  p_access_token_encrypted text,p_webhook_secret_encrypted text,p_configuration jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if p_workspace_id is null or p_connected_by is null
    or p_channel_type not in ('FACEBOOK','FACEBOOK_PROFILE','ZALO')
    or (p_channel_type='FACEBOOK' and p_provider<>'META_GRAPH')
    or (p_channel_type='FACEBOOK_PROFILE' and p_provider<>'FACEBOOK_PROFILE_BRIDGE')
    or (p_channel_type='ZALO' and p_provider<>'ZALO_BRIDGE')
    or p_external_account_id is null or btrim(p_external_account_id)='' or length(btrim(p_external_account_id))>256
    or p_provider is null or btrim(p_provider)=''
    or p_capabilities is null or array_position(p_capabilities,null) is not null
    or not (p_capabilities <@ array['SEND_TEXT','SEND_IMAGE','SEND_FILE','REPLY','REACTIONS','DELIVERY_RECEIPTS','READ_RECEIPTS','TYPING_INDICATOR','TEMPLATES','COMMENTS']::text[])
    or (p_channel_type='FACEBOOK_PROFILE' and not (p_capabilities <@ array['SEND_TEXT','REPLY']::text[]))
    or p_webhook_secret_encrypted is null or btrim(p_webhook_secret_encrypted)=''
    or (p_channel_type='FACEBOOK' and (p_access_token_encrypted is null or btrim(p_access_token_encrypted)=''))
    or (p_channel_type='FACEBOOK_PROFILE' and p_access_token_encrypted is not null)
    or p_configuration is null or jsonb_typeof(p_configuration)<>'object'
    or not exists(select 1 from public.profiles where id=p_connected_by and workspace_id=p_workspace_id)
  then return null; end if;
  insert into public.channel_accounts(workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status,capabilities)
  values(p_workspace_id,p_connected_by,p_channel_type,p_provider,btrim(p_external_account_id),nullif(btrim(p_display_name),''),'CONNECTED',p_capabilities)
  on conflict(workspace_id,channel_type,lower(provider),lower(btrim(external_account_id)))
  do update set display_name=excluded.display_name,status='CONNECTED',capabilities=excluded.capabilities,last_error_code=null
  returning id into v_id;
  insert into public.channel_account_credentials(channel_account_id,workspace_id,access_token_encrypted,webhook_secret_encrypted,configuration)
  values(v_id,p_workspace_id,p_access_token_encrypted,p_webhook_secret_encrypted,p_configuration)
  on conflict(channel_account_id) do update set access_token_encrypted=excluded.access_token_encrypted,webhook_secret_encrypted=excluded.webhook_secret_encrypted,configuration=excluded.configuration;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_workspace_id,p_connected_by,'CHANNEL_ACCOUNT_CREDENTIAL_CONFIGURED','CHANNEL_ACCOUNT',v_id,jsonb_build_object('channelType',p_channel_type,'provider',p_provider));
  return v_id;
end $$;

create or replace function public.disconnect_channel_account(p_workspace_id uuid,p_actor_id uuid,p_channel_account_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and workspace_id=p_workspace_id) then return false; end if;
  update public.channel_accounts set status='DISCONNECTED' where id=p_channel_account_id and workspace_id=p_workspace_id and channel_type in ('FACEBOOK','FACEBOOK_PROFILE','ZALO') and status<>'DISCONNECTED';
  if not found then return false; end if;
  delete from public.channel_account_credentials where channel_account_id=p_channel_account_id and workspace_id=p_workspace_id;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id) values(p_workspace_id,p_actor_id,'CHANNEL_ACCOUNT_DISCONNECTED','CHANNEL_ACCOUNT',p_channel_account_id);
  return true;
end $$;

revoke all on function public.upsert_channel_account_credential(uuid,uuid,text,text,text,text,text[],text,text,jsonb) from public,anon;
grant execute on function public.upsert_channel_account_credential(uuid,uuid,text,text,text,text,text[],text,text,jsonb) to service_role;
revoke all on function public.disconnect_channel_account(uuid,uuid,uuid) from public,anon;
grant execute on function public.disconnect_channel_account(uuid,uuid,uuid) to service_role;
