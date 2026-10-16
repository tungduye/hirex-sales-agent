-- Verifies migration 086. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated, service_role;
create temp table proposed(k text primary key, id uuid);
grant insert, select on proposed to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000861','a@test.local'),('00000000-0000-4000-8000-000000000862','b@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000086a1','WS 086'),('00000000-0000-4000-8000-0000000086a2','Other 086');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000086b1','00000000-0000-4000-8000-0000000086a1','Role 086'),('00000000-0000-4000-8000-0000000086b2','00000000-0000-4000-8000-0000000086a2','Role 086b');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values('00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086b1','inbox.reply');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000000861','00000000-0000-4000-8000-0000000086a1','A','00000000-0000-4000-8000-0000000086b1',true),
  ('00000000-0000-4000-8000-000000000862','00000000-0000-4000-8000-0000000086a2','B','00000000-0000-4000-8000-0000000086b2',true);
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status)
  values('00000000-0000-4000-8000-0000000086c1','00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-000000000861','ZALO','ZALO_BRIDGE','zalo-086','Zalo 086','CONNECTED');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata) values
  ('00000000-0000-4000-8000-0000000086d1','00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086c1','ZALO','person-1','OPEN','BOT_ALLOWED','{}'),
  ('00000000-0000-4000-8000-0000000086d2','00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086c1','ZALO','group-1','OPEN','BOT_ALLOWED','{}'),
  ('00000000-0000-4000-8000-0000000086d3','00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086c1','ZALO','group-2','OPEN','BOT_ALLOWED','{"conversationKind":"GROUP"}');
insert into public.omnichannel_messages(id,workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values
  ('00000000-0000-4000-8000-0000000086e1','00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086d1','00000000-0000-4000-8000-0000000086c1','ZALO','m1','INBOUND','person-1','Chào',now()-interval '1 hour',null,now()-interval '1 hour'),
  ('00000000-0000-4000-8000-0000000086e2','00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086d1','00000000-0000-4000-8000-0000000086c1','ZALO','m2','INBOUND','system','Vy đã đồng ý kết bạn',now(),null,now()),
  ('00000000-0000-4000-8000-0000000086e3','00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086d2','00000000-0000-4000-8000-0000000086c1','ZALO','m3','INBOUND','member-9','Hi cả nhà',now(),null,now()),
  ('00000000-0000-4000-8000-0000000086e4','00000000-0000-4000-8000-0000000086a1','00000000-0000-4000-8000-0000000086d3','00000000-0000-4000-8000-0000000086c1','ZALO','m4','INBOUND','group-2','Tin cũ',now(),null,now());
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000861',true);
select pg_temp.assert_true(public.is_zalo_group_conversation('00000000-0000-4000-8000-0000000086d2') and public.is_zalo_group_conversation('00000000-0000-4000-8000-0000000086d3') and not public.is_zalo_group_conversation('00000000-0000-4000-8000-0000000086d1'),'group by another member writing, group by sync flag, one-to-one with a system notice is not');
select pg_temp.assert_true((select array_agg(g order by g) from public.get_inbox_zalo_group_ids(array['00000000-0000-4000-8000-0000000086d1','00000000-0000-4000-8000-0000000086d2','00000000-0000-4000-8000-0000000086d3']::uuid[]) g)='{00000000-0000-4000-8000-0000000086d2,00000000-0000-4000-8000-0000000086d3}'::uuid[],'inbox group ids include the sync flag');
insert into proposed values ('group', public.propose_channel_message('00000000-0000-4000-8000-0000000086d2','Chào nhóm','k-086-1','HUMAN')),
  ('person', public.propose_channel_message('00000000-0000-4000-8000-0000000086d1','Chào bạn','k-086-2','HUMAN')),
  ('flagged', public.propose_channel_message('00000000-0000-4000-8000-0000000086d3','Chào nhóm 2','k-086-3','HUMAN'));
reset role;
select pg_temp.assert_true((select a.recipient_external_id from public.channel_outbound_actions a join proposed p on p.id=a.id where p.k='group')='group-1','a group reply is addressed to the group, not the last member');
select pg_temp.assert_true((select a.recipient_external_id from public.channel_outbound_actions a join proposed p on p.id=a.id where p.k='person')='person-1','a one-to-one reply skips the Zalo system notice');
select pg_temp.assert_true((select a.recipient_external_id from public.channel_outbound_actions a join proposed p on p.id=a.id where p.k='flagged')='group-2','a sync-flagged group is addressed to the group');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000862',true);
set local role authenticated;
select pg_temp.assert_true(not public.is_zalo_group_conversation('00000000-0000-4000-8000-0000000086d2'),'another workspace learns nothing');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select pg_temp.assert_true(public.is_zalo_group_conversation('00000000-0000-4000-8000-0000000086d2'),'the server sees the group');
reset role;
rollback;
