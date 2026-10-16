-- Verifies migration 085. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000851','a@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000085a1','WS 085'),('00000000-0000-4000-8000-0000000085a2','Other 085');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000085b1','00000000-0000-4000-8000-0000000085a1','Role 085');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values('00000000-0000-4000-8000-000000000851','00000000-0000-4000-8000-0000000085a1','A','00000000-0000-4000-8000-0000000085b1',true);
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status)
  values('00000000-0000-4000-8000-0000000085c1','00000000-0000-4000-8000-0000000085a1','00000000-0000-4000-8000-000000000851','ZALO','ZALO_BRIDGE','zalo-085','Zalo 085','CONNECTED');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode) values
  ('00000000-0000-4000-8000-0000000085d1','00000000-0000-4000-8000-0000000085a1','00000000-0000-4000-8000-0000000085c1','ZALO','person-1','OPEN','BOT_ALLOWED'),
  ('00000000-0000-4000-8000-0000000085d2','00000000-0000-4000-8000-0000000085a1','00000000-0000-4000-8000-0000000085c1','ZALO','group-1','OPEN','BOT_ALLOWED'),
  ('00000000-0000-4000-8000-0000000085d3','00000000-0000-4000-8000-0000000085a1','00000000-0000-4000-8000-0000000085c1','ZALO','person-2','OPEN','BOT_ALLOWED');
insert into public.omnichannel_messages(id,workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values
  ('00000000-0000-4000-8000-0000000085e1','00000000-0000-4000-8000-0000000085a1','00000000-0000-4000-8000-0000000085d1','00000000-0000-4000-8000-0000000085c1','ZALO','m1','INBOUND','person-1','Chào',now(),null,now()-interval '2 hours'),
  ('00000000-0000-4000-8000-0000000085e2','00000000-0000-4000-8000-0000000085a1','00000000-0000-4000-8000-0000000085d2','00000000-0000-4000-8000-0000000085c1','ZALO','m2','INBOUND','member-9','Hi cả nhà',now(),null,now()-interval '3 days'),
  ('00000000-0000-4000-8000-0000000085e4','00000000-0000-4000-8000-0000000085a1','00000000-0000-4000-8000-0000000085d3','00000000-0000-4000-8000-0000000085c1','ZALO','m4','INBOUND','system','Vy đã đồng ý kết bạn',now(),null,now()),
  ('00000000-0000-4000-8000-0000000085e3','00000000-0000-4000-8000-0000000085a1','00000000-0000-4000-8000-0000000085d2','00000000-0000-4000-8000-0000000085c1','ZALO','m3','OUTBOUND','zalo-085','Bên mình gửi JD',null,now(),now());
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000851',true);
select pg_temp.assert_true((select array_agg(g) from public.get_inbox_zalo_group_ids(array['00000000-0000-4000-8000-0000000085d1','00000000-0000-4000-8000-0000000085d2','00000000-0000-4000-8000-0000000085d3']::uuid[]) g)='{00000000-0000-4000-8000-0000000085d2}'::uuid[],'a Zalo system notice (sender system) does not make a one-to-one chat a group');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000859',true);
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.get_inbox_zalo_group_ids(array['00000000-0000-4000-8000-0000000085d2']::uuid[]))=0,'other users see nothing');
reset role;
rollback;
