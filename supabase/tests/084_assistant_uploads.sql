-- Verifies migration 084. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000841','a@test.local'),('00000000-0000-4000-8000-000000000842','b@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000008ab','WS 084');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000008bb','00000000-0000-4000-8000-0000000008ab','Staff 084');
insert into public.profiles(id,workspace_id,full_name,role_id) values
 ('00000000-0000-4000-8000-000000000841','00000000-0000-4000-8000-0000000008ab','A','00000000-0000-4000-8000-0000000008bb'),
 ('00000000-0000-4000-8000-000000000842','00000000-0000-4000-8000-0000000008ab','B','00000000-0000-4000-8000-0000000008bb');
insert into public.assistant_uploads(id,workspace_id,user_id,file_name,recipients,stats) values
 ('00000000-0000-4000-8000-0000000008c1','00000000-0000-4000-8000-0000000008ab','00000000-0000-4000-8000-000000000841','a.csv','[{"email":"x@y.vn"}]','{"addedRows":1}');
select pg_temp.assert_true((select expires_at > now() + interval '23 hours' from public.assistant_uploads where id='00000000-0000-4000-8000-0000000008c1'),'uploads expire after 24 hours');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_uploads(workspace_id,user_id,file_name,recipients) values('00000000-0000-4000-8000-0000000008ab','00000000-0000-4000-8000-000000000841','b.csv','{}')$$),'recipients must be a list');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_uploads(workspace_id,user_id,file_name) values('00000000-0000-4000-8000-0000000008ab','00000000-0000-4000-8000-000000000841','  ')$$),'file name required');
-- Members only see their own uploads.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000842';
select pg_temp.assert_true((select count(*) from public.assistant_uploads)=0,'another member cannot read the upload');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_uploads(workspace_id,user_id,file_name) values('00000000-0000-4000-8000-0000000008ab','00000000-0000-4000-8000-000000000842','c.csv')$$),'members cannot write uploads directly');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000841';
select pg_temp.assert_true((select count(*) from public.assistant_uploads)=1,'the owner can read the upload');
reset role;
insert into public.assistant_actions(workspace_id,user_id,kind) values('00000000-0000-4000-8000-0000000008ab','00000000-0000-4000-8000-000000000841','CREATE_EMAIL_CAMPAIGNS');
select pg_temp.assert_true(true,'CREATE_EMAIL_CAMPAIGNS accepted');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_actions(workspace_id,user_id,kind) values('00000000-0000-4000-8000-0000000008ab','00000000-0000-4000-8000-000000000841','LAUNCH_CAMPAIGN')$$),'launch kinds are still refused');
rollback;
