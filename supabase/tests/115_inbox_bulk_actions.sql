-- Verifies migration 115 (Suối Nguồn bulk actions: permission, nick scope, audit record, undo).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
create function pg_temp.fails(sql text, expected text) returns boolean language plpgsql as $$begin execute sql; return false; exception when others then return sqlerrm = expected; end$$;
grant execute on function pg_temp.fails(text,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001151','a115@test.local'),('00000000-0000-4000-8000-000000001152','b115@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000115a1','WS 115');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000115b1','00000000-0000-4000-8000-0000000115a1','Editor'),('00000000-0000-4000-8000-0000000115b2','00000000-0000-4000-8000-0000000115a1','Viewer');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values
  ('00000000-0000-4000-8000-0000000115a1','00000000-0000-4000-8000-0000000115b1','inbox.view'),('00000000-0000-4000-8000-0000000115a1','00000000-0000-4000-8000-0000000115b1','inbox.update'),
  ('00000000-0000-4000-8000-0000000115a1','00000000-0000-4000-8000-0000000115b2','inbox.view');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000001151','00000000-0000-4000-8000-0000000115a1','A','00000000-0000-4000-8000-0000000115b1',false),
  ('00000000-0000-4000-8000-000000001152','00000000-0000-4000-8000-0000000115a1','B','00000000-0000-4000-8000-0000000115b2',true);
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('00000000-0000-4000-8000-0000000115c1','00000000-0000-4000-8000-0000000115a1','00000000-0000-4000-8000-000000001151','ZALO','ZALO_BRIDGE','n1-115','Nick 1','CONNECTED'),
  ('00000000-0000-4000-8000-0000000115c2','00000000-0000-4000-8000-0000000115a1','00000000-0000-4000-8000-000000001151','ZALO','ZALO_BRIDGE','n2-115','Nick 2','CONNECTED');
insert into public.profile_channel_account_access(workspace_id,profile_id,channel_account_id) values('00000000-0000-4000-8000-0000000115a1','00000000-0000-4000-8000-000000001151','00000000-0000-4000-8000-0000000115c1');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata,last_message_at,unread_count) values
  ('00000000-0000-4000-8000-0000000115d1','00000000-0000-4000-8000-0000000115a1','00000000-0000-4000-8000-0000000115c1','ZALO','p1','OPEN','BOT_ALLOWED','{}','2026-10-20T08:00:00Z',3),
  ('00000000-0000-4000-8000-0000000115d2','00000000-0000-4000-8000-0000000115a1','00000000-0000-4000-8000-0000000115c1','ZALO','p2','OPEN','BOT_ALLOWED','{}','2026-10-20T07:00:00Z',0),
  ('00000000-0000-4000-8000-0000000115d3','00000000-0000-4000-8000-0000000115a1','00000000-0000-4000-8000-0000000115c2','ZALO','p3','OPEN','BOT_ALLOWED','{}','2026-10-20T06:00:00Z',1);
