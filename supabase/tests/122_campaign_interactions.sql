-- Verifies migration 122 (campaign interactions for Soda): per-reply rows, per-nick progress, AI reading queue.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.fails(text) to authenticated;
insert into auth.users(id,email) values('99000000-0000-4000-8000-000000002201','a122@test.local');
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000002202','WS 122');
insert into public.workspace_roles(id,workspace_id,name) values('99000000-0000-4000-8000-000000002203','99000000-0000-4000-8000-000000002202','Role 122');
insert into public.profiles(id,workspace_id,full_name,role_id) values('99000000-0000-4000-8000-000000002201','99000000-0000-4000-8000-000000002202','A','99000000-0000-4000-8000-000000002203');
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('99000000-0000-4000-8000-000000002210','99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002201','ZALO','ZALO_BRIDGE','nick-122','Xuân Ly','CONNECTED');
insert into public.contacts(id,workspace_id,full_name) values
  ('99000000-0000-4000-8000-000000002221','99000000-0000-4000-8000-000000002202','UV Một'),
  ('99000000-0000-4000-8000-000000002222','99000000-0000-4000-8000-000000002202','UV Hai'),
  ('99000000-0000-4000-8000-000000002223','99000000-0000-4000-8000-000000002202','UV Ba');
insert into public.channel_campaigns(id,workspace_id,name,created_by,status,started_at,owner_name) values
  ('99000000-0000-4000-8000-000000002230','99000000-0000-4000-8000-000000002202','MKT (Tuấn Rec)','99000000-0000-4000-8000-000000002201','RUNNING',now() - interval '5 days','204');
insert into public.channel_campaign_steps(id,workspace_id,campaign_id,position,text_template,allowed_channels) values
  ('99000000-0000-4000-8000-000000002231','99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002230',1,'Chào anh',array['ZALO']);
insert into public.channel_campaign_senders(workspace_id,campaign_id,channel_account_id) values
  ('99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002230','99000000-0000-4000-8000-000000002210');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,contact_id,status,takeover_mode,metadata) values
  ('99000000-0000-4000-8000-000000002240','99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002210','ZALO','p-1','99000000-0000-4000-8000-000000002221','OPEN','BOT_ALLOWED','{"participantDisplayName":"Minh BrSE"}');
insert into public.omnichannel_messages(id,workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,attachment_count,received_at,sent_at,created_at,metadata) values
  ('99000000-0000-4000-8000-000000002250','99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002240','99000000-0000-4000-8000-000000002210','ZALO','m-0','OUTBOUND','nick-122','Chào anh',0,null,now() - interval '3 days',now() - interval '3 days','{}'),
  ('99000000-0000-4000-8000-000000002251','99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002240','99000000-0000-4000-8000-000000002210','ZALO','m-1','INBOUND','p-1','Job này lương bao nhiêu em?',0,now() - interval '2 days',null,now() - interval '2 days','{}'),
  ('99000000-0000-4000-8000-000000002252','99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002240','99000000-0000-4000-8000-000000002210','ZALO','m-2','OUTBOUND','nick-122','Dạ 2.000$ anh ạ',0,null,now() - interval '1 day',now() - interval '1 day','{}'),
  ('99000000-0000-4000-8000-000000002253','99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002240','99000000-0000-4000-8000-000000002210','ZALO','m-3','INBOUND','p-1',null,1,now() - interval '20 hours',null,now() - interval '20 hours','{"attachments":[{"filename":"Minh_CV.pdf","contentType":"application/pdf"}]}');
insert into public.channel_campaign_recipients(id,workspace_id,campaign_id,contact_id,status,stop_reason,replied_at,source_message_id) values
  ('99000000-0000-4000-8000-000000002260','99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002230','99000000-0000-4000-8000-000000002221','REPLIED','REPLIED',now() - interval '2 days','99000000-0000-4000-8000-000000002251');
insert into public.channel_campaign_recipients(id,workspace_id,campaign_id,contact_id) values
  ('99000000-0000-4000-8000-000000002261','99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002230','99000000-0000-4000-8000-000000002222'),
  ('99000000-0000-4000-8000-000000002262','99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002230','99000000-0000-4000-8000-000000002223');
