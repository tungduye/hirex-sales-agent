-- Verifies migration 112 (group broadcasts: approved sends into Zalo groups only). Never calls Zalo.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.fails(text) to authenticated;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('99000000-0000-4000-8000-000000001201','a112@test.local');
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000001202','WS 112');
insert into public.workspace_roles(id,workspace_id,name) values('99000000-0000-4000-8000-000000001203','99000000-0000-4000-8000-000000001202','Role 112');
insert into public.profiles(id,workspace_id,full_name,role_id) values('99000000-0000-4000-8000-000000001201','99000000-0000-4000-8000-000000001202','A','99000000-0000-4000-8000-000000001203');
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('99000000-0000-4000-8000-000000001210','99000000-0000-4000-8000-000000001202','99000000-0000-4000-8000-000000001201','ZALO','ZALO_BRIDGE','nick-112','Ngân Lê','CONNECTED');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata) values
  ('99000000-0000-4000-8000-000000001220','99000000-0000-4000-8000-000000001202','99000000-0000-4000-8000-000000001210','ZALO','group-1','OPEN','BOT_ALLOWED','{"isGroup":true,"groupName":"BrSE Jobs"}'),
  ('99000000-0000-4000-8000-000000001221','99000000-0000-4000-8000-000000001202','99000000-0000-4000-8000-000000001210','ZALO','person-1','OPEN','BOT_ALLOWED','{}');
insert into public.zalo_broadcasts(id,workspace_id,name,text_content,status,created_by,approved_by,approved_at) values
  ('99000000-0000-4000-8000-000000001230','99000000-0000-4000-8000-000000001202','Job BrSE','[Tuyển] BrSE N2','RUNNING','99000000-0000-4000-8000-000000001201','99000000-0000-4000-8000-000000001201',clock_timestamp());
insert into public.zalo_broadcast_targets(id,workspace_id,broadcast_id,conversation_id,channel_account_id,group_id,group_name) values
  ('99000000-0000-4000-8000-000000001240','99000000-0000-4000-8000-000000001202','99000000-0000-4000-8000-000000001230','99000000-0000-4000-8000-000000001220','99000000-0000-4000-8000-000000001210','group-1','BrSE Jobs'),
  ('99000000-0000-4000-8000-000000001241','99000000-0000-4000-8000-000000001202','99000000-0000-4000-8000-000000001230','99000000-0000-4000-8000-000000001221','99000000-0000-4000-8000-000000001210','person-1','Không phải nhóm');
select pg_temp.assert_true(pg_temp.fails($$insert into public.zalo_broadcasts(workspace_id,name,text_content,status,created_by) values('99000000-0000-4000-8000-000000001202','X','Y','RUNNING','99000000-0000-4000-8000-000000001201')$$),'nothing runs without someone starting it');
select pg_temp.assert_true(pg_temp.fails($$insert into public.zalo_broadcasts(workspace_id,name,text_content,created_by,daily_cap_per_nick) values('99000000-0000-4000-8000-000000001202','X','Y','99000000-0000-4000-8000-000000001201',500)$$),'at most 100 groups per nick per day');
create temp table sent112 as select public.propose_zalo_broadcast_send_service('99000000-0000-4000-8000-000000001202','99000000-0000-4000-8000-000000001240',1) as id;
select pg_temp.assert_true((select status='APPROVED' and recipient_external_id='group-1' and text_content='[Tuyển] BrSE N2' and approved_by='99000000-0000-4000-8000-000000001201' and dispatch_source='AI_AUTOMATION' and idempotency_key='group-broadcast:99000000-0000-4000-8000-000000001240:part:1' from public.channel_outbound_actions where id=(select id from sent112)),'the group gets the approved text from its nick');
select pg_temp.assert_true(public.propose_zalo_broadcast_send_service('99000000-0000-4000-8000-000000001202','99000000-0000-4000-8000-000000001240',1)=(select id from sent112),'the same attempt is one action');
select pg_temp.assert_true(public.propose_zalo_broadcast_send_service('99000000-0000-4000-8000-000000001202','99000000-0000-4000-8000-000000001241',1) is null,'never into a one-to-one chat');
update public.zalo_broadcasts set status='PAUSED' where id='99000000-0000-4000-8000-000000001230';
select pg_temp.assert_true(public.propose_zalo_broadcast_send_service('99000000-0000-4000-8000-000000001202','99000000-0000-4000-8000-000000001240',2) is null,'nothing while paused');
select pg_temp.assert_true((select pg_get_constraintdef(oid) like '%CREATE_BROADCAST%' from pg_constraint where conname='assistant_actions_kind_allowed'),'Trợ lý may prepare a draft');
set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000001201',true);
select pg_temp.assert_true(pg_temp.fails($$select count(*) from public.zalo_broadcasts$$),'only through the server');
select pg_temp.assert_true(pg_temp.fails($$select public.propose_zalo_broadcast_send_service('99000000-0000-4000-8000-000000001202','99000000-0000-4000-8000-000000001240',3)$$),'members cannot send directly');
reset role;
rollback;
