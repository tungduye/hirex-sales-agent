-- Verifies migration 136 (Soda's "remove people from a Zalo group" card).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
insert into auth.users(id,email) values('99000000-0000-4000-8000-000000013601','a136@test.local');
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000013602','WS 136');
insert into public.workspace_roles(id,workspace_id,name) values('99000000-0000-4000-8000-000000013603','99000000-0000-4000-8000-000000013602','Role 136');
insert into public.profiles(id,workspace_id,full_name,role_id) values('99000000-0000-4000-8000-000000013601','99000000-0000-4000-8000-000000013602','A','99000000-0000-4000-8000-000000013603');
insert into public.assistant_actions(workspace_id,user_id,kind,params,preview,expires_at) values('99000000-0000-4000-8000-000000013602','99000000-0000-4000-8000-000000013601','REMOVE_GROUP_MEMBERS','{}','{}',now() + interval '15 minutes');
select pg_temp.assert_true(true,'REMOVE_GROUP_MEMBERS cards are allowed');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_actions(workspace_id,user_id,kind,params,preview,expires_at) values('99000000-0000-4000-8000-000000013602','99000000-0000-4000-8000-000000013601','DELETE_EVERYTHING','{}','{}',now())$$),'other kinds still refused');
rollback;