set local session_replication_role = replica;
insert into public.conversation_tags(id,workspace_id,name) values('00000000-0000-4000-8000-0000000115e1','00000000-0000-4000-8000-0000000115a1','Hot'),('00000000-0000-4000-8000-0000000115e2','00000000-0000-4000-8000-0000000115a1','HCM');
set local session_replication_role = origin;
grant select on public.contacts, public.omnichannel_conversations, public.omnichannel_messages, public.conversation_tag_links to authenticated;
create temp table ops115(name text, id uuid);
grant select, insert on ops115 to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001151',true);
insert into ops115 select 'add', operation_id from public.inbox_bulk_apply(array['00000000-0000-4000-8000-0000000115d1','00000000-0000-4000-8000-0000000115d2','00000000-0000-4000-8000-0000000115d3']::uuid[],'TAG_ADD',array['00000000-0000-4000-8000-0000000115e1']::uuid[],null);
select pg_temp.assert_true((select affected=2 and requested=3 from public.inbox_bulk_operations where id=(select id from ops115 where name='add')),'tagging: 2 of 3 changed, the third is on a nick A may not use');
select pg_temp.assert_true((select count(*)=2 from public.conversation_tag_links where workspace_id='00000000-0000-4000-8000-0000000115a1'),'tagging: links created');
select pg_temp.assert_true((select affected=0 and skipped=1 from public.inbox_bulk_apply(array['00000000-0000-4000-8000-0000000115d1','00000000-0000-4000-8000-0000000115d2','00000000-0000-4000-8000-0000000115d3']::uuid[],'TAG_ADD',array['00000000-0000-4000-8000-0000000115e1']::uuid[],null)),'tagging again changes nothing');
select pg_temp.assert_true(public.inbox_bulk_undo((select id from ops115 where name='add'))=2,'undo removes the 2 links it added');
select pg_temp.assert_true((select count(*)=0 from public.conversation_tag_links where workspace_id='00000000-0000-4000-8000-0000000115a1'),'undo: no links left');
select pg_temp.assert_true(pg_temp.fails(format('select public.inbox_bulk_undo(%L)', (select id from ops115 where name='add')),'ALREADY_UNDONE'),'undo only once');
insert into ops115 select 'read', operation_id from public.inbox_bulk_apply(array['00000000-0000-4000-8000-0000000115d1','00000000-0000-4000-8000-0000000115d2']::uuid[],'MARK_READ',null,null);
select pg_temp.assert_true((select unread_count=0 from public.omnichannel_conversations where id='00000000-0000-4000-8000-0000000115d1'),'mark read');
select pg_temp.assert_true(public.inbox_bulk_undo((select id from ops115 where name='read'))=1,'undo mark read restores the count: undone');
select pg_temp.assert_true((select unread_count=3 from public.omnichannel_conversations where id='00000000-0000-4000-8000-0000000115d1'),'undo mark read restores the count');
insert into ops115 select 'other', operation_id from public.inbox_bulk_apply(array['00000000-0000-4000-8000-0000000115d1']::uuid[],'MOVE_OTHER',null,null);
select pg_temp.assert_true((select metadata->>'folder'='OTHER' from public.omnichannel_conversations where id='00000000-0000-4000-8000-0000000115d1'),'move to Khác');
select pg_temp.assert_true(public.inbox_bulk_undo((select id from ops115 where name='other'))=1,'undo move: undone');
select pg_temp.assert_true((select not metadata ? 'folder' from public.omnichannel_conversations where id='00000000-0000-4000-8000-0000000115d1'),'undo move');
insert into ops115 select 'assign', operation_id from public.inbox_bulk_apply(array['00000000-0000-4000-8000-0000000115d1','00000000-0000-4000-8000-0000000115d2']::uuid[],'ASSIGN',null,'00000000-0000-4000-8000-000000001152');
select pg_temp.assert_true((select count(*)=2 from public.omnichannel_conversations where assigned_to='00000000-0000-4000-8000-000000001152'),'assign');
select pg_temp.assert_true(public.inbox_bulk_undo((select id from ops115 where name='assign'))=2,'undo assign: undone');
select pg_temp.assert_true((select count(*)=0 from public.omnichannel_conversations where assigned_to is not null and workspace_id='00000000-0000-4000-8000-0000000115a1'),'undo assign');
select pg_temp.assert_true(pg_temp.fails('select * from public.inbox_bulk_apply((select array_agg(gen_random_uuid()) from generate_series(1,5001)),''MARK_READ'',null,null)','TOO_MANY'),'at most 5,000 at once');
select pg_temp.assert_true(pg_temp.fails('select * from public.inbox_bulk_apply(array[''00000000-0000-4000-8000-0000000115d1'']::uuid[],''TAG_ADD'',array[gen_random_uuid()],null)','INVALID_TAG'),'unknown tag refused');
select pg_temp.assert_true((select count(*)=5 from public.inbox_bulk_operations),'every run is recorded (5)');
select pg_temp.assert_true(cardinality(public.inbox_matching_conversation_ids(array['00000000-0000-4000-8000-0000000115c1','00000000-0000-4000-8000-0000000115c2']::uuid[],null,null,'all',null,null,'any',null,'00000000-0000-4000-8000-000000001151',5000))=2,'filter results: only conversations A may see');
-- B may read Suối Nguồn but not change it.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001152',true);
select pg_temp.assert_true(pg_temp.fails('select * from public.inbox_bulk_apply(array[''00000000-0000-4000-8000-0000000115d1'']::uuid[],''MARK_READ'',null,null)','FORBIDDEN'),'no Cập nhật permission: refused');
select pg_temp.assert_true((select count(*)=0 from public.inbox_bulk_operations),'B does not see A''s runs');
reset role;
-- Soda acting for A (service role): same scope and permission as A.
select set_config('request.jwt.claim.sub','',true);
select pg_temp.assert_true((select matched=2 from public.assistant_inbox_bulk('00000000-0000-4000-8000-000000001151',null,null,null,'any',null,'TAG_ADD',array['00000000-0000-4000-8000-0000000115e2']::uuid[],null,true)),'Soda: dry run counts only A''s conversations');
select pg_temp.assert_true((select affected=2 from public.assistant_inbox_bulk('00000000-0000-4000-8000-000000001151',null,null,null,'any',null,'TAG_ADD',array['00000000-0000-4000-8000-0000000115e2']::uuid[],null,false)),'Soda: tags them');
select pg_temp.assert_true((select count(*)=1 from public.inbox_bulk_operations where source='ASSISTANT' and created_by='00000000-0000-4000-8000-000000001151' and affected=2),'Soda run recorded under A');
select pg_temp.assert_true(pg_temp.fails('select * from public.assistant_inbox_bulk(''00000000-0000-4000-8000-000000001152'',null,null,null,''any'',null,''MARK_READ'',null,null,false)','FORBIDDEN'),'Soda: B has no Cập nhật permission');
rollback;
