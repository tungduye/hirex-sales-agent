-- Verifies migration 078. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000781','a@test.local'),('00000000-0000-4000-8000-000000000782','b@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000007e9','WS 078');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000007f9','00000000-0000-4000-8000-0000000007e9','Staff 078');
insert into public.profiles(id,workspace_id,full_name,role_id) values
  ('00000000-0000-4000-8000-000000000781','00000000-0000-4000-8000-0000000007e9','A','00000000-0000-4000-8000-0000000007f9'),
  ('00000000-0000-4000-8000-000000000782','00000000-0000-4000-8000-0000000007e9','B','00000000-0000-4000-8000-0000000007f9');
insert into public.assistant_alerts(workspace_id,user_id,kind,dedupe_key,severity,title,link) values
  ('00000000-0000-4000-8000-0000000007e9','00000000-0000-4000-8000-000000000781','CHANNEL_DOWN','channel:x','high','Zalo mất kết nối','/settings/channels'),
  ('00000000-0000-4000-8000-0000000007e9','00000000-0000-4000-8000-000000000782','CHANNEL_DOWN','channel:x','high','Zalo mất kết nối','/settings/channels');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_alerts(workspace_id,user_id,kind,dedupe_key,severity,title) values('00000000-0000-4000-8000-0000000007e9','00000000-0000-4000-8000-000000000781','CHANNEL_DOWN','channel:x','high','again')$$),'no second open alert for the same problem');
update public.assistant_alerts set resolved_at=now() where user_id='00000000-0000-4000-8000-000000000781';
insert into public.assistant_alerts(workspace_id,user_id,kind,dedupe_key,severity,title) values('00000000-0000-4000-8000-0000000007e9','00000000-0000-4000-8000-000000000781','CHANNEL_DOWN','channel:x','high','again');
select pg_temp.assert_true((select count(*) from public.assistant_alerts where user_id='00000000-0000-4000-8000-000000000781')=2,'a problem that comes back after being fixed alerts again');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_alerts(workspace_id,user_id,kind,dedupe_key,severity,title,link) values('00000000-0000-4000-8000-0000000007e9','00000000-0000-4000-8000-000000000781','CHANNEL_DOWN','k2','high','t','https://evil.example')$$),'only internal links');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_alerts(workspace_id,user_id,kind,dedupe_key,severity,title) values('00000000-0000-4000-8000-0000000007e9','00000000-0000-4000-8000-000000000781','SEND_SPAM','k3','high','t')$$),'unknown kind refused');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.assistant_alerts','update'),'browser cannot change alerts directly');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000782',true);
select pg_temp.assert_true((select count(*) from public.assistant_alerts)=1,'member sees only own alerts');
reset role;
rollback;
