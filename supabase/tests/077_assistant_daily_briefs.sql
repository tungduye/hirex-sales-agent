-- Verifies migration 077. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000771','a@test.local'),('00000000-0000-4000-8000-000000000772','b@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000007c9','WS 077');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000007d9','00000000-0000-4000-8000-0000000007c9','Staff 077');
insert into public.profiles(id,workspace_id,full_name,role_id) values
  ('00000000-0000-4000-8000-000000000771','00000000-0000-4000-8000-0000000007c9','A','00000000-0000-4000-8000-0000000007d9'),
  ('00000000-0000-4000-8000-000000000772','00000000-0000-4000-8000-0000000007c9','B','00000000-0000-4000-8000-0000000007d9');
insert into public.assistant_daily_briefs(workspace_id,user_id,brief_date,content) values
  ('00000000-0000-4000-8000-0000000007c9','00000000-0000-4000-8000-000000000771','2026-10-14','{"items":[]}'),
  ('00000000-0000-4000-8000-0000000007c9','00000000-0000-4000-8000-000000000772','2026-10-14','{"items":[]}');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_daily_briefs(workspace_id,user_id,brief_date,content) values('00000000-0000-4000-8000-0000000007c9','00000000-0000-4000-8000-000000000771','2026-10-14','{}')$$),'one brief per member per day');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_daily_briefs(workspace_id,user_id,brief_date,content) values('00000000-0000-4000-8000-0000000007c9','00000000-0000-4000-8000-000000000771','2026-10-15','[]')$$),'content must be an object');
-- Upsert used by the server refreshes the same row.
insert into public.assistant_daily_briefs(workspace_id,user_id,brief_date,content) values('00000000-0000-4000-8000-0000000007c9','00000000-0000-4000-8000-000000000771','2026-10-14','{"items":[1]}')
  on conflict (workspace_id,user_id,brief_date) do update set content=excluded.content, generated_at=now();
select pg_temp.assert_true((select content->'items'->>0 from public.assistant_daily_briefs where user_id='00000000-0000-4000-8000-000000000771')='1','refresh replaces the day''s brief');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.assistant_daily_briefs','insert'),'browser cannot write briefs');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000771',true);
select pg_temp.assert_true((select count(*) from public.assistant_daily_briefs)=1,'member sees only own brief');
reset role;
rollback;
