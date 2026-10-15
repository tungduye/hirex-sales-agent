-- Verifies migration 079. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000791','a@test.local'),('00000000-0000-4000-8000-000000000792','b@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000007a1','WS 079');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000007b1','00000000-0000-4000-8000-0000000007a1','Staff 079');
insert into public.profiles(id,workspace_id,full_name,role_id) values
  ('00000000-0000-4000-8000-000000000791','00000000-0000-4000-8000-0000000007a1','A','00000000-0000-4000-8000-0000000007b1'),
  ('00000000-0000-4000-8000-000000000792','00000000-0000-4000-8000-0000000007a1','B','00000000-0000-4000-8000-0000000007b1');
insert into public.assistant_rules(id,workspace_id,created_by,name,definition) values
  ('00000000-0000-4000-8000-0000000007c1','00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-000000000791','Chờ 4 giờ','{"trigger":"CUSTOMER_WAITING","hours":4}'),
  ('00000000-0000-4000-8000-0000000007c2','00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-000000000792','Của B','{"trigger":"TASK_OVERDUE","hours":0}');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_rules(workspace_id,created_by,name,definition) values('00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-000000000791','x','{"trigger":"SEND_ALL"}')$$),'unknown trigger refused');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_alerts(workspace_id,user_id,kind,dedupe_key,severity,title) values('00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-000000000791','RULE','k','medium','t')$$),'rule alert needs its rule');
insert into public.assistant_actions(id,workspace_id,user_id,kind,params,preview) values('00000000-0000-4000-8000-0000000007d1','00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-000000000791','CREATE_RULE','{}','{}');
insert into public.assistant_alerts(workspace_id,user_id,kind,dedupe_key,severity,title,rule_id,action_id) values('00000000-0000-4000-8000-0000000007a1','00000000-0000-4000-8000-000000000791','RULE','rule:x','medium','t','00000000-0000-4000-8000-0000000007c1','00000000-0000-4000-8000-0000000007d1');
delete from public.assistant_rules where id='00000000-0000-4000-8000-0000000007c1';
select pg_temp.assert_true((select count(*) from public.assistant_alerts where kind='RULE')=0,'deleting a rule removes its alerts');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.assistant_rules','insert'),'browser cannot write rules');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000792',true);
select pg_temp.assert_true((select count(*) from public.assistant_rules)=1,'member sees only own rules');
reset role;
rollback;
