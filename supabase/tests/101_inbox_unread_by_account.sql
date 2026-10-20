-- Verifies migration 101 (unread conversations per account). Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001011','a101@test.local'),('00000000-0000-4000-8000-000000001012','b101@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000101a1','WS 101');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000101b1','00000000-0000-4000-8000-0000000101a1','Role 101');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000001011','00000000-0000-4000-8000-0000000101a1','A','00000000-0000-4000-8000-0000000101b1',true),
  ('00000000-0000-4000-8000-000000001012','00000000-0000-4000-8000-0000000101a1','B','00000000-0000-4000-8000-0000000101b1',false);
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('00000000-0000-4000-8000-0000000101c1','00000000-0000-4000-8000-0000000101a1','00000000-0000-4000-8000-000000001011','ZALO','ZALO_BRIDGE','nick-101-1','Nick 1','CONNECTED'),
  ('00000000-0000-4000-8000-0000000101c2','00000000-0000-4000-8000-0000000101a1','00000000-0000-4000-8000-000000001011','ZALO','ZALO_BRIDGE','nick-101-2','Nick 2','CONNECTED');
insert into public.profile_channel_account_access(workspace_id,profile_id,channel_account_id) values('00000000-0000-4000-8000-0000000101a1','00000000-0000-4000-8000-000000001012','00000000-0000-4000-8000-0000000101c2');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,unread_count,metadata) values
  ('00000000-0000-4000-8000-0000000101d1','00000000-0000-4000-8000-0000000101a1','00000000-0000-4000-8000-0000000101c1','ZALO','t1','OPEN','BOT_ALLOWED',3,'{}'),
  ('00000000-0000-4000-8000-0000000101d2','00000000-0000-4000-8000-0000000101a1','00000000-0000-4000-8000-0000000101c1','ZALO','t2','OPEN','BOT_ALLOWED',1,'{}'),
  ('00000000-0000-4000-8000-0000000101d3','00000000-0000-4000-8000-0000000101a1','00000000-0000-4000-8000-0000000101c1','ZALO','t3','OPEN','BOT_ALLOWED',0,'{}'),
  ('00000000-0000-4000-8000-0000000101d4','00000000-0000-4000-8000-0000000101a1','00000000-0000-4000-8000-0000000101c1','ZALO','t4','OPEN','BOT_ALLOWED',2,'{"hidden":true}'),
  ('00000000-0000-4000-8000-0000000101d5','00000000-0000-4000-8000-0000000101a1','00000000-0000-4000-8000-0000000101c2','ZALO','t5','OPEN','BOT_ALLOWED',5,'{}');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001011',true);
select pg_temp.assert_true((select unread from public.get_inbox_unread_by_account(array['00000000-0000-4000-8000-0000000101c1','00000000-0000-4000-8000-0000000101c2']::uuid[]) where channel_account_id='00000000-0000-4000-8000-0000000101c1')=2,'counts unread conversations, not hidden or read ones');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001012',true);
set local role authenticated;
select pg_temp.assert_true((select array_agg(channel_account_id) from public.get_inbox_unread_by_account(array['00000000-0000-4000-8000-0000000101c1','00000000-0000-4000-8000-0000000101c2']::uuid[]))='{00000000-0000-4000-8000-0000000101c2}'::uuid[],'a member only gets counts of accounts they may use');
reset role;
rollback;
