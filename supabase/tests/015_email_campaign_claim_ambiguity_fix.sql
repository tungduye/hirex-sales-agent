-- ROLLBACK-SAFE validation for migration 015. Synthetic data only; no Gmail.
begin;

create or replace function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$begin if value is not true then raise exception '%',message;end if;end$$;

select pg_temp.assert_true(position('#variable_conflict use_column' in pg_get_functiondef('public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)'::regprocedure))>0,'column conflict directive missing');
select pg_temp.assert_true((select not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') from pg_proc p where p.oid='public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)'::regprocedure),'PUBLIC claim execute');
select pg_temp.assert_true(not has_function_privilege('anon','public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)','execute'),'anon claim execute');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)','execute'),'authenticated claim execute');
select pg_temp.assert_true(has_function_privilege('service_role','public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)','execute'),'service claim denied');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','95000000-0000-4000-8000-000000000001','authenticated','authenticated','campaign-015-fixture@example.test','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp());
insert into public.workspaces(id,name) values('95000000-0000-4000-8000-000000000002','Campaign 015 rollback fixture');
insert into public.profiles(id,workspace_id,full_name) values('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002','Campaign 015 Fixture');
insert into public.email_accounts(id,workspace_id,connected_by,provider,email_address,status,scopes)
values('95000000-0000-4000-8000-000000000003','95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000001','GMAIL','sender-015@example.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']);
insert into public.email_campaigns(id,workspace_id,name,status,subject_template,body_text_template,created_by)
values('95000000-0000-4000-8000-000000000010','95000000-0000-4000-8000-000000000002','Claim ambiguity fixture','DRAFT','Hello {{position}}','Body','95000000-0000-4000-8000-000000000001');
insert into public.email_campaign_senders(id,workspace_id,campaign_id,email_account_id,daily_cap,per_minute_cap)
values('95000000-0000-4000-8000-000000000011','95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000010','95000000-0000-4000-8000-000000000003',10,10);
insert into public.email_campaign_recipients(id,workspace_id,campaign_id,email,normalized_email,position,idempotency_key) values
('95000000-0000-4000-8000-000000000020','95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000010','claim-015@example.test','claim-015@example.test','Founder','95000000-0000-4000-8000-000000000030'),
('95000000-0000-4000-8000-000000000021','95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000010','blocked-015@example.test','blocked-015@example.test','CTO','95000000-0000-4000-8000-000000000031');
insert into public.email_suppressions(workspace_id,normalized_email,reason,source)
values('95000000-0000-4000-8000-000000000002','blocked-015@example.test','MANUAL','FIXTURE_015');
update public.email_campaigns set status='RUNNING',started_at=clock_timestamp() where id='95000000-0000-4000-8000-000000000010';

select pg_temp.assert_true((select count(*)=1 and bool_and(recipient_id='95000000-0000-4000-8000-000000000020' and recipient_position='Founder') from public.claim_email_campaign_recipients('95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000010','95000000-0000-4000-8000-000000000040',1)),'RUNNING campaign did not return one safe claim');
select pg_temp.assert_true((select status='SUPPRESSED' from public.email_campaign_recipients where id='95000000-0000-4000-8000-000000000021'),'suppression did not block recipient');
select pg_temp.assert_true((select count(*)=0 from public.claim_email_campaign_recipients('95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000010','95000000-0000-4000-8000-000000000041',1)),'same recipient claimed twice without stale lease');
select pg_temp.assert_true((select count(*)=2 and sum(sent_count)=2 from public.email_campaign_sender_usage where workspace_id='95000000-0000-4000-8000-000000000002'),'campaign quota was not reserved for day and minute');
select pg_temp.assert_true((select count(*)=2 and sum(reserved_count)=2 from public.email_sender_usage where workspace_id='95000000-0000-4000-8000-000000000002'),'global quota was not reserved for day and minute');

update public.email_campaign_recipients set claimed_at=clock_timestamp()-interval '16 minutes' where id='95000000-0000-4000-8000-000000000020';
select pg_temp.assert_true((select count(*)=1 and bool_and(recipient_id='95000000-0000-4000-8000-000000000020' and sender_email_account_id='95000000-0000-4000-8000-000000000003' and idempotency_key='95000000-0000-4000-8000-000000000030') from public.claim_email_campaign_recipients('95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000010','95000000-0000-4000-8000-000000000042',1)),'stale claim was not safely reclaimed');
select pg_temp.assert_true((select count(*)=2 and sum(sent_count)=2 from public.email_campaign_sender_usage where workspace_id='95000000-0000-4000-8000-000000000002'),'stale reclaim reserved campaign quota twice');
select pg_temp.assert_true((select count(*)=2 and sum(reserved_count)=2 from public.email_sender_usage where workspace_id='95000000-0000-4000-8000-000000000002'),'stale reclaim reserved global quota twice');

rollback;

select not exists(select 1 from auth.users where id='95000000-0000-4000-8000-000000000001') as fixture_user_removed,
  not exists(select 1 from public.workspaces where id='95000000-0000-4000-8000-000000000002') as fixture_workspace_removed,
  not exists(select 1 from public.email_campaigns where id='95000000-0000-4000-8000-000000000010') as fixture_campaign_removed;
