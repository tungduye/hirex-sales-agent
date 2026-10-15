-- Verifies migration 073. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000731','u@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000007a3','WS 073'),('00000000-0000-4000-8000-0000000007a4','WS 073 other');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000007b3','00000000-0000-4000-8000-0000000007a3','R 073');
insert into public.profiles(id,workspace_id,full_name,role_id) values('00000000-0000-4000-8000-000000000731','00000000-0000-4000-8000-0000000007a3','U','00000000-0000-4000-8000-0000000007b3');
insert into public.content_templates(id,workspace_id,code,department,body) values
  ('00000000-0000-4000-8000-0000000007e3','00000000-0000-4000-8000-0000000007a3','T1','REC','Mẫu'),
  ('00000000-0000-4000-8000-0000000007e4','00000000-0000-4000-8000-0000000007a4','T2','REC','Mẫu khác');
insert into public.content_batches(id,workspace_id,created_by,job_title,style,content_language,content_format,department,quantity)
  values('00000000-0000-4000-8000-0000000007c3','00000000-0000-4000-8000-0000000007a3','00000000-0000-4000-8000-000000000731','Job','PROFESSIONAL','VI','POST_LONG','REC',2);
insert into public.content_items(id,workspace_id,batch_id,title,body,job_title,content_language,content_format,department,style,created_by,template_id)
  values('00000000-0000-4000-8000-0000000007d3','00000000-0000-4000-8000-0000000007a3','00000000-0000-4000-8000-0000000007c3','t','b','Job','VI','POST_LONG','REC','PROFESSIONAL','00000000-0000-4000-8000-000000000731','00000000-0000-4000-8000-0000000007e3');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_items(workspace_id,batch_id,title,body,job_title,content_language,content_format,department,style,created_by,template_id)
  values('00000000-0000-4000-8000-0000000007a3','00000000-0000-4000-8000-0000000007c3','t','b2','Job','VI','POST_LONG','REC','PROFESSIONAL','00000000-0000-4000-8000-000000000731','00000000-0000-4000-8000-0000000007e4')$$),'template of another workspace refused');
select pg_temp.assert_true(has_column_privilege('authenticated','public.content_items','template_id','insert'),'template id can be recorded');
delete from public.content_templates where id='00000000-0000-4000-8000-0000000007e3';
select pg_temp.assert_true((select template_id is null and workspace_id is not null from public.content_items where id='00000000-0000-4000-8000-0000000007d3'),'deleting a template keeps the content');
rollback;
