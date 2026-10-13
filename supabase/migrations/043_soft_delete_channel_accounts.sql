alter table public.channel_accounts add column if not exists deleted_at timestamptz;
create index if not exists channel_accounts_active_idx on public.channel_accounts(workspace_id,channel_type) where deleted_at is null;

create or replace function public.soft_delete_channel_account(p_workspace_id uuid,p_actor_id uuid,p_channel_account_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and workspace_id=p_workspace_id) then return false; end if;
  update public.channel_accounts set status='DISCONNECTED',operator_enabled=false,deleted_at=clock_timestamp()
  where id=p_channel_account_id and workspace_id=p_workspace_id and channel_type<>'EMAIL' and deleted_at is null;
  if not found then return false; end if;
  delete from public.channel_account_credentials where channel_account_id=p_channel_account_id and workspace_id=p_workspace_id;
  delete from public.profile_channel_account_access where channel_account_id=p_channel_account_id and workspace_id=p_workspace_id;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id)
  values(p_workspace_id,p_actor_id,'CHANNEL_ACCOUNT_DELETED','CHANNEL_ACCOUNT',p_channel_account_id);
  return true;
end $$;
revoke all on function public.soft_delete_channel_account(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.soft_delete_channel_account(uuid,uuid,uuid) to service_role;

create or replace function public.restore_channel_account_on_reconnect() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='CONNECTED' then new.deleted_at=null; end if;
  return new;
end $$;
drop trigger if exists channel_accounts_restore_on_reconnect on public.channel_accounts;
create trigger channel_accounts_restore_on_reconnect before update on public.channel_accounts for each row execute function public.restore_channel_account_on_reconnect();
