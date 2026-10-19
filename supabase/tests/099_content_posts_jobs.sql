-- Verifies migration 099 (posts, job link, copy count). Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
grant execute on function pg_temp.fails(text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000009901','a99@test.local'),('00000000-0000-4000-8000-000000009902','b99@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000099a1','WS 099');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000099b1','00000000-0000-4000-8000-0000000099a1','Viewer');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values('00000000-0000-4000-8000-0000000099a1','00000000-0000-4000-8000-0000000099b1','content.view');
insert into public.profiles(id,workspace_id,full_name,role_id) values('00000000-0000-4000-8000-000000009901','00000000-0000-4000-8000-0000000099a1','A','00000000-0000-4000-8000-0000000099b1'),
  ('00000000-0000-4000-8000-000000009902','00000000-0000-4000-8000-0000000099a1','B','00000000-0000-4000-8000-0000000099b1');
insert into public.recruitment_jobs(id,workspace_id,title,career_track,company_name,location) values('00000000-0000-4000-8000-0000000099c1','00000000-0000-4000-8000-0000000099a1','BrSE','BrSE','Cty','Hà Nội');
insert into public.content_batches(id,workspace_id,created_by,job_title,style,content_language,content_format,department,quantity,job_id)
  values('00000000-0000-4000-8000-0000000099d1','00000000-0000-4000-8000-0000000099a1','00000000-0000-4000-8000-000000009901','BrSE','PROFESSIONAL','VI','POST_LONG','REC',1,'00000000-0000-4000-8000-0000000099c1');
insert into public.content_items(id,workspace_id,batch_id,title,body,job_title,content_language,content_format,department,style,max_similarity,created_by,job_id)
  values('00000000-0000-4000-8000-0000000099e1','00000000-0000-4000-8000-0000000099a1','00000000-0000-4000-8000-0000000099d1','T','B','BrSE','VI','POST_LONG','REC','PROFESSIONAL',0,'00000000-0000-4000-8000-000000009901','00000000-0000-4000-8000-0000000099c1');
select pg_temp.assert_true((select copy_count=0 and job_id is not null from public.content_items where id='00000000-0000-4000-8000-0000000099e1'),'content keeps its job and starts with 0 copies');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009901',true);
select pg_temp.assert_true(not pg_temp.fails($$insert into public.content_item_posts(workspace_id,content_item_id,channel,place,posted_by) values('00000000-0000-4000-8000-0000000099a1','00000000-0000-4000-8000-0000000099e1','FACEBOOK_GROUP','Cộng đồng BrSE','00000000-0000-4000-8000-000000009901')$$),'a viewer marks where they posted');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_item_posts(workspace_id,content_item_id,channel,place,posted_by) values('00000000-0000-4000-8000-0000000099a1','00000000-0000-4000-8000-0000000099e1','FACEBOOK_GROUP','x','00000000-0000-4000-8000-000000009902')$$),'nobody marks a post in someone else''s name');
select pg_temp.assert_true(pg_temp.fails($$insert into public.content_item_posts(workspace_id,content_item_id,channel,place,posted_by) values('00000000-0000-4000-8000-0000000099a1','00000000-0000-4000-8000-0000000099e1','TIKTOK','x','00000000-0000-4000-8000-000000009901')$$),'unknown channel refused');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009902',true);
delete from public.content_item_posts;
reset role;
select pg_temp.assert_true((select count(*)=1 from public.content_item_posts),'others cannot remove my mark');
delete from public.recruitment_jobs where id='00000000-0000-4000-8000-0000000099c1';
select pg_temp.assert_true((select job_id is null from public.content_items where id='00000000-0000-4000-8000-0000000099e1'),'deleting the job keeps the content');
rollback;
