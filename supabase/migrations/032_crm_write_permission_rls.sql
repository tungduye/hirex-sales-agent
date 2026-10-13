-- Enforce the workspace permission matrix for CRM writes at the database boundary.
begin;

drop policy if exists companies_insert_workspace on public.companies;
drop policy if exists companies_update_workspace on public.companies;
drop policy if exists companies_delete_workspace on public.companies;
create policy companies_insert_permission on public.companies for insert to authenticated
with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('companies.create'));
create policy companies_update_permission on public.companies for update to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('companies.update'))
with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('companies.update'));
create policy companies_delete_permission on public.companies for delete to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('companies.delete'));

drop policy if exists contacts_insert_workspace on public.contacts;
drop policy if exists contacts_update_workspace on public.contacts;
drop policy if exists contacts_delete_workspace on public.contacts;
create policy contacts_insert_permission on public.contacts for insert to authenticated
with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('contacts.create'));
create policy contacts_update_permission on public.contacts for update to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('contacts.update'))
with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('contacts.update'));
create policy contacts_delete_permission on public.contacts for delete to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('contacts.delete'));

drop policy if exists contact_channels_insert_workspace on public.contact_channels;
drop policy if exists contact_channels_update_workspace on public.contact_channels;
drop policy if exists contact_channels_delete_workspace on public.contact_channels;
create policy contact_channels_insert_permission on public.contact_channels for insert to authenticated
with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('contacts.update'));
create policy contact_channels_update_permission on public.contact_channels for update to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('contacts.update'))
with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('contacts.update'));
create policy contact_channels_delete_permission on public.contact_channels for delete to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('contacts.update'));

create or replace function public.set_contact_channel_marketing_consent(
  p_contact_channel_id uuid,
  p_status text,
  p_source text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_workspace_id uuid := public.current_workspace_id();
  v_actor_id uuid := auth.uid();
  v_source text := nullif(btrim(p_source),'');
begin
  if v_workspace_id is null or v_actor_id is null or p_contact_channel_id is null
    or not public.has_workspace_permission('contacts.update')
    or p_status not in ('UNKNOWN','OPTED_IN','OPTED_OUT')
    or (p_status <> 'UNKNOWN' and (v_source is null or length(v_source)>200 or v_source ~ '[[:cntrl:]]'))
  then return false; end if;
  update public.contact_channels
  set marketing_consent_status=p_status,
      marketing_consent_source=case when p_status='UNKNOWN' then null else v_source end,
      marketing_consent_recorded_at=case when p_status='UNKNOWN' then null else now() end
  where id=p_contact_channel_id and workspace_id=v_workspace_id;
  if not found then return false; end if;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_workspace_id,v_actor_id,'CONTACT_CHANNEL_MARKETING_CONSENT_SET','CONTACT_CHANNEL',p_contact_channel_id,
    jsonb_build_object('status',p_status,'source',case when p_status='UNKNOWN' then null else v_source end));
  return true;
end $$;

revoke all on function public.set_contact_channel_marketing_consent(uuid,text,text) from public, anon;
grant execute on function public.set_contact_channel_marketing_consent(uuid,text,text) to authenticated;

commit;
