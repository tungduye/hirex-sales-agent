-- Verifies migration 076. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000761','a@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000007aa','WS 076');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000007ba','00000000-0000-4000-8000-0000000007aa','Staff 076');
insert into public.profiles(id,workspace_id,full_name,role_id) values('00000000-0000-4000-8000-000000000761','00000000-0000-4000-8000-0000000007aa','A','00000000-0000-4000-8000-0000000007ba');
insert into public.assistant_actions(workspace_id,user_id,kind,params) values('00000000-0000-4000-8000-0000000007aa','00000000-0000-4000-8000-000000000761','SEND_REPLY','{"conversationId":"x"}');
select pg_temp.assert_true(true,'SEND_REPLY accepted');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_actions(workspace_id,user_id,kind) values('00000000-0000-4000-8000-0000000007aa','00000000-0000-4000-8000-000000000761','SEND_CAMPAIGN')$$),'other kinds still refused');
rollback;
