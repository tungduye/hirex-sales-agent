-- Verifies migration 125 (Màn CV): who sees which CV (Rec or "Xem tất cả CV"), facets and counts for Soda.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001251','rec125@test.local'),('00000000-0000-4000-8000-000000001252','all125@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000125a1','WS 125');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000125b1','00000000-0000-4000-8000-0000000125a1','Rec 125'),('00000000-0000-4000-8000-0000000125b2','00000000-0000-4000-8000-0000000125a1','Lead 125');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values
  ('00000000-0000-4000-8000-0000000125a1','00000000-0000-4000-8000-0000000125b1','cvs.view'),
  ('00000000-0000-4000-8000-0000000125a1','00000000-0000-4000-8000-0000000125b2','cvs.view'),('00000000-0000-4000-8000-0000000125a1','00000000-0000-4000-8000-0000000125b2','cvs.view_all');
insert into public.profiles(id,workspace_id,full_name,role_id) values
  ('00000000-0000-4000-8000-000000001251','00000000-0000-4000-8000-0000000125a1','Rec','00000000-0000-4000-8000-0000000125b1'),
  ('00000000-0000-4000-8000-000000001252','00000000-0000-4000-8000-0000000125a1','Lead','00000000-0000-4000-8000-0000000125b2');
insert into public.human_user_links(workspace_id,human_user_id,human_name,profile_id) values('00000000-0000-4000-8000-0000000125a1','188','Vân Anh','00000000-0000-4000-8000-000000001251');
insert into public.human_cvs(workspace_id,cv_id,name,status2,position,recer_human_id,block_keys,human_created_at,search_text) values
  ('00000000-0000-4000-8000-0000000125a1',1,'An','PV1','BrSE','188',array['CV_GOC'],now() - interval '1 day','an brse java'),
  ('00000000-0000-4000-8000-0000000125a1',2,'Bình','CV gửi','PM','204',array['CV_GOC'],now() - interval '40 days','binh pm'),
  ('00000000-0000-4000-8000-0000000125a1',3,'Cường','CV gửi','BrSE','188',array['CV_GOC'],now() - interval '2 days','cuong brse');
grant select on public.human_cvs, public.human_user_links, public.human_cv_blocks to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001251',true);
select pg_temp.assert_true((select string_agg(cv_id::text, ',' order by cv_id) from public.human_cvs)='1,3','a Rec sees only the CVs they are Rec of');
select pg_temp.assert_true((select count(*)=1 from public.human_user_links),'a Rec without Khách hàng can read the Human people links');
select pg_temp.assert_true((select string_agg(value||'='||total, ',' order by value) from public.human_cv_facets() where kind='status2')='CV gửi=1,PV1=1','facets within their CVs');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001252',true);
select pg_temp.assert_true((select count(*)=3 from public.human_cvs),'"Xem tất cả CV" sees every CV');
select pg_temp.assert_true((select string_agg(value||'='||total, ',' order by value) from public.human_cv_stats('position', null, null, null, null))='BrSE=2,PM=1','counts by position');
select pg_temp.assert_true((select string_agg(value||'='||total, ',' order by value) from public.human_cv_stats('position', now() - interval '7 days', now(), 'brse', null))='BrSE=2','new this week with a search');
select pg_temp.assert_true((select sum(total)=2 from public.human_cv_stats('status2', null, null, null, array['188'])),'only some Recs');
reset role;
rollback;
