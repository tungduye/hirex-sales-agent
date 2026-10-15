-- Verifies migration 081. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
grant execute on function pg_temp.fails(text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000811','admin81@test.local'),('00000000-0000-4000-8000-000000000812','staff81@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000008f1','WS 081');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000008f2','00000000-0000-4000-8000-0000000008f1','Editor 081'),('00000000-0000-4000-8000-0000000008f3','00000000-0000-4000-8000-0000000008f1','Viewer 081');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values
  ('00000000-0000-4000-8000-0000000008f1','00000000-0000-4000-8000-0000000008f2','content.view'),('00000000-0000-4000-8000-0000000008f1','00000000-0000-4000-8000-0000000008f2','content.templates'),
  ('00000000-0000-4000-8000-0000000008f1','00000000-0000-4000-8000-0000000008f3','content.view');
insert into public.profiles(id,workspace_id,full_name,role_id) values('00000000-0000-4000-8000-000000000811','00000000-0000-4000-8000-0000000008f1','Editor','00000000-0000-4000-8000-0000000008f2'),('00000000-0000-4000-8000-000000000812','00000000-0000-4000-8000-0000000008f1','Viewer','00000000-0000-4000-8000-0000000008f3');
insert into public.content_categories(id,workspace_id,department,name) values
  ('00000000-0000-4000-8000-0000000008c1','00000000-0000-4000-8000-0000000008f1','SALE','Giới thiệu'),
  ('00000000-0000-4000-8000-0000000008c2','00000000-0000-4000-8000-0000000008f1','MEDIA','Sự kiện');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_categories(workspace_id,department,name) values('00000000-0000-4000-8000-0000000008f1','SALE',' giới thiệu ')$$),'category names are unique per department, ignoring case and spaces');
select pg_temp.assert_true(not pg_temp.fails($$insert into public.content_templates(workspace_id,department,language,body,content_format,category_id) values('00000000-0000-4000-8000-0000000008f1','SALE','JA','本文','COMMENT','00000000-0000-4000-8000-0000000008c1')$$),'template with new format, JA and a Sale category');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_templates(workspace_id,department,language,body,category_id) values('00000000-0000-4000-8000-0000000008f1','REC','VI','x','00000000-0000-4000-8000-0000000008c1')$$),'a category of another department is refused');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_templates(workspace_id,department,language,body,content_format) values('00000000-0000-4000-8000-0000000008f1','NOTICE','VI','x','STORY')$$),'old format codes are refused');
select pg_temp.assert_true(not pg_temp.fails($$insert into public.content_templates(workspace_id,department,language,body) values('00000000-0000-4000-8000-0000000008f1','NOTICE','VI','x')$$),'Thông báo is a department');
delete from public.content_categories where id='00000000-0000-4000-8000-0000000008c1';
select pg_temp.assert_true((select count(*) from public.content_templates where workspace_id='00000000-0000-4000-8000-0000000008f1' and department='SALE' and category_id is null)=1,'deleting a category keeps its templates (category cleared)');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000812',true);
select pg_temp.assert_true((select count(*) from public.content_categories where workspace_id='00000000-0000-4000-8000-0000000008f1')=1,'viewers can read categories');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_categories(workspace_id,department,name) values('00000000-0000-4000-8000-0000000008f1','SALE','Khác')$$),'viewers cannot add categories');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000811',true);
select pg_temp.assert_true(not pg_temp.fails($$insert into public.content_categories(workspace_id,department,name) values('00000000-0000-4000-8000-0000000008f1','SALE','Khác')$$),'template managers add categories');
reset role;
select pg_temp.assert_true((select count(*) from public.content_categories c join public.workspaces w on w.id=c.workspace_id where w.name<>'WS 081')=(select count(*)*2 from public.workspaces where name<>'WS 081'),'every existing workspace is seeded with the two Sale categories');
rollback;
