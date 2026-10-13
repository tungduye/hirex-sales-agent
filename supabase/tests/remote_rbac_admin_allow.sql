-- Safe production probe: allowed admin writes are verified, then rolled back.
begin;
select set_config('request.jwt.claim.sub',
  (select p.id::text from public.profiles p
   join public.workspace_roles r on r.id=p.role_id and r.workspace_id=p.workspace_id
   where r.name='Quản trị viên' order by p.created_at limit 1), true);
select set_config('request.jwt.claim.role','authenticated',true);

do $$
begin
  if not public.has_workspace_permission('inbox.update')
    or not public.has_workspace_permission('channels.manage')
    or not public.has_workspace_permission('campaigns.create') then
    raise exception 'ADMIN_PERMISSION_MISSING';
  end if;
  if public.create_conversation_tag('__RBAC_ROLLBACK_ADMIN_PROBE__','#000000') is null then
    raise exception 'ADMIN_TAG_WRITE_FAILED';
  end if;
  if public.save_manual_channel_suppression('ZALO','rbac-admin-rollback-probe.invalid') is null then
    raise exception 'ADMIN_SUPPRESSION_WRITE_FAILED';
  end if;
  if public.create_channel_campaign_draft('__RBAC_ROLLBACK_ADMIN_PROBE__') is null then
    raise exception 'ADMIN_CAMPAIGN_WRITE_FAILED';
  end if;
end $$;

select 'PASS' as admin_config_write_allow;
rollback;
