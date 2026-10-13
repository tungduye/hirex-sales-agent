-- Safe production probe: every attempted write is inside a rolled-back transaction.
begin;
select set_config('request.jwt.claim.sub',
  (select id::text from auth.users where email='tungddhe163913@fpt.edu.vn'), true);
select set_config('request.jwt.claim.role','authenticated',true);

do $$
begin
  begin
    perform public.create_conversation_tag('__RBAC_ROLLBACK_PROBE__','#000000');
    raise exception 'TAG_DENIAL_MISSING';
  exception when insufficient_privilege then null; end;

  begin
    perform public.save_manual_channel_suppression('ZALO','rbac-rollback-probe.invalid');
    raise exception 'SUPPRESSION_DENIAL_MISSING';
  exception when insufficient_privilege then null; end;

  begin
    perform public.create_channel_campaign_draft('__RBAC_ROLLBACK_PROBE__');
    raise exception 'CAMPAIGN_DENIAL_MISSING';
  exception when insufficient_privilege then null; end;
end $$;

select 'PASS' as member_config_write_denials;
rollback;
