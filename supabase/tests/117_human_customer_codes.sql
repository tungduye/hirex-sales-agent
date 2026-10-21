-- Verifies migration 117 (Human code names, readable with Khách hàng · Xem; facets on the new columns).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001171','a117@test.local'),('00000000-0000-4000-8000-000000001172','b117@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000117a1','WS 117');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000117b1','00000000-0000-4000-8000-0000000117a1','Lead'),('00000000-0000-4000-8000-0000000117b2','00000000-0000-4000-8000-0000000117a1','Other');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values('00000000-0000-4000-8000-0000000117a1','00000000-0000-4000-8000-0000000117b1','customers.view'),('00000000-0000-4000-8000-0000000117a1','00000000-0000-4000-8000-0000000117b1','customers.view_all');
insert into public.profiles(id,workspace_id,full_name,role_id) values('00000000-0000-4000-8000-000000001171','00000000-0000-4000-8000-0000000117a1','Lead','00000000-0000-4000-8000-0000000117b1'),('00000000-0000-4000-8000-000000001172','00000000-0000-4000-8000-0000000117a1','Other','00000000-0000-4000-8000-0000000117b2');
insert into public.human_master_codes(workspace_id,master_id,name,kind) values('00000000-0000-4000-8000-0000000117a1',200223,'Hạng 1','Xếp hạng Công việc');
insert into public.human_partners(workspace_id,partner_id,name,project_rank,job_rank,am_rank,location) values
  ('00000000-0000-4000-8000-0000000117a1',1,'A','B1. Leader','Hạng 1','Doing','Hà Nội'),('00000000-0000-4000-8000-0000000117a1',2,'B','B1. Leader','Hạng 2',null,'Hà Nội');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001171',true);
select pg_temp.assert_true((select name='Hạng 1' from public.human_master_codes where master_id=200223),'code names readable with Khách hàng · Xem');
select pg_temp.assert_true((select total=2 from public.human_partner_facets() where kind='project_rank' and value='B1. Leader'),'facet: Xếp hạng dự án');
select pg_temp.assert_true((select count(*)=2 from public.human_partner_facets() where kind='job_rank'),'facet: Hạng');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001172',true);
select pg_temp.assert_true((select count(*)=0 from public.human_master_codes),'no permission: no code names');
reset role;
rollback;
