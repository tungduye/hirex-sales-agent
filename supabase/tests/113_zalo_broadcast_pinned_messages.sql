-- Verifies migration 113 (pinning the sent message vs adding a note).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
insert into auth.users(id,email) values('99000000-0000-4000-8000-000000001301','a113@test.local');
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000001302','WS 113');
insert into public.workspace_roles(id,workspace_id,name) values('99000000-0000-4000-8000-000000001303','99000000-0000-4000-8000-000000001302','Role 113');
insert into public.profiles(id,workspace_id,full_name,role_id) values('99000000-0000-4000-8000-000000001301','99000000-0000-4000-8000-000000001302','A','99000000-0000-4000-8000-000000001303');
insert into public.zalo_broadcasts(workspace_id,name,text_content,send_message,pin_message,created_by) values('99000000-0000-4000-8000-000000001302','Ghim','Tin','true','true','99000000-0000-4000-8000-000000001301');
select pg_temp.assert_true((select pin_message from public.zalo_broadcasts where name='Ghim'),'a message can be sent and pinned');
select pg_temp.assert_true(pg_temp.fails($$insert into public.zalo_broadcasts(workspace_id,name,text_content,send_message,pin_message,pin_note,created_by) values('99000000-0000-4000-8000-000000001302','X','Y',false,true,true,'99000000-0000-4000-8000-000000001301')$$),'pinning a message needs the message');
select pg_temp.assert_true((select count(*)=1 from information_schema.columns where table_name='zalo_broadcast_targets' and column_name='message_pin_status'),'targets track the pinned message');
rollback;
