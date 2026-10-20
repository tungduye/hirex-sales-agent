-- Verifies migration 103 (reply/bounce candidates from sent threads, due campaigns with a connected sender). Never calls Gmail.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
select pg_temp.assert_true(not has_function_privilege('authenticated','public.find_email_campaign_reply_candidates(integer,uuid)','EXECUTE'),'members cannot read reply candidates');
insert into auth.users(id,email) values('99000000-0000-4000-8000-000000000301','c103@test.local');
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000000302','WS 103');
insert into public.workspace_roles(id,workspace_id,name) values('99000000-0000-4000-8000-000000000305','99000000-0000-4000-8000-000000000302','Role 103');
insert into public.profiles(id,workspace_id,full_name,role_id) values('99000000-0000-4000-8000-000000000301','99000000-0000-4000-8000-000000000302','Owner 103','99000000-0000-4000-8000-000000000305');
insert into public.email_accounts(id,workspace_id,connected_by,provider,email_address,status,scopes) values
  ('99000000-0000-4000-8000-000000000303','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000301','GMAIL','sender103@example.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']),
  ('99000000-0000-4000-8000-000000000304','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000301','GMAIL','broken103@example.test','REAUTH_REQUIRED',array['https://www.googleapis.com/auth/gmail.send']);
insert into public.email_campaigns(id,workspace_id,name,status,subject_template,body_text_template,created_by,sequence_enabled) values
  ('99000000-0000-4000-8000-000000000310','99000000-0000-4000-8000-000000000302','Ok','DRAFT','S','B','99000000-0000-4000-8000-000000000301',true),('99000000-0000-4000-8000-000000000340','99000000-0000-4000-8000-000000000302','Broken','DRAFT','S','B','99000000-0000-4000-8000-000000000301',true);
insert into public.email_campaign_steps(id,workspace_id,campaign_id,step_order,step_type,delay_minutes,subject_template,body_text_template) values
  ('99000000-0000-4000-8000-000000000311','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000310',0,'INITIAL',0,'S','B'),('99000000-0000-4000-8000-000000000341','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000340',0,'INITIAL',0,'S','B');
insert into public.email_campaign_senders(id,workspace_id,campaign_id,email_account_id,daily_cap,per_minute_cap) values
  ('99000000-0000-4000-8000-000000000312','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000310','99000000-0000-4000-8000-000000000303',50,5),('99000000-0000-4000-8000-000000000342','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000340','99000000-0000-4000-8000-000000000304',50,5);
insert into public.email_campaign_recipients(id,workspace_id,campaign_id,email,normalized_email,idempotency_key) values
  ('99000000-0000-4000-8000-000000000321','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000310','a@example.test','a@example.test','99000000-0000-4000-8000-000000000331'),
  ('99000000-0000-4000-8000-000000000322','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000310','b@example.test','b@example.test','99000000-0000-4000-8000-000000000332'),
  ('99000000-0000-4000-8000-000000000323','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000310','c@example.test','c@example.test','99000000-0000-4000-8000-000000000333');
update public.email_campaigns set status='RUNNING',started_at=clock_timestamp() where id in ('99000000-0000-4000-8000-000000000310','99000000-0000-4000-8000-000000000340');
select public.initialize_email_campaign_sequence('99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000310');
update public.email_campaign_recipient_steps set status='SENT',sender_email_account_id='99000000-0000-4000-8000-000000000303',sent_at='2026-10-01T08:00:00Z',
  provider_thread_id='thr-'||right(recipient_id::text,2) where campaign_id='99000000-0000-4000-8000-000000000310';
insert into public.email_threads(id,workspace_id,email_account_id,provider,provider_thread_id) values
  ('99000000-0000-4000-8000-000000000351','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000303','GMAIL','thr-21'),('99000000-0000-4000-8000-000000000352','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000303','GMAIL','thr-22'),('99000000-0000-4000-8000-000000000353','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000303','GMAIL','thr-99');
insert into public.email_messages(id,workspace_id,email_account_id,email_thread_id,provider,provider_message_id,direction,from_email,received_at,auto_submitted,dsn_report_type,dsn_status,dsn_action,dsn_final_recipient,is_mailer_daemon) values
  ('99000000-0000-4000-8000-000000000361','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000303','99000000-0000-4000-8000-000000000351','GMAIL','m61','INBOUND','A@Example.test','2026-10-02T08:00:00Z',null,null,null,null,null,false),
  ('99000000-0000-4000-8000-000000000362','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000303','99000000-0000-4000-8000-000000000352','GMAIL','m62','INBOUND','b@example.test','2026-10-02T08:00:00Z','auto-replied',null,null,null,null,false),
  ('99000000-0000-4000-8000-000000000363','99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000303','99000000-0000-4000-8000-000000000353','GMAIL','m63','INBOUND','mailer-daemon@googlemail.com','2026-10-02T08:00:00Z','auto-replied','delivery-status','5.1.1','failed','rfc822; c@example.test',true);
select pg_temp.assert_true((select array_agg(recipient_id)='{99000000-0000-4000-8000-000000000321}'::uuid[] from public.find_email_campaign_reply_candidates(100,null)),'a reply in the sent thread is found; an auto-reply is not');
select pg_temp.assert_true((select count(*)=1 and bool_and(recipient_id='99000000-0000-4000-8000-000000000323' and normalized_email='c@example.test') from public.find_email_campaign_bounce_candidates(100,365)),'a delivery failure for a sent recipient is found');
select pg_temp.assert_true(public.apply_email_campaign_signal('99000000-0000-4000-8000-000000000302','99000000-0000-4000-8000-000000000321','REPLY','message:99000000-0000-4000-8000-000000000361','99000000-0000-4000-8000-000000000361',null),'reply applied');
select pg_temp.assert_true((select count(*)=0 from public.find_email_campaign_reply_candidates(100,null)),'an applied reply is not found again');
update public.email_campaigns set pacing_next_at=null where id in ('99000000-0000-4000-8000-000000000310','99000000-0000-4000-8000-000000000340');
select pg_temp.assert_true((select array_agg(id)='{99000000-0000-4000-8000-000000000310}'::uuid[] from public.list_due_email_sequence_campaigns(100) where workspace_id='99000000-0000-4000-8000-000000000302'),'only campaigns with a connected sender are due');
update public.email_campaigns set pacing_next_at=clock_timestamp()+interval '1 hour' where id='99000000-0000-4000-8000-000000000310';
select pg_temp.assert_true((select count(*)=0 from public.list_due_email_sequence_campaigns(100) where workspace_id='99000000-0000-4000-8000-000000000302'),'a campaign waiting for its next slot is not due');
rollback;
