-- READ-ONLY preflight and post-hotfix metadata verification for migration 012.

select pg_catalog.pg_get_functiondef(
  'public.finalize_reply_email_send_request_sent(uuid,uuid,uuid,uuid,text,text)'::regprocedure
) as current_finalizer_definition;

select
  to_regprocedure(
    'public.finalize_reply_email_send_request_sent(uuid,uuid,uuid,uuid,text,text)'
  ) is not null as rpc_exists,
  procedure.prosecdef as security_definer,
  coalesce('search_path=""' = any(procedure.proconfig), false) as search_path_empty,
  not exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) as privilege
    where privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) as public_execute_denied,
  not has_function_privilege(
    'anon',
    'public.finalize_reply_email_send_request_sent(uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ) as anon_execute_denied,
  not has_function_privilege(
    'authenticated',
    'public.finalize_reply_email_send_request_sent(uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ) as authenticated_execute_denied,
  has_function_privilege(
    'service_role',
    'public.finalize_reply_email_send_request_sent(uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ) as service_role_execute_allowed
from pg_catalog.pg_proc as procedure
where procedure.oid =
  'public.finalize_reply_email_send_request_sent(uuid,uuid,uuid,uuid,text,text)'::regprocedure;
