-- Verifies migration 111 (Word files made by the Trợ lý, sent as one file by the Trợ lý nick). Never calls Zalo.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.fails(text) to authenticated;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('99000000-0000-4000-8000-000000001111','a111@test.local'),('99000000-0000-4000-8000-000000001112','b111@test.local');
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000001113','WS 111');
insert into public.workspace_roles(id,workspace_id,name) values('99000000-0000-4000-8000-000000001114','99000000-0000-4000-8000-000000001113','Role 111');
insert into public.profiles(id,workspace_id,full_name,role_id) values('99000000-0000-4000-8000-000000001111','99000000-0000-4000-8000-000000001113','A','99000000-0000-4000-8000-000000001114'),('99000000-0000-4000-8000-000000001112','99000000-0000-4000-8000-000000001113','B','99000000-0000-4000-8000-000000001114');
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('99000000-0000-4000-8000-000000001120','99000000-0000-4000-8000-000000001113','99000000-0000-4000-8000-000000001111','ZALO','ZALO_BRIDGE','bot-111','Soda','CONNECTED');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode) values
  ('99000000-0000-4000-8000-000000001121','99000000-0000-4000-8000-000000001113','99000000-0000-4000-8000-000000001120','ZALO','user-a','OPEN','BOT_ALLOWED');
insert into public.omnichannel_messages(id,workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,created_at) values
  ('99000000-0000-4000-8000-000000001122','99000000-0000-4000-8000-000000001113','99000000-0000-4000-8000-000000001121','99000000-0000-4000-8000-000000001120','ZALO','m111','INBOUND','user-a','Làm JD',clock_timestamp(),clock_timestamp());
insert into public.assistant_bot_settings(workspace_id,channel_account_id,enabled,enabled_at) values('99000000-0000-4000-8000-000000001113','99000000-0000-4000-8000-000000001120',true,clock_timestamp());
insert into public.assistant_bot_jobs(id,workspace_id,channel_account_id,conversation_id,message_id,status,profile_id,started_at) values('99000000-0000-4000-8000-000000001130','99000000-0000-4000-8000-000000001113','99000000-0000-4000-8000-000000001120','99000000-0000-4000-8000-000000001121','99000000-0000-4000-8000-000000001122','RUNNING','99000000-0000-4000-8000-000000001111',clock_timestamp());
insert into public.channel_attachments(id,workspace_id,storage_bucket,storage_path,filename,content_type,size_bytes,sha256,source,created_by) values
  ('99000000-0000-4000-8000-000000001140','99000000-0000-4000-8000-000000001113','channel-attachments','w/assistant/a.docx','JD.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',1000,repeat('a',64),'ASSISTANT_GENERATED','99000000-0000-4000-8000-000000001111'),
  ('99000000-0000-4000-8000-000000001141','99000000-0000-4000-8000-000000001113','channel-attachments','w/assistant/b.docx','B.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',1000,repeat('b',64),'ASSISTANT_GENERATED','99000000-0000-4000-8000-000000001112'),
  ('99000000-0000-4000-8000-000000001142','99000000-0000-4000-8000-000000001113','channel-attachments','w/outbound/c.pdf','C.pdf','application/pdf',1000,repeat('c',64),'HUMAN_UPLOAD','99000000-0000-4000-8000-000000001111');
insert into public.assistant_generated_files(workspace_id,created_by,kind,title,attachment_id) values
  ('99000000-0000-4000-8000-000000001113','99000000-0000-4000-8000-000000001111','JD','JD BrSE','99000000-0000-4000-8000-000000001140'),
  ('99000000-0000-4000-8000-000000001113','99000000-0000-4000-8000-000000001112','FREE','Của B','99000000-0000-4000-8000-000000001141');
create temp table file111 as select public.propose_assistant_bot_file_service('99000000-0000-4000-8000-000000001113','99000000-0000-4000-8000-000000001130','99000000-0000-4000-8000-000000001140',6) as id;
select pg_temp.assert_true((select text_content is null and attachment_ids=array['99000000-0000-4000-8000-000000001140']::uuid[] and dispatch_source='AI_AUTOMATION' and idempotency_key='assistant-bot:99000000-0000-4000-8000-000000001130:part:6' from public.channel_outbound_actions where id=(select id from file111)),'the Trợ lý sends the member''s own file on its own');
select pg_temp.assert_true(public.propose_assistant_bot_file_service('99000000-0000-4000-8000-000000001113','99000000-0000-4000-8000-000000001130','99000000-0000-4000-8000-000000001141',7) is null,'not a file made for someone else');
select pg_temp.assert_true(public.propose_assistant_bot_file_service('99000000-0000-4000-8000-000000001113','99000000-0000-4000-8000-000000001130','99000000-0000-4000-8000-000000001142',7) is null,'not an uploaded file');
select pg_temp.assert_true(public.propose_assistant_bot_file_service('99000000-0000-4000-8000-000000001113','99000000-0000-4000-8000-000000001130','99000000-0000-4000-8000-000000001140',11) is null,'parts 1..10 only');
set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000001111',true);
select pg_temp.assert_true(pg_temp.fails($$select count(*) from public.assistant_generated_files$$),'listed only through the server');
select pg_temp.assert_true(pg_temp.fails($$select public.propose_assistant_bot_file_service('99000000-0000-4000-8000-000000001113','99000000-0000-4000-8000-000000001130','99000000-0000-4000-8000-000000001140',8)$$),'members cannot send as the Trợ lý');
reset role;
rollback;