insert into public.channel_campaign_recipient_steps(workspace_id,campaign_id,recipient_id,step_id,channel_account_id,channel_type,status,idempotency_key,completed_at) values
  ('99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002230','99000000-0000-4000-8000-000000002260','99000000-0000-4000-8000-000000002231','99000000-0000-4000-8000-000000002210','ZALO','SENT','k122-1',now() - interval '3 days'),
  ('99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002230','99000000-0000-4000-8000-000000002261','99000000-0000-4000-8000-000000002231','99000000-0000-4000-8000-000000002210','ZALO','SENT','k122-2',now() - interval '2 hours');
insert into public.candidate_flow_states(workspace_id,contact_id,step,outcome) values('99000000-0000-4000-8000-000000002202','99000000-0000-4000-8000-000000002221',8,'CV_RECEIVED');

create temp table rows122 as select * from public.campaign_interaction_rows('99000000-0000-4000-8000-000000002202', null, null);
select pg_temp.assert_true((select count(*) = 1 from rows122),'one row per candidate who replied');
select pg_temp.assert_true((select owner_name = '204' and candidate_name = 'Minh BrSE' and first_reply like 'Job này%' from rows122),'owner, name on Zalo, first reply');
select pg_temp.assert_true((select owner_messages = 1 and owner_replied_at is not null from rows122),'the nick answered after the reply');
select pg_temp.assert_true((select inbound_messages = 2 and cv_file = 'Minh_CV.pdf' from rows122),'candidate messages counted, PDF seen as CV');
select pg_temp.assert_true((select rec_outcome = 'CV_RECEIVED' and interest is null from rows122),'Luồng Rec result; not read by AI yet');
select pg_temp.assert_true((select count(*) = 1 from public.campaign_interaction_rows('99000000-0000-4000-8000-000000002202', now() - interval '3 days', now())),'date window keeps the reply');
select pg_temp.assert_true((select count(*) = 0 from public.campaign_interaction_rows('99000000-0000-4000-8000-000000002202', now() - interval '1 day', now())),'date window drops older replies');

create temp table progress122 as select * from public.campaign_account_progress('99000000-0000-4000-8000-000000002202');
select pg_temp.assert_true((select count(*) = 1 from progress122),'one row for the only nick');
select pg_temp.assert_true((select recipients = 3 and reached = 2 and replied = 1 and waiting = 1 and messages_sent = 2 and sent_24h = 1 and sent_7d = 2 from progress122),'reached 2 of 3, one still waiting, pace counted');

create temp table queue122 as select * from public.campaign_replies_to_classify(10);
select pg_temp.assert_true((select count(*) = 1 from queue122 where recipient_id = '99000000-0000-4000-8000-000000002260'),'unread reply waits for the AI');
insert into public.campaign_reply_insights(recipient_id,workspace_id,interest,reason,last_inbound_at) select recipient_id, workspace_id, 'QUAN_TAM', 'Hỏi lương, gửi CV', last_inbound_at from queue122;
select pg_temp.assert_true((select count(*) = 0 from public.campaign_replies_to_classify(10) where recipient_id = '99000000-0000-4000-8000-000000002260'),'read replies leave the queue');
select pg_temp.assert_true((select interest = 'QUAN_TAM' from public.campaign_interaction_rows('99000000-0000-4000-8000-000000002202', null, null)),'AI reading shown in rows');
select pg_temp.assert_true(pg_temp.fails($$insert into public.campaign_reply_insights(recipient_id,workspace_id,interest,last_inbound_at) values('99000000-0000-4000-8000-000000002261','99000000-0000-4000-8000-000000002202','MAYBE',now())$$),'interest values are checked');
set local role authenticated;
select pg_temp.assert_true(pg_temp.fails($$select * from public.campaign_interaction_rows('99000000-0000-4000-8000-000000002202', null, null)$$),'members cannot call it directly');
select pg_temp.assert_true(pg_temp.fails($$select * from public.campaign_reply_insights$$),'members cannot read the AI readings directly');
reset role;
rollback;
