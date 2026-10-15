-- Verifies migration 072 (content templates, departments, new brief fields). Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
grant execute on function pg_temp.fails(text) to authenticated;

insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000721','editor@test.local'),('00000000-0000-4000-8000-000000000722','viewer@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000007a7','WS 072');
insert into public.workspace_roles(id,workspace_id,name) values
  ('00000000-0000-4000-8000-0000000007b7','00000000-0000-4000-8000-0000000007a7','Editor 072'),
  ('00000000-0000-4000-8000-0000000007b8','00000000-0000-4000-8000-0000000007a7','Viewer 072');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values
  ('00000000-0000-4000-8000-0000000007a7','00000000-0000-4000-8000-0000000007b7','content.view'),
  ('00000000-0000-4000-8000-0000000007a7','00000000-0000-4000-8000-0000000007b7','content.create'),
  ('00000000-0000-4000-8000-0000000007a7','00000000-0000-4000-8000-0000000007b7','content.templates'),
  ('00000000-0000-4000-8000-0000000007a7','00000000-0000-4000-8000-0000000007b8','content.view');
insert into public.profiles(id,workspace_id,full_name,role_id) values
  ('00000000-0000-4000-8000-000000000721','00000000-0000-4000-8000-0000000007a7','Editor','00000000-0000-4000-8000-0000000007b7'),
  ('00000000-0000-4000-8000-000000000722','00000000-0000-4000-8000-0000000007a7','Viewer','00000000-0000-4000-8000-0000000007b8');
insert into public.content_templates(id,workspace_id,code,department,body) values('00000000-0000-4000-8000-0000000007e1','00000000-0000-4000-8000-0000000007a7','LEARN_X','REC','Mẫu có sẵn');

select pg_temp.assert_true(not has_column_privilege('authenticated','public.content_templates','code','insert'),'template code is assigned by the database');
select pg_temp.assert_true(not has_column_privilege('authenticated','public.content_templates','workspace_id','update'),'template cannot move workspace');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000721',true);
insert into public.content_templates(id,workspace_id,department,language,body,created_by)
  values('00000000-0000-4000-8000-0000000007e2','00000000-0000-4000-8000-0000000007a7','CTV','VI','Mẫu CTV mới','00000000-0000-4000-8000-000000000721');
select pg_temp.assert_true((select code ~ '^MAU-[0-9]{4,}$' from public.content_templates where id='00000000-0000-4000-8000-0000000007e2'),'new template gets MAU-0001 style code');
update public.content_templates set active=false, weight=7 where id='00000000-0000-4000-8000-0000000007e1';
select pg_temp.assert_true((select not active and weight=7 from public.content_templates where id='00000000-0000-4000-8000-0000000007e1'),'editor updates template');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_templates(workspace_id,department,body,created_by) values('00000000-0000-4000-8000-0000000007a7','MARKETING','x','00000000-0000-4000-8000-000000000721')$$),'unknown department refused');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_templates(workspace_id,department,body,created_by,weight) values('00000000-0000-4000-8000-0000000007a7','REC','x','00000000-0000-4000-8000-000000000721',11)$$),'weight above 10 refused');
insert into public.content_batches(workspace_id,created_by,job_title,style,content_language,content_format,department,quantity,jd_text,blocked_terms,template_ids)
  values('00000000-0000-4000-8000-0000000007a7','00000000-0000-4000-8000-000000000721','BrSE','PROFESSIONAL','VI','POST_LONG','HR',2,'JD','ABC Corp',array['00000000-0000-4000-8000-0000000007e1'::uuid]);
select pg_temp.assert_true(exists(select 1 from public.content_batches where content_format='POST_LONG' and department='HR'),'POST_LONG format, HR department and new brief fields accepted');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_batches(workspace_id,created_by,job_title,style,content_language,content_format,department,quantity)
  values('00000000-0000-4000-8000-0000000007a7','00000000-0000-4000-8000-000000000721','BrSE','PROFESSIONAL','VI','POST_LONG','RECRUITING',1)$$),'old department codes refused');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000722',true);
select pg_temp.assert_true((select count(*) from public.content_templates)=2,'viewer sees templates');
update public.content_templates set body='hacked' where id='00000000-0000-4000-8000-0000000007e2';
select pg_temp.assert_true((select body from public.content_templates where id='00000000-0000-4000-8000-0000000007e2')='Mẫu CTV mới','viewer cannot edit templates');
delete from public.content_templates;
select pg_temp.assert_true((select count(*) from public.content_templates)=2,'viewer cannot delete templates');
reset role;
rollback;
