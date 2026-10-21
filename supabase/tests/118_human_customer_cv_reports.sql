-- Verifies migration 118 (CV reports readable only with the company; AM ranking list facets).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001181','a118@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000118a1','WS 118');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000118b1','00000000-0000-4000-8000-0000000118a1','Sale');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values('00000000-0000-4000-8000-0000000118a1','00000000-0000-4000-8000-0000000118b1','customers.view');
insert into public.profiles(id,workspace_id,full_name,role_id) values('00000000-0000-4000-8000-000000001181','00000000-0000-4000-8000-0000000118a1','Sale','00000000-0000-4000-8000-0000000118b1');
insert into public.human_partners(workspace_id,partner_id,name,sale_human_id,am_ranks) values
  ('00000000-0000-4000-8000-0000000118a1',1,'Mine','94',array['Done','Doing']),('00000000-0000-4000-8000-0000000118a1',2,'Other','95',array['Done']);
insert into public.human_user_links(workspace_id,human_user_id,profile_id) values('00000000-0000-4000-8000-0000000118a1','94','00000000-0000-4000-8000-000000001181');
insert into public.human_partner_reports(workspace_id,partner_id,data) values('00000000-0000-4000-8000-0000000118a1',1,'{"a":1}'),('00000000-0000-4000-8000-0000000118a1',2,'{"a":2}');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001181',true);
select pg_temp.assert_true((select string_agg(partner_id::text, ',')='1' from public.human_partner_reports),'CV report only of customers the member may see');
select pg_temp.assert_true((select string_agg(value||'='||total, ',' order by value)='Doing=1,Done=1' from public.human_partner_facets() where kind='am_rank'),'AM ranking facets count each ranking once');
reset role;
rollback;
