begin;
do $$ begin
  if to_regprocedure('public.reorder_email_campaign_step_attachments(uuid,uuid,uuid,uuid[])') is null then raise exception 'reorder RPC missing';end if;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where p.oid='public.reorder_email_campaign_step_attachments(uuid,uuid,uuid,uuid[])'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'PUBLIC execute present';end if;
  if has_function_privilege('authenticated','public.reorder_email_campaign_step_attachments(uuid,uuid,uuid,uuid[])','EXECUTE') then raise exception 'authenticated execute present';end if;
  if not has_function_privilege('service_role','public.reorder_email_campaign_step_attachments(uuid,uuid,uuid,uuid[])','EXECUTE') then raise exception 'service role execute missing';end if;
  if position('set constraints public.email_campaign_step_attachments_order_key deferred' in lower(pg_get_functiondef('public.reorder_email_campaign_step_attachments(uuid,uuid,uuid,uuid[])'::regprocedure)))=0 then raise exception 'schema-qualified deferred constraint missing';end if;
  raise notice 'ATTACHMENT_REORDER_FOUNDATION_PASS assertions=5';
end $$;
rollback;
