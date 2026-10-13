-- Verifies migration 074. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
grant execute on function pg_temp.fails(text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000741','a@test.local'),('00000000-0000-4000-8000-000000000742','b@test.local'),('00000000-0000-4000-8000-000000000743','m@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000007a5','WS 074');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000007b5','00000000-0000-4000-8000-0000000007a5','Staff 074'),('00000000-0000-4000-8000-0000000007b6','00000000-0000-4000-8000-0000000007a5','Manager 074');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values('00000000-0000-4000-8000-0000000007a5','00000000-0000-4000-8000-0000000007b6','roles.manage');
insert into public.profiles(id,workspace_id,full_name,role_id) values
  ('00000000-0000-4000-8000-000000000741','00000000-0000-4000-8000-0000000007a5','A','00000000-0000-4000-8000-0000000007b5'),
  ('00000000-0000-4000-8000-000000000742','00000000-0000-4000-8000-0000000007a5','B','00000000-0000-4000-8000-0000000007b5'),
  ('00000000-0000-4000-8000-000000000743','00000000-0000-4000-8000-0000000007a5','M','00000000-0000-4000-8000-0000000007b6');
insert into public.assistant_requests(workspace_id,user_id,question,status,tools_used) values
  ('00000000-0000-4000-8000-0000000007a5','00000000-0000-4000-8000-000000000741','Câu của A','ANSWERED','{tong_quan_crm}'),
  ('00000000-0000-4000-8000-0000000007a5','00000000-0000-4000-8000-000000000742','Câu của B','ANSWERED','{}');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_requests(workspace_id,user_id,question,status) values('00000000-0000-4000-8000-0000000007a5','00000000-0000-4000-8000-000000000741','x','DONE')$$),'unknown status refused');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.assistant_requests','insert'),'browser cannot write the log');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000741',true);
select pg_temp.assert_true((select count(*) from public.assistant_requests)=1,'member sees only own questions');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000743',true);
select pg_temp.assert_true((select count(*) from public.assistant_requests)=2,'role manager sees the workspace log');
reset role;
rollback;
