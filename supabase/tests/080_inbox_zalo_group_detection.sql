-- Verifies migration 080. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000801','a@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000008a1','WS 080'),('00000000-0000-4000-8000-0000000008a2','Other 080');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000008b1','00000000-0000-4000-8000-0000000008a1','Role 080');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-0000000008a1','A','00000000-0000-4000-8000-0000000008b1',true);
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status)
  values('00000000-0000-4000-8000-0000000008c1','00000000-0000-4000-8000-0000000008a1','00000000-0000-4000-8000-000000000801','ZALO','ZALO_BRIDGE','zalo-080','Zalo 080','CONNECTED');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode) values
  ('00000000-0000-4000-8000-0000000008d1','00000000-0000-4000-8000-0000000008a1','00000000-0000-4000-8000-0000000008c1','ZALO','person-1','OPEN','BOT_ALLOWED'),
  ('00000000-0000-4000-8000-0000000008d2','00000000-0000-4000-8000-0000000008a1','00000000-0000-4000-8000-0000000008c1','ZALO','group-1','OPEN','BOT_ALLOWED'),
  ('00000000-0000-4000-8000-0000000008d3','00000000-0000-4000-8000-0000000008a1','00000000-0000-4000-8000-0000000008c1','ZALO','person-2','OPEN','BOT_ALLOWED');
insert into public.omnichannel_messages(id,workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values
  ('00000000-0000-4000-8000-0000000008e1','00000000-0000-4000-8000-0000000008a1','00000000-0000-4000-8000-0000000008d1','00000000-0000-4000-8000-0000000008c1','ZALO','m1','INBOUND','person-1','Chào',now(),null,now()-interval '2 hours'),
  ('00000000-0000-4000-8000-0000000008e2','00000000-0000-4000-8000-0000000008a1','00000000-0000-4000-8000-0000000008d2','00000000-0000-4000-8000-0000000008c1','ZALO','m2','INBOUND','member-9','Hi cả nhà',now(),null,now()-interval '3 days'),
  ('00000000-0000-4000-8000-0000000008e3','00000000-0000-4000-8000-0000000008a1','00000000-0000-4000-8000-0000000008d2','00000000-0000-4000-8000-0000000008c1','ZALO','m3','OUTBOUND','zalo-080','Bên mình gửi JD',null,now(),now());
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000801',true);
select pg_temp.assert_true((select array_agg(g) from public.get_inbox_zalo_group_ids(array['00000000-0000-4000-8000-0000000008d1','00000000-0000-4000-8000-0000000008d2','00000000-0000-4000-8000-0000000008d3']::uuid[]) g)='{00000000-0000-4000-8000-0000000008d2}'::uuid[],'only the thread with another inbound sender is a group, even when our message is newest');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000999',true);
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.get_inbox_zalo_group_ids(array['00000000-0000-4000-8000-0000000008d2']::uuid[]))=0,'other users see nothing');
reset role;
rollback;
