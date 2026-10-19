-- Verifies migration 071 (content library). Run through supabase/tests/run-local.sh.
-- Everything runs inside one transaction and is rolled back.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
-- Runs a statement and reports whether it raised (used for RLS / constraint / privilege checks).
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
grant execute on function pg_temp.fails(text) to authenticated;

-- Fixture: one workspace, a writer (view+create), a reader (view only), an outsider workspace.
insert into auth.users(id,email) values
  ('00000000-0000-4000-8000-000000000711','writer@test.local'),
  ('00000000-0000-4000-8000-000000000712','reader@test.local'),
  ('00000000-0000-4000-8000-000000000713','other@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000007a1','WS 071'),('00000000-0000-4000-8000-0000000007a2','WS 071 other');
insert into public.workspace_roles(id,workspace_id,name,is_system) values
  ('00000000-0000-4000-8000-0000000007b1','00000000-0000-4000-8000-0000000007a1','Writer 071',false),
  ('00000000-0000-4000-8000-0000000007b2','00000000-0000-4000-8000-0000000007a1','Reader 071',false),
  ('00000000-0000-4000-8000-0000000007b3','00000000-0000-4000-8000-0000000007a2','Quản trị viên',true);
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values
  ('00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-0000000007b1','content.view'),
  ('00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-0000000007b1','content.create'),
  ('00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-0000000007b2','content.view');
insert into public.profiles(id,workspace_id,full_name,role_id) values
  ('00000000-0000-4000-8000-000000000711','00000000-0000-4000-8000-0000000007a1','Writer','00000000-0000-4000-8000-0000000007b1'),
  ('00000000-0000-4000-8000-000000000712','00000000-0000-4000-8000-0000000007a1','Reader','00000000-0000-4000-8000-0000000007b2'),
  ('00000000-0000-4000-8000-000000000713','00000000-0000-4000-8000-0000000007a2','Other','00000000-0000-4000-8000-0000000007b3');

-- Privilege shape
select pg_temp.assert_true(not has_column_privilege('authenticated','public.content_items','code','insert'),'browser cannot choose a content code');
select pg_temp.assert_true(not has_column_privilege('authenticated','public.content_items','created_at','insert'),'browser cannot backdate content');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.content_items','update'),'saved content is immutable');
select pg_temp.assert_true(not has_column_privilege('authenticated','public.content_batches','job_title','update'),'brief cannot be rewritten');
select pg_temp.assert_true(has_column_privilege('authenticated','public.content_batches','status','update'),'batch outcome can be recorded');
select pg_temp.assert_true(not has_table_privilege('anon','public.content_items','select'),'anon cannot read content');

-- Writer creates a batch and two items through RLS.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000711',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into public.content_batches(id,workspace_id,created_by,job_title,style,content_language,content_format,department,quantity)
  values('00000000-0000-4000-8000-0000000007c1','00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-000000000711','Java Developer','PROFESSIONAL','VI_JA','EMAIL','REC',3);
insert into public.content_items(id,workspace_id,batch_id,title,body,job_title,content_language,content_format,department,style,max_similarity,created_by)
  values('00000000-0000-4000-8000-0000000007d1','00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-0000000007c1','Tiêu đề 1','Nội dung 1','Java Developer','VI_JA','EMAIL','REC','PROFESSIONAL',0,'00000000-0000-4000-8000-000000000711');
insert into public.content_items(id,workspace_id,batch_id,title,body,job_title,content_language,content_format,department,style,max_similarity,most_similar_item_id,created_by)
  values('00000000-0000-4000-8000-0000000007d2','00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-0000000007c1','Tiêu đề 2','Nội dung 2','Java Developer','VI_JA','EMAIL','REC','PROFESSIONAL',0.5,'00000000-0000-4000-8000-0000000007d1','00000000-0000-4000-8000-000000000711');
