-- Verifies migration 075. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000751','a@test.local'),('00000000-0000-4000-8000-000000000752','b@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000007a9','WS 075');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000007b9','00000000-0000-4000-8000-0000000007a9','Staff 075');
insert into public.profiles(id,workspace_id,full_name,role_id) values
  ('00000000-0000-4000-8000-000000000751','00000000-0000-4000-8000-0000000007a9','A','00000000-0000-4000-8000-0000000007b9'),
  ('00000000-0000-4000-8000-000000000752','00000000-0000-4000-8000-0000000007a9','B','00000000-0000-4000-8000-0000000007b9');
insert into public.assistant_actions(id,workspace_id,user_id,kind,params,preview) values
  ('00000000-0000-4000-8000-0000000007f1','00000000-0000-4000-8000-0000000007a9','00000000-0000-4000-8000-000000000751','CREATE_TASK','{"title":"x"}','{"title":"Tạo công việc"}'),
  ('00000000-0000-4000-8000-0000000007f2','00000000-0000-4000-8000-0000000007a9','00000000-0000-4000-8000-000000000752','SET_LEAD_STATUS','{}','{}');
select pg_temp.assert_true((select expires_at > now() + interval '14 minutes' from public.assistant_actions where id='00000000-0000-4000-8000-0000000007f1'),'proposal expires after 15 minutes');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_actions(workspace_id,user_id,kind) values('00000000-0000-4000-8000-0000000007a9','00000000-0000-4000-8000-000000000751','SEND_MESSAGE')$$),'unsupported action kind refused');
select pg_temp.assert_true(pg_temp.fails($$update public.assistant_actions set status='EXECUTED' where id='00000000-0000-4000-8000-0000000007f1'$$),'status change requires decided_at');
-- Atomic claim: only one of two concurrent confirms wins.
create function pg_temp.claim() returns integer language sql as $$
  with claimed as (update public.assistant_actions set status='EXECUTING',decided_at=now() where id='00000000-0000-4000-8000-0000000007f1' and status='PROPOSED' returning 1) select count(*)::integer from claimed
$$;
select pg_temp.assert_true(pg_temp.claim()=1,'first confirm claims the action');
select pg_temp.assert_true(pg_temp.claim()=0,'second confirm claims nothing');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.assistant_actions','update'),'browser cannot confirm directly');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000751',true);
select pg_temp.assert_true((select count(*) from public.assistant_actions)=1,'member sees only own proposals');
reset role;
rollback;
