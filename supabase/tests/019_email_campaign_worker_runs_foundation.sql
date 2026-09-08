begin;
do $$ begin
  if not exists(select 1 from pg_class where oid='public.email_campaign_worker_runs'::regclass and relrowsecurity) then raise exception 'worker RLS missing'; end if;
  if has_table_privilege('authenticated','public.email_campaign_worker_runs','SELECT') or has_table_privilege('authenticated','public.email_campaign_worker_runs','INSERT') then raise exception 'browser privilege present'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and tablename='email_campaign_worker_runs' and indexname='email_campaign_worker_runs_started_idx') then raise exception 'worker index missing'; end if;
  raise notice 'WORKER_RUN_FOUNDATION_PASS assertions=3';
end $$;
rollback;
