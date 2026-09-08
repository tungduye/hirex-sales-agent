begin;
create temporary table __attachment_test_init(id integer) on commit drop;
do $$ begin
  if not exists(select 1 from storage.buckets where id='email-attachments' and public=false) then raise exception 'private bucket missing'; end if;
  if not exists(select 1 from pg_class where oid='public.email_attachments'::regclass and relrowsecurity) then raise exception 'attachment RLS missing'; end if;
  if not exists(select 1 from pg_class where oid='public.email_campaign_step_attachments'::regclass and relrowsecurity) then raise exception 'association RLS missing'; end if;
  if has_table_privilege('authenticated','public.email_attachments','INSERT') or has_table_privilege('authenticated','public.email_attachments','UPDATE') or has_table_privilege('authenticated','public.email_attachments','DELETE') then raise exception 'browser mutation privilege present'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.email_campaign_step_attachments'::regclass and tgname='email_campaign_step_attachments_guard') then raise exception 'draft guard missing'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.email_campaign_step_attachments'::regclass and contype='u') then raise exception 'ordering uniqueness missing'; end if;
  raise notice 'ATTACHMENT_FOUNDATION_PASS assertions=6';
end $$;
rollback;
