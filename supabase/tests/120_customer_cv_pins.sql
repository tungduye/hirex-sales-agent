-- Verifies migration 120 (per-group text in parts for Tình trạng CV; company ↔ group links). Never calls Zalo.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.fails(text) to authenticated;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('99000000-0000-4000-8000-000000001E01','a120@test.local');
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000001E02','WS 120');
insert into public.workspace_roles(id,workspace_id,name) values('99000000-0000-4000-8000-000000001E03','99000000-0000-4000-8000-000000001E02','Role 120');
insert into public.profiles(id,workspace_id,full_name,role_id) values('99000000-0000-4000-8000-000000001E01','99000000-0000-4000-8000-000000001E02','A','99000000-0000-4000-8000-000000001E03');
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('99000000-0000-4000-8000-000000001E10','99000000-0000-4000-8000-000000001E02','99000000-0000-4000-8000-000000001E01','ZALO','ZALO_BRIDGE','nick-120','Ngân Lê','CONNECTED');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata) values
  ('99000000-0000-4000-8000-000000001E20','99000000-0000-4000-8000-000000001E02','99000000-0000-4000-8000-000000001E10','ZALO','group-1','OPEN','BOT_ALLOWED','{"isGroup":true,"groupName":"BrSE Jobs"}'),
  ('99000000-0000-4000-8000-000000001E21','99000000-0000-4000-8000-000000001E02','99000000-0000-4000-8000-000000001E10','ZALO','person-1','OPEN','BOT_ALLOWED','{}');
insert into public.zalo_broadcasts(id,workspace_id,name,text_content,status,created_by,approved_by,approved_at) values
  ('99000000-0000-4000-8000-000000001E30','99000000-0000-4000-8000-000000001E02','Job BrSE','[Tuyển] BrSE N2','RUNNING','99000000-0000-4000-8000-000000001E01','99000000-0000-4000-8000-000000001E01',clock_timestamp());
insert into public.zalo_broadcast_targets(id,workspace_id,broadcast_id,conversation_id,channel_account_id,group_id,group_name) values
  ('99000000-0000-4000-8000-000000001E40','99000000-0000-4000-8000-000000001E02','99000000-0000-4000-8000-000000001E30','99000000-0000-4000-8000-000000001E20','99000000-0000-4000-8000-000000001E10','group-1','BrSE Jobs'),
  ('99000000-0000-4000-8000-000000001E41','99000000-0000-4000-8000-000000001E02','99000000-0000-4000-8000-000000001E30','99000000-0000-4000-8000-000000001E21','99000000-0000-4000-8000-000000001E10','person-1','Không phải nhóm');
update public.zalo_broadcast_targets set text_parts=array['Phần một','Phần hai'] where id='99000000-0000-4000-8000-000000001E40';
create temp table parts120 as select 1 as part, public.propose_zalo_broadcast_send_service('99000000-0000-4000-8000-000000001E02','99000000-0000-4000-8000-000000001E40',1,0) as id;
insert into parts120 select 2, public.propose_zalo_broadcast_send_service('99000000-0000-4000-8000-000000001E02','99000000-0000-4000-8000-000000001E40',1,1);
select pg_temp.assert_true((select text_content='Phần một' and idempotency_key like '%:part:1' from public.channel_outbound_actions where id=(select id from parts120 where part=1)),'part 1: its own text');
select pg_temp.assert_true((select text_content='Phần hai' and idempotency_key like '%:part:4' from public.channel_outbound_actions where id=(select id from parts120 where part=2)),'part 2: next key (part * 3 + attempt)');
select pg_temp.assert_true(public.propose_zalo_broadcast_send_service('99000000-0000-4000-8000-000000001E02','99000000-0000-4000-8000-000000001E40',1,2) is null,'no third part: nothing sent');
select pg_temp.assert_true(pg_temp.fails($$update public.zalo_broadcast_targets set text_parts=array['1','2','3','4'] where id='99000000-0000-4000-8000-000000001E40'$$),'at most 3 parts');
insert into public.zalo_broadcasts(workspace_id,name,text_content,status,created_by,approved_by,approved_at,source,kind) values('99000000-0000-4000-8000-000000001E02','Tình trạng CV','x','RUNNING','99000000-0000-4000-8000-000000001E01','99000000-0000-4000-8000-000000001E01',now(),'SCHEDULE','CV_STATUS');
select pg_temp.assert_true(true,'scheduled CV broadcasts are allowed');
insert into public.human_partners(workspace_id,partner_id,name) values('99000000-0000-4000-8000-000000001E02',7,'Brisasoft');
insert into public.human_partner_groups(workspace_id,group_id,partner_id,group_name) values('99000000-0000-4000-8000-000000001E02','group-1',7,'30/09 - BRISASOFT');
select pg_temp.assert_true(pg_temp.fails($$insert into public.human_partner_groups(workspace_id,group_id,partner_id,status) values('99000000-0000-4000-8000-000000001E02','group-1',7,'MAYBE')$$),'link status is checked');
select pg_temp.assert_true(pg_temp.fails($$insert into public.human_cv_pin_settings(workspace_id,enabled) values('99000000-0000-4000-8000-000000001E02',true)$$),'switching pins on needs the person who approves them');
rollback;
