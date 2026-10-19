-- Verifies migration 096 (Bảng Job). Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated, service_role;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000009601','a96@test.local'),('00000000-0000-4000-8000-000000009602','b96@test.local'),('00000000-0000-4000-8000-000000009603','c96@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000096a1','WS 096'),('00000000-0000-4000-8000-0000000096a2','Other 096');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000096b1','00000000-0000-4000-8000-0000000096a1','Manage'),('00000000-0000-4000-8000-0000000096b2','00000000-0000-4000-8000-0000000096a1','View'),('00000000-0000-4000-8000-0000000096b3','00000000-0000-4000-8000-0000000096a2','Other');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values
  ('00000000-0000-4000-8000-0000000096a1','00000000-0000-4000-8000-0000000096b1','jobs.view'),('00000000-0000-4000-8000-0000000096a1','00000000-0000-4000-8000-0000000096b1','jobs.manage'),
  ('00000000-0000-4000-8000-0000000096a1','00000000-0000-4000-8000-0000000096b2','jobs.view'),('00000000-0000-4000-8000-0000000096a2','00000000-0000-4000-8000-0000000096b3','jobs.view');
insert into public.profiles(id,workspace_id,full_name,role_id) values
  ('00000000-0000-4000-8000-000000009601','00000000-0000-4000-8000-0000000096a1','M','00000000-0000-4000-8000-0000000096b1'),
  ('00000000-0000-4000-8000-000000009602','00000000-0000-4000-8000-0000000096a1','V','00000000-0000-4000-8000-0000000096b2'),
  ('00000000-0000-4000-8000-000000009603','00000000-0000-4000-8000-0000000096a2','O','00000000-0000-4000-8000-0000000096b3');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009601',true);
insert into public.recruitment_jobs(workspace_id,title,career_track,company_name,location,created_by,updated_by) values('00000000-0000-4000-8000-0000000096a1','BrSE','BrSE','Cty A','Hà Nội','00000000-0000-4000-8000-000000009601','00000000-0000-4000-8000-000000009601');
select pg_temp.assert_true((select code like 'J-%' and status='OPEN' and priority='NORMAL' and company_name_public from public.recruitment_jobs),'managers add jobs with a generated code and defaults');
update public.recruitment_jobs set status='CLOSED' where title='BrSE';
select pg_temp.assert_true((select status='CLOSED' from public.recruitment_jobs),'managers close jobs');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009602',true);
select pg_temp.assert_true((select count(*)=1 from public.recruitment_jobs),'viewers read jobs');
update public.recruitment_jobs set status='OPEN';
select pg_temp.assert_true((select status='CLOSED' from public.recruitment_jobs),'viewers cannot change jobs');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009603',true);
select pg_temp.assert_true((select count(*)=0 from public.recruitment_jobs),'another workspace sees nothing');
reset role;
select pg_temp.assert_true(not has_table_privilege('authenticated','public.recruitment_jobs','delete'),'nobody deletes jobs, they are closed');
do $$ begin
  insert into public.recruitment_jobs(workspace_id,title,career_track,company_name,location,jd_link) values('00000000-0000-4000-8000-0000000096a1','x','x','x','x','javascript:alert(1)');
  raise exception 'FAIL: unsafe JD link accepted';
exception when check_violation then raise notice 'PASS: JD link must be http(s)'; end $$;
rollback;
