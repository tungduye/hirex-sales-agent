-- ROLLBACK-SAFE structural/security validation. Run only after migration 014.
begin;
create temporary table __campaign_test_temp_init (
  id integer
) on commit drop;
create or replace function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$begin if value is not true then raise exception '%',message;end if;end$$;
create or replace function pg_temp.assert_raises(statement text,message text) returns void language plpgsql as $$begin begin execute statement;exception when others then return;end;raise exception '%',message;end$$;
select pg_temp.assert_true(to_regclass(name) is not null,name||' missing') from unnest(array['public.email_campaigns','public.email_campaign_senders','public.email_campaign_recipients','public.email_campaign_sender_usage','public.email_suppressions','public.email_campaign_events','public.email_sender_limits','public.email_sender_usage']) name;
select pg_temp.assert_true(exists(select 1 from pg_catalog.pg_constraint where conrelid='public.email_send_requests'::regclass and conname='email_send_requests_id_workspace_key' and contype='u' and regexp_replace(pg_catalog.pg_get_constraintdef(oid),'[[:space:]]+','','g')='UNIQUE(id,workspace_id)'),'send request workspace unique missing or malformed');
select pg_temp.assert_true(exists(select 1 from pg_catalog.pg_constraint where conrelid='public.email_campaign_recipients'::regclass and confrelid='public.email_send_requests'::regclass and contype='f' and pg_catalog.pg_get_constraintdef(oid) ~ '^FOREIGN KEY \(send_request_id, workspace_id\) REFERENCES (public\.)?email_send_requests\(id, workspace_id\) ON DELETE RESTRICT$'),'recipient send request composite FK missing or malformed');
select pg_temp.assert_true(c.relrowsecurity,c.relname||' RLS disabled') from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('email_campaigns','email_campaign_senders','email_campaign_recipients','email_campaign_sender_usage','email_suppressions','email_campaign_events','email_sender_limits','email_sender_usage');
select pg_temp.assert_true((select not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') from pg_proc p where p.oid='public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)'::regprocedure),'PUBLIC claim execute');
select pg_temp.assert_true(not has_function_privilege('anon','public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)','execute'),'anon claim execute');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)','execute'),'authenticated claim execute');
select pg_temp.assert_true(has_function_privilege('service_role','public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)','execute'),'service claim denied');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.finalize_email_campaign_recipient(uuid,uuid,uuid,text,uuid,text)','execute'),'authenticated finalize execute');
select pg_temp.assert_true(has_function_privilege('service_role','public.finalize_email_campaign_recipient(uuid,uuid,uuid,text,uuid,text)','execute'),'service finalize denied');
select pg_temp.assert_true((select not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') from pg_proc p where p.oid='public.finalize_email_campaign_recipient(uuid,uuid,uuid,text,uuid,text)'::regprocedure),'PUBLIC finalize execute');
select pg_temp.assert_true(not has_function_privilege('anon','public.finalize_email_campaign_recipient(uuid,uuid,uuid,text,uuid,text)','execute'),'anon finalize execute');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.complete_email_campaign_if_idle(uuid,uuid)','execute'),'authenticated complete execute');
select pg_temp.assert_true(has_function_privilege('service_role','public.complete_email_campaign_if_idle(uuid,uuid)','execute'),'service complete denied');
select pg_temp.assert_true((select not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') from pg_proc p where p.oid='public.complete_email_campaign_if_idle(uuid,uuid)'::regprocedure),'PUBLIC complete execute');
select pg_temp.assert_true(not has_function_privilege('anon','public.complete_email_campaign_if_idle(uuid,uuid)','execute'),'anon complete execute');
select pg_temp.assert_true(position('FOR UPDATE SKIP LOCKED' in upper(pg_get_functiondef('public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)'::regprocedure)))>0,'claim lacks skip locked');
select pg_temp.assert_true(position('UTC_DAY' in pg_get_functiondef('public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)'::regprocedure))>0,'daily quota missing');
select pg_temp.assert_true(position('UTC_MINUTE' in pg_get_functiondef('public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)'::regprocedure))>0,'minute quota missing');
select pg_temp.assert_true(position('email_sender_usage' in pg_get_functiondef('public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)'::regprocedure))>0,'global usage missing');
select pg_temp.assert_true(position('email_sender_limits' in pg_get_functiondef('public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)'::regprocedure))>0,'global limits missing');
select pg_temp.assert_true(position('gmail.send' in pg_get_functiondef('public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)'::regprocedure))>0,'send scope missing');
select pg_temp.assert_true(exists(select 1 from pg_catalog.pg_constraint where conrelid='public.email_campaign_recipients'::regclass and contype='u' and pg_get_constraintdef(oid) ilike '%campaign_id%normalized_email%'),'recipient dedupe missing');
select pg_temp.assert_true(exists(select 1 from pg_catalog.pg_constraint where conrelid='public.email_suppressions'::regclass and contype='u' and pg_get_constraintdef(oid) ilike '%workspace_id%normalized_email%'),'suppression unique missing');
select pg_temp.assert_true(exists(select 1 from pg_catalog.pg_constraint where conrelid='public.email_campaign_recipients'::regclass and contype='u' and pg_get_constraintdef(oid) ilike '%idempotency_key%'),'stable idempotency unique missing');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','94000000-0000-4000-8000-000000000001','authenticated','authenticated','campaign-fixture@example.test','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp());
insert into public.workspaces(id,name) values('94000000-0000-4000-8000-000000000002','Campaign rollback fixture');
insert into public.profiles(id,workspace_id,full_name) values('94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002','Campaign Fixture');
insert into public.email_accounts(id,workspace_id,connected_by,provider,email_address,status,scopes) values
('94000000-0000-4000-8000-000000000003','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','GMAIL','sender1@example.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']),
('94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','GMAIL','sender2@example.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']),
('94000000-0000-4000-8000-000000000005','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','GMAIL','disconnected@example.test','DISCONNECTED',array['https://www.googleapis.com/auth/gmail.send']),
('94000000-0000-4000-8000-000000000006','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','GMAIL','no-scope@example.test','CONNECTED','{}'),
('94000000-0000-4000-8000-000000000007','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','GMAIL','reclaim-only@example.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']);
insert into public.email_campaigns(id,workspace_id,name,status,subject_template,body_text_template,created_by) values
('94000000-0000-4000-8000-000000000010','94000000-0000-4000-8000-000000000002','Fixture campaign','DRAFT','Hello {{name}}','Body','94000000-0000-4000-8000-000000000001'),
('94000000-0000-4000-8000-000000000014','94000000-0000-4000-8000-000000000002','Second campaign','DRAFT','Hello','Body','94000000-0000-4000-8000-000000000001'),
('94000000-0000-4000-8000-000000000015','94000000-0000-4000-8000-000000000002','Scheduled campaign','DRAFT','Hello','Body','94000000-0000-4000-8000-000000000001'),
('94000000-0000-4000-8000-000000000016','94000000-0000-4000-8000-000000000002','Disconnected sender','DRAFT','Hello','Body','94000000-0000-4000-8000-000000000001'),
('94000000-0000-4000-8000-000000000017','94000000-0000-4000-8000-000000000002','Missing scope sender','DRAFT','Hello','Body','94000000-0000-4000-8000-000000000001'),
('94000000-0000-4000-8000-000000000018','94000000-0000-4000-8000-000000000002','Disabled sender','DRAFT','Hello','Body','94000000-0000-4000-8000-000000000001'),
('94000000-0000-4000-8000-000000000019','94000000-0000-4000-8000-000000000002','Isolated stale reclaim','DRAFT','Hello','Body','94000000-0000-4000-8000-000000000001'),
('94000000-0000-4000-8000-000000000090','94000000-0000-4000-8000-000000000002','Isolated idle completion','DRAFT','Hello','Body','94000000-0000-4000-8000-000000000001');
insert into public.email_campaign_senders(id,workspace_id,campaign_id,email_account_id,daily_cap,per_minute_cap) values
('94000000-0000-4000-8000-000000000011','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','94000000-0000-4000-8000-000000000003',1,1),
('94000000-0000-4000-8000-000000000012','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','94000000-0000-4000-8000-000000000004',1,1),
('94000000-0000-4000-8000-000000000013','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000014','94000000-0000-4000-8000-000000000003',5,5),
('94000000-0000-4000-8000-000000000060','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000016','94000000-0000-4000-8000-000000000005',5,5),
('94000000-0000-4000-8000-000000000061','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000017','94000000-0000-4000-8000-000000000006',5,5),
('94000000-0000-4000-8000-000000000062','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000018','94000000-0000-4000-8000-000000000004',5,5),
('94000000-0000-4000-8000-000000000063','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000019','94000000-0000-4000-8000-000000000007',5,5),
('94000000-0000-4000-8000-000000000091','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000090','94000000-0000-4000-8000-000000000007',5,5);
update public.email_campaign_senders set enabled=false where id='94000000-0000-4000-8000-000000000062';
insert into public.email_campaign_recipients(id,workspace_id,campaign_id,email,normalized_email,idempotency_key) values
('94000000-0000-4000-8000-000000000020','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','one@example.test','one@example.test','94000000-0000-4000-8000-000000000030'),
('94000000-0000-4000-8000-000000000021','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','two@example.test','two@example.test','94000000-0000-4000-8000-000000000031'),
('94000000-0000-4000-8000-000000000022','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','blocked@example.test','blocked@example.test','94000000-0000-4000-8000-000000000032'),
('94000000-0000-4000-8000-000000000023','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000014','cross@example.test','cross@example.test','94000000-0000-4000-8000-000000000033'),
('94000000-0000-4000-8000-000000000024','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000016','disconnected-target@example.test','disconnected-target@example.test','94000000-0000-4000-8000-000000000034'),
('94000000-0000-4000-8000-000000000025','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000017','no-scope-target@example.test','no-scope-target@example.test','94000000-0000-4000-8000-000000000035'),
('94000000-0000-4000-8000-000000000026','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000018','disabled-target@example.test','disabled-target@example.test','94000000-0000-4000-8000-000000000036'),
('94000000-0000-4000-8000-000000000027','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','unknown@example.test','unknown@example.test','94000000-0000-4000-8000-000000000037'),
('94000000-0000-4000-8000-000000000028','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','reply-shape@example.test','reply-shape@example.test','94000000-0000-4000-8000-000000000038'),
('94000000-0000-4000-8000-000000000029','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000019','reclaim-only@example.test','reclaim-only@example.test','94000000-0000-4000-8000-000000000039'),
('94000000-0000-4000-8000-000000000092','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000090','complete-only@example.test','complete-only@example.test','94000000-0000-4000-8000-000000000093');
insert into public.email_suppressions(workspace_id,normalized_email,reason,source) values
('94000000-0000-4000-8000-000000000002','blocked@example.test','MANUAL','FIXTURE'),
('94000000-0000-4000-8000-000000000002','complete-only@example.test','MANUAL','FIXTURE_COMPLETION');
select pg_temp.assert_true((select count(*)=0 from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','94000000-0000-4000-8000-000000000040',1)),'DRAFT cannot claim');
update public.email_campaigns set status='SCHEDULED',scheduled_at=clock_timestamp()+interval '1 day' where id='94000000-0000-4000-8000-000000000015';
select pg_temp.assert_true((select count(*)=0 from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000015','94000000-0000-4000-8000-000000000049',1)),'SCHEDULED cannot claim');
update public.email_campaigns set status='CANCELLED',cancelled_at=clock_timestamp() where id='94000000-0000-4000-8000-000000000015';
select pg_temp.assert_true((select count(*)=0 from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000015','94000000-0000-4000-8000-000000000049',1)),'CANCELLED cannot claim');
update public.email_campaigns set status='RUNNING',started_at=clock_timestamp() where id in ('94000000-0000-4000-8000-000000000016','94000000-0000-4000-8000-000000000017','94000000-0000-4000-8000-000000000018');
select pg_temp.assert_true((select count(*)=0 from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000016','94000000-0000-4000-8000-000000000070',1)),'disconnected Gmail sender blocked');
select pg_temp.assert_true((select count(*)=0 from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000017','94000000-0000-4000-8000-000000000071',1)),'missing gmail.send blocked');
select pg_temp.assert_true((select count(*)=0 from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000018','94000000-0000-4000-8000-000000000072',1)),'disabled campaign sender blocked');
update public.email_campaigns set status='RUNNING',started_at=clock_timestamp() where id='94000000-0000-4000-8000-000000000010';
select pg_temp.assert_raises($sql$insert into public.email_campaign_recipients(workspace_id,campaign_id,email,normalized_email) values('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','late@example.test','late@example.test')$sql$,'audience mutation outside DRAFT accepted');
select pg_temp.assert_raises($sql$update public.email_campaign_senders set daily_cap=99 where id='94000000-0000-4000-8000-000000000011'$sql$,'sender mutation outside DRAFT accepted');
select pg_temp.assert_true((select count(*)=1 from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','94000000-0000-4000-8000-000000000040',1)),'RUNNING claims one');
select pg_temp.assert_true((select count(*)=1 from public.email_campaign_recipients where id='94000000-0000-4000-8000-000000000020' and status='SENDING'),'first recipient claimed once');
select pg_temp.assert_true((select status='SUPPRESSED' from public.email_campaign_recipients where id='94000000-0000-4000-8000-000000000022'),'suppressed recipient never claimed');
select pg_temp.assert_true((select sum(reserved_count)=2 from public.email_sender_usage where workspace_id='94000000-0000-4000-8000-000000000002'),'global day and minute reserved');

update public.email_campaigns set status='RUNNING',started_at=clock_timestamp() where id='94000000-0000-4000-8000-000000000019';
select pg_temp.assert_true((select count(*)=1 and bool_and(recipient_id='94000000-0000-4000-8000-000000000029' and sender_email_account_id='94000000-0000-4000-8000-000000000007' and idempotency_key='94000000-0000-4000-8000-000000000039' and claim_token='94000000-0000-4000-8000-000000000080') from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000019','94000000-0000-4000-8000-000000000080',1)),'isolated recipient initial claim failed');
create temporary table pg_temp.stale_reclaim_snapshot on commit drop as
select r.id as recipient_id,r.sender_email_account_id,r.idempotency_key,
  (select coalesce(sum(u.sent_count),0) from public.email_campaign_sender_usage u where u.campaign_sender_id='94000000-0000-4000-8000-000000000063') as campaign_reserved,
  (select coalesce(sum(u.reserved_count),0) from public.email_sender_usage u where u.workspace_id='94000000-0000-4000-8000-000000000002' and u.email_account_id='94000000-0000-4000-8000-000000000007') as global_reserved
from public.email_campaign_recipients r where r.id='94000000-0000-4000-8000-000000000029';
select pg_temp.assert_true((select campaign_reserved=2 and global_reserved=2 from pg_temp.stale_reclaim_snapshot),'isolated initial quota reservation incorrect');
update public.email_campaign_recipients set claimed_at=clock_timestamp()-interval '16 minutes' where id='94000000-0000-4000-8000-000000000029' and send_request_id is null;
select pg_temp.assert_true((select count(*)=1 and bool_and(recipient_id='94000000-0000-4000-8000-000000000029' and sender_email_account_id='94000000-0000-4000-8000-000000000007' and idempotency_key='94000000-0000-4000-8000-000000000039' and claim_token='94000000-0000-4000-8000-000000000081') from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000019','94000000-0000-4000-8000-000000000081',1)),'isolated stale reclaim changed stable evidence');
select pg_temp.assert_true((select r.send_request_id is null and r.claim_token='94000000-0000-4000-8000-000000000081' and s.campaign_reserved=(select coalesce(sum(u.sent_count),0) from public.email_campaign_sender_usage u where u.campaign_sender_id='94000000-0000-4000-8000-000000000063') and s.global_reserved=(select coalesce(sum(u.reserved_count),0) from public.email_sender_usage u where u.workspace_id='94000000-0000-4000-8000-000000000002' and u.email_account_id='94000000-0000-4000-8000-000000000007') from public.email_campaign_recipients r cross join pg_temp.stale_reclaim_snapshot s where r.id='94000000-0000-4000-8000-000000000029'),'isolated stale reclaim changed request state or quota reservations');
update public.email_sender_limits set daily_cap=1,per_minute_cap=1 where workspace_id='94000000-0000-4000-8000-000000000002' and email_account_id='94000000-0000-4000-8000-000000000003';
update public.email_campaigns set status='RUNNING',started_at=clock_timestamp() where id='94000000-0000-4000-8000-000000000014';
select pg_temp.assert_true((select count(*)=0 from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000014','94000000-0000-4000-8000-000000000048',1)),'global same-account quota blocks second campaign');
select pg_temp.assert_true(not public.complete_email_campaign_if_idle('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000014'),'non-idle RUNNING campaign completed');
select pg_temp.assert_true((select status='RUNNING' from public.email_campaigns where id='94000000-0000-4000-8000-000000000014'),'non-idle campaign did not remain RUNNING');
select pg_temp.assert_true(public.finalize_email_campaign_recipient('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000020','94000000-0000-4000-8000-000000000040','FAILED',null,'INVALID_SUBJECT'),'pre-send FAILED finalizes');
select pg_temp.assert_true((select count(*)=1 from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','94000000-0000-4000-8000-000000000042',1)),'second eligible sender selected after first cap');
insert into public.email_send_requests(id,workspace_id,email_account_id,send_type,status,reply_to_email_message_id,to_addresses,subject,body_text,idempotency_key,attempt_count,send_lock_id,send_lock_at,rfc_message_id)
values
('94000000-0000-4000-8000-000000000053','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000004','NEW','SENDING',null,array['unknown@example.test'],'Hello','Body','94000000-0000-4000-8000-000000000037',1,'94000000-0000-4000-8000-000000000073',clock_timestamp(),'<unknown@example.test>'),
('94000000-0000-4000-8000-000000000054','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000004','REPLY','SENDING','94000000-0000-4000-8000-000000000099',array['reply-shape@example.test'],'Re: Hello','Body','94000000-0000-4000-8000-000000000038',1,'94000000-0000-4000-8000-000000000074',clock_timestamp(),null);
update public.email_campaign_recipients set status='SENDING',sender_email_account_id='94000000-0000-4000-8000-000000000004',claim_token='94000000-0000-4000-8000-000000000075',claimed_at=clock_timestamp()-interval '16 minutes',send_request_id='94000000-0000-4000-8000-000000000053' where id='94000000-0000-4000-8000-000000000027';
update public.email_campaign_recipients set status='SENDING',sender_email_account_id='94000000-0000-4000-8000-000000000004',claim_token='94000000-0000-4000-8000-000000000076',claimed_at=clock_timestamp(),send_request_id='94000000-0000-4000-8000-000000000054' where id='94000000-0000-4000-8000-000000000028';
select pg_temp.assert_true((select count(*)=0 from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','94000000-0000-4000-8000-000000000077',1)),'stale SENDING with send request cannot reclaim');
select pg_temp.assert_true(not public.finalize_email_campaign_recipient('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000028','94000000-0000-4000-8000-000000000076','DELIVERY_UNKNOWN','94000000-0000-4000-8000-000000000054','DELIVERY_STATUS_UNKNOWN'),'non-NEW send request rejected');
select pg_temp.assert_true(public.finalize_email_campaign_recipient('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000027','94000000-0000-4000-8000-000000000075','DELIVERY_UNKNOWN','94000000-0000-4000-8000-000000000053','DELIVERY_STATUS_UNKNOWN'),'correct DELIVERY_UNKNOWN finalization');
select pg_temp.assert_true(public.finalize_email_campaign_recipient('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000028','94000000-0000-4000-8000-000000000076','FAILED',null,'INVALID_SUBJECT'),'non-NEW fixture safely closed as pre-send FAILED');
update public.email_campaigns set status='PAUSED',paused_at=clock_timestamp() where id='94000000-0000-4000-8000-000000000010';
select pg_temp.assert_true((select count(*)=0 from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000010','94000000-0000-4000-8000-000000000043',1)),'PAUSED cannot claim');
update public.email_campaigns set status='RUNNING',paused_at=null where id='94000000-0000-4000-8000-000000000010';
insert into public.email_send_requests(id,workspace_id,email_account_id,send_type,status,to_addresses,subject,body_text,idempotency_key,attempt_count,provider_message_id,provider_thread_id,rfc_message_id,sent_at)
values
('94000000-0000-4000-8000-000000000050','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000004','NEW','SENT',array['two@example.test'],'Hello','Body','94000000-0000-4000-8000-000000000031',1,'provider-message','provider-thread','<fixture@example.test>',clock_timestamp()),
('94000000-0000-4000-8000-000000000051','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000003','NEW','SENT',array['two@example.test'],'Hello','Body','94000000-0000-4000-8000-000000000031',1,'wrong-sender','wrong-sender-thread','<wrong-sender@example.test>',clock_timestamp()),
('94000000-0000-4000-8000-000000000052','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000004','NEW','SENT',array['two@example.test'],'Hello','Body','94000000-0000-4000-8000-000000000039',1,'wrong-key','wrong-key-thread','<wrong-key@example.test>',clock_timestamp());
select pg_temp.assert_true(not public.finalize_email_campaign_recipient('94000000-0000-4000-8000-000000000099','94000000-0000-4000-8000-000000000021','94000000-0000-4000-8000-000000000042','SENT','94000000-0000-4000-8000-000000000050',null),'finalizer rejects wrong workspace');
select pg_temp.assert_true(not public.finalize_email_campaign_recipient('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000021','94000000-0000-4000-8000-000000000099','SENT','94000000-0000-4000-8000-000000000050',null),'finalizer rejects wrong claim token');
select pg_temp.assert_true(not public.finalize_email_campaign_recipient('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000021','94000000-0000-4000-8000-000000000042','SENT','94000000-0000-4000-8000-000000000051',null),'finalizer rejects wrong sender request');
select pg_temp.assert_true(not public.finalize_email_campaign_recipient('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000021','94000000-0000-4000-8000-000000000042','SENT','94000000-0000-4000-8000-000000000052',null),'finalizer rejects wrong idempotency request');
select pg_temp.assert_true(public.finalize_email_campaign_recipient('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000021','94000000-0000-4000-8000-000000000042','SENT','94000000-0000-4000-8000-000000000050',null),'correct SENT finalization');
select pg_temp.assert_true((select status='COMPLETED' and completed_at is not null from public.email_campaigns where id='94000000-0000-4000-8000-000000000010'),'final recipient did not auto-complete campaign');
select pg_temp.assert_true((select count(*)=1 from public.email_campaign_events where workspace_id='94000000-0000-4000-8000-000000000002' and campaign_id='94000000-0000-4000-8000-000000000010' and event_type='CAMPAIGN_COMPLETED'),'auto-completion event count incorrect');

update public.email_campaigns set status='RUNNING',started_at=clock_timestamp() where id='94000000-0000-4000-8000-000000000090';
select pg_temp.assert_true((select count(*)=0 from public.claim_email_campaign_recipients('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000090','94000000-0000-4000-8000-000000000094',1)),'suppression-only campaign unexpectedly returned a claim');
select pg_temp.assert_true((select status='SUPPRESSED' from public.email_campaign_recipients where id='94000000-0000-4000-8000-000000000092'),'completion fixture recipient was not suppressed');
select pg_temp.assert_true((select status='RUNNING' from public.email_campaigns where id='94000000-0000-4000-8000-000000000090'),'claim unexpectedly auto-completed suppression-only campaign');
select pg_temp.assert_true((select count(*)=0 from public.email_campaign_recipients where campaign_id='94000000-0000-4000-8000-000000000090' and status in ('PENDING','SENDING')),'completion fixture is not idle');
select pg_temp.assert_true(public.complete_email_campaign_if_idle('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000090'),'idle RUNNING campaign did not complete');
select pg_temp.assert_true((select status='COMPLETED' and completed_at is not null from public.email_campaigns where id='94000000-0000-4000-8000-000000000090'),'completion RPC did not persist COMPLETED state');
select pg_temp.assert_true((select count(*)=1 from public.email_campaign_events where workspace_id='94000000-0000-4000-8000-000000000002' and campaign_id='94000000-0000-4000-8000-000000000090' and event_type='CAMPAIGN_COMPLETED'),'completion RPC event count incorrect');
select pg_temp.assert_true(not public.complete_email_campaign_if_idle('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000090'),'already COMPLETED campaign completed twice');
select pg_temp.assert_true((select count(*)=1 from public.email_campaign_events where workspace_id='94000000-0000-4000-8000-000000000002' and campaign_id='94000000-0000-4000-8000-000000000090' and event_type='CAMPAIGN_COMPLETED'),'repeated completion created duplicate event');
insert into public.email_suppressions(workspace_id,normalized_email,reason,source) values
('94000000-0000-4000-8000-000000000002','hard@example.test','HARD_BOUNCE','FIXTURE'),
('94000000-0000-4000-8000-000000000002','unsub@example.test','UNSUBSCRIBED','FIXTURE'),
('94000000-0000-4000-8000-000000000002','manual@example.test','MANUAL','FIXTURE');
update public.email_suppressions set reason='MANUAL',source='DOWNGRADE' where workspace_id='94000000-0000-4000-8000-000000000002' and normalized_email in ('hard@example.test','unsub@example.test');
update public.email_suppressions set reason='UNSUBSCRIBED',source='UPGRADE' where workspace_id='94000000-0000-4000-8000-000000000002' and normalized_email='manual@example.test';
select pg_temp.assert_true((select reason='HARD_BOUNCE' and source='FIXTURE' from public.email_suppressions where normalized_email='hard@example.test'),'HARD_BOUNCE cannot downgrade');
select pg_temp.assert_true((select reason='UNSUBSCRIBED' and source='FIXTURE' from public.email_suppressions where normalized_email='unsub@example.test'),'UNSUBSCRIBED cannot downgrade to MANUAL');
select pg_temp.assert_true((select reason='UNSUBSCRIBED' and source='UPGRADE' from public.email_suppressions where normalized_email='manual@example.test'),'MANUAL can upgrade to UNSUBSCRIBED');
rollback;
select not exists(select 1 from auth.users where id='94000000-0000-4000-8000-000000000001') as fixture_user_removed,
 not exists(select 1 from public.workspaces where id='94000000-0000-4000-8000-000000000002') as fixture_workspace_removed,
 not exists(select 1 from public.email_campaigns where id='94000000-0000-4000-8000-000000000010') as fixture_campaign_removed;