select pg_temp.assert_true((select count(*) from public.content_items where batch_id='00000000-0000-4000-8000-0000000007c1')=2,'writer sees own items');
select pg_temp.assert_true((select bool_and(code ~ '^[0-9]{6}_[A-Z0-9]+_[A-Z0-9]+_[A-Z0-9]+_[A-Z0-9]+_[0-9]{2,}$') from public.content_items),'codes have the 261019_REC_DCT_GT_VI_01 shape');
select pg_temp.assert_true((select count(distinct code) from public.content_items)=2,'each item has its own code');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_items(workspace_id,batch_id,title,body,job_title,content_language,content_format,department,style,max_similarity,created_by)
  values('00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-0000000007c1','x','y','Java','VI','EMAIL','REC','PROFESSIONAL',0.51,'00000000-0000-4000-8000-000000000711')$$),'more than 50% similar is rejected by the database');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_items(workspace_id,batch_id,code,title,body,job_title,content_language,content_format,department,style,created_by)
  values('00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-0000000007c1','CT-999999','x','y','Java','VI','EMAIL','REC','PROFESSIONAL','00000000-0000-4000-8000-000000000711')$$),'explicit code is refused');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_batches(workspace_id,created_by,job_title,style,content_language,content_format,department,quantity)
  values('00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-000000000711','Java','PROFESSIONAL','FR','EMAIL','REC',1)$$),'unknown language is refused');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_batches(workspace_id,created_by,job_title,style,content_language,content_format,department,quantity)
  values('00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-000000000711','Java','PROFESSIONAL','VI','EMAIL','REC',11)$$),'more than 10 per batch is refused');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_batches(workspace_id,created_by,job_title,style,content_language,content_format,department,quantity)
  values('00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-000000000712','Java','PROFESSIONAL','VI','EMAIL','REC',1)$$),'cannot create a batch as someone else');
update public.content_batches set status='PARTIAL',saved_count=2,rejected_count=1,completed_at=now() where id='00000000-0000-4000-8000-0000000007c1';
select pg_temp.assert_true((select status from public.content_batches where id='00000000-0000-4000-8000-0000000007c1')='PARTIAL','creator records batch outcome');
select pg_temp.assert_true(pg_temp.fails($$delete from public.content_items where id='00000000-0000-4000-8000-0000000007d1'$$) or (select count(*) from public.content_items)=2,'writer without content.delete cannot delete');

-- Reader: can see, cannot create.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000712',true);
select pg_temp.assert_true((select count(*) from public.content_items)=2,'reader sees workspace items');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_batches(workspace_id,created_by,job_title,style,content_language,content_format,department,quantity)
  values('00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-000000000712','Java','PROFESSIONAL','VI','EMAIL','REC',1)$$),'reader cannot create');
update public.content_batches set status='FAILED' where id='00000000-0000-4000-8000-0000000007c1';
select pg_temp.assert_true((select status from public.content_batches where id='00000000-0000-4000-8000-0000000007c1')='PARTIAL','reader cannot change a batch');

-- Other workspace admin (granted by the migration? no: role created after it) sees nothing.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000713',true);
select pg_temp.assert_true((select count(*) from public.content_items)=0,'other workspace sees nothing');
reset role;

-- Deleting the referenced item keeps the other one and clears the link.
delete from public.content_items where id='00000000-0000-4000-8000-0000000007d1';
select pg_temp.assert_true((select most_similar_item_id is null and workspace_id is not null from public.content_items where id='00000000-0000-4000-8000-0000000007d2'),'deleting a similar item clears the link only');

-- Existing system admin roles received the permissions.
select pg_temp.assert_true(not exists(
  select 1 from public.workspace_roles r cross join (values('content.view'),('content.create'),('content.delete')) p(k)
  where r.is_system and r.name='Quản trị viên' and r.id<>'00000000-0000-4000-8000-0000000007b3'
    and not exists(select 1 from public.workspace_role_permissions rp where rp.role_id=r.id and rp.permission_key=p.k)),'system admins hold content permissions');
rollback;
