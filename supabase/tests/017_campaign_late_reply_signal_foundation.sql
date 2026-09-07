-- Rollback-safe audit for migration 017. Never calls Gmail.
begin;
create temporary table __late_reply_test_init(id integer) on commit drop;
create or replace function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;

select pg_temp.assert_true(has_function_privilege('service_role','public.apply_email_campaign_signal(uuid,uuid,text,text,uuid,text)','EXECUTE'),'service_role execute allowed');
select pg_temp.assert_true(not has_function_privilege('anon','public.apply_email_campaign_signal(uuid,uuid,text,text,uuid,text)','EXECUTE'),'anon execute blocked');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.apply_email_campaign_signal(uuid,uuid,text,text,uuid,text)','EXECUTE'),'authenticated execute blocked');
select pg_temp.assert_true(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.apply_email_campaign_signal(uuid,uuid,text,text,uuid,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC execute blocked');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','99000000-0000-4000-8000-000000000001','authenticated','authenticated','late-reply@example.test','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp());
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000000002','Late reply audit');
insert into public.profiles(id,workspace_id,full_name) values('99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','Late Reply Fixture');
insert into public.email_campaigns(id,workspace_id,name,status,subject_template,body_text_template,created_by,sequence_enabled)
values('99000000-0000-4000-8000-000000000010','99000000-0000-4000-8000-000000000002','Late reply','DRAFT','Subject','Body','99000000-0000-4000-8000-000000000001',true);
insert into public.email_campaign_steps(id,workspace_id,campaign_id,step_order,step_type,delay_minutes,subject_template,body_text_template)
values('99000000-0000-4000-8000-000000000011','99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000010',0,'INITIAL',0,'Subject','Body');
insert into public.email_campaign_recipients(id,workspace_id,campaign_id,email,normalized_email,idempotency_key,engagement_status)
values
('99000000-0000-4000-8000-000000000021','99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000010','active@example.test','active@example.test','99000000-0000-4000-8000-000000000031','ACTIVE'),
('99000000-0000-4000-8000-000000000022','99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000010','completed@example.test','completed@example.test','99000000-0000-4000-8000-000000000032','COMPLETED');
update public.email_campaigns set status='RUNNING',started_at=clock_timestamp() where id='99000000-0000-4000-8000-000000000010';
select public.initialize_email_campaign_sequence('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000010');

select pg_temp.assert_true(not public.apply_email_campaign_signal('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000022','HARD_BOUNCE','completed-bounce',null,'fixture'),'COMPLETED hard bounce rejected');
select pg_temp.assert_true(not public.apply_email_campaign_signal('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000022','UNSUBSCRIBE','completed-unsubscribe'),'COMPLETED unsubscribe rejected');
select pg_temp.assert_true(public.apply_email_campaign_signal('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000021','REPLY','active-reply'),'ACTIVE reply accepted');
select pg_temp.assert_true((select engagement_status='REPLIED' and replied_at is not null and stopped_reason='REPLY' from public.email_campaign_recipients where id='99000000-0000-4000-8000-000000000021'),'ACTIVE transitions to REPLIED');
select pg_temp.assert_true(public.apply_email_campaign_signal('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000022','REPLY','completed-reply'),'COMPLETED reply accepted');
select pg_temp.assert_true((select engagement_status='REPLIED' and replied_at is not null and stopped_reason='REPLY' from public.email_campaign_recipients where id='99000000-0000-4000-8000-000000000022'),'COMPLETED transitions to REPLIED');
select pg_temp.assert_true((select bool_and(status='SKIPPED_REPLY') from public.email_campaign_recipient_steps where recipient_id in('99000000-0000-4000-8000-000000000021','99000000-0000-4000-8000-000000000022')),'future PENDING steps cannot revive');
select pg_temp.assert_true(not public.apply_email_campaign_signal('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000022','REPLY','completed-reply'),'duplicate reply is idempotently rejected');
select pg_temp.assert_true((select count(*)=1 from public.email_campaign_signal_events where workspace_id='99000000-0000-4000-8000-000000000002' and signal_type='REPLY' and source_key='completed-reply'),'duplicate reply creates one signal event');
select pg_temp.assert_true((select count(*)=0 from public.email_suppressions where workspace_id='99000000-0000-4000-8000-000000000002'),'reply creates no suppression');

select 'LATE_REPLY_AUDIT_PASS' result,14 assertions;
rollback;
