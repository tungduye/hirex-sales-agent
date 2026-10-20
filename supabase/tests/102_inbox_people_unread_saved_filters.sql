-- Verifies migration 102 (people-only unread counts, saved filters). Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
grant execute on function pg_temp.fails(text) to authenticated;
select pg_temp.assert_true(public.inbox_is_automated_sender('no-reply@accounts.google.com'),'no-reply is a robot');
select pg_temp.assert_true(public.inbox_is_automated_sender('messages-noreply@linkedin.com'),'linkedin noreply is a robot');
select pg_temp.assert_true(not public.inbox_is_automated_sender('lan.nguyen@gmail.com'),'a person is not a robot');
select pg_temp.assert_true(not public.inbox_is_automated_sender(null),'no sender is not a robot');
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001021','a102@test.local'),('00000000-0000-4000-8000-000000001022','b102@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000102a1','WS 102');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000102b1','00000000-0000-4000-8000-0000000102a1','Role 102');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000001021','00000000-0000-4000-8000-0000000102a1','A','00000000-0000-4000-8000-0000000102b1',true),
  ('00000000-0000-4000-8000-000000001022','00000000-0000-4000-8000-0000000102a1','B','00000000-0000-4000-8000-0000000102b1',true);
insert into public.email_accounts(id,workspace_id,connected_by,provider,email_address,status,scopes) values('00000000-0000-4000-8000-0000000102f1','00000000-0000-4000-8000-0000000102a1','00000000-0000-4000-8000-000000001021','GMAIL','a102@mail.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']);
create temp table acc102 as select id from public.channel_accounts where legacy_email_account_id='00000000-0000-4000-8000-0000000102f1';
grant select on acc102 to authenticated;
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,unread_count,metadata) values
  ('00000000-0000-4000-8000-0000000102d1','00000000-0000-4000-8000-0000000102a1',(select id from acc102),'EMAIL','th1','OPEN','BOT_ALLOWED',1,'{}'),
  ('00000000-0000-4000-8000-0000000102d2','00000000-0000-4000-8000-0000000102a1',(select id from acc102),'EMAIL','th2','OPEN','BOT_ALLOWED',2,'{}'),
  ('00000000-0000-4000-8000-0000000102d3','00000000-0000-4000-8000-0000000102a1',(select id from acc102),'EMAIL','th3','OPEN','BOT_ALLOWED',1,'{"folder":"OTHER"}');
insert into public.omnichannel_messages(id,workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,created_at) values
  ('00000000-0000-4000-8000-0000000102e1','00000000-0000-4000-8000-0000000102a1','00000000-0000-4000-8000-0000000102d1',(select id from acc102),'EMAIL','e1','INBOUND','lan.nguyen@gmail.com','Chào anh','2026-10-01T08:00:00Z','2026-10-01T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000102e2','00000000-0000-4000-8000-0000000102a1','00000000-0000-4000-8000-0000000102d2',(select id from acc102),'EMAIL','e2','INBOUND','no-reply@accounts.google.com','Cảnh báo','2026-10-01T08:00:00Z','2026-10-01T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000102e3','00000000-0000-4000-8000-0000000102a1','00000000-0000-4000-8000-0000000102d3',(select id from acc102),'EMAIL','e3','INBOUND','hr@cty.vn','Thư','2026-10-01T08:00:00Z','2026-10-01T08:00:00Z');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001021',true);
select pg_temp.assert_true((select unread=3 and unread_people=1 from public.get_inbox_unread_by_account(array[(select id from acc102)]::uuid[])),'people count leaves out robots and the Khác folder');
insert into public.inbox_saved_filters(workspace_id,profile_id,name,query,scope,view) values('00000000-0000-4000-8000-0000000102a1','00000000-0000-4000-8000-000000001021','Zalo chờ trả lời','channel=ZALO','MINE','waiting');
select pg_temp.assert_true((select count(*)=1 from public.inbox_saved_filters),'a member saves a filter');
select pg_temp.assert_true(pg_temp.fails($$insert into public.inbox_saved_filters(workspace_id,profile_id,name) values('00000000-0000-4000-8000-0000000102a1','00000000-0000-4000-8000-000000001022','Của người khác')$$),'cannot save a filter for someone else');
select pg_temp.assert_true(pg_temp.fails($$insert into public.inbox_saved_filters(workspace_id,profile_id,name,view) values('00000000-0000-4000-8000-0000000102a1','00000000-0000-4000-8000-000000001021','Sai','bogus')$$),'view must be a known tab');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001022',true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.inbox_saved_filters),'saved filters are private');
reset role;
rollback;
