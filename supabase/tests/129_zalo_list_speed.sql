-- Verifies migration 129 (Zalo lists counted in the database).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.fails(text) to authenticated;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('99000000-0000-4000-8000-000000129201','a129@test.local');
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000129202','WS 129');
insert into public.workspace_roles(id,workspace_id,name) values('99000000-0000-4000-8000-000000129203','99000000-0000-4000-8000-000000129202','Role 129');
insert into public.profiles(id,workspace_id,full_name,role_id) values('99000000-0000-4000-8000-000000129201','99000000-0000-4000-8000-000000129202','A','99000000-0000-4000-8000-000000129203');
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('99000000-0000-4000-8000-000000129210','99000000-0000-4000-8000-000000129202','99000000-0000-4000-8000-000000129201','ZALO','ZALO_BRIDGE','nick-129','Ngân Lê','CONNECTED');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata) values
  ('99000000-0000-4000-8000-000000129220','99000000-0000-4000-8000-000000129202','99000000-0000-4000-8000-000000129210','ZALO','group-1','OPEN','BOT_ALLOWED','{"isGroup":true,"groupName":"BrSE Jobs"}'),
  ('99000000-0000-4000-8000-000000129221','99000000-0000-4000-8000-000000129202','99000000-0000-4000-8000-000000129210','ZALO','person-1','OPEN','BOT_ALLOWED','{}');
insert into public.zalo_broadcasts(id,workspace_id,name,text_content,status,created_by,approved_by,approved_at) values
  ('99000000-0000-4000-8000-000000129230','99000000-0000-4000-8000-000000129202','Job BrSE','[Tuyển] BrSE N2','RUNNING','99000000-0000-4000-8000-000000129201','99000000-0000-4000-8000-000000129201',clock_timestamp());
insert into public.zalo_broadcast_targets(id,workspace_id,broadcast_id,conversation_id,channel_account_id,group_id,group_name) values
  ('99000000-0000-4000-8000-000000129240','99000000-0000-4000-8000-000000129202','99000000-0000-4000-8000-000000129230','99000000-0000-4000-8000-000000129220','99000000-0000-4000-8000-000000129210','group-1','BrSE Jobs'),
  ('99000000-0000-4000-8000-000000129241','99000000-0000-4000-8000-000000129202','99000000-0000-4000-8000-000000129230','99000000-0000-4000-8000-000000129221','99000000-0000-4000-8000-000000129210','person-1','Không phải nhóm');
update public.zalo_broadcast_targets set status='SENT', pin_status='PINNED' where id='99000000-0000-4000-8000-000000129240';
update public.zalo_broadcast_targets set status='FAILED' where id='99000000-0000-4000-8000-000000129241';
select pg_temp.assert_true((select total=2 and sent=1 and failed=1 and waiting=0 and pinned=1 and pinned_messages=0 from public.zalo_broadcast_target_counts('99000000-0000-4000-8000-000000129202',array['99000000-0000-4000-8000-000000129230']::uuid[])),'broadcast counts');
select pg_temp.assert_true((select count(*)=0 from public.zalo_broadcast_target_counts('00000000-0000-4000-8000-000000000000',array['99000000-0000-4000-8000-000000129230']::uuid[])),'other workspace sees nothing');
select pg_temp.assert_true((select array_agg(broadcast_id)=array['99000000-0000-4000-8000-000000129230']::uuid[] from public.zalo_broadcast_ids_for_accounts('99000000-0000-4000-8000-000000129202',array['99000000-0000-4000-8000-000000129210']::uuid[])),'broadcasts by nick, once each');
set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000129201',true);
select pg_temp.assert_true(pg_temp.fails($$select * from public.zalo_broadcast_target_counts('99000000-0000-4000-8000-000000129202',array[]::uuid[])$$),'members cannot call the counts');
reset role;
rollback;
