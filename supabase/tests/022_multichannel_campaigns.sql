begin;
create temporary table __phase6_campaign_test_init(id integer) on commit drop;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;

select pg_temp.assert_true(to_regclass('public.channel_campaigns') is not null,'channel campaigns exists');
select pg_temp.assert_true(to_regclass('public.channel_campaign_steps') is not null,'campaign steps exists');
select pg_temp.assert_true(to_regclass('public.channel_campaign_recipients') is not null,'campaign recipients exists');
select pg_temp.assert_true(to_regclass('public.channel_campaign_recipient_steps') is not null,'recipient steps exists');
select pg_temp.assert_true((select relrowsecurity from pg_catalog.pg_class where oid='public.channel_campaigns'::regclass),'campaign RLS');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.channel_campaigns','insert'),'browser direct insert blocked');
select pg_temp.assert_true(has_function_privilege('authenticated','public.create_channel_campaign_draft(text)','execute'),'authenticated draft RPC allowed');
select pg_temp.assert_true(has_function_privilege('authenticated','public.start_channel_campaign(uuid)','execute'),'authenticated start RPC allowed');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.mark_channel_campaign_reply(uuid,uuid,uuid,uuid)','execute'),'authenticated reply signal blocked');
select pg_temp.assert_true(has_function_privilege('service_role','public.mark_channel_campaign_reply(uuid,uuid,uuid,uuid)','execute'),'service reply signal allowed');
select pg_temp.assert_true(exists(select 1 from pg_catalog.pg_constraint where conrelid='public.channel_campaign_recipients'::regclass and contype='c' and pg_get_constraintdef(oid) like '%REPLIED%'),'terminal recipient constraint exists');
select pg_temp.assert_true(exists(select 1 from pg_catalog.pg_indexes where schemaname='public' and tablename='channel_campaign_recipient_steps' and indexdef like '%idempotency_key%'),'campaign idempotency index exists');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.claim_channel_campaign_recipient_step(uuid,uuid,uuid)','execute'),'authenticated campaign claim blocked');
select pg_temp.assert_true(has_function_privilege('service_role','public.claim_channel_campaign_recipient_step(uuid,uuid,uuid)','execute'),'service campaign claim allowed');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.finalize_channel_campaign_recipient_step(uuid,uuid,uuid,uuid)','execute'),'authenticated campaign finalizer blocked');
select pg_temp.assert_true(has_function_privilege('service_role','public.finalize_channel_campaign_recipient_step(uuid,uuid,uuid,uuid)','execute'),'service campaign finalizer allowed');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','99000000-0000-4000-8000-000000000001','authenticated','authenticated','phase6@example.test','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp());
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000000002','Phase 6 SQL Test');
insert into public.profiles(id,workspace_id,full_name) values('99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','Phase 6');
insert into public.contacts(id,workspace_id,full_name) values('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000002','Recipient');
insert into public.contact_channels(id,workspace_id,contact_id,channel_type,channel_value,is_primary,marketing_consent_status,marketing_consent_source,marketing_consent_recorded_at) values('99000000-0000-4000-8000-000000000004','99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000003','FACEBOOK','recipient-page-id',true,'OPTED_IN','SYNTHETIC_TEST',now());
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,status,capabilities) values('99000000-0000-4000-8000-000000000005','99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000001','FACEBOOK','META_GRAPH','page-id','CONNECTED',array['SEND_TEXT']);
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,contact_id,last_message_at) values('99000000-0000-4000-8000-000000000013','99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000005','FACEBOOK','recipient-page-id','99000000-0000-4000-8000-000000000003',now());

set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(public.create_channel_campaign_draft('SQL Lifecycle') is not null,'authenticated draft creation works');
reset role;
-- Use deterministic rows for the remaining service lifecycle test.
insert into public.channel_campaigns(id,workspace_id,name,created_by) values('99000000-0000-4000-8000-000000000006','99000000-0000-4000-8000-000000000002','Deterministic Lifecycle','99000000-0000-4000-8000-000000000001');
insert into public.channel_campaign_steps(id,workspace_id,campaign_id,position,text_template,allowed_channels) values('99000000-0000-4000-8000-000000000007','99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000006',1,'Hello',array['FACEBOOK']);
insert into public.channel_campaign_senders(id,workspace_id,campaign_id,channel_account_id) values('99000000-0000-4000-8000-000000000008','99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000006','99000000-0000-4000-8000-000000000005');
insert into public.channel_campaign_recipients(id,workspace_id,campaign_id,contact_id) values('99000000-0000-4000-8000-000000000009','99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000006','99000000-0000-4000-8000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(public.start_channel_campaign('99000000-0000-4000-8000-000000000006'),'campaign starts');
reset role;
update public.contact_channels set marketing_consent_status='UNKNOWN',marketing_consent_source=null,marketing_consent_recorded_at=null where id='99000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*)=0 from public.claim_channel_campaign_recipient_step('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000006','99000000-0000-4000-8000-000000000012')),'unknown marketing consent blocks claim');
update public.contact_channels set marketing_consent_status='OPTED_IN',marketing_consent_source='SYNTHETIC_TEST',marketing_consent_recorded_at=now() where id='99000000-0000-4000-8000-000000000004';
update public.omnichannel_conversations set last_message_at=now()-interval '24 hours' where id='99000000-0000-4000-8000-000000000013';
select pg_temp.assert_true((select count(*)=0 from public.claim_channel_campaign_recipient_step('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000006','99000000-0000-4000-8000-000000000012')),'Facebook response-window expiry blocks claim');
update public.omnichannel_conversations set last_message_at=now() where id='99000000-0000-4000-8000-000000000013';
create temporary table claimed as select * from public.claim_channel_campaign_recipient_step('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000006','99000000-0000-4000-8000-000000000010');
select pg_temp.assert_true((select count(*)=1 from claimed),'one due step claimed');
select pg_temp.assert_true((select recipient_external_id='recipient-page-id' from claimed),'recipient channel selected');
select pg_temp.assert_true(public.materialize_channel_campaign_action('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000006','99000000-0000-4000-8000-000000000011','99000000-0000-4000-8000-000000000010') is null,'wrong recipient step cannot materialize');
select pg_temp.assert_true(public.materialize_channel_campaign_action('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000006',(select recipient_step_id from claimed),'99000000-0000-4000-8000-000000000010') is not null,'claimed step materializes once');
select pg_temp.assert_true((select count(*)=1 from public.channel_outbound_actions where workspace_id='99000000-0000-4000-8000-000000000002'),'exactly one outbound action');
update public.channel_outbound_actions set status='SENT',provider_message_id='provider-message',provider_conversation_id='provider-thread',accepted_at=clock_timestamp() where workspace_id='99000000-0000-4000-8000-000000000002';
select pg_temp.assert_true(public.finalize_channel_campaign_recipient_step('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000006',(select recipient_step_id from claimed),(select id from public.channel_outbound_actions where workspace_id='99000000-0000-4000-8000-000000000002')),'sent action finalizes campaign step');
select pg_temp.assert_true((select status='SENT' from public.channel_campaign_recipient_steps where id=(select recipient_step_id from claimed)),'recipient step sent');
select pg_temp.assert_true((select status='COMPLETED' from public.channel_campaign_recipients where id='99000000-0000-4000-8000-000000000009'),'final recipient completes');
select pg_temp.assert_true(public.finalize_channel_campaign_recipient_step('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000006',(select recipient_step_id from claimed),(select id from public.channel_outbound_actions where workspace_id='99000000-0000-4000-8000-000000000002')),'repeated finalization idempotent');

rollback;
