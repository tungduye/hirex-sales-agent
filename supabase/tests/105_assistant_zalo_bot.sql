-- Verifies migration 105 (Trợ lý on Zalo: links private to their member, job queue, replies only from the enabled nick). Never calls Zalo.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('99000000-0000-4000-8000-000000000501','a105@test.local'),('99000000-0000-4000-8000-000000000502','b105@test.local');
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000000503','WS 105');
insert into public.workspace_roles(id,workspace_id,name) values('99000000-0000-4000-8000-000000000504','99000000-0000-4000-8000-000000000503','Role 105');
insert into public.profiles(id,workspace_id,full_name,role_id) values('99000000-0000-4000-8000-000000000501','99000000-0000-4000-8000-000000000503','A','99000000-0000-4000-8000-000000000504'),('99000000-0000-4000-8000-000000000502','99000000-0000-4000-8000-000000000503','B','99000000-0000-4000-8000-000000000504');
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('99000000-0000-4000-8000-000000000510','99000000-0000-4000-8000-000000000503','99000000-0000-4000-8000-000000000501','ZALO','ZALO_BRIDGE','bot-105','Kiều Trang','CONNECTED');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode) values
  ('99000000-0000-4000-8000-000000000520','99000000-0000-4000-8000-000000000503','99000000-0000-4000-8000-000000000510','ZALO','user-a','OPEN','BOT_ALLOWED');
insert into public.omnichannel_messages(id,workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,created_at) values
  ('99000000-0000-4000-8000-000000000530','99000000-0000-4000-8000-000000000503','99000000-0000-4000-8000-000000000520','99000000-0000-4000-8000-000000000510','ZALO','m105','INBOUND','user-a','Hôm nay có gì cần xử lý?',clock_timestamp(),clock_timestamp());
insert into public.assistant_zalo_links(workspace_id,profile_id,zalo_user_id,zalo_name) values('99000000-0000-4000-8000-000000000503','99000000-0000-4000-8000-000000000501','user-a','Anh A');
insert into public.assistant_bot_jobs(id,workspace_id,channel_account_id,conversation_id,message_id) values('99000000-0000-4000-8000-000000000540','99000000-0000-4000-8000-000000000503','99000000-0000-4000-8000-000000000510','99000000-0000-4000-8000-000000000520','99000000-0000-4000-8000-000000000530');
select pg_temp.assert_true((select count(*)=1 from public.claim_assistant_bot_job() where id='99000000-0000-4000-8000-000000000540'),'the worker claims a waiting job');
select pg_temp.assert_true((select count(*)=0 from public.claim_assistant_bot_job() where id='99000000-0000-4000-8000-000000000540'),'a running job is not claimed twice');
select pg_temp.assert_true(public.propose_assistant_bot_message_service('99000000-0000-4000-8000-000000000503','99000000-0000-4000-8000-000000000540','Chào anh',1) is null,'no reply while the nick is not the enabled Trợ lý');
insert into public.assistant_bot_settings(workspace_id,channel_account_id,enabled,enabled_at) values('99000000-0000-4000-8000-000000000503','99000000-0000-4000-8000-000000000510',true,clock_timestamp());
create temp table sent105 as select public.propose_assistant_bot_message_service('99000000-0000-4000-8000-000000000503','99000000-0000-4000-8000-000000000540','Chào anh',1) as id;
select pg_temp.assert_true((select status='APPROVED' and recipient_external_id='user-a' and dispatch_source='AI_AUTOMATION' from public.channel_outbound_actions where id=(select id from sent105)),'the enabled nick replies into the same chat');
select pg_temp.assert_true(public.propose_assistant_bot_message_service('99000000-0000-4000-8000-000000000503','99000000-0000-4000-8000-000000000540','Chào anh',1)=(select id from public.channel_outbound_actions where idempotency_key='assistant-bot:99000000-0000-4000-8000-000000000540:part:1'),'the same part is not sent twice');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000502',true);
select pg_temp.assert_true((select count(*)=0 from public.assistant_zalo_links),'a member does not see other members'' Zalo links');
select pg_temp.assert_true((select count(*)=1 from public.assistant_bot_settings),'members can see which nick is the Trợ lý');
reset role;
rollback;
