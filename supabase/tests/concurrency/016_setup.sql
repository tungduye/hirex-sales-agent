-- ISOLATED/REVIEWED DATABASE ONLY. Synthetic DB rows; never calls Gmail.
begin;
do $$begin if exists(select 1 from public.workspaces where id='97000000-0000-4000-8000-000000000002') then raise exception 'Phase 4C fixture collision';end if;end$$;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000','97000000-0000-4000-8000-000000000001','authenticated','authenticated','phase4c-concurrency@example.test','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp());
insert into public.workspaces(id,name) values('97000000-0000-4000-8000-000000000002','Phase 4C concurrency fixture');
insert into public.profiles(id,workspace_id,full_name) values('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000002','Phase 4C Fixture');
insert into public.email_accounts(id,workspace_id,connected_by,provider,email_address,status,scopes) values('97000000-0000-4000-8000-000000000003','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000001','GMAIL','phase4c-sender@example.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']);
insert into public.email_sender_limits(workspace_id,email_account_id,daily_cap,per_minute_cap) values('97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000003',1,1);
insert into public.email_campaigns(id,workspace_id,name,status,subject_template,body_text_template,created_by,sequence_enabled) values
('97000000-0000-4000-8000-000000000010','97000000-0000-4000-8000-000000000002','Same step','DRAFT','Initial','Body','97000000-0000-4000-8000-000000000001',true),
('97000000-0000-4000-8000-000000000020','97000000-0000-4000-8000-000000000002','Quota A','DRAFT','Initial','Body','97000000-0000-4000-8000-000000000001',true),
('97000000-0000-4000-8000-000000000030','97000000-0000-4000-8000-000000000002','Quota B','DRAFT','Initial','Body','97000000-0000-4000-8000-000000000001',true),
('97000000-0000-4000-8000-000000000040','97000000-0000-4000-8000-000000000002','Nonreclaim','DRAFT','Initial','Body','97000000-0000-4000-8000-000000000001',true),
('97000000-0000-4000-8000-000000000050','97000000-0000-4000-8000-000000000002','Reply race','DRAFT','Initial','Body','97000000-0000-4000-8000-000000000001',true);
insert into public.email_campaign_senders(id,workspace_id,campaign_id,email_account_id,daily_cap,per_minute_cap) select gen_random_uuid(),'97000000-0000-4000-8000-000000000002',id,'97000000-0000-4000-8000-000000000003',10,10 from public.email_campaigns where workspace_id='97000000-0000-4000-8000-000000000002';
insert into public.email_campaign_steps(id,workspace_id,campaign_id,step_order,step_type,delay_minutes,subject_template,body_text_template) values
('97000000-0000-4000-8000-000000000011','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000010',0,'INITIAL',0,'Initial','Body'),
('97000000-0000-4000-8000-000000000021','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000020',0,'INITIAL',0,'Initial','Body'),
('97000000-0000-4000-8000-000000000031','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000030',0,'INITIAL',0,'Initial','Body'),
('97000000-0000-4000-8000-000000000041','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000040',0,'INITIAL',0,'Initial','Body'),
('97000000-0000-4000-8000-000000000051','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000050',0,'INITIAL',0,'Initial','Body'),
('97000000-0000-4000-8000-000000000052','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000050',1,'FOLLOW_UP',1,'Follow up','Body');
insert into public.email_campaign_recipients(id,workspace_id,campaign_id,email,normalized_email,idempotency_key) values
('97000000-0000-4000-8000-000000000015','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000010','same@example.test','same@example.test','97000000-0000-4000-8000-000000000071'),
('97000000-0000-4000-8000-000000000025','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000020','quota-a@example.test','quota-a@example.test','97000000-0000-4000-8000-000000000072'),
('97000000-0000-4000-8000-000000000035','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000030','quota-b@example.test','quota-b@example.test','97000000-0000-4000-8000-000000000073'),
('97000000-0000-4000-8000-000000000045','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000040','locked@example.test','locked@example.test','97000000-0000-4000-8000-000000000074'),
('97000000-0000-4000-8000-000000000055','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000050','reply@example.test','reply@example.test','97000000-0000-4000-8000-000000000075');
update public.email_campaigns set status='RUNNING',started_at=clock_timestamp() where workspace_id='97000000-0000-4000-8000-000000000002';
select public.initialize_email_campaign_sequence('97000000-0000-4000-8000-000000000002',id) from public.email_campaigns where workspace_id='97000000-0000-4000-8000-000000000002';
update public.email_campaign_recipient_steps set id='97000000-0000-4000-8000-000000000061' where recipient_id='97000000-0000-4000-8000-000000000015';
-- Dedicated non-reclaimable in-flight row with a synthetic send request.
update public.email_campaign_recipient_steps set status='SENDING',sender_email_account_id='97000000-0000-4000-8000-000000000003',claim_token='97000000-0000-4000-8000-000000000088',claimed_at=clock_timestamp()-interval '16 minutes' where recipient_id='97000000-0000-4000-8000-000000000045';
insert into public.email_send_requests(id,workspace_id,email_account_id,send_type,status,to_addresses,subject,body_text,idempotency_key,attempt_count,send_lock_id,send_lock_at,rfc_message_id) select '97000000-0000-4000-8000-000000000089',workspace_id,sender_email_account_id,'NEW','SENDING',array['locked@example.test'],'Initial','Body',idempotency_key,1,'97000000-0000-4000-8000-000000000090',clock_timestamp(),'<fixture@example.test>' from public.email_campaign_recipient_steps where recipient_id='97000000-0000-4000-8000-000000000045';
update public.email_campaign_recipient_steps set send_request_id='97000000-0000-4000-8000-000000000089' where recipient_id='97000000-0000-4000-8000-000000000045';
commit;
select 'SETUP_PASS' status,'97000000-0000-4000-8000-000000000002' workspace_id,'97000000-0000-4000-8000-000000000003' sender_account_id;
