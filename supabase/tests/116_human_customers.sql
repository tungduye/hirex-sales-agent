-- Verifies migration 116 (Khách hàng from Human: who sees which customer).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001161','a116@test.local'),('00000000-0000-4000-8000-000000001162','b116@test.local'),('00000000-0000-4000-8000-000000001163','c116@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000116a1','WS 116');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000116b1','00000000-0000-4000-8000-0000000116a1','Lead'),('00000000-0000-4000-8000-0000000116b2','00000000-0000-4000-8000-0000000116a1','Sale'),('00000000-0000-4000-8000-0000000116b3','00000000-0000-4000-8000-0000000116a1','Other');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values
  ('00000000-0000-4000-8000-0000000116a1','00000000-0000-4000-8000-0000000116b1','customers.view'),('00000000-0000-4000-8000-0000000116a1','00000000-0000-4000-8000-0000000116b1','customers.view_all'),
  ('00000000-0000-4000-8000-0000000116a1','00000000-0000-4000-8000-0000000116b2','customers.view');
insert into public.profiles(id,workspace_id,full_name,role_id) values
  ('00000000-0000-4000-8000-000000001161','00000000-0000-4000-8000-0000000116a1','Lead','00000000-0000-4000-8000-0000000116b1'),
  ('00000000-0000-4000-8000-000000001162','00000000-0000-4000-8000-0000000116a1','Sale','00000000-0000-4000-8000-0000000116b2'),
  ('00000000-0000-4000-8000-000000001163','00000000-0000-4000-8000-0000000116a1','Other','00000000-0000-4000-8000-0000000116b3');
insert into public.human_partners(workspace_id,partner_id,name,sale_human_id,am_human_id) values
  ('00000000-0000-4000-8000-0000000116a1',1,'Cty A','11',null),('00000000-0000-4000-8000-0000000116a1',2,'Cty B','12','11'),('00000000-0000-4000-8000-0000000116a1',3,'Cty C','13',null);
insert into public.human_user_links(workspace_id,human_user_id,profile_id) values('00000000-0000-4000-8000-0000000116a1','11','00000000-0000-4000-8000-000000001162');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001161',true);
select pg_temp.assert_true((select count(*)=3 from public.human_partners),'Xem tất cả: every customer');
select pg_temp.assert_true((select string_agg(human_user_id||'='||total, ',' order by human_user_id)='11=2,12=1,13=1' from public.human_partner_owner_counts()),'customers per Sale/AM');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001162',true);
select pg_temp.assert_true((select string_agg(partner_id::text, ',' order by partner_id)='1,2' from public.human_partners),'Sale: only customers where they are Sale or AM');
select pg_temp.assert_true((select total=2 from public.human_partner_facets() where kind='project_rank' and value=''),'facets count only what the member sees');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001163',true);
select pg_temp.assert_true((select count(*)=0 from public.human_partners),'no Khách hàng · Xem: nothing');
select pg_temp.assert_true((select count(*)=0 from public.human_user_links),'no permission: links hidden too');
reset role;
rollback;
